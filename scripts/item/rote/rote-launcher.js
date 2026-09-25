import { Sockets } from "../../system/sockets.js";
import { getActorTokenId, localize as t } from "../../utils.js";
import { getRollRote } from "./rote-roll.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const DRAG_TYPE = "LitmRoteLauncher";
const pendingMacros = new Map();
const activeGM = () =>
	game.users.activeGM ?? game.users.find((user) => user.isGM && user.active);

async function createLauncherMacro(rote, ownerId = game.user.id) {
	return getDocumentClass("Macro").create({
		name: rote.name,
		img: rote.img,
		type: "script",
		command: `game.litm.useRote(${JSON.stringify(rote.uuid)});`,
		ownership: { default: 0, [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
	});
}

function linkedTag(rote) {
	const actor = rote?.parent;
	const link = rote?.getFlag("litm-rn", "roteLink");
	if (actor?.type !== "character" || !link?.tagId) return null;
	const themeTag = (actor.system.themes ?? [])
		.flatMap((theme) => [theme.themeTag, ...(theme.powerTags ?? [])])
		.find((tag) => tag?.id === link.tagId);
	if (themeTag) return { actor, tag: themeTag };
	for (const story of actor.items.filter(
		(item) => item.type === "story" && !item.system.isArchived,
	)) {
		const tag = [story.system.themeTag, ...(story.system.powerTags ?? [])].find(
			(entry) => entry?.id === link.tagId,
		);
		if (tag) return { actor, tag };
	}
	return null;
}

/** Use an actor-owned Rote via a system launcher Macro or the Rotes window. */
export async function useRote(uuid) {
	const actorId = /^Actor\.([^.]+)\.Item\./.exec(uuid)?.[1];
	const owner = actorId ? game.actors.get(actorId) : null;
	if (owner && !game.user.isGM && !owner.testUserPermission(game.user, "OWNER"))
		return ui.notifications.error(t("Litm.rote.launch-no-owner"));
	const rote = await fromUuid(uuid).catch(() => null);
	if (rote?.type !== "rote")
		return ui.notifications.error(t("Litm.rote.launch-missing"));
	if (rote.parent?.documentName !== "Actor")
		return rote.sheet.render({ force: true });
	const link = linkedTag(rote);
	if (!link) return ui.notifications.error(t("Litm.rote.launch-tag-missing"));
	if (!game.user.isGM && !link.actor.testUserPermission(game.user, "OWNER"))
		return ui.notifications.error(t("Litm.rote.launch-no-owner"));
	if (!rote.system.isActive)
		return ui.notifications.error(t("Litm.rote.launch-inactive"));
	if (link.tag.isScratched)
		return ui.notifications.error(t("Litm.rote.launch-scratched"));
	const current = await getRollRote(link.actor.uuid, link.tag.id, {
		actorId: link.actor.id,
		fresh: true,
	});
	if (current?.uuid !== rote.uuid)
		return ui.notifications.error(t("Litm.rote.launch-tag-missing"));
	return new RoteUseDialog(rote, link.actor, link.tag).render({ force: true });
}

class RoteUseDialog extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--rote-use"],
		position: { width: 420, height: "auto" },
		window: {
			resizable: false,
		},
	};
	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/rote-use.html" },
	};
	constructor(rote, actor, tag) {
		super();
		this.rote = rote;
		this.actor = actor;
		this.tag = tag;
	}
	get title() {
		return this.rote?.name ?? t("Litm.rote.simple");
	}
	async _prepareContext(options) {
		return {
			...(await super._prepareContext(options)),
			rote: this.rote,
			actor: this.actor,
		};
	}
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[data-rote-mode]").forEach((button) =>
			button.addEventListener("click", async () => {
				const mode = button.dataset.roteMode;
				const rote = this.rote;
				await this.close();
				await useRoteMode(rote, mode);
			}),
		);
	}
}

/** Resolve and apply one chosen mode after rechecking the Rote and its tag. */
export async function useRoteMode(rote, mode) {
	const link = linkedTag(rote);
	if (!link) return ui.notifications.error(t("Litm.rote.launch-tag-missing"));
	if (!game.user.isGM && !link.actor.testUserPermission(game.user, "OWNER"))
		return ui.notifications.error(t("Litm.rote.launch-no-owner"));
	if (!rote.system.isActive || link.tag.isScratched)
		return ui.notifications.error(
			t(
				!rote.system.isActive
					? "Litm.rote.launch-inactive"
					: "Litm.rote.launch-scratched",
			),
		);
	const selected = await getRollRote(link.actor.uuid, link.tag.id, {
		actorId: link.actor.id,
		fresh: true,
	});
	if (selected?.uuid !== rote.uuid)
		return ui.notifications.error(t("Litm.rote.launch-tag-missing"));
	if (mode === "simpleSuccess" || mode === "simpleConsequence")
		return createSimpleRoteMessage(rote, link.actor, link.tag, selected, mode);
	const type = { quick: "quick", tracked: "tracked", reaction: "reaction" }[
		mode
	];
	if (!type) return;
	game.litm.addTagToRoll(
		link.actor.id,
		link.actor.uuid,
		link.tag.id,
		"positive",
	);
	const dialog = game.user.isGM
		? game.litm.LitmRollDialog.openForGm(link.actor.id, { type })
		: link.actor.sheet.rollDialog;
	if (!dialog) return;
	const currentTab = type === "tracked" ? "detailed" : "quick";
	const subtab = type === "reaction" ? "reaction" : "";
	if (!game.user.isGM) await dialog.render({ force: true });
	dialog.receiveUpdate({
		actorId: link.actor.id,
		type,
		currentTab,
		subtab,
		selectedRoteKey: `${link.actor.uuid}::${link.tag.id}`,
	});
}

