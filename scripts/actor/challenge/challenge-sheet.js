import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, dispatch, localize as t } from "../../utils.js";
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class ChallengeSheet extends SheetMixin(foundry.appv1.sheets.ActorSheet) {
	static defaultOptions = foundry.utils.mergeObject(foundry.appv1.sheets.ActorSheet.defaultOptions, {
		classes: ["litm", "litm--challenge"],
		width: 320,
		height: 700,
		resizable: false,
		scrollY: [".litm--challenge-wrapper"],
	});

	get template() {
		return "systems/litm-rn/templates/actor/challenge.html";
	}

	get system() {
		return this.actor.system;
	}

	get items() {
		return this.actor.items;
	}

	get #storyRef() {
		return (this.actor.isToken && !this.token?.actorLink)
			? this.token.uuid
			: this.actor.id;
	}

	async getData() {
		const { data, rest } = super.getData();

		const userId = game.user.id;
		const ownership = this.actor.ownership ?? this.actor.data.permission ?? {};
		const permissionLevel = ownership[userId] ?? ownership.default ?? 0;
		data.permissionLevel = permissionLevel;

		data.system.challenges = this.system.challenges;
		data.system.special = await TextEditor.enrichHTML(data.system.special);
		data.system.note = await TextEditor.enrichHTML(data.system.note);
		data.system.renderedTags = await TextEditor.enrichHTML(data.system.tags);
		data.items = await Promise.all(this.items.map((i) => i.sheet.getData()));

		return { data, ...rest, isEditing: this.isEditing };
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find("[data-click]").on("click", this.#handleClick.bind(this));
		html
			.find("[data-dblclick]")
			.on("dblclick", this.#handleDblClick.bind(this));
		html
			.find("[data-context]")
			.on("contextmenu", this.#handleContext.bind(this));
		html
			.find("li.litm--tag-item input[type='text']")
			.on("change", this.#onEffectNameChange.bind(this));
		html
			.find("li.litm--tag-item input.litm--tag-item-tier[type='checkbox']")
			.on("change", this.#onEffectValueChange.bind(this));
		html
			.find("li.litm--tag-item input.litm--hindering-checkbox[type='checkbox']")
			.on("change", this.#onEffectHinderingChange.bind(this));

		if (this.isEditing) html.find("[contenteditable]:has(+#tags)").focus();
	}

	async _updateObject(event, formData) {
		const sanitizedFormData = this.#sanitizeTags(formData);

		return super._updateObject(event, sanitizedFormData);
	}

	// Prevent dropping non-threat items
	async _onDropItem(event, data) {
		const item = await Item.implementation.fromDropData(data);
		if (item.type !== "threat") return;

		if (this.items.get(item.id)) return this._onSortItem(event, item);

		return super._onDropItem(event, data);
	}

	#handleClick(event) {
		event.preventDefault();

		const button = event.currentTarget;
		const action = button.dataset.click;

		switch (action) {
			case "add-limit":
				this.#addLimit();
				break;
			case "add-threat":
				this.#addThreat();
				break;
			case "add-effect":
				this.#addEffect();
				break;
			case "move-to-story":
				this.#moveToStory();
				break;
			case "increase":
				this.#increase(button);
				break;
		}
	}

	#handleDblClick(event) {
		event.preventDefault();

		const button = event.currentTarget;
		const action = button.dataset.dblclick;

		switch (action) {
			case "edit-item":
				this.#openItemSheet(button);
				break;
		}
	}

	#handleContext(event) {
		event.preventDefault();

		const button = event.currentTarget;
		const action = button.dataset.context;

		switch (action) {
			case "remove-limit":
				this.#removeLimit(button);
				break;
			case "remove-threat":
				this.#removeThreat(button);
				break;
			case "decrease":
				this.#decrease(button);
				break;
			case "remove-effect":
				event.preventDefault();
				event.stopPropagation();
				this.#removeEffect(button.dataset.id);
				break;
		}
	}

	#addLimit() {
		const limits = this.system.limits;
		const limit = {
			name: t("Litm.ui.new-limit"),
			value: 0,
		};

		limits.push(limit);
		this.actor.update({ "system.limits": limits });
	}

	async #addThreat() {
		const threats = await this.actor.createEmbeddedDocuments("Item", [
			{ name: t("Litm.ui.new-threat"), type: "threat" },
		]);
		threats[0].sheet.render(true);
	}

	async #removeLimit(button) {
		if (!(await confirmDelete("Litm.other.limit"))) return;
		const index = Number(button.dataset.id);
		const limits = this.system.limits;

		limits.splice(index, 1);
		this.actor.update({ "system.limits": limits });
	}

	async #removeThreat(button) {
		if (!(await confirmDelete("TYPES.Item.threat"))) return;
		const item = this.items.get(button.dataset.id);
		item.delete();
	}

	async #removeEffect(id) {
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		if (!(await confirmDelete())) return;

		const config = game.settings.get("litm-rn", "storytags");
		if (config?.selectedTags?.some(t => t.id === id)) {
			const selectedTags = config.selectedTags.filter(t => t.id !== id);

			if (game.user.isGM) {
				await game.settings.set("litm-rn", "storytags", { ...config, selectedTags });
			} else {
				dispatch({ 
					app: "story-tags", 
					type: "update", 
					component: "selectedTags", 
					data: selectedTags 
				});
			}
		}

		await effect.delete();

		game.litm.storyTags.render();
		dispatch({
			app: "story-tags",
			type: "render",
		});
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #increase(target) {
		const attrib = target.dataset.name;
		const value = foundry.utils.getProperty(this.actor, attrib);

		return this.actor.update({ [attrib]: Math.min(value + 1, 5) });
	}

	async #decrease(target) {
		const attrib = target.dataset.name;
		const value = foundry.utils.getProperty(this.actor, attrib);

		return this.actor.update({ [attrib]: Math.max(value - 1, 1) });
	}

	#openItemSheet(button) {
		const item = this.items.get(button.dataset.id);
		item.sheet.render(true);
	}

	#sanitizeTags(formData) {
		if (!formData["system.tags"]) return formData;
		const re = CONFIG.litm.tagStringRe;
		const tags = formData["system.tags"].match(re);
		formData["system.tags"] = tags ? tags.join(" ") : "";

		return formData;
	}

	async #onEffectNameChange(event) {
		const li = $(event.currentTarget).closest("li[data-id]");
		const id = li.data("id");
		if (!id) return;

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, name: event.currentTarget.value },
		]);

		await game.litm.storyTags.syncSelectedTagsFromActor(this.#storyRef);
		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #onEffectValueChange(event) {
		const li = $(event.currentTarget).closest("li[data-id]");
		const id = li.data("id");

		if (!id) return;

		const checkboxes = li.find("input.litm--tag-item-tier[type='checkbox']");
		
		const values = checkboxes.map((i, cb) => cb.checked ? i + 1 : false).get();
		const value = values.findLast((v) => !!v);
		const type = values.some((v) => !!v) ? "status" : "tag";

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [{
			_id: id,
			"flags.litm-rn.values": values,
			"flags.litm-rn.type": type,
			"flags.litm-rn.value": value
		}]);

		await game.litm.storyTags.syncSelectedTagsFromActor(this.#storyRef);
		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #onEffectHinderingChange(event) {
		const li = $(event.currentTarget).closest("li[data-id]");
		const id = li.data("id");

		if (!id) return;

		const isHindering = event.currentTarget.checked;

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [{
			_id: id,
			"flags.litm-rn.isHindering": isHindering,
		}]);

		await game.litm.storyTags.syncSelectedTagsFromActor(this.#storyRef);
		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #addEffect() {
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-tag"),
				flags: {
					["litm-rn"]: {
						type: "tag",
						values: new Array(6).fill(false),
						isScratched: false,
						isHindering: false,
					},
				},
			},
		]);

		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
	}

	async #moveToStory() {
		const storyTags = game.litm.storyTags;
		const ref = this.#storyRef;

		if (storyTags.config.actors.includes(ref)) {
			return ui.notifications.warn("Litm.ui.warn-actor-exists", { localize: true });
		}

		await storyTags.setActors([...storyTags.config.actors, ref]);
	}

	async _onDrop(dragEvent) {
		const dragData = dragEvent.dataTransfer.getData("text/plain");
		const data = JSON.parse(dragData);

		// Handle dropping tags and statuses
		if (!["tag", "status"].includes(data.type)) return super._onDrop(dragEvent);

		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: data.name,
				flags: {
					["litm-rn"]: {
						type: data.type,
						values: data.values,
						isScratched: data.isScratched,
						isHindering: data.isHindering || false,
					},
				},
			},
		]);

		game.litm.storyTags.render();
		dispatch({
			app: "story-tags",
			type: "render",
		});
	}
}
