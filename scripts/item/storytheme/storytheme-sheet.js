import { registerDataInputSync } from "../../mixins/sheet-utils.js";
import { localize as t } from "../../utils.js";
import {
	configureTagRote,
	confirmTagRoteRemoval,
	deleteTagRote,
	getLinkedRote,
	getWorldRoteLink,
} from "../rote/rote-links.js";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

export class StoryThemeSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	#roteItemHooks = [];
	#linkedRoteIds = new Set();
	#pendingDataInputSubmit = Promise.resolve();

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--story-theme", "litm--theme-card"],
		tag: "form",
		position: { width: 800, height: 540 },
		window: {
			resizable: true,
			title: (app) => app.document.name,
		},
		form: { submitOnChange: true },
		actions: {
			editImage: StoryThemeSheet.#onEditImage,
			unlinkWorldRote: StoryThemeSheet.#onUnlinkWorldRote,
		},
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/item/storytheme.html" },
	};

	get system() {
		return this.item.system;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.system = this.document.system.toObject();
		this.#linkedRoteIds.clear();
		const withRote = (tag) => {
			const rote = getLinkedRote(this.item, tag.id);
			const worldLink = getWorldRoteLink(this.item, tag.id);
			if (rote) this.#linkedRoteIds.add(rote.id);
			return {
				...tag,
				hasRote: Boolean(rote || worldLink),
				hasWorldLink: Boolean(worldLink),
				hasActiveRote: rote?.system.isActive === true,
				roteTooltip: worldLink
					? "Litm.rote.open-source"
					: this.item.isEmbedded
						? rote
							? "Litm.rote.configure"
							: "Litm.rote.add"
						: "Litm.rote.link-source",
			};
		};
		context.system.themeTag = withRote(context.system.themeTag);
		context.system.powerTags = context.system.powerTags.map(withRote);
		context.document = this.document;
		context.title = this.item.name;
		context.isEmbedded = this.item.isEmbedded;
		context.storyTypes = [
			"companion",
			"consumable",
			"possessions",
			"intangible",
		].map((type) => game.i18n.localize(`Litm.other.story-type-${type}`));

		const system = this.document.system;

		context.system.weakness = system.weakness;
		context.system.levels = system.levels;
		context.system.noteRaw = context.system.note;
		context.system.note = await TextEditor.enrichHTML(
			context.system.note || "",
		);

		const fallbackSrc = ["origin", "adventure", "greatness"].includes(
			system.level,
		)
			? system.level
			: "origin";
		const darkTheme = document.body.classList.contains("theme-dark");
		const iconSrc = (might) =>
			`${CONFIG.litm.themeicon_src[might]}${darkTheme ? "-color-light" : "-color"}_litm_icn.svg`;
		context.themeiconsrc =
			CONFIG.litm.themeicon_src[system.level] ||
			`systems/litm-rn/assets/media/icons/${fallbackSrc}`;
		context.mightDropdownOptions = Object.entries(system.levels).map(
			([key, label]) => ({ key, label, icon: iconSrc(key) }),
		);
		context.transitionSrc = `systems/litm-rn/assets/media/transition-left-${fallbackSrc}-dark.webp`;
		context.currentLevelLabel = game.i18n.localize(
			`Litm.levels.${fallbackSrc}`,
		);

		return context;
	}

	static #onEditImage(_event, target) {
		const attr = target.dataset.edit;
		const current = foundry.utils.getProperty(this.document, attr);
		new FilePicker({
			type: "image",
			current,
			callback: (path) => this.document.update({ [attr]: path }),
		}).render();
	}

	static async #onUnlinkWorldRote(event, target) {
		event.preventDefault();
		event.stopPropagation();
		await this.#unlinkWorldRote(target.dataset.id);
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const form = this.element;

		registerDataInputSync(form, this, (submission) => {
			this.#pendingDataInputSubmit = submission;
		});

		form
			.querySelectorAll("[data-click]")
			.forEach((el) =>
				el.addEventListener("click", this.#handleClicks.bind(this)),
			);
		form.querySelectorAll('[data-context="delete-rote"]').forEach((el) => {
			el.addEventListener("contextmenu", async (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (await deleteTagRote(this.item, el.dataset.id)) this.render();
			});
		});
		if (!this.#roteItemHooks.length) {
			const refreshForRote = (item) => {
				if (item.type !== "rote") return;
				if (
					item.getFlag("litm-rn", "roteLink")?.ownerUuid !== this.item.uuid &&
					!this.#linkedRoteIds.has(item.id)
				)
					return;
				this.render();
			};
			this.#roteItemHooks = [
				Hooks.on("createItem", refreshForRote),
				Hooks.on("updateItem", refreshForRote),
				Hooks.on("deleteItem", refreshForRote),
			];
		}
	}

	/** @override */
	async close(options) {
		for (const [index, hook] of [
			"createItem",
			"updateItem",
			"deleteItem",
		].entries()) {
			if (this.#roteItemHooks[index])
				Hooks.off(hook, this.#roteItemHooks[index]);
		}
		this.#roteItemHooks = [];
		return super.close(options);
	}

	async _processSubmitData(event, form, formData) {
		const hasLockedWorldRote = (tagId) =>
			Boolean(getWorldRoteLink(this.item, tagId));
		if (
			formData.system?.themeTag &&
			hasLockedWorldRote(this.system.themeTag?.id)
		)
			formData.system.themeTag.name = this.system.themeTag.name;
		const powerTags = formData.system?.powerTags;
		if (powerTags) {
			for (const [index, submitted] of Object.entries(powerTags)) {
				const tag =
					this.system.powerTags?.find((entry) => entry.id === submitted.id) ??
					this.system.powerTags?.[Number(index)];
				if (tag && hasLockedWorldRote(tag.id)) submitted.name = tag.name;
			}
		}
		await super._processSubmitData(event, form, formData);
	}

	async #handleClicks(event) {
		const t = event.currentTarget;
		const action = t.dataset.click;
		const id = t.dataset.id;
		switch (action) {
			case "add-power-tag":
				this.#addTag("powerTag");
				break;
			case "add-weakness-tag":
				this.#addTag("weaknessStoryTag");
				break;
			case "remove-power-tag":
				this.#removeTag(t, "powerTag");
				break;
			case "remove-weakness-tag":
				this.#removeTag(t, "weaknessStoryTag");
				break;
			case "toggle-secret":
				this.#toggleSecret(t.dataset.field, id);
				break;
			case "configure-rote":
				this.#configureRote(id);
				break;
			case "open-levels":
				this.#openlevels(event);
				break;
			case "select-level":
				this.#selectlevel(event);
				break;
		}
	}

	async #toggleSecret(field, id) {
		if (!this.item.isEmbedded) return;
		if (field === "themeTag") {
			await this.item.update({
				"system.themeTag.isPrivate": !this.system.themeTag.isPrivate,
			});
			return;
		}
		const tags = foundry.utils.deepClone(this.system[field] ?? []);
		const tag = tags.find((entry) => entry.id === id);
		if (!tag) return;
		tag.isPrivate = !tag.isPrivate;
		await this.item.update({ [`system.${field}`]: tags });
	}

	async #configureRote(id) {
		// Clicking the Rote button blurs a contenteditable tag and saves its form.
		// Wait for that save before reading the tag or opening the picker.
		await this.#pendingDataInputSubmit.catch(() => {});
		const tag =
			this.system.themeTag?.id === id
				? this.system.themeTag
				: this.system.powerTags?.find((entry) => entry.id === id);
		if (!tag) return;
		await configureTagRote(this.item, tag, async (name) => {
			if (this.system.themeTag?.id === id) {
				await this.item.update({ "system.themeTag.name": name });
				return;
			}
			const tags = (this.system.powerTags ?? []).map((tag) =>
				tag?.toObject ? tag.toObject() : foundry.utils.deepClone(tag),
			);
			const target = tags.find((entry) => entry.id === id);
			if (!target) return;
			target.name = name;
			await this.item.update({ "system.powerTags": tags });
		});
		await this.render();
	}

	async #unlinkWorldRote(id) {
		await this.#pendingDataInputSubmit.catch(() => {});
		if (this.item.isEmbedded || !getWorldRoteLink(this.item, id)) return;
		const removed = await deleteTagRote(this.item, id);
		if (removed === true) {
			await this.render({ force: true });
			return;
		}
		if (removed === false) ui.notifications.error(t("Litm.rote.unlink-failed"));
	}

	#handleCloseLevels = (event) => {
		const dropdown = document.querySelector(".litm--image-dropdown.open");
		if (!dropdown) return;

		const icon = dropdown.querySelector(".selected-image i.fas");
		if (!dropdown.contains(event.target)) {
			dropdown.classList.remove("open");
			icon.classList.toggle("fa-angle-down");
			icon.classList.toggle("fa-angle-up");
			event.currentTarget?.removeEventListener(
				"click",
				this.#handleCloseLevels,
			);
		}
	};

	#openlevels(event) {
		const dropdown = event.currentTarget.closest(".litm--image-dropdown");
		const icon = dropdown.querySelector(".selected-image i.fas");

		dropdown.classList.toggle("open");
		icon.classList.toggle("fa-angle-down");
		icon.classList.toggle("fa-angle-up");

		if (dropdown.classList.contains("open")) {
			dropdown.ownerDocument.addEventListener("click", this.#handleCloseLevels);
		} else {
			dropdown.ownerDocument.removeEventListener(
				"click",
				this.#handleCloseLevels,
			);
		}
	}

	async #selectlevel(event) {
		const option = event.currentTarget;
		const value = option.dataset.value;

		const dropdown = option.closest(".litm--image-dropdown");
		const input = dropdown.querySelector("input[type=hidden]");

		input.value = value;

		await this.submit();
		await this.render();
	}

	async #addTag(type) {
		const fixedType = type === "weaknessStoryTag" ? "weaknessTag" : "powerTag";
		const label = type === "weaknessStoryTag" ? "weakness" : "power";
		const item = {
			name: t(`Litm.ui.name-${label}`),
			isScratched: false,
			type: type,
			id: foundry.utils.randomID(),
		};

		const tags = this.system[`${fixedType}s`];
		tags.push(item);

		await this.item.update({ [`system.${fixedType}s`]: tags });
	}

	async #removeTag(button, type) {
		const id = button.dataset.id;
		const fixedType = type === "weaknessStoryTag" ? "weaknessTag" : "powerTag";
		const tag = this.system[`${fixedType}s`].find((entry) => entry.id === id);
		if (!tag || !(await confirmTagRoteRemoval(this.item, tag))) return;
		const tags = this.system[`${fixedType}s`].filter((t) => t.id !== id);
		const changes = { [`system.${fixedType}s`]: tags };
		if (getWorldRoteLink(this.item, id)) {
			const links = {
				...(this.item.getFlag("litm-rn", "roteLinks") ?? {}),
			};
			delete links[id];
			changes["flags.litm-rn.roteLinks"] = links;
		}
		await this.item.update(changes);
	}
}
