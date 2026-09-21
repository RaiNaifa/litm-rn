import { registerDataInputSync } from "../../mixins/sheet-utils.js";
import { localize as t } from "../../utils.js";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

export class StoryThemeSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
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

	_onRender(context, options) {
		super._onRender(context, options);
		const form = this.element;

		registerDataInputSync(form, this);

		form
			.querySelectorAll("[data-click]")
			.forEach((el) =>
				el.addEventListener("click", this.#handleClicks.bind(this)),
			);
	}

	async _processSubmitData(event, form, formData) {
		await super._processSubmitData(event, form, formData);
	}

	#handleClicks(event) {
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
		const tags = this.system[`${fixedType}s`].filter((t) => t.id !== id);

		await this.item.update({ [`system.${fixedType}s`]: tags });
	}
}
