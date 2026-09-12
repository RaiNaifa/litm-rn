import { Sockets } from "../system/sockets.js";
import { localize as t } from "../utils.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } =
	foundry.applications.api;
const { fromUuid, fromUuidSync } = foundry.utils;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** A synchronized, Narrator-authoritative Camp / Sojourn scene. */
export class CampDialog extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--camp", "litm--roll"],
		position: { width: 900, height: 700 },
		window: { resizable: true },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/camp-dialog.html" },
	};

	static #instances = new Map();
	static #draftInstances = new Map();
	static #registered = false;
	static #activeSignature = "";
	static #mutationQueue = Promise.resolve();

	constructor(fellowshipId, options = {}) {
		super(options);
		this.fellowshipId = fellowshipId;
		this._tab = options.tab || "setup";
		this._selectedActorId = options.actorId || game.user.character?.id || "";
		this._draftSession = options.draft || null;
		this._phaseKey = "";
		this._contextMenu = null;
		this._tabResizeObserver = null;
	}

	/** Register Camp socket listeners and restore active-session notices. */
	static register() {
		if (this.#registered) return;
		this.#registered = true;
		Sockets.on("campMutation", ({ data, senderId }) => {
			if (!game.user.isGM || !this.#isActiveGM()) return;
			this.#queueMutation(data.fellowshipId, data.mutation, senderId);
		});
		Sockets.on("campOpen", ({ data }) => this.open(data.fellowshipId));
		Sockets.on("campChanged", () => this.refreshAll());
		Hooks.once("ready", () => this.refreshAll());
		Hooks.on("renderChatMessageHTML", (message, html) => {
			const button = html.querySelector("[data-camp-history]");
			if (!button) return;
			const history = message?.flags?.["litm-rn"]?.campHistory;
			if (!history || !this.#canView(history)) {
				button.remove();
				return;
			}
			button.addEventListener("click", () => this.showHistory(message));
		});
		for (const hook of [
			"updateActor",
			"updateItem",
			"createActiveEffect",
			"updateActiveEffect",
			"deleteActiveEffect",
		]) {
			Hooks.on(hook, () => {
				for (const app of this.#instances.values())
					if (app.rendered) app.render();
			});
		}
	}

	/** Open an active Camp, or an unstarted Narrator-only setup draft. */
	static launch(fellowshipId) {
		return this.getSession(fellowshipId)
			? this.open(fellowshipId)
			: this.preview(fellowshipId);
	}

	/** Open a Narrator-only Camp setup draft without activating it. */
	static preview(fellowshipId) {
		if (!game.user.isGM) return null;
		const fellowship = game.items?.get(fellowshipId);
		if (!fellowship || fellowship.type !== "fellowship") return null;
		let app = this.#draftInstances.get(fellowshipId);
		if (!app) {
			const draft = this.#buildSession(fellowship, "draft");
			if (!draft) return null;
			app = new CampDialog(fellowshipId, { draft });
			this.#draftInstances.set(fellowshipId, app);
		}
		app.render({ force: true });
		return app;
	}

	/** Activate a prepared Camp and open it for every active Fellowship user. */
	static async start(fellowshipId, prepared = null) {
		if (!game.user.isGM) return;
		const fellowship = game.items?.get(fellowshipId);
		if (!fellowship || fellowship.type !== "fellowship") return;
		if (this.getSession(fellowshipId)) return this.open(fellowshipId);
		const session = prepared
			? foundry.utils.deepClone(prepared)
			: this.#buildSession(fellowship, "active");
		if (!session) return;
		session.state = "active";
		session.startedAt = Date.now();
		session.startedBy = game.user.id;
		await this.#saveSession(session);
		Sockets.dispatch("campOpen", { fellowshipId });
		return session;
	}

	static #buildSession(fellowship, state = "draft") {
		const fellowshipId = fellowship.id;
		const actors = game.actors.filter(
			(actor) =>
				actor.type === "character" &&
				actor.system?.fellowshipId === fellowshipId,
		);
		if (!actors.length) {
			ui.notifications.warn(t("Litm.camp.no-members"));
			return null;
		}
		const heroes = {};
		for (const actor of actors) {
			heroes[actor.id] = {
				actorId: actor.id,
				preparationReady: false,
				activities: [
					this.#emptyActivity(),
					this.#emptyActivity(),
					this.#emptyActivity(),
				],
				quality: {
					type: "",
					tagId: "",
					relationshipActorId: "",
					relationshipName: "",
					submitted: false,
				},
			};
		}
		return {
			version: 1,
			id: foundry.utils.randomID(),
			fellowshipId,
			fellowshipName: fellowship.name,
			state,
			visitedPhases: ["setup"],
			phase: "setup",
			phaseIndex: 0,
			duration: "camp",
			bonus: 0,
			campsite: { name: "", description: "", tags: [] },
			preparation: {},
			heroes,
			thirdRequestedBy: [],
			thirdEnabled: false,
			consequence: { text: "", state: "pending" },
			startedAt: 0,
			startedBy: "",
		};
	}

	/** Open an active Camp window. */
	static open(fellowshipId) {
		const session = this.getSession(fellowshipId);
		if (!session || !this.#canView(session)) return null;
		let app = this.#instances.get(fellowshipId);
		if (!app) {
			app = new CampDialog(fellowshipId);
			this.#instances.set(fellowshipId, app);
		}
		app._tab = this.#tabForSession(session);
		app._phaseKey = `${session.phase}:${session.phaseIndex}`;
		app.render({ force: true });
		return app;
	}

	/** Return the active Camp session for a Fellowship. */
	static getSession(fellowshipId) {
		try {
			return (
				game.settings.get("litm-rn", "campSessions")?.active?.[fellowshipId] ??
				null
			);
		} catch (_) {
			return null;
		}
	}

	/** Whether the Fellowship currently has an active Camp. */
	static isActive(fellowshipId) {
		return !!this.getSession(fellowshipId);
	}

	/** Store the mechanical result of a Camp Action in its activity slot. */
	static recordAction(camp, actorId, result) {
		if (!camp?.fellowshipId || !camp.phaseIndex) return;
		const mutation = {
			type: "set",
			path: `heroes.${actorId}.activities.${camp.phaseIndex - 1}.result`,
			value: result,
		};
		if (game.user.isGM) return this.#queueMutation(camp.fellowshipId, mutation);
		Sockets.dispatch("campMutation", {
			fellowshipId: camp.fellowshipId,
			mutation,
		});
	}

	/** Remove one campsite tag through the authoritative Camp mutation queue. */
	static removeCampsiteTag(fellowshipId, tagId) {
		if (!fellowshipId || !tagId) return;
		const mutation = { type: "removeCampsiteTag", id: tagId };
		if (game.user.isGM) return this.#queueMutation(fellowshipId, mutation);
		Sockets.dispatch("campMutation", { fellowshipId, mutation });
	}

	/** Refresh open Camp windows and persistent launch notices. */
	static refreshAll() {
		const activeSignature = Object.keys(
			game.settings.get("litm-rn", "campSessions")?.active ?? {},
		)
			.sort()
			.join("|");
		const activeChanged = activeSignature !== this.#activeSignature;
		this.#activeSignature = activeSignature;
		for (const [id, app] of this.#instances) {
			const session = this.getSession(id);
			if (!session) {
				if (app.rendered) app.close();
				this.#instances.delete(id);
			} else if (app.rendered) {
				const phaseKey = `${session.phase}:${session.phaseIndex}`;
				if (!game.user.isGM && app._phaseKey && app._phaseKey !== phaseKey)
					app._tab = this.#tabForSession(session);
				app._phaseKey = phaseKey;
				app.render();
			}
		}
		this.#renderNotices();
		if (activeChanged) {
			for (const item of game.items?.filter(
				(entry) => entry.type === "fellowship",
			) ?? []) {
				if (item.sheet?.rendered) item.sheet.render();
			}
			ui.combat?.render?.();
			game.litm?._tmPopOut?.render?.();
		}
	}

	static #tabForSession(session) {
		if (session.phase === "quality") return "quality";
		if (session.phase === "activity") return `activity-${session.phaseIndex}`;
		return "setup";
	}

	/** Open a permission-filtered, read-only history from the Camp chat message. */
	static showHistory(message) {
		const session = message?.flags?.["litm-rn"]?.campHistory;
		if (!session || !this.#canView(session)) return;
		const ownId = game.user.character?.id;
		const heroes = Object.values(session.heroes).filter(
			(hero) => game.user.isGM || hero.actorId === ownId,
		);
		const tabs =
			game.user.isGM && heroes.length > 1
				? `<nav class="litm--camp-history-tabs">${heroes.map((hero, index) => `<button type="button" data-history-tab="${hero.actorId}" class="${index === 0 ? "active" : ""}">${foundry.utils.escapeHTML(this.#historyActorName(hero))}</button>`).join("")}</nav>`
				: "";
		const rows = heroes
			.map((hero, index) => this.#renderHeroHistory(session, hero, index))
			.join("");
		const dialog = new DialogV2({
			window: { title: `${t("Litm.camp.history")}: ${session.fellowshipName}` },
			content: `<div class="litm litm--camp-history"><p><strong>${t("Litm.camp.campsite")}:</strong> ${foundry.utils.escapeHTML(session.campsite?.name || "—")}</p><p><strong>${t("Litm.camp.duration")}:</strong> ${foundry.utils.escapeHTML(this.#durationLabel(session.duration))}</p>${tabs}<div class="litm--camp-history-pages">${rows}</div></div>`,
			buttons: [
				{ action: "close", label: t("Litm.camp.close"), default: true },
			],
		});
		const hookId = Hooks.on("renderDialogV2", (app, element) => {
			if (app !== dialog) return;
			Hooks.off("renderDialogV2", hookId);
			element.querySelectorAll("[data-history-tab]").forEach((button) =>
				button.addEventListener("click", (event) => {
					const actorId = event.currentTarget.dataset.historyTab;
					element
						.querySelectorAll("[data-history-tab]")
						.forEach((entry) =>
							entry.classList.toggle("active", entry === event.currentTarget),
						);
					element
						.querySelectorAll("[data-history-actor]")
						.forEach((page) =>
							page.classList.toggle(
								"active",
								page.dataset.historyActor === actorId,
							),
						);
				}),
			);
		});
		dialog.render({ force: true });
	}

	static #historyActorName(hero) {
		return hero.actorName || game.actors.get(hero.actorId)?.name || "";
	}

	static #durationLabel(duration) {
		return t(
			`Litm.camp.duration-summary-${["camp", "days", "weeks", "months"].includes(duration) ? duration : "camp"}`,
		);
	}

	static #decisionDetails(decisions, phase) {
		const details = [];
		for (const decision of Object.values(decisions ?? {})) {
			if (!decision?.name) continue;
			let key = "";
			if (decision.action === "expire")
				key = decision.archive ? "history-archived" : "history-removed";
			else if (phase === "rest" && decision.action === "restore")
				key = "history-restored";
			else if (phase === "rest" && decision.action === "status")
				key = "history-decreased";
			if (!key) continue;
			const suffix =
				key === "history-decreased"
					? ` ${Math.max(0, Number(decision.decrease) || 0)}`
					: "";
			details.push(
				`${t(`Litm.camp.${key}`)}${suffix}: ${foundry.utils.escapeHTML(decision.name)}`,
			);
		}
		return details;
	}

	static #renderHeroHistory(session, hero, index) {
		const list = (lines) =>
			`<ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>`;
		const preparation = hero.preparationReady
			? this.#decisionDetails(
					session.preparation?.[hero.actorId],
					"preparation",
				)
			: [t("Litm.camp.skip-activity")];
		const sections = [
			`<section><h4>${t("Litm.camp.setup")}</h4>${list(preparation.length ? preparation : [t("Litm.camp.history-no-changes")])}</section>`,
		];
		for (const [activityIndex, activity] of (hero.activities ?? []).entries()) {
			const heading = t("Litm.camp.activity-n").replace(
				"{number}",
				activityIndex + 1,
			);
			const details = [];
			if (
				!activity?.submitted ||
				!activity.type ||
				activity.type === "skip-activity"
			)
				details.push(t("Litm.camp.skip-activity"));
			else if (activity.type === "rest")
				details.push(...this.#decisionDetails(activity.choices, "rest"));
			else if (activity.type === "reflect") {
				const benefit =
					activity.result?.benefit === "improvement"
						? t("Litm.camp.history-improvement")
						: t("Litm.camp.history-experience");
				details.push(
					`${foundry.utils.escapeHTML(activity.result?.themeName || "—")} — ${benefit}`,
				);
			} else if (activity.type === "camp-action") {
				const method =
					activity.result?.method === "roll"
						? t("Litm.camp.history-with-roll")
						: t("Litm.camp.history-without-roll");
				const power =
					activity.result?.method === "spend"
						? activity.result.effects
						: activity.result?.power;
				details.push(
					`${t("Litm.camp.history-power")}: ${Number(power) || 0} (${method})`,
				);
			}
			const activityName =
				activity?.type && activity.type !== "skip-activity"
					? foundry.utils.escapeHTML(t(`Litm.camp.${activity.type}`))
					: t("Litm.camp.skip-activity");
			sections.push(
				`<section><h4>${heading}: ${activityName}</h4>${list(details.length ? details : [t("Litm.camp.history-no-changes")])}</section>`,
			);
		}
		const quality = [];
		if (!hero.quality?.submitted) quality.push(t("Litm.camp.skip-activity"));
		else if (hero.quality.type === "tag")
			quality.push(
				`${t("Litm.camp.history-fellowship-tag")}: ${foundry.utils.escapeHTML(hero.quality.tagName || "—")}`,
			);
		else if (hero.quality.type === "relationship")
			quality.push(
				`${t("Litm.camp.history-relationship")}: ${foundry.utils.escapeHTML(hero.quality.relationshipName || "—")}`,
			);
		sections.push(
			`<section><h4>${t("Litm.camp.quality-time")}</h4>${list(quality.length ? quality : [t("Litm.camp.skip-activity")])}</section>`,
		);
		return `<article class="litm--camp-history-page${index === 0 ? " active" : ""}" data-history-actor="${hero.actorId}"><h3>${foundry.utils.escapeHTML(this.#historyActorName(hero))}</h3>${sections.join("")}</article>`;
	}

	static #emptyActivity() {
		return {
			type: "",
			submitted: false,
			choices: {},
			themeId: "",
			result: null,
		};
	}

	static #isActiveGM() {
		const active =
			game.users.activeGM ??
			game.users.find((user) => user.isGM && user.active);
		return !active || active.id === game.user.id;
	}

	static #canView(session) {
		if (game.user.isGM) return true;
		return !!session.heroes?.[game.user.character?.id];
	}

	static async #saveSession(session) {
		const store = foundry.utils.deepClone(
			game.settings.get("litm-rn", "campSessions") || {
				version: 1,
				active: {},
			},
		);
		store.active ||= {};
		store.active[session.fellowshipId] = session;
		await game.settings.set("litm-rn", "campSessions", store);
		Sockets.dispatch("campChanged", { fellowshipId: session.fellowshipId });
	}

	static async #deleteSession(fellowshipId) {
		const store = foundry.utils.deepClone(
			game.settings.get("litm-rn", "campSessions") || {
				version: 1,
				active: {},
			},
		);
		delete store.active?.[fellowshipId];
		await game.settings.set("litm-rn", "campSessions", store);
	}

	static #queueMutation(fellowshipId, mutation, senderId = game.user.id) {
		const operation = this.#mutationQueue.then(() =>
			this.#applyMutation(fellowshipId, mutation, senderId),
		);
		this.#mutationQueue = operation.catch((error) =>
			console.error("litm-rn | Camp mutation failed", error),
		);
		return operation;
	}

	static async #applyMutation(fellowshipId, mutation, senderId = game.user.id) {
		const session = foundry.utils.deepClone(this.getSession(fellowshipId));
		if (!session || session.state !== "active") return;
		const sender = game.users.get(senderId);
		const senderActor = sender?.character;
		const isGM = sender?.isGM ?? game.user.isGM;
		if (!isGM && senderActor?.system?.fellowshipId !== fellowshipId) return;

		if (mutation.type === "set") {
			if (!this.#canSetPath(mutation.path, senderActor?.id, isGM, session))
				return;
			this.#hydrateDecisionSnapshot(session, mutation.path);
			const activityType = mutation.path.match(
				/^(heroes\.[^.]+\.activities\.\d+)\.type$/,
			);
			if (activityType)
				foundry.utils.setProperty(session, activityType[1], {
					...this.#emptyActivity(),
					type: mutation.value,
				});
			else foundry.utils.setProperty(session, mutation.path, mutation.value);
			if (/\.(action|name|value|values)$/.test(mutation.path)) {
				const base = mutation.path.replace(/\.(action|name|value|values)$/, "");
				const decision = foundry.utils.getProperty(session, base) ?? {};
				if (!decision.timing)
					foundry.utils.setProperty(session, `${base}.timing`, "now");
				if (/\.(name|value|values)$/.test(mutation.path) && !decision.action)
					foundry.utils.setProperty(session, `${base}.action`, "status");
			}
			if (mutation.path === "duration") {
				session.bonus =
					{ camp: 0, days: 1, weeks: 2, months: 3 }[mutation.value] ?? 0;
			}
			const preparationActorId = mutation.path.match(
				/^preparation\.([^.]+)\./,
			)?.[1];
			if (preparationActorId && session.heroes[preparationActorId])
				session.heroes[preparationActorId].preparationReady = false;
			const resultActivity = mutation.path.match(
				/^heroes\.([^.]+)\.activities\.(\d+)\.result$/,
			);
			if (resultActivity) {
				const activity =
					session.heroes?.[resultActivity[1]]?.activities?.[
						Number(resultActivity[2])
					];
				if (activity && !isGM) activity.submitted = true;
			}
		} else if (mutation.type === "setDecision") {
			if (
				!this.#canSetPath(
					`${mutation.path}.action`,
					senderActor?.id,
					isGM,
					session,
				)
			)
				return;
			this.#hydrateDecisionSnapshot(session, `${mutation.path}.action`);
			const current = foundry.utils.getProperty(session, mutation.path) ?? {};
			const next = { ...current, ...mutation.changes };
			next.timing ||= "now";
			foundry.utils.setProperty(session, mutation.path, next);
			const preparationActorId = mutation.path.match(
				/^preparation\.([^.]+)\./,
			)?.[1];
			if (preparationActorId && session.heroes[preparationActorId])
				session.heroes[preparationActorId].preparationReady = false;
		} else if (mutation.type === "addCampsiteTag") {
			if (!isGM) return;
			this.#addCampsiteTag(session, mutation.tag);
		} else if (mutation.type === "removeCampsiteTag") {
			if (!isGM) return;
			session.campsite.tags = session.campsite.tags.filter(
				(tag) => tag.id !== mutation.id,
			);
		} else if (mutation.type === "updateCampsiteTag") {
			if (!isGM) return;
			const tag = session.campsite.tags.find(
				(entry) => entry.id === mutation.id,
			);
			if (!tag) return;
			Object.assign(tag, mutation.changes ?? {});
			if (tag.type === "status") {
				tag.values = this.#statusValues(tag.values, tag.value);
				tag.value = tag.values.findLastIndex(Boolean) + 1;
			}
		} else if (mutation.type === "requestThird") {
			if (
				!senderActor ||
				session.phase !== "activity" ||
				session.phaseIndex !== 2
			)
				return;
			if (!session.thirdRequestedBy.includes(senderActor.id))
				session.thirdRequestedBy.push(senderActor.id);
		} else if (mutation.type === "togglePreparationReady") {
			if (isGM) return;
			const actorId = mutation.actorId || senderActor?.id;
			if (!actorId || session.phase !== "setup" || !session.heroes[actorId])
				return;
			if (!isGM && actorId !== senderActor?.id) return;
			const hero = session.heroes[actorId];
			if (hero.preparationReady) return;
			hero.preparationReady = true;
		} else if (mutation.type === "submitActivity") {
			if (isGM) return;
			const actorId = mutation.actorId;
			if (!isGM && actorId !== senderActor?.id) return;
			if (
				session.phase !== "activity" ||
				mutation.index !== session.phaseIndex - 1
			)
				return;
			const activity = session.heroes?.[actorId]?.activities?.[mutation.index];
			if (!activity || activity.submitted) return;
			if (!activity.type) return;
			if (activity.type === "reflect" && !activity.themeId) return;
			if (activity.type === "camp-action" && !activity.result) return;
			await this.#applyActivity(session, actorId, mutation.index);
			activity.submitted = true;
		} else if (mutation.type === "submitQuality") {
			if (isGM) return;
			const actorId = mutation.actorId;
			if (
				!actorId ||
				(!isGM && actorId !== senderActor?.id) ||
				session.phase !== "quality"
			)
				return;
			const quality = session.heroes?.[actorId]?.quality;
			if (!quality || quality.submitted) return;
			if (quality.type === "tag") {
				if (!quality.tagId) return;
				const fellowship = game.items.get(session.fellowshipId);
				const selectedTag = [
					fellowship?.system?.themeTag,
					...(fellowship?.system?.powerTags ?? []),
				].find((tag) => tag?.id === quality.tagId);
				if (!selectedTag?.isScratched) {
					quality.tagId = "";
					await this.#saveSession(session);
					return;
				}
			}
			if (quality.type === "relationship") {
				if (
					!quality.relationshipActorId ||
					!session.heroes[quality.relationshipActorId] ||
					quality.relationshipActorId === actorId
				)
					return;
			}
			if (!["tag", "relationship"].includes(quality.type)) return;
			await this.#applyQuality(session, actorId);
			quality.submitted = true;
		} else if (mutation.type === "chooseRelationship") {
			const actorId = mutation.actorId;
			const fellowActorId = mutation.fellowActorId;
			if (!actorId || !fellowActorId || actorId === fellowActorId) return;
			if (!isGM && actorId !== senderActor?.id) return;
			const hero = session.heroes?.[actorId];
			if (
				session.phase !== "quality" ||
				!hero ||
				hero.quality?.submitted ||
				!session.heroes[fellowActorId]
			)
				return;
			const actor = game.actors.get(actorId);
			const existing = actor?.system?.relationships?.find(
				(entry) => entry.fellowActorId === fellowActorId,
			);
			hero.quality.relationshipActorId = fellowActorId;
			hero.quality.relationshipName =
				existing?.name ?? t("Litm.tags.relationship");
		} else if (mutation.type === "unlockChoice") {
			if (!isGM) return;
			const hero = session.heroes?.[mutation.actorId];
			if (!hero) return;
			if (mutation.phase === "setup" && session.phase === "setup")
				hero.preparationReady = false;
			else if (mutation.phase === "quality" && session.phase === "quality")
				hero.quality.submitted = false;
			else if (
				mutation.phase === "activity" &&
				session.phase === "activity" &&
				mutation.index === session.phaseIndex - 1
			) {
				hero.activities[mutation.index].submitted = false;
			} else return;
		} else return;

		await this.#saveSession(session);
	}

	static #hydrateDecisionSnapshot(session, path) {
		const preparation = path.match(/^preparation\.([^.]+)\.([^.]+)\./);
		const activity = path.match(
			/^heroes\.([^.]+)\.activities\.(\d+)\.choices\.([^.]+)\./,
		);
		const actorId = preparation?.[1] ?? activity?.[1];
		const key = preparation?.[2] ?? activity?.[3];
		const base = preparation
			? `preparation.${actorId}.${key}`
			: activity
				? `heroes.${actorId}.activities.${activity[2]}.choices.${key}`
				: "";
		if (!actorId || !key || !base) return;
		const current = foundry.utils.getProperty(session, base) ?? {};
		if (current.originalValues) return;
		const actor = game.actors.get(actorId);
		if (!actor) return;
		const resources = this.#collectResources(actor);
		const resource = [
			resources.backpack,
			resources.tracking,
			resources.statuses,
			resources.scratched,
			resources.expirable,
			resources.storyThemes.flatMap((theme) => theme.tags),
		]
			.flat()
			.find((entry) => entry.key === key);
		if (!resource) return;
		foundry.utils.setProperty(session, base, {
			...current,
			name: resource.name,
			type: resource.type,
			value: resource.value,
			values: foundry.utils.deepClone(resource.values),
			originalValues: foundry.utils.deepClone(resource.values),
			isPrivate: resource.isPrivate,
			resourceGroup: resource.resourceGroup,
			preparationGroup: resource.preparationGroup,
		});
	}

	static async #applyActivity(session, actorId, index) {
		const hero = session.heroes?.[actorId];
		const activity = hero?.activities?.[index];
		if (!activity) return;
		if (activity.type === "rest") {
			await this.#applyDecisionSet(
				session,
				`heroes.${actorId}.activities.${index}.choices`,
				"now",
			);
		} else if (activity.type === "reflect" && activity.themeId) {
			const actor = game.actors.get(actorId);
			if (!actor) return;
			const beforeThemes = foundry.utils.deepClone(
				actor._source.system.themes ?? [],
			);
			const themes = foundry.utils.deepClone(beforeThemes);
			const theme = themes.find((entry) => entry.id === activity.themeId);
			if (!theme) return;
			const before = Number(theme.improve) || 0;
			theme.improve = session.duration === "camp" ? Math.min(3, before + 1) : 3;
			activity.result = {
				method: "reflect",
				themeName: theme.name || "",
				benefit: session.duration === "camp" ? "experience" : "improvement",
			};
			await actor.update({ "system.themes": themes });
		}
	}

	static #canSetPath(path, actorId, isGM, session) {
		if (session.phase === "complete") return false;
		const preparationMatch = path.match(/^preparation\.([^.]+)\./);
		if (preparationMatch) {
			const targetActorId = preparationMatch[1];
			if (!isGM && targetActorId !== actorId) return false;
			return (
				session.phase === "setup" &&
				!session.heroes?.[targetActorId]?.preparationReady
			);
		}
		const activityMatch = path.match(/^heroes\.([^.]+)\.activities\.(\d+)\./);
		if (activityMatch) {
			const targetActorId = activityMatch[1];
			const index = Number(activityMatch[2]);
			if (!isGM && targetActorId !== actorId) return false;
			return (
				session.phase === "activity" &&
				index === session.phaseIndex - 1 &&
				!session.heroes?.[targetActorId]?.activities?.[index]?.submitted
			);
		}
		const qualityMatch = path.match(/^heroes\.([^.]+)\.quality\./);
		if (qualityMatch) {
			const targetActorId = qualityMatch[1];
			if (!isGM && targetActorId !== actorId) return false;
			return (
				session.phase === "quality" &&
				!session.heroes?.[targetActorId]?.quality?.submitted
			);
		}
		if (isGM) return true;
		if (!actorId) return false;
		const prefix = `heroes.${actorId}.`;
		if (!path.startsWith(prefix)) return false;
		return false;
	}

	static #normalizeCampTag(source) {
		if (!source) return null;
		const flags = source.flags?.["litm-rn"] ?? source.flags ?? {};
		const type = source.type === "ActiveEffect" ? flags.type : source.type;
		if (
			!source.name ||
			![
				"tag",
				"status",
				"might",
				"powerTag",
				"weaknessTag",
				"backpack",
			].includes(type)
		)
			return null;
		return {
			id: foundry.utils.randomID(),
			name: source.name,
			type: type === "powerTag" || type === "backpack" ? "tag" : type,
			value: Number(source.value ?? flags.value) || 0,
			values: this.#statusValues(
				source.values ?? flags.values,
				Number(source.value ?? flags.value) || 0,
			),
			isHindering: !!(source.isHindering ?? flags.isHindering),
			isPrivate: !!(source.isPrivate ?? flags.isPrivate),
			isPermanent: !!(source.isPermanent ?? flags.isPermanent),
			sourceUuid: source.uuid || "",
		};
	}

	static #addCampsiteTag(session, source) {
		const tag = this.#normalizeCampTag(source);
		if (!tag) return;
		if (tag.type === "status") {
			const existing = session.campsite.tags.find(
				(entry) =>
					entry.type === "status" &&
					entry.name.trim().toLocaleLowerCase() ===
						tag.name.trim().toLocaleLowerCase(),
			);
			if (existing) {
				const values = this.#statusValues(existing.values, existing.value);
				const startIndex = Math.max(0, tag.value - 1);
				const freeIndex = values.findIndex(
					(value, index) => index >= startIndex && !value,
				);
				if (tag.value > 0 && freeIndex !== -1)
					values[freeIndex] = freeIndex + 1;
				existing.values = values;
				existing.value = values.findLastIndex(Boolean) + 1;
				return;
			}
		}
		session.campsite.tags.push(tag);
	}

	static #statusValues(values, value = 0) {
		if (Array.isArray(values) && values.length) {
			return Array.from({ length: 6 }, (_, index) =>
				values[index] ? index + 1 : false,
			);
		}
		return Array.from({ length: 6 }, (_, index) =>
			index + 1 === value ? index + 1 : false,
		);
	}

	static #renderNotices() {
		const sessions = Object.values(
			game.settings.get("litm-rn", "campSessions")?.active ?? {},
		).filter((session) => this.#canView(session));
		const doc = document;
		let container = doc.querySelector("#litm-camp-notices");
		if (!container) {
			container = doc.createElement("div");
			container.id = "litm-camp-notices";
			doc.body.appendChild(container);
		}
		container.replaceChildren();
		for (const session of sessions) {
			const app = this.#instances.get(session.fellowshipId);
			if (app?.rendered) continue;
			const card = doc.createElement("div");
			card.className = "litm litm--sacrifice-proposal litm--camp-proposal";
			card.dataset.campNotice = session.fellowshipId;
			const label = doc.createElement("span");
			label.innerHTML = `<strong>${foundry.utils.escapeHTML(session.fellowshipName)}</strong><small>${foundry.utils.escapeHTML(this.#phaseLabel(session))}</small>`;
			const open = doc.createElement("button");
			open.type = "button";
			open.className = "litm--sacrifice-proposal-open";
			open.innerHTML = '<i class="fas fa-campground"></i>';
			open.dataset.tooltip = t("Litm.camp.open");
			open.addEventListener("click", () => this.open(session.fellowshipId));
			card.append(label, open);
			container.append(card);
		}
	}

	static #phaseLabel(session) {
		if (session.phase === "setup") return t("Litm.camp.setup");
		if (session.phase === "quality") return t("Litm.camp.quality-time");
		return game.i18n.format("Litm.camp.activity-n", {
			number: session.phaseIndex,
		});
	}

	get session() {
		return this._draftSession ?? CampDialog.getSession(this.fellowshipId);
	}

	get title() {
		return `${t("Litm.camp.title")}: ${this.session?.fellowshipName ?? ""}`;
	}

	/** Render the Camp window without resetting its independently scrollable columns. */
	async render(options) {
		game.tooltip?.deactivate?.();
		const selectors = [
			".litm--camp-page",
			".litm--camp-overview",
			".litm--camp-phase-main",
		];
		const scroll = selectors
			.map((selector) => {
				const element = this.element?.querySelector(selector);
				return element
					? { selector, top: element.scrollTop, left: element.scrollLeft }
					: null;
			})
			.filter(Boolean);
		const result = await super.render(options);
		for (const saved of scroll) {
			const element = this.element?.querySelector(saved.selector);
			if (!element) continue;
			element.scrollTop = saved.top;
			element.scrollLeft = saved.left;
		}
		return result;
	}

	async close(options) {
		game.tooltip?.deactivate?.();
		this.#closeCampsiteTagMenu();
		this._tabResizeObserver?.disconnect();
		this._tabResizeObserver = null;
		const result = await super.close(options);
		if (this._draftSession)
			CampDialog.#draftInstances.delete(this.fellowshipId);
		queueMicrotask(() => CampDialog.refreshAll());
		return result;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const isGM = game.user.isGM;
		const sourceSession = this.session;
		if (!sourceSession) return context;
		const session = foundry.utils.deepClone(sourceSession);
		for (const tag of session.campsite.tags ?? []) {
			if (tag.type === "status")
				tag.values = CampDialog.#statusValues(tag.values, tag.value);
		}
		if (!isGM)
			session.campsite.tags = session.campsite.tags.filter(
				(tag) => !tag.isPrivate,
			);
		const playerActorId = game.user.character?.id || "";
		const members = Object.keys(session.heroes)
			.map((actorId) => game.actors.get(actorId))
			.filter(Boolean);
		if (!isGM && playerActorId) {
			members.sort(
				(left, right) =>
					Number(right.id === playerActorId) -
					Number(left.id === playerActorId),
			);
		}
		const currentTabName =
			session.phase === "setup"
				? "setup"
				: session.phase === "quality"
					? "quality"
					: `activity-${session.phaseIndex}`;
		const visitedPhases = new Set(session.visitedPhases);
		if (this._tab !== "setup" && !visitedPhases.has(this._tab))
			this._tab = currentTabName;
		const viewedActivityIndex = this._tab.startsWith("activity-")
			? Math.max(0, Number(this._tab.slice(-1)) - 1)
			: Math.max(0, session.phaseIndex - 1);
		if (!isGM) this._selectedActorId = playerActorId;
		else if (!this._selectedActorId || !session.heroes[this._selectedActorId])
			this._selectedActorId = members[0]?.id;
		const resources = Object.fromEntries(
			members.map((actor) => [actor.id, CampDialog.#collectResources(actor)]),
		);
		const fellowship = game.items.get(session.fellowshipId);
		const heroes = members.map((actor) => {
			const hero = session.heroes[actor.id];
			const currentActivity = hero.activities[viewedActivityIndex] ?? null;
			const mayShowType =
				isGM || actor.id === playerActorId || currentActivity?.submitted;
			let qualityLabel = t("Litm.camp.not-selected");
			if (hero.quality?.type === "tag" && hero.quality.tagId) {
				qualityLabel = t("Litm.camp.quality-tag-choice");
			} else if (hero.quality?.type === "relationship") {
				qualityLabel = t("Litm.camp.quality-relationship-choice");
			}
			return {
				id: actor.id,
				name: actor.name,
				img: actor.img,
				selected: actor.id === this._selectedActorId,
				canEdit: isGM || actor.id === playerActorId,
				preparationReady: !!hero.preparationReady,
				activityLabel:
					mayShowType && currentActivity?.type
						? t(`Litm.camp.${currentActivity.type}`)
						: t("Litm.camp.not-selected"),
				submitted: !!currentActivity?.submitted,
				thirdRequested: session.thirdRequestedBy?.includes(actor.id) ?? false,
				qualitySubmitted: !!hero.quality?.submitted,
				qualityLabel,
			};
		});
		const selectedActor = game.actors.get(this._selectedActorId);
		const selectedHero = session.heroes[this._selectedActorId];
		const activityIndex = viewedActivityIndex;
		const activity = selectedHero?.activities?.[activityIndex] ?? null;
		const selectedResources = resources[this._selectedActorId] ?? {
			expirable: [],
			backpack: [],
			tracking: [],
			statuses: [],
			scratched: [],
			storyThemes: [],
		};
		const preparationChoices =
			session.preparation?.[this._selectedActorId] ?? {};
		const standardResources = [
			selectedResources.expirable,
			selectedResources.backpack,
			selectedResources.tracking,
			selectedResources.statuses,
			selectedResources.scratched,
		].flat();
		const storyThemeResources = selectedResources.storyThemes.flatMap(
			(theme) => theme.tags,
		);
		const allKeys = new Set(
			[...standardResources, ...storyThemeResources].map(
				(resource) => resource.key,
			),
		);
		for (const [key, decision] of Object.entries(preparationChoices)) {
			if (allKeys.has(key) || !decision?.name || !decision.preparationGroup)
				continue;
			selectedResources[decision.preparationGroup]?.push({
				key,
				...foundry.utils.deepClone(decision),
			});
			allKeys.add(key);
		}
		for (const [key, decision] of Object.entries(activity?.choices ?? {})) {
			if (allKeys.has(key) || !decision?.name || !decision.resourceGroup)
				continue;
			if (decision.resourceGroup === "storyThemes") continue;
			selectedResources[decision.resourceGroup]?.push({
				key,
				...foundry.utils.deepClone(decision),
			});
			allKeys.add(key);
		}
		for (const resource of [...standardResources, ...storyThemeResources]) {
			const defaults = {
				action: "keep",
				timing: "now",
				name: resource.name,
				type: resource.type,
				value: resource.value,
				values: resource.values,
				isPrivate: resource.isPrivate,
			};
			resource.prep = {
				...defaults,
				...(preparationChoices[resource.key] ?? {}),
			};
			resource.rest = {
				...defaults,
				...(activity?.choices?.[resource.key] ?? {}),
			};
			resource.prep.values = CampDialog.#statusValues(
				resource.prep.values,
				resource.prep.value,
			);
			resource.rest.values = CampDialog.#statusValues(
				resource.rest.values,
				resource.rest.value,
			);
			resource.rest.decrease = Math.max(0, Number(resource.rest.decrease) || 0);
			resource.statusDisplay = {
				...resource.rest,
				values: foundry.utils.deepClone(
					resource.rest.originalValues ?? resource.values,
				),
			};
		}
		const usedTypes =
			selectedHero?.activities
				?.slice(0, activityIndex)
				.map((entry) => entry.type) ?? [];
		const themes = (selectedActor?.system?.themes ?? [])
			.filter((theme) => !theme.isEmpty)
			.map((theme) => ({
				id: theme.id,
				name: theme.themeTag?.name || theme.name,
				selected: activity?.themeId === theme.id,
			}));
		const fellowshipTags = [
			fellowship?.system?.themeTag,
			...(fellowship?.system?.powerTags ?? []),
		]
			.filter((tag) => tag?.isScratched)
			.map((tag) => ({
				id: tag.id,
				name: tag.name,
				selected: selectedHero?.quality?.tagId === tag.id,
			}));
		const storedRelationships = selectedActor?.system?.relationships ?? [];
		const selectedRelationshipActorId =
			selectedHero?.quality?.relationshipActorId || "";
		const qualityChoiceComplete =
			selectedHero?.quality?.type === "tag"
				? !!selectedHero.quality.tagId
				: selectedHero?.quality?.type === "relationship" &&
					!!selectedRelationshipActorId;
		const relationships = members
			.filter((member) => member.id !== this._selectedActorId)
			.map((member) => {
				const existing = storedRelationships.find(
					(rel) => rel.fellowActorId === member.id,
				);
				return {
					fellowActorId: member.id,
					fellowName: member.name,
					name: existing?.name ?? t("Litm.tags.relationship"),
					scratched: existing?.isScratched ?? true,
					selected: selectedRelationshipActorId === member.id,
				};
			});
		const playerOwnsSelected = this._selectedActorId === playerActorId;
		const selectedPreparationReady =
			!!session.heroes[this._selectedActorId]?.preparationReady;
		const selectedActivitySubmitted = !!activity?.submitted;
		const activityChoiceComplete =
			!!activity?.type &&
			(activity.type !== "reflect" || !!activity.themeId) &&
			(activity.type !== "camp-action" || !!activity.result);
		const selectedChoiceLocked =
			this._tab === "setup"
				? selectedPreparationReady
				: this._tab.startsWith("activity-")
					? selectedActivitySubmitted
					: this._tab === "quality" && !!selectedHero?.quality?.submitted;
		this._phaseKey ||= `${session.phase}:${session.phaseIndex}`;
		const playerPhaseEditable =
			(this._tab === "setup" && session.phase === "setup") ||
			(this._tab === "quality" && session.phase === "quality") ||
			(this._tab === `activity-${session.phaseIndex}` &&
				session.phase === "activity");
		return {
			...context,
			session,
			isGM,
			isDraft: session.state === "draft",
			isSetup: this._tab === "setup",
			isActivity1: this._tab === "activity-1",
			isActivity2: this._tab === "activity-2",
			isActivity3: this._tab === "activity-3",
			isActivity: this._tab.startsWith("activity-"),
			isQuality: this._tab === "quality",
			currentSetup: session.state !== "draft" && currentTabName === "setup",
			currentActivity1: currentTabName === "activity-1",
			currentActivity2: currentTabName === "activity-2",
			currentActivity3: currentTabName === "activity-3",
			currentQuality: currentTabName === "quality",
			canVisitActivity1: visitedPhases.has("activity-1"),
			canVisitActivity2: visitedPhases.has("activity-2"),
			canVisitActivity3: visitedPhases.has("activity-3"),
			canVisitQuality: visitedPhases.has("quality"),
			playerPreparationReady: !!session.heroes[playerActorId]?.preparationReady,
			playerActivitySubmitted:
				!!session.heroes[playerActorId]?.activities?.[activityIndex]?.submitted,
			playerQualitySubmitted:
				!!session.heroes[playerActorId]?.quality?.submitted,
			activityChoiceComplete,
			qualityChoiceComplete,
			durationLabel: t(`Litm.camp.duration-${session.duration}`),
			heroes,
			selectedHero,
			selectedActor,
			resources: selectedResources,
			activity,
			activityIndex,
			setupEditable: isGM,
			selectedChoiceLocked,
			canEditSelected:
				playerPhaseEditable &&
				(isGM || playerOwnsSelected) &&
				!selectedChoiceLocked,
			phaseEditable:
				isGM ||
				(session.phase === "activity" &&
					session.phaseIndex - 1 === activityIndex),
			canChooseRest: !usedTypes.includes("rest"),
			canChooseReflect: !usedTypes.includes("reflect"),
			themes,
			fellowshipTags,
			relationships,
			hasSelectedRelationship: !!selectedRelationshipActorId,
			isSkippedThirdRevisit:
				this._tab === "activity-3" &&
				session.phase === "quality" &&
				!session.thirdEnabled,
			phaseLabel: CampDialog.#phaseLabel(session),
			tabIsCurrent: this._tab === currentTabName,
			viewedPhase: this._tab,
		};
	}

	static #collectResources(actor) {
		const result = {
			expirable: [],
			backpack: [],
			tracking: [],
			statuses: [],
			scratched: [],
			storyThemes: [],
		};
		const seen = new Set();
		const addTag = (group, key, tag, extra = {}) => {
			if (!tag?.name || seen.has(key)) return;
			seen.add(key);
			result[group].push({
				key: this.#encodeResourceKey(key),
				name: tag.name,
				type: "tag",
				value: 0,
				values: CampDialog.#statusValues([], 0),
				isPrivate: !!tag.isPrivate,
				resourceGroup: group,
				...extra,
			});
		};
		for (const effect of actor.effects) {
			const flags = effect.flags?.["litm-rn"] ?? {};
			const value =
				Number(flags.value) || (flags.values?.findLastIndex(Boolean) ?? -1) + 1;
			const isStatus =
				flags.type === "status" ||
				(flags.type === "tag" && flags.values?.some(Boolean));
			if (isStatus) {
				const key = `effect:${effect.id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				result.statuses.push({
					key: this.#encodeResourceKey(key),
					name: effect.name,
					type: "status",
					value,
					values: CampDialog.#statusValues(flags.values, value),
					isPrivate: !!flags.isPrivate,
					resourceGroup: "statuses",
				});
				continue;
			}
			if (flags.type !== "tag") continue;

			const isTrackingTag = !flags.ownerType;
			if (!isTrackingTag) continue;
			if (flags.isScratched)
				addTag("scratched", `effect:${effect.id}`, effect, {
					isPrivate: !!flags.isPrivate,
				});
			else {
				addTag("expirable", `effect:${effect.id}`, effect, {
					isPrivate: !!flags.isPrivate,
				});
				result.tracking.push({
					...result.expirable.at(-1),
					preparationGroup: "tracking",
				});
			}
		}

		for (const [index, tag] of (actor.system.backpackTags ?? []).entries()) {
			addTag(
				tag.isScratched ? "scratched" : "expirable",
				`actor:system.backpackTags.${index}|${tag.id}`,
				tag,
			);
			if (!tag.isScratched)
				result.backpack.push({
					...result.expirable.at(-1),
					preparationGroup: "backpack",
				});
		}
		for (const [themeIndex, theme] of (actor.system.themes ?? []).entries()) {
			if (theme.isEmpty) continue;
			for (const field of ["themeTag", "powerTags"]) {
				const tags =
					field === "themeTag" ? [theme.themeTag] : (theme.powerTags ?? []);
				for (const [tagIndex, tag] of tags.entries()) {
					if (!tag?.isScratched) continue;
					const suffix =
						field === "themeTag" ? "themeTag" : `powerTags.${tagIndex}`;
					addTag(
						"scratched",
						`actor:system.themes.${themeIndex}.${suffix}|${tag.id}`,
						tag,
					);
				}
			}
		}

		for (const item of actor.items.filter(
			(entry) => entry.type === "story" && !entry.system.isArchived,
		)) {
			const storyTheme = {
				id: item.id,
				name: item.name,
				img: item.img,
				level: item.system.level || "origin",
				tags: [],
			};
			for (const field of ["themeTag", "powerTags", "weaknessTags"]) {
				const tags =
					field === "themeTag"
						? [item.system.themeTag]
						: (item.system[field] ?? []);
				for (const [index, tag] of tags.entries()) {
					if (!tag?.isScratched) continue;
					const path = `item:${item.id}:system.${field}${field === "themeTag" ? "" : `.${index}`}|${tag.id}`;
					storyTheme.tags.push({
						key: this.#encodeResourceKey(path),
						name: tag.name,
						type:
							tag.type ||
							(field === "weaknessTags"
								? "weaknessTag"
								: field === "themeTag"
									? "themeTag"
									: "powerTag"),
						value: 0,
						values: CampDialog.#statusValues([], 0),
						isPrivate: !!tag.isPrivate,
						resourceGroup: "storyThemes",
					});
				}
			}
			if (storyTheme.tags.length) result.storyThemes.push(storyTheme);
		}
		return result;
	}

	static #encodeResourceKey(key) {
		return key.replaceAll(":", "__c__").replaceAll(".", "__d__");
	}

	static #decodeResourceKey(key) {
		return key.replaceAll("__d__", ".").replaceAll("__c__", ":");
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#closeCampsiteTagMenu();
		document
			.querySelector(`[data-camp-notice="${this.fellowshipId}"]`)
			?.remove();
		const root = this.element;
		const tabs = root.querySelector(".litm--camp-tabs");
		this.#fitControlLabels();
		this._tabResizeObserver?.disconnect();
		if (tabs) {
			let observedWidth = tabs.clientWidth;
			this._tabResizeObserver = new ResizeObserver((entries) => {
				const width = entries[0]?.contentRect?.width ?? tabs.clientWidth;
				if (Math.abs(width - observedWidth) < 1) return;
				observedWidth = width;
				this.#fitControlLabels();
			});
			this._tabResizeObserver.observe(tabs);
		}
		root.querySelectorAll("[data-camp-tab]").forEach((button) =>
			button.addEventListener("click", (event) => {
				if (event.currentTarget.disabled) return;
				this._tab = event.currentTarget.dataset.campTab;
				this.render();
			}),
		);
		root.querySelectorAll("[data-actor-id]").forEach((button) =>
			button.addEventListener("click", (event) => {
				const actorId = event.currentTarget.dataset.actorId;
				if (!game.user.isGM && actorId !== game.user.character?.id) return;
				this._selectedActorId = actorId;
				this.render();
			}),
		);
		root.querySelectorAll("[data-set-path]").forEach((input) =>
			input.addEventListener("change", (event) => {
				const target = event.currentTarget;
				const value =
					target.type === "number" ? Number(target.value) : target.value;
				this.#mutate({ type: "set", path: target.dataset.setPath, value });
			}),
		);
		root.querySelectorAll("[data-set-button]").forEach((button) =>
			button.addEventListener("click", (event) => {
				const target = event.currentTarget;
				const raw = target.dataset.setValue;
				const value = raw === "true" ? true : raw === "false" ? false : raw;
				this.#mutate({ type: "set", path: target.dataset.setButton, value });
			}),
		);
		root.querySelectorAll("[data-set-decision]").forEach((button) =>
			button.addEventListener("click", (event) => {
				const target = event.currentTarget;
				this.#mutate({
					type: "setDecision",
					path: target.dataset.setDecision,
					changes: {
						action: target.dataset.decisionAction,
						...(target.dataset.decisionTiming
							? { timing: target.dataset.decisionTiming }
							: {}),
					},
				});
			}),
		);
		root.querySelectorAll("[data-choose-status-decrease]").forEach((button) =>
			button.addEventListener("click", (event) => {
				const target = event.currentTarget;
				const decrease = Math.min(
					6,
					(Number(target.dataset.currentDecrease) || 0) + 1,
				);
				this.#mutate({
					type: "setDecision",
					path: target.dataset.chooseStatusDecrease,
					changes: { action: "status", decrease },
				});
			}),
		);
		root.querySelectorAll("[data-content-path]").forEach((element) =>
			element.addEventListener("blur", (event) => {
				const target = event.currentTarget;
				this.#mutate({
					type: "set",
					path: target.dataset.contentPath,
					value: target.textContent.trim(),
				});
			}),
		);
		root
			.querySelectorAll("[data-camp-tag-context]")
			.forEach((element) =>
				element.addEventListener("contextmenu", (event) =>
					this.#openCampsiteTagMenu(event),
				),
			);
		root.querySelectorAll("[data-camp-tag-name]").forEach((element) =>
			element.addEventListener("blur", (event) => {
				const target = event.currentTarget;
				target.contentEditable = "false";
				const name = target.textContent.trim();
				if (name)
					this.#mutate({
						type: "updateCampsiteTag",
						id: target.dataset.campTagName,
						changes: { name },
					});
			}),
		);
		root.querySelectorAll("[data-status-values]").forEach((group) => {
			group.querySelectorAll("[data-status-index]").forEach((button) =>
				button.addEventListener("click", (event) => {
					const values = Array.from(
						group.querySelectorAll("[data-status-index]"),
						(dot, index) =>
							dot.classList.contains("filled") ? index + 1 : false,
					);
					const index = Number(event.currentTarget.dataset.statusIndex);
					values[index] = values[index] ? false : index + 1;
					this.#mutate({
						type: "set",
						path: `${group.dataset.statusValues}.values`,
						value: values,
					});
				}),
			);
		});
		root.querySelectorAll("[data-reset-status]").forEach((button) =>
			button.addEventListener("click", (event) => {
				const target = event.currentTarget;
				this.#mutate({
					type: "setDecision",
					path: target.dataset.resetStatus,
					changes: { action: "keep", decrease: 0 },
				});
			}),
		);
		root
			.querySelector("[data-campsite-name]")
			?.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				this.#onAction({
					currentTarget: { dataset: { campAction: "add-campsite-tag" } },
				});
			});
		root
			.querySelectorAll("[data-camp-action]")
			.forEach((button) =>
				button.addEventListener("click", (event) => this.#onAction(event)),
			);
		const drop = root.querySelector("[data-campsite-drop]");
		if (drop) {
			drop.addEventListener("dragover", (event) => {
				event.preventDefault();
				drop.classList.add("dragover");
			});
			drop.addEventListener("dragleave", () =>
				drop.classList.remove("dragover"),
			);
			drop.addEventListener("drop", (event) => this.#onDrop(event));
		}
	}

	#fitControlLabels() {
		for (const label of this.element?.querySelectorAll(
			".litm--camp-tab-label, .litm--camp-option-label",
		) ?? []) {
			const button = label.closest("button");
			const content = label.parentElement;
			if (!button || !content) continue;
			label.style.width = "max-content";
			label.style.maxWidth = "none";
			const buttonStyle = getComputedStyle(button);
			const contentStyle = getComputedStyle(content);
			const padding =
				Number.parseFloat(buttonStyle.paddingLeft) +
				Number.parseFloat(buttonStyle.paddingRight);
			const siblings = [...content.children]
				.filter((child) => child !== label)
				.reduce(
					(width, child) => width + child.getBoundingClientRect().width,
					0,
				);
			const gaps =
				Math.max(0, content.children.length - 1) *
				(Number.parseFloat(contentStyle.columnGap) || 0);
			const reserve = button.classList.contains("current") ? 14 : 0;
			const available = Math.max(
				24,
				button.clientWidth - padding - siblings - gaps - reserve,
			);
			label.style.maxWidth = `${available}px`;
			const range = document.createRange();
			range.selectNodeContents(label);
			const lineWidths = [...range.getClientRects()]
				.map((rect) => rect.width)
				.filter(Boolean);
			range.detach();
			if (lineWidths.length > 1)
				label.style.width = `${Math.ceil(Math.max(...lineWidths)) + 1}px`;
		}
	}

	#openCampsiteTagMenu(event) {
		event.preventDefault();
		event.stopPropagation();
		if (!game.user.isGM) return;
		const id = event.currentTarget.dataset.campTagContext;
		const tag = this.session?.campsite?.tags?.find((entry) => entry.id === id);
		if (!tag) return;
		this.#closeCampsiteTagMenu();
		const menu = document.createElement("div");
		menu.className = "litm--character-tag-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		const addOption = (label, icon, callback, separator = false) => {
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle("litm--character-tag-menu-separator", separator);
			button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
			button.addEventListener("click", () => {
				this.#closeCampsiteTagMenu();
				callback();
			});
			menu.append(button);
		};
		addOption(t("Litm.ui.edit"), "fa-solid fa-pen", () => {
			const name = this.element.querySelector(`[data-camp-tag-name="${id}"]`);
			if (!name) return;
			name.contentEditable = "true";
			name.focus();
			const selection = window.getSelection();
			selection?.selectAllChildren(name);
			selection?.collapseToEnd();
		});
		addOption(
			t(tag.isPrivate ? "Litm.ui.reveal-secret-tag" : "Litm.ui.make-secret"),
			"fa-solid fa-mask",
			() => {
				this.#mutate({
					type: "updateCampsiteTag",
					id,
					changes: { isPrivate: !tag.isPrivate },
				});
			},
		);
		if (tag.type === "tag") {
			addOption(
				t(tag.isPermanent ? "Litm.tags.isPermanent" : "Litm.tags.toPermanent"),
				"fa-solid fa-infinity",
				() => {
					this.#mutate({
						type: "updateCampsiteTag",
						id,
						changes: { isPermanent: !tag.isPermanent },
					});
				},
			);
		}
		if (tag.type === "status") {
			const values = CampDialog.#statusValues(tag.values, tag.value);
			const group = document.createElement("div");
			group.className = "litm--tag-menu-values litm--tm-popup-status";
			values.forEach((filled, index) => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = `litm--tm-popup-status-btn${filled ? " filled" : ""}`;
				button.dataset.tooltip = String(index + 1);
				button.addEventListener("click", () => {
					const next = [...values];
					next[index] = next[index] ? false : index + 1;
					this.#closeCampsiteTagMenu();
					this.#mutate({
						type: "updateCampsiteTag",
						id,
						changes: { values: next },
					});
				});
				group.append(button);
			});
			menu.append(group);
			addOption(t("Litm.ui.decrease-status"), "fa-solid fa-arrow-left", () => {
				if (values.findLastIndex(Boolean) <= 0) {
					this.#mutate({ type: "removeCampsiteTag", id });
					return;
				}
				const shifted = Array.from({ length: 6 }, (_, index) =>
					values[index + 1] ? index + 1 : false,
				);
				this.#mutate({
					type: "updateCampsiteTag",
					id,
					changes: { values: shifted },
				});
			});
		}
		addOption(
			t("Litm.ui.remove"),
			"fa-solid fa-trash",
			() => this.#mutate({ type: "removeCampsiteTag", id }),
			true,
		);
		document.body.append(menu);
		this._contextMenu = menu;
		this._contextOutside = (pointerEvent) => {
			if (!menu.contains(pointerEvent.target)) this.#closeCampsiteTagMenu();
		};
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			if (rect.right > window.innerWidth)
				menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
			if (rect.bottom > window.innerHeight)
				menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
		});
		setTimeout(
			() => document.addEventListener("pointerdown", this._contextOutside),
			0,
		);
	}

	#closeCampsiteTagMenu() {
		if (this._contextOutside)
			document.removeEventListener("pointerdown", this._contextOutside);
		this._contextMenu?.remove();
		this._contextMenu = null;
		this._contextOutside = null;
	}

	#mutate(mutation) {
		if (this._draftSession) {
			if (mutation.type === "set") {
				const activityType = mutation.path.match(
					/^(heroes\.[^.]+\.activities\.\d+)\.type$/,
				);
				if (activityType)
					foundry.utils.setProperty(this._draftSession, activityType[1], {
						...CampDialog.#emptyActivity(),
						type: mutation.value,
					});
				else
					foundry.utils.setProperty(
						this._draftSession,
						mutation.path,
						mutation.value,
					);
				if (/\.(action|name|value|values)$/.test(mutation.path)) {
					const base = mutation.path.replace(
						/\.(action|name|value|values)$/,
						"",
					);
					const decision =
						foundry.utils.getProperty(this._draftSession, base) ?? {};
					if (!decision.timing)
						foundry.utils.setProperty(
							this._draftSession,
							`${base}.timing`,
							"now",
						);
					if (
						/\.(name|value|values)$/.test(mutation.path) &&
						!decision.action
					) {
						foundry.utils.setProperty(
							this._draftSession,
							`${base}.action`,
							"status",
						);
					}
				}
				if (mutation.path === "duration")
					this._draftSession.bonus =
						{ camp: 0, days: 1, weeks: 2, months: 3 }[mutation.value] ?? 0;
			} else if (mutation.type === "addCampsiteTag") {
				CampDialog.#addCampsiteTag(this._draftSession, mutation.tag);
			} else if (mutation.type === "removeCampsiteTag") {
				this._draftSession.campsite.tags =
					this._draftSession.campsite.tags.filter(
						(tag) => tag.id !== mutation.id,
					);
			} else if (mutation.type === "updateCampsiteTag") {
				const tag = this._draftSession.campsite.tags.find(
					(entry) => entry.id === mutation.id,
				);
				if (tag) {
					Object.assign(tag, mutation.changes ?? {});
					if (tag.type === "status") {
						tag.values = CampDialog.#statusValues(tag.values, tag.value);
						tag.value = tag.values.findLastIndex(Boolean) + 1;
					}
				}
			}
			return this.render();
		}
		if (game.user.isGM)
			return CampDialog.#queueMutation(this.fellowshipId, mutation);
		Sockets.dispatch("campMutation", {
			fellowshipId: this.fellowshipId,
			mutation,
		});
	}

	async #onAction(event) {
		const button = event.currentTarget;
		const action = button.dataset.campAction;
		if (action === "add-campsite-tag") {
			const input = this.element.querySelector("[data-campsite-name]");
			const raw = input?.value?.trim();
			if (!raw) return;
			const status = raw.match(/^(.+?)[\s:-]([0-6])$/u);
			const value = status ? Number(status[2]) : 0;
			const name = status?.[1]?.trim() || raw;
			this.#mutate({
				type: "addCampsiteTag",
				tag: {
					name,
					type: status ? "status" : "tag",
					value,
					values: CampDialog.#statusValues([], value),
					isPermanent: false,
				},
			});
			input.value = "";
		} else if (action === "remove-campsite-tag") {
			this.#mutate({ type: "removeCampsiteTag", id: button.dataset.id });
		} else if (action === "choose-activity") {
			const type = button.dataset.type;
			const index = Number(button.dataset.index);
			this.#mutate({
				type: "set",
				path: `heroes.${this._selectedActorId}.activities.${index}.type`,
				value: type,
			});
		} else if (action === "submit-activity") {
			this.#mutate({
				type: "submitActivity",
				actorId: this._selectedActorId,
				index: Number(button.dataset.index),
			});
		} else if (action === "submit-quality") {
			this.#mutate({ type: "submitQuality", actorId: this._selectedActorId });
		} else if (action === "choose-relationship") {
			this.#mutate({
				type: "chooseRelationship",
				actorId: this._selectedActorId,
				fellowActorId: button.dataset.fellowActorId,
			});
		} else if (action === "unlock-choice" && game.user.isGM) {
			const confirmed = await DialogV2.confirm({
				window: { title: t("Litm.camp.unlock-choice") },
				content: `<p>${t("Litm.camp.unlock-choice-warning")}</p>`,
			});
			if (confirmed)
				this.#mutate({
					type: "unlockChoice",
					actorId: this._selectedActorId,
					phase: button.dataset.phase,
					index: Number(button.dataset.index),
				});
		} else if (action === "open-camp-roll") {
			this.#openCampRoll(Number(button.dataset.index));
		} else if (action === "request-third") {
			this.#mutate({ type: "requestThird" });
		} else if (action === "toggle-preparation-ready") {
			this.#mutate({
				type: "togglePreparationReady",
				actorId: game.user.character?.id,
			});
		} else if (action === "advance-phase" && game.user.isGM) {
			await this.#advancePhase();
		} else if (action === "skip-third" && game.user.isGM) {
			await this.#skipThird();
		} else if (action === "start-third-late" && game.user.isGM) {
			await this.#startThirdLate();
		} else if (action === "finish-camp" && game.user.isGM) {
			await this.#finishCamp();
		} else if (
			action === "start-camp" &&
			game.user.isGM &&
			this._draftSession
		) {
			await CampDialog.start(this.fellowshipId, this._draftSession);
			this._draftSession = null;
			CampDialog.#draftInstances.delete(this.fellowshipId);
			CampDialog.#instances.set(this.fellowshipId, this);
			await this.render({ force: true });
		} else if (action === "cancel-camp" && game.user.isGM) {
			await this.#cancelCamp();
		}
	}

	async #onDrop(event) {
		event.preventDefault();
		event.currentTarget.classList.remove("dragover");
		if (!game.user.isGM) return;
		let data;
		try {
			const internal = JSON.parse(
				event.dataTransfer.getData("application/litm-tag-manager"),
			);
			const resolved = this.#resolveDroppedTag(internal);
			if (resolved)
				return this.#mutate({ type: "addCampsiteTag", tag: resolved });
		} catch (_) {
			/* use generic drag data */
		}
		try {
			data = TextEditor.getDragEventData(event);
		} catch (_) {
			try {
				data = JSON.parse(event.dataTransfer.getData("text/plain"));
			} catch (_) {
				return;
			}
		}
		let source = data?.tag || data;
		if (data?.uuid) {
			try {
				const doc = await fromUuid(data.uuid);
				if (doc) source = { ...doc.toObject(), uuid: doc.uuid };
			} catch (_) {
				/* no-op */
			}
		}
		this.#mutate({ type: "addCampsiteTag", tag: source });
	}

	#resolveDroppedTag(data) {
		if (!data?.tagId || !data.ref) return null;
		if (data.ref === "story")
			return (
				(game.settings.get("litm-rn", "storytags")?.tags ?? []).find(
					(tag) => tag.id === data.tagId,
				) ?? null
			);
		if (data.ref === "scene")
			return (
				(canvas.scene?.getFlag("litm-rn", "scenetags")?.tags ?? []).find(
					(tag) => tag.id === data.tagId,
				) ?? null
			);
		if (data.ref === "fellowship") {
			const item = game.items.get(this.fellowshipId);
			const tag = item?.system?.allTags?.find(
				(entry) => entry.id === data.tagId,
			);
			return tag?.toObject?.() ?? (tag ? { ...tag } : null);
		}
		if (data.ref.startsWith("story-theme-")) {
			const item = game.items.get(data.ref.slice("story-theme-".length));
			const tag = item?.system?.allTags?.find(
				(entry) => entry.id === data.tagId,
			);
			return tag?.toObject?.() ?? (tag ? { ...tag } : null);
		}
		let actor = game.actors.get(data.ref);
		try {
			const document = actor ? null : fromUuidSync(data.ref);
			actor ||= document?.actor ?? document;
		} catch (_) {
			/* no-op */
		}
		const effect = actor?.effects?.get(data.tagId);
		if (!effect) return null;
		return {
			name: effect.name,
			type: effect.flags?.["litm-rn"]?.type || "tag",
			...effect.flags?.["litm-rn"],
		};
	}

	#openCampRoll(index) {
		const session = this.session;
		const camp = {
			sessionId: session.id,
			fellowshipId: session.fellowshipId,
			phaseIndex: index + 1,
			bonus: session.bonus,
			duration: session.duration,
		};
		if (game.user.isGM) {
			game.litm.LitmRollDialog.openForGm(this._selectedActorId, {
				camp,
				type: "tracked",
			});
			return;
		}
		const existing = game.litm.LitmRollDialog.findOpen?.(
			this._selectedActorId,
			camp,
		);
		if (existing) {
			existing.render({ force: true });
			return;
		}
		const dialog = new game.litm.LitmRollDialog(this._selectedActorId, {
			type: "camp",
			camp,
		});
		dialog.render({ force: true });
	}

	async #advancePhase() {
		const session = foundry.utils.deepClone(this.session);
		if (session.phase === "activity") {
			const activities = Object.values(session.heroes).map(
				(hero) => hero.activities[session.phaseIndex - 1],
			);
			const incomplete = activities.some(
				(activity) => !activity.type || !activity.submitted,
			);
			if (incomplete) {
				const proceed = await DialogV2.confirm({
					window: { title: t("Litm.camp.incomplete-phase") },
					content: `<p>${t("Litm.camp.incomplete-phase-warning")}</p>`,
				});
				if (!proceed) return;
			}
		}
		if (session.phase === "setup") {
			await CampDialog.#applyDecisionSet(session, "preparation", "now");
			session.phase = "activity";
			session.phaseIndex = 1;
			this.#markPhaseVisited(session, "activity-1");
			this._tab = "activity-1";
		} else if (session.phase === "activity") {
			if (session.phaseIndex === 1) {
				session.phaseIndex = 2;
				this.#markPhaseVisited(session, "activity-2");
				this._tab = "activity-2";
			} else if (session.phaseIndex === 2) {
				session.thirdEnabled = true;
				for (const hero of Object.values(session.heroes)) {
					if (
						!(session.thirdRequestedBy ?? []).includes(hero.actorId) &&
						!hero.activities[2].type
					) {
						hero.activities[2] = {
							...CampDialog.#emptyActivity(),
							type: "skip-activity",
						};
					}
				}
				session.phaseIndex = 3;
				this.#markPhaseVisited(session, "activity-3");
				this._tab = "activity-3";
			} else {
				session.phase = "quality";
				this.#markPhaseVisited(session, "quality");
				this._tab = "quality";
			}
		} else if (session.phase === "quality") {
			await this.#finishCamp();
			return;
		}
		await CampDialog.#saveSession(session);
	}

	#markPhaseVisited(session, phase) {
		session.visitedPhases = [...new Set([...session.visitedPhases, phase])];
	}

	async #skipThird() {
		const session = foundry.utils.deepClone(this.session);
		if (session.phase !== "activity" || session.phaseIndex !== 2) return;
		session.thirdEnabled = false;
		session.phase = "quality";
		session.phaseIndex = 0;
		this.#markPhaseVisited(session, "activity-3");
		this.#markPhaseVisited(session, "quality");
		this._tab = "quality";
		await CampDialog.#saveSession(session);
	}

	async #startThirdLate() {
		const session = foundry.utils.deepClone(this.session);
		if (session.phase !== "quality" || session.thirdEnabled) return;
		session.thirdEnabled = true;
		session.phase = "activity";
		session.phaseIndex = 3;
		for (const hero of Object.values(session.heroes)) {
			if (hero.activities[2]?.type === "skip-activity")
				hero.activities[2] = CampDialog.#emptyActivity();
		}
		this.#markPhaseVisited(session, "activity-3");
		this._tab = "activity-3";
		await CampDialog.#saveSession(session);
	}

	static async #applyDecisionSet(session, path, timing) {
		const decisions = foundry.utils.getProperty(session, path) ?? {};
		for (const [actorId, actorDecisions] of Object.entries(
			path === "preparation" ? decisions : { [path.split(".")[1]]: decisions },
		)) {
			const actor = game.actors.get(actorId);
			if (!actor) continue;
			const entries = Object.entries(actorDecisions ?? {}).sort(
				([left], [right]) => {
					const l = this.#decodeResourceKey(left).match(/^(.*)\.(\d+)$/);
					const r = this.#decodeResourceKey(right).match(/^(.*)\.(\d+)$/);
					if (l && r && l[1] === r[1]) return Number(r[2]) - Number(l[2]);
					return left.localeCompare(right);
				},
			);
			for (const [key, decision] of entries) {
				if (
					!decision ||
					(decision.timing ?? "now") !== timing ||
					!decision.action ||
					decision.action === "keep"
				)
					continue;
				await this.#applyResourceDecision(actor, key, decision);
			}
		}
	}

	static async #applyResourceDecision(actor, key, decision) {
		const decodedKey = this.#decodeResourceKey(key);
		if (decodedKey.startsWith("effect:")) {
			const id = decodedKey.slice(7);
			const effect = actor.effects.get(id);
			if (!effect) return;
			if (decision.action === "expire") {
				if (decision.archive)
					await this.#archiveTag(actor, {
						id: foundry.utils.randomID(),
						name: effect.name,
						isPrivate: !!effect.flags?.["litm-rn"]?.isPrivate,
					});
				await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
			} else {
				const update = { _id: id };
				if (decision.action === "restore")
					update["flags.litm-rn.isScratched"] = false;
				if (decision.action === "status") {
					update.name = decision.name || effect.name;
					const original = CampDialog.#statusValues(
						decision.originalValues ?? effect.flags?.["litm-rn"]?.values,
						Number(decision.value ?? effect.flags?.["litm-rn"]?.value) || 0,
					);
					const decrease = Math.max(0, Number(decision.decrease) || 0);
					const values = Array.from({ length: 6 }, (_, index) =>
						original[index + decrease] ? index + 1 : false,
					);
					const value = values.findLastIndex(Boolean) + 1;
					if (!value) {
						await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
						return;
					}
					update["flags.litm-rn.value"] = value;
					update["flags.litm-rn.values"] = values;
				}
				await actor.updateEmbeddedDocuments("ActiveEffect", [update]);
			}
			return;
		}
		const [kind, ...parts] = decodedKey.split(":");
		let document = actor;
		let path;
		if (kind === "item") {
			document = actor.items.get(parts.shift());
			path = parts.join(":");
		} else path = parts.join(":");
		if (!document || !path) return;
		let tagId = "";
		[path, tagId = ""] = path.split("|");
		const indexedPath = path.match(/^(.*)\.(\d+)$/);
		if (indexedPath && tagId) {
			const current =
				foundry.utils.getProperty(document._source, indexedPath[1]) ?? [];
			const currentIndex = current.findIndex((entry) => entry.id === tagId);
			if (currentIndex < 0) return;
			path = `${indexedPath[1]}.${currentIndex}`;
		}
		if (!foundry.utils.getProperty(document._source, path)) return;
		if (decision.action === "expire") {
			if (decision.archive)
				await this.#archiveTag(
					actor,
					foundry.utils.deepClone(
						foundry.utils.getProperty(document._source, path),
					),
				);
			const indexed = path.match(/^(.*)\.(\d+)$/);
			if (indexed) {
				await this.#removeTagPath(document, path);
			} else {
				await this.#updateTagPath(document, path, { isScratched: true });
			}
		} else if (decision.action === "restore") {
			await this.#updateTagPath(document, path, { isScratched: false });
		}
	}

	/** Add a removed story tag to the Hero's existing Backpack archive. */
	static async #archiveTag(actor, tag) {
		if (!tag?.name) return;
		const archive = foundry.utils.deepClone(
			actor._source.system.backpackArchive ?? [],
		);
		archive.push({
			id: foundry.utils.randomID(),
			name: tag.name,
			type: "backpack",
			isScratched: false,
			isPrivate: tag.isPrivate ?? false,
		});
		await actor.update(
			{ "system.backpackArchive": archive },
			{ validate: false },
		);
	}

	static async #removeTagPath(document, path) {
		const arrayPath = path.match(/^(system\.[^.]+)\.(\d+)(?:\.(.*))?$/);
		if (!arrayPath) return;
		const [, parentPath, index, nestedPath = ""] = arrayPath;
		const entries = foundry.utils.deepClone(
			foundry.utils.getProperty(document._source, parentPath) ?? [],
		);
		const targetPath = nestedPath ? `${index}.${nestedPath}` : index;
		const separator = targetPath.lastIndexOf(".");
		const collectionPath = separator >= 0 ? targetPath.slice(0, separator) : "";
		const targetIndex = Number(
			separator >= 0 ? targetPath.slice(separator + 1) : targetPath,
		);
		const collection = collectionPath
			? foundry.utils.getProperty(entries, collectionPath)
			: entries;
		if (
			!Array.isArray(collection) ||
			!Number.isInteger(targetIndex) ||
			targetIndex < 0 ||
			targetIndex >= collection.length
		)
			return;
		collection.splice(targetIndex, 1);
		await document.update({ [parentPath]: entries }, { validate: false });
	}

	static async #updateTagPath(document, path, changes) {
		const arrayPath = path.match(/^(system\.[^.]+)\.(\d+)(?:\.(.*))?$/);
		if (!arrayPath) {
			const update = Object.fromEntries(
				Object.entries(changes).map(([field, value]) => [
					`${path}.${field}`,
					value,
				]),
			);
			await document.update(update, { validate: false });
			return;
		}
		const [, parentPath, index, nestedPath = ""] = arrayPath;
		const entries = foundry.utils.deepClone(
			foundry.utils.getProperty(document._source, parentPath) ?? [],
		);
		const targetPath = nestedPath ? `${index}.${nestedPath}` : index;
		const target = foundry.utils.getProperty(entries, targetPath);
		if (!target) return;
		Object.assign(target, changes);
		await document.update({ [parentPath]: entries }, { validate: false });
	}

	static async #applyQuality(session, actorId = null) {
		const fellowship = game.items.get(session.fellowshipId);
		for (const hero of Object.values(session.heroes)) {
			if (actorId && hero.actorId !== actorId) continue;
			if (hero.quality.type === "tag" && hero.quality.tagId && fellowship) {
				const sys = fellowship.system;
				if (sys.themeTag?.id === hero.quality.tagId) {
					await fellowship.update(
						{ "system.themeTag.isScratched": false },
						{ validate: false },
					);
				} else {
					const index = sys.powerTags.findIndex(
						(tag) => tag.id === hero.quality.tagId,
					);
					if (index >= 0) {
						const powerTags = foundry.utils.deepClone(
							fellowship._source.system.powerTags ?? [],
						);
						powerTags[index].isScratched = false;
						await fellowship.update(
							{ "system.powerTags": powerTags },
							{ validate: false },
						);
					}
				}
			} else if (hero.quality.type === "relationship") {
				const actor = game.actors.get(hero.actorId);
				if (!actor) continue;
				const relationships = foundry.utils.duplicate(
					actor.system.relationships ?? [],
				);
				const fellowActorId = hero.quality.relationshipActorId;
				if (
					!fellowActorId ||
					!session.heroes[fellowActorId] ||
					fellowActorId === hero.actorId
				)
					continue;
				const relationship = relationships.find(
					(entry) => entry.fellowActorId === fellowActorId,
				);
				if (relationship) {
					relationship.name =
						hero.quality.relationshipName || relationship.name;
					relationship.isScratched = false;
				} else
					relationships.push({
						id: foundry.utils.randomID(),
						fellowActorId,
						name: hero.quality.relationshipName || t("Litm.tags.relationship"),
						isScratched: false,
						isPrivate: false,
					});
				await actor.update(
					{ "system.relationships": relationships },
					{ validate: false },
				);
			}
		}
	}

	async #finishCamp() {
		const hasUnconfirmedChoices = Object.values(this.session.heroes).some(
			(hero) => !hero.quality?.submitted,
		);
		if (hasUnconfirmedChoices) {
			const proceed = await DialogV2.confirm({
				window: { title: t("Litm.camp.incomplete-phase") },
				content: `<p>${t("Litm.camp.incomplete-phase-warning")}</p>`,
			});
			if (!proceed) return;
		}
		const confirmed = await DialogV2.confirm({
			window: { title: t("Litm.camp.finish") },
			content: `<p>${t("Litm.camp.finish-warning")}</p>`,
		});
		if (!confirmed) return;
		const session = foundry.utils.deepClone(this.session);
		await CampDialog.#applyDecisionSet(session, "preparation", "after");
		const fellowship = game.items.get(session.fellowshipId);
		for (const hero of Object.values(session.heroes)) {
			hero.actorName = game.actors.get(hero.actorId)?.name || "";
			if (hero.quality?.type === "tag" && hero.quality.tagId) {
				hero.quality.tagName =
					[
						fellowship?.system?.themeTag,
						...(fellowship?.system?.powerTags ?? []),
					].find((tag) => tag?.id === hero.quality.tagId)?.name || "";
			}
		}
		const summary = Object.values(session.heroes)
			.map((hero) => {
				const actor = game.actors.get(hero.actorId);
				const labels = hero.activities.map((activity) =>
					activity.submitted &&
					activity.type &&
					activity.type !== "skip-activity"
						? t(`Litm.camp.${activity.type}`)
						: t("Litm.camp.skip-activity"),
				);
				return `<li><strong>${foundry.utils.escapeHTML(actor?.name ?? "")}</strong>: ${labels.map((label) => foundry.utils.escapeHTML(label)).join(" · ")}</li>`;
			})
			.join("");
		await CONFIG.ChatMessage.documentClass.create({
			content: `<div class="litm litm--camp-chat"><h3><i class="fas fa-campground"></i> ${t("Litm.camp.completed")}</h3><ul>${summary}</ul><p>${CampDialog.#durationLabel(session.duration)}</p><p>${t("Litm.camp.sojourn-bonus")}: +${session.bonus}</p><button type="button" data-camp-history><i class="fas fa-clock-rotate-left"></i> ${t("Litm.camp.view-history")}</button></div>`,
			flags: { "litm-rn": { campHistory: session } },
		});
		this.#clearCampSelections(session);
		await CampDialog.#deleteSession(this.fellowshipId);
		await this.close();
	}

	#clearCampSelections(session) {
		game.litm?.removeRollRefFromActors?.(Object.keys(session.heroes), "camp");
	}

	async #cancelCamp() {
		const confirmed = await DialogV2.confirm({
			window: { title: t("Litm.camp.cancel") },
			content: `<p>${t("Litm.camp.cancel-warning")}</p>`,
		});
		if (!confirmed) return;
		const session = this.session;
		this.#clearCampSelections(session);
		await CampDialog.#deleteSession(this.fellowshipId);
		await this.close();
	}
}
