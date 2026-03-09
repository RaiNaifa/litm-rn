import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { getAssignedUser, getAvailableFellowships, confirmDelete, confirmUnlink, localize as t } from "../../utils.js";

export class HeroSheet extends SheetMixin(foundry.appv1.sheets.ItemSheet) {
	/** @override */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["litm", "litm--hero"],
			template: "systems/litm-rn/templates/item/hero.html",
			width: 400,
			height: 450,
			resizable: false,
			scrollY: [".taglist"],
		});
	}
	#backside = false;
	#contextmenu = null;
	#tagsFocused = null;

	get system() {
		return this.item.system;
	}

	get actor() {
		return this.item.parent;
	}

	get isEmbedded() {
		return this.item.isEmbedded && this.actor instanceof Actor;
	}

	/** @override */
	async getData() {
		const data = {};
		if (this.isEmbedded) {
			const assignedUser = getAssignedUser(this.actor);
			data.fellowship = this.actor.system.fellowship;  // world-level Item или null
			data.availableFellowships = getAvailableFellowships(this.actor);
			data.hasAssignedUser = !!assignedUser;
		} else {
			data.fellowship = null;
			data.availableFellowships = [];
			data.hasAssignedUser = false;
		}
	
		return {
			hero: this.system,
			name: this.item.name,
			backside: this.#backside,
			promise: this.system.promise,
			fulfillment: this.system.fulfillment,
			tagsFocused: this.#tagsFocused,
			...data,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find("[data-click]").on("click", this.#onClick.bind(this));
		html.find("[data-dblclick").on("dblclick", this.#handleDblclick.bind(this));
		html.find("[data-context]").on("contextmenu", this.#onContext.bind(this));
		html
			.find("[data-mousedown]")
			.on("mousedown", this.#handleMouseDown.bind(this));
		html.find("[data-action='select-fellowship']")
			.on("change", this.#onSelectFellowship.bind(this));

		if (!this._fellowshipHookId && this.isEmbedded) {
			this._fellowshipHookId = Hooks.on("updateItem", (item, _changes) => {
				if (item.type !== "fellowship" || item.isEmbedded) return;
				if (item.id === this.actor.system.fellowshipId) {
					this.render();
				}
			});
		}

		this.#contextmenu = foundry.applications.ux.ContextMenu.implementation.create(
			this,
			html[0],
			"[data-context='unlink-fellowship']",
			[
				{
					name: game.i18n.localize("Litm.ui.unlink-fellowship"),
					icon: '<i class="fas fa-unlink"></i>',
					callback: () => {
						this.#unlinkFellowship();
					},
				},
			],
			{
				hookName: "LitmHeroContextMenu",
				fixed: true,
				jQuery: false,
			},
		);
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

	#handleDblclick(event) {
		const t = event.currentTarget;
		const action = t.dataset.dblclick;

		switch (action) {
			case "return":
				this.#tagsFocused = null;
				t.classList.remove("focused");
				t.style.cssText = this.#tagsFocused;
				break;
			case "open-item": {
				const id = t.dataset.id;
				const item = game.items.get(id);
				if (item) item.sheet.render(true);
				break;
			}
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

	#handleMouseDown(event) {
		const t = event.currentTarget;
		const action = t.dataset.mousedown;

		switch (action) {
			case "keep-open":
				this.#keepOpen(event);
				break;
		}
	}

	#keepOpen(event) {
		const t = event.currentTarget;

		t.classList.add("focused");
		const listener = () => {
			this.#tagsFocused = t.style.cssText;
			t.removeEventListener("mouseup", listener);
		};
		t.addEventListener("mouseup", listener);
	}

	#addTag() {
		const item = {
			name: t("Litm.tags.relationship"),
			fellowName: t("Litm.ui.fellow-name"),
			isScratched: false,
			type: "hero",
			id: foundry.utils.randomID(),
		};

		const contents = this.system.contents;
		contents.push(item);

		return this.item.update({ "system.contents": contents });
	}

	async #onSelectFellowship(event) {
		if (!this.isEmbedded) return;
		const selectedId = event.currentTarget.value || null;
		if (!selectedId) return;

		await this.actor.update({ "system.fellowshipId": selectedId });
		this.render();
	}

	async #unlinkFellowship() {
		if (!(await confirmUnlink(`TYPES.Item.fellowship`))) return;

		if (!this.isEmbedded) return;
		await this.actor.update({ "system.fellowshipId": null });
		this.render();
	}

	#toggleBackside() {
		this.#backside = !this.#backside;

		this.render(false);
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

	close(options) {
		if (this._fellowshipHookId) {
			Hooks.off("updateItem", this._fellowshipHookId);
			this._fellowshipHookId = null;
		}
		return super.close(options);
	}
}
