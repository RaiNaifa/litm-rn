import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete } from "../../utils.js";

export class ThemeSheet extends SheetMixin(foundry.appv1.sheets.ItemSheet) {
	static defaultOptions = foundry.utils.mergeObject(foundry.appv1.sheets.ItemSheet.defaultOptions, {
		classes: ["litm", "litm--theme"],
		width: 330,
		height: 700,
	});

	get system() {
		return this.item.system;
	}

	get template() {
		return "systems/litm/templates/item/theme.html";
	}

	getData() {
		const { data, ...rest } = super.getData();

		data.system.weakness = this.system.weakness;
		data.system.levels = this.system.levels;
		data.system.themebooks = this.system.themebooks;

		const fallbackSrc = ["origin", "adventure", "greatness"].includes(
			data.system.level,
		)
			? data.system.level
			: "origin";
		const themesrc =
			CONFIG.litm.theme_src[data.system.level] ||
			`systems/litm/assets/media/${fallbackSrc}`;
		const themeiconsrc =
			CONFIG.litm.themeicon_src[data.system.level] ||
			`systems/litm/assets/media/icons/${fallbackSrc}`;

		return { data, themesrc, themeiconsrc, ...rest };
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
		const fd = new FormDataExtended(this.form, {
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
		const id = t.dataset.id;
		switch (action) {
			case "add-tag":
				this.#addTag();
				break;
			case "remove-tag":
				this.#removeTag(id);
				break;
			case "increase":
				this.#increase(id);
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
		const t = event.currentTarget;
		const action = t.dataset.context;
		const id = t.dataset.id;
		switch (action) {
			case "decrease":
				this.#decrease(id);
				break;
		}
	}

	#handleCloseLevels = (event) => {
		const $dropdown = $(".litm--image-dropdown.open");
		const $icon = $dropdown.find(".selected-image i.fas");
		const dropdown = $dropdown[0];
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

	async #addTag() {
		throw new Error("Not implemented");
	}

	async #removeTag(_) {
		if (!(await confirmDelete("Litm.other.tag"))) return;
		throw new Error("Not implemented");
	}

	async #increase(field) {
		const attribute = foundry.utils.getProperty(this.item, field);
		await this.item.update({ [field]: attribute + 1 });
	}

	async #decrease(field) {
		const attribute = foundry.utils.getProperty(this.item, field);
		await this.item.update({ [field]: attribute - 1 });
	}
}
