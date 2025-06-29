import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, localize as t } from "../../utils.js";

export class HeroSheet extends SheetMixin(foundry.appv1.sheets.ItemSheet) {
	/** @override */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["litm", "litm--hero"],
			template: "systems/litm/templates/item/hero.html",
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
			hero: this.system,
			name: this.item.name,
			backside: this.system.backside,
			promise: this.system.promise,
			fulfillment: this.system.fulfillment,
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

	#onClick(event) {
		const button = event.currentTarget;
		const action = button.dataset.click;
		const id = button.dataset.id;

		switch (action) {
			case "add-tag":
				this.#addTag();
				break;
			case "toggle-backside":
				this.#toggleBackside();
				break;
			case "increase":
				this.#increase(id);
				break;
		}
	}

	#onContext(event) {
		const button = event.currentTarget;
		const action = button.dataset.context;
		const id = button.dataset.id;

		switch (action) {
			case "remove-tag":
				this.#removeTag(button);
				break;
			case "decrease":
				this.#decrease(id);
				break;
		}
	}

	#addTag() {
		const item = {
			name: t("Litm.tags.relationship"),
			fellowName: t("Litm.ui.fellow-name"),
			isActive: false,
			type: "hero",
			id: foundry.utils.randomID(),
		};

		const contents = this.system.contents;
		contents.push(item);

		return this.item.update({ "system.contents": contents });
	}

	#toggleBackside() {
		const backside = !this.system.backside;

		return this.item.update({ "system.backside": backside });
	}

	async #removeTag(button) {
		if (!(await confirmDelete("Litm.tags.relationship"))) return;

		const id = button.dataset.id;
		const contents = this.system.contents.filter((t) => t.id !== id);

		return this.item.update({ "system.contents": contents });
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
