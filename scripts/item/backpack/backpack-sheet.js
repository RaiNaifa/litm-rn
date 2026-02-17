import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, localize as t } from "../../utils.js";

export class BackpackSheet extends SheetMixin(foundry.appv1.sheets.ItemSheet) {
	/** @override */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["litm", "litm--backpack"],
			template: "systems/litm-rn/templates/item/backpack.html",
			width: 400,
			height: 450,
			resizable: false,
			scrollY: [".taglist"],
		});
	}

	get system() {
		return this.item.system;
	}

	/** @override */
	async getData() {
		return {
			backpack: this.system.contents,
			specials: this.system.specials,
			backside: this.system.backside,
			name: this.item.name,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find("[data-click]").on("click", this.#onClick.bind(this));
		html.find("[data-context]").on("contextmenu", this.#onContext.bind(this));
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

	#onClick(event) {
		const button = event.currentTarget;
		const action = button.dataset.click;

		switch (action) {
			case "add-tag":
				this.#addTag();
				break;
			case "add-special":
				this.#addSpecial();
				break;
			case "toggle-backside":
				this.#toggleBackside();
				break;
		}
	}

	#onContext(event) {
		const button = event.currentTarget;
		const action = button.dataset.context;

		switch (action) {
			case "remove-tag":
				this.#removeTag(button);
				break;
			case "remove-special":
				this.#removeSpecial(button);
				break;
		}
	}

	#addTag() {
		const item = {
			name: t("Litm.ui.name-tag"),
			isScratched: false,
			type: "backpack",
			id: foundry.utils.randomID(),
		};

		const contents = this.system.contents;
		contents.push(item);

		return this.item.update({ "system.contents": contents });
	}

	#addSpecial() {
		const item = {
			name: t("Litm.ui.name-special"),
			description: t("Litm.ui.name-special-description"),
			isActive: true,
			id: foundry.utils.randomID(),
		};

		const specials = this.system.specials;
		specials.push(item);

		return this.item.update({ "system.specials": specials });
	}

	#toggleBackside() {
		const backside = !this.system.backside;

		return this.item.update({ "system.backside": backside });
	}

	async #removeTag(button) {
		if (!(await confirmDelete("Litm.other.tag"))) return;
		const id = button.dataset.id;
		const contents = this.system.contents.filter((t) => t.id !== id);

		return this.item.update({ "system.contents": contents });
	}

	async #removeSpecial(button) {
		if (!(await confirmDelete("Litm.other.special"))) return;
		const id = button.dataset.id;
		const specials = this.system.specials.filter((t) => t.id !== id);

		return this.item.update({ "system.specials": specials });
	}
}