async function createSimpleRoteMessage(rote, actor, tag, selected, mode) {
	const outcome = mode === "simpleSuccess" ? "success" : "consequence";
	const enrich = (value) =>
		foundry.applications.ux.TextEditor.implementation.enrichHTML(value || "", {
			secrets: false,
		});
	const effects =
		outcome === "success"
			? await Promise.all(
					(selected.effects ?? [])
						.filter(
							(effect) =>
								effect.type === "simpleQuick" && effect.description?.trim(),
						)
						.map(async (effect) => ({
							label: t("Litm.rote.types.simpleQuick"),
							html: await enrich(effect.description),
						})),
				)
			: [];
	const consequences =
		outcome === "consequence"
			? await Promise.all(
					(selected.consequences ?? [])
						.filter((value) => value?.trim())
						.map(enrich),
				)
			: [];
	const rollId = foundry.utils.randomID();
	const content = await foundry.applications.handlebars.renderTemplate(
		game.litm.LitmRoll.CHAT_TEMPLATE,
		{
			actor,
			type: "simple",
			simple: true,
			outcome: { label: outcome, description: "" },
			total: "",
			tooltip: "",
			power: null,
			rote: {
				uuid: rote.uuid,
				name: rote.name,
				img: rote.img,
				effects,
				consequences,
			},
		},
	);
	const message = await CONFIG.ChatMessage.documentClass.create({
		content,
		speaker: CONFIG.ChatMessage.documentClass.getSpeaker({ actor }),
		flavor: t("Litm.rote.simple"),
		flags: {
			"litm-rn": {
				roteSimple: {
					rollId,
					actorId: actor.id,
					roteUuid: rote.uuid,
					tagId: tag.id,
					outcome,
				},
			},
		},
	});
	if (game.user.isGM) {
		const report = await game.litm.runRoteAutomation({
			actorId: actor.id,
			roteUuid: rote.uuid,
			roteRef: actor.uuid,
			roteTagId: tag.id,
			rollId,
			mode: "simple",
			rollType: "simple",
			outcome,
			tokenId: getActorTokenId(
				actor.id,
				CONFIG.ChatMessage.documentClass.getSpeaker({ actor })?.token,
			),
			targetIds: [...(game.user.targets ?? [])].map((token) => token.id),
			sceneId: canvas.scene?.id ?? null,
			initiatorId: game.user.id,
			messageId: message.id,
		});
		if (report.failed)
			ui.notifications.warn(t("Litm.ui.post-roll-partial-failure"));
	} else {
		await Sockets.requestPostRollProcessing({
			actorId: actor.id,
			rollId,
			type: "simple",
			rote: { uuid: rote.uuid, ref: actor.uuid, tagId: tag.id },
			_outcome: outcome,
			messageId: message.id,
			sceneId: canvas.scene?.id ?? null,
			mode: "simple",
			tokenId: getActorTokenId(
				actor.id,
				CONFIG.ChatMessage.documentClass.getSpeaker({ actor })?.token,
			),
			targetIds: [...(game.user.targets ?? [])].map((token) => token.id),
		});
	}
	return message;
}

