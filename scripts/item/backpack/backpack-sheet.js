import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, localize as t } from "../../utils.js";
const TextEditor = foundry.applications.ux.TextEditor.implementation;

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
			dragDrop: [{ dropSelector: null }],
		});
	}

	#backside = false;
	#storyUpdateHook = null;

	get system() {
		return this.item.system;
	}

	get isCharacterEmbedded() {
		return this.item.parent?.type === "character";
	}

	get stories() {
		if (!this.isCharacterEmbedded) return [];
		return this.item.parent.items
			.filter((i) => i.type === "story")
			.sort((a, b) => a.sort - b.sort);
	}

	/** @override */
	async getData() {
		const stories = await Promise.all(
			this.stories.map(async (s) => ({
				id: s.id,
				_id: s.id,
				name: s.name,
				img: s.img,
				system: {
					...s.system.toObject(),
					enrichedNote: await TextEditor.enrichHTML(s.system.note || ""),
				},
			}))
		);

		return {
			backpack: this.system.contents,
			specials: this.system.specials,
			backside: this.#backside,
			name: this.item.name,
			isCharacterEmbedded: this.isCharacterEmbedded,
			stories,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find("[data-click]").on("click", this.#onClick.bind(this));
		html.find("[data-context]").on("contextmenu", this.#onContext.bind(this));
		html.find("[data-dblclick]").on("dblclick", this.#onDblClick.bind(this));

		if (!this.#storyUpdateHook && this.isCharacterEmbedded) {
			const actorId = this.item.parent.id;
			this.#storyUpdateHook = Hooks.on("updateItem", (item, changes, options, userId) => {
				if (!item.isEmbedded) return;
				if (item.parent?.id !== actorId) return;
				if (item.type !== "story") return;
				if (this.rendered) this.render(false);
			});
		}
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

	async _onDrop(event) {
		if (!this.isCharacterEmbedded) return;

		let data;
		try {
			data = JSON.parse(event.dataTransfer.getData("text/plain"));
		} catch {
			return;
		}
		if (data.type !== "Item") return;

		const item = await Item.implementation.fromDropData(data);
		if (item.type !== "story") return;

		const actor = this.item.parent;
		if (actor.items.get(item.id)) return;

		const itemData = item.toObject();
		delete itemData._id;
		await actor.createEmbeddedDocuments("Item", [itemData]);
		this.render();
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
			case "add-story":
				this.#addStory();
				break;
			case "toggle-backside":
				this.#toggleBackside();
				break;
			case "toggle-collapse":
				event.preventDefault();
				event.stopPropagation();
				this.#toggleCollapse(button);
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
			case "remove-story":
				event.preventDefault();
				event.stopPropagation();
				this.#removeStory(button);
				break;
		}
	}

	#onDblClick(event) {
		const button = event.currentTarget;
		const action = button.dataset.dblclick;

		switch (action) {
			case "open-story":
				this.#openStorySheet(button);
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

	async #addStory() {
		const actor = this.item.parent;
		if (!actor) return;

		const [story] = await actor.createEmbeddedDocuments("Item", [
			{ name: t("Litm.other.story-theme"), type: "story" },
		]);
		story.sheet.render(true);
		this.render();
	}

	#toggleBackside() {
		this.#backside = !this.#backside;

		this.render(false); // with no save in DB
	}

	#toggleCollapse(button) {
    const targetId = button.dataset.target;
    const container = this.element.find(`[data-collapse-id="${targetId}"]`);
    const icon = $(button).find("i");

    container.slideToggle(150);
    icon.toggleClass("fa-angle-down fa-angle-right");
	}

	async #removeTag(button) {
		if (!(await confirmDelete("Litm.other.tag"))) return;
		const id = button.dataset.id;

		if (this.system.contents.some((t) => t.id === id)) {
			const contents = this.system.contents.filter((t) => t.id !== id);
			return this.item.update({ "system.contents": contents });
		}

		const actor = this.item.parent;
		if (!actor) return;
		for (const story of this.stories) {
			if (story.system.powerTags.some((t) => t.id === id)) {
				const powerTags = story.system.powerTags.filter((t) => t.id !== id);
				await story.update({ "system.powerTags": powerTags });
				this.render();
				return;
			}
			if (story.system.weaknessTags.some((t) => t.id === id)) {
				const weaknessTags = story.system.weaknessTags.filter((t) => t.id !== id);
				await story.update({ "system.weaknessTags": weaknessTags });
				this.render();
				return;
			}
		}
	}

	async #removeSpecial(button) {
		if (!(await confirmDelete("Litm.other.special"))) return;
		const id = button.dataset.id;
		const specials = this.system.specials.filter((t) => t.id !== id);

		return this.item.update({ "system.specials": specials });
	}

	async #removeStory(button) {
		if (!(await confirmDelete("TYPES.Item.story"))) return;
		const id = button.dataset.id;
		const actor = this.item.parent;
		if (!actor) return;

		const item = actor.items.get(id);
		if (item) {
			await item.delete();
			this.render();
		}
	}

	#openStorySheet(button) {
		const actor = this.item.parent;
		if (!actor) return;
		const item = actor.items.get(button.dataset.id);
		if (item) item.sheet.render(true);
	}

	async close(options) {
		if (this.#storyUpdateHook) {
			Hooks.off("updateItem", this.#storyUpdateHook);
			this.#storyUpdateHook = null;
		}
		return super.close(options);
	}
}
