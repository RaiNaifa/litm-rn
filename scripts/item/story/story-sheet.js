import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, localize as t } from "../../utils.js";
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class StoryThemeSheet extends SheetMixin(foundry.appv1.sheets.ItemSheet) {
	static defaultOptions = foundry.utils.mergeObject(foundry.appv1.sheets.ItemSheet.defaultOptions, {
		classes: ["litm", "litm--story-theme"],
		template: "systems/litm-rn/templates/item/story.html",
		width: 360,
		resizable: true,
	});

	get system() {
		return this.item.system;
	}

	async getData() {
		const { data, ...rest } = super.getData();

		data.system.weakness = this.system.weakness;
		data.system.levels = this.system.levels;
		data.system.note = await TextEditor.enrichHTML(data.system.note);

		const fallbackSrc = ["origin", "adventure", "greatness"].includes(
			data.system.level,
		)
			? data.system.level
			: "origin";
		const themeiconsrc =
			CONFIG.litm.themeicon_src[data.system.level] ||
			`systems/litm-rn/assets/media/icons/${fallbackSrc}`;

		return { data, themeiconsrc, ...rest };
	}

	activateListeners(html) {
		super.activateListeners(html);
	
		html.find("[data-click]").click(this.#handleClicks.bind(this));
		html.find("[data-context").contextmenu(this.#handleContextmenu.bind(this));
	}

	/** @override - This method needs to be overriden to accommodate readonly input fields */
	_getSubmitData(updateData) {
		if (!this.form)
			throw new Error(
				"The FormApplication subclass has no registered form element",
			);
		const fd = new foundry.applications.ux.FormDataExtended(this.form, {
			editors: this.editors,
			readonly: true,
			disabled: true,
		});
		let data = fd.object;
		if (updateData)
			data = foundry.utils.flattenObject(
				foundry.utils.mergeObject(data, updateData),
			);
		return data;
	}

	#handleClicks(event) {
		const t = event.currentTarget;
		const action = t.dataset.click;
		switch (action) {
			case "add-power-tag":
				this.#addTag("powerTag");
				break;
			case "add-weakness-tag":
				this.#addTag("weaknessStoryTag");
				break;
			case "open-levels":
				this.#openlevels(event);
				break;
			case "select-level":
				this.#selectlevel(event);
				break;
		}
	}

	#handleContextmenu(event) {
		const button = event.currentTarget;
		const action = button.dataset.context;
		const id = button.dataset.id;

		switch (action) {
			case "remove-tag":
				this.#removeTag(button, "powerTag");
				break;
			case "remove-weakness":
				this.#removeTag(button, "weaknessStoryTag");
				break;
		}
	}

	#handleCloseLevels = (event) => {
		const $dropdown = $(".litm--image-dropdown.open");
		const dropdown = $dropdown[0];
		if (!dropdown) return;

		const $icon = $dropdown.find(".selected-image i.fas");
		if (!dropdown.contains(event.target)) {
			$dropdown.removeClass("open");
			$icon.toggleClass("fa-angle-down fa-angle-up");
			$(document).off("click", this.#handleCloseLevels);
		}
	};

	#openlevels(event) {
		const dropdown = event.currentTarget.closest(".litm--image-dropdown");
		const $dropdown = $(dropdown);
		const $icon = $dropdown.find(".selected-image i.fas");

		$dropdown.toggleClass("open");
		$icon.toggleClass("fa-angle-down fa-angle-up");

		const isOpen = $dropdown.hasClass("open");
		if (isOpen) {
			$(document).on("click", this.#handleCloseLevels);
		} else {
			$(document).off("click", this.#handleCloseLevels);
		}
	}

	async #selectlevel(event) {
		const $option = $(event.currentTarget);
		const value = $option.data("value");

		const $dropdown = $option.closest(".litm--image-dropdown");
		const $input = $dropdown.find("input[type=hidden]");

		$input.val(value);

		await this._onSubmit(event);
		await this.render();
	}

	async #addTag(type) {
		const fixedType = type === "weaknessStoryTag" ? "weaknessTag" : "powerTag"
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
		if (!(await confirmDelete("Litm.other.tag"))) return;
		const id = button.dataset.id;
		const fixedType = type === "weaknessStoryTag" ? "weaknessTag" : "powerTag"
		const tags = this.system[`${fixedType}s`].filter((t) => t.id !== id);

		await this.item.update({ [`system.${fixedType}s`]: tags });
	}
}