/** Small actor Rote browser, shared by sheet button and keybinding. */
export class RotesWindow extends HandlebarsApplicationMixin(ApplicationV2) {
	static #instance = null;
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--rotes-window"],
		position: { width: 428, height: 400 },
		window: { resizable: true },
	};
	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/rotes-window.html" },
	};
	constructor(actorId) {
		super();
		this.actorId = actorId;
	}
	get title() {
		return t("Litm.rote.window-title");
	}
	/** Toggle the Rotes window or switch its currently displayed actor. */
	static toggle(actorId) {
		const actor = game.actors.get(actorId);
		if (actor?.type !== "character" || (!game.user.isGM && !actor.isOwner))
			return ui.notifications.warn(t("Litm.ui.warn-no-character"));
		if (this.#instance?.rendered && this.#instance.actorId === actorId)
			return this.#instance.close();
		this.#instance ??= new RotesWindow(actorId);
		this.#instance.actorId = actorId;
		return this.#instance.render({ force: true });
	}
	async close(options) {
		if (RotesWindow.#instance === this) RotesWindow.#instance = null;
		return super.close(options);
	}
	async _prepareContext(options) {
		const actor = game.actors.get(this.actorId);
		const fellow = actor?.system.fellowshipId;
		return {
			...(await super._prepareContext(options)),
			actor,
			rotes:
				actor?.items.filter(
					(item) => item.type === "rote" && linkedTag(item),
				) ?? [],
			members:
				game.user.isGM && fellow
					? game.actors.filter(
							(item) =>
								item.type === "character" &&
								item.system.fellowshipId === fellow,
						)
					: [],
		};
	}
	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelector("[data-rotes-actor]")
			?.addEventListener("change", (event) => {
				this.actorId = event.currentTarget.value;
				this.render({ force: true });
			});
		this.element.querySelectorAll("[data-rotes-use]").forEach((button) => {
			button.addEventListener("click", () => useRote(button.dataset.rotesUse));
			button.addEventListener("dragstart", (event) => {
				event.dataTransfer.setData(
					"text/plain",
					JSON.stringify({
						type: DRAG_TYPE,
						uuid: button.dataset.rotesUse,
						name: button.dataset.rotesName,
						img: button.dataset.rotesImg,
					}),
				);
			});
		});
		this.element.querySelectorAll("[data-rotes-export]").forEach((button) =>
			button.addEventListener("click", async () => {
				const rote = await fromUuid(button.dataset.rotesExport);
				if (!rote || !game.user.can("ITEM_CREATE"))
					return ui.notifications.error(t("Litm.rote.export-denied"));
				const data = rote.toObject();
				delete data._id;
				delete data.flags?.["litm-rn"]?.roteLink;
				await getDocumentClass("Item").create(data);
			}),
		);
		this.element.querySelectorAll("[data-rotes-edit]").forEach((button) =>
			button.addEventListener("click", async () =>
				(await fromUuid(button.dataset.rotesEdit))?.sheet.render({
					force: true,
				}),
			),
		);
	}
}

/** Install a launcher Macro when a Rote is dragged to a hotbar slot. */
export function registerRoteLauncherDrop() {
	Sockets.on("requestRoteLauncherMacro", async ({ data, senderId }) => {
		if (!game.user.isGM || activeGM()?.id !== game.user.id) return;
		const sender = game.users.get(senderId);
		const rote = await fromUuid(data.uuid).catch(() => null);
		const link = linkedTag(rote);
		if (!sender || !link?.actor.testUserPermission(sender, "OWNER")) return;
		try {
			const macro = await createLauncherMacro(rote, senderId);
			Sockets.dispatch("replyRoteLauncherMacro", {
				requestId: data.requestId,
				userId: senderId,
				macroId: macro.id,
			});
		} catch (error) {
			console.error("LITM | Could not create Rote launcher Macro", error);
		}
	});
	Sockets.on("replyRoteLauncherMacro", ({ data, senderId }) => {
		if (senderId !== activeGM()?.id || data.userId !== game.user.id) return;
		pendingMacros.get(data.requestId)?.(data.macroId);
		pendingMacros.delete(data.requestId);
	});
	Hooks.on("hotbarDrop", (_hotbar, data, slot) => {
		if (data?.type !== DRAG_TYPE) return;
		(async () => {
			const rote = await fromUuid(data.uuid).catch(() => null);
			const link = linkedTag(rote);
			if (
				!link ||
				(!game.user.isGM && !link.actor.testUserPermission(game.user, "OWNER"))
			)
				return ui.notifications.error(t("Litm.rote.launch-no-owner"));
			let macro = null;
			if (game.user.isGM || game.user.can("MACRO_SCRIPT"))
				macro = await createLauncherMacro(rote);
			else if (activeGM()) {
				const requestId = foundry.utils.randomID();
				const macroId = await new Promise((resolve) => {
					const timeout = setTimeout(() => {
						pendingMacros.delete(requestId);
						resolve(null);
					}, 6000);
					pendingMacros.set(requestId, (id) => {
						clearTimeout(timeout);
						resolve(id);
					});
					Sockets.dispatch("requestRoteLauncherMacro", {
						requestId,
						uuid: rote.uuid,
					});
				});
				for (let attempt = 0; macroId && !macro && attempt < 5; attempt += 1) {
					macro = game.macros.get(macroId);
					if (!macro) await new Promise((resolve) => setTimeout(resolve, 100));
				}
			} else ui.notifications.warn(t("Litm.rote.launcher-macro-no-gm"));
			if (macro) await game.user.assignHotbarMacro(macro, slot);
		})().catch(console.error);
		return false;
	});
}
