import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { compareTagTypes, confirmDelete, dispatch, localize as t } from "../../utils.js";
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

		// Soft Migration
		data.effects = this.actor.effects
			.map(e => {
				let effect = e.toObject();
				let flags = effect.flags["litm-rn"] || {};
				if (flags.type) {
					return effect;
				}
				let type = flags.type || (flags.values?.length === 3 ? "might" : (flags.values?.some((v) => !!v) ? "status" : "tag"));

				flags.type = type;
				if (type === "tag") {
					delete flags.values;
					delete flags.value;
				}
				return effect;
			})
			.sort((a, b) => {
				const typeA = a.flags["litm-rn"]?.type;
				const typeB = b.flags["litm-rn"]?.type;
				return compareTagTypes({ type: typeA }, { type: typeB });
			});

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
			.find("li.litm--tag-item input.litm--tag-item-might-radio[type='radio']")
			.on("change", this.#onEffectMightChange.bind(this));
		html
			.find("li.litm--tag-item input.litm--hindering-checkbox[type='checkbox']")
			.on("change", this.#onEffectHinderingChange.bind(this));
		html
			.find("li.litm--tag-item input.litm--private-checkbox[type='checkbox']")
			.on("change", this.#onEffectPrivateChange.bind(this));

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
			case "add-tag":
				this.#addTag();
				break;
			case "add-status":
				this.#addStatus();
				break;
			case "add-might":
				this.#addMight();
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
		const reMS = CONFIG.litm.regexp.mightSctictStringRe;
		const reM = CONFIG.litm.regexp.mightStringRe;
		const re = CONFIG.litm.regexp.tagStringRe;
		const mightsScaled = formData["system.tags"].match(reMS) || [];
		const mights = formData["system.tags"].match(reM) || [];
		const tags = formData["system.tags"].match(re) || [];
		const marks = [...tags, ...mights, ...mightsScaled];

		formData["system.tags"] = marks.length > 0 ? marks.join(" ") : "";

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

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [{
			_id: id,
			"flags.litm-rn.values": values,
			"flags.litm-rn.value": value
		}]);

		await game.litm.storyTags.syncSelectedTagsFromActor(this.#storyRef);
		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #onEffectMightChange(event) {
		const li = $(event.currentTarget).closest("li[data-id]");
		const id = li.data("id");
		if (!id) return;

		const value = Number(event.currentTarget.value);

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [{
			_id: id,
			"flags.litm-rn.value": value,
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

	async #onEffectPrivateChange(event) {
		const li = $(event.currentTarget).closest("li[data-id]");
		const id = li.data("id");

		if (!id) return;

		const isPrivate = event.currentTarget.checked;

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [{
			_id: id,
			"flags.litm-rn.isPrivate": isPrivate,
		}]);

		await game.litm.storyTags.syncSelectedTagsFromActor(this.#storyRef);
		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #addTag() {
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-tag"),
				flags: {
					["litm-rn"]: {
						type: "tag",
						isScratched: false,
						isHindering: false,
						isPrivate: true,
					},
				},
			},
		]);

		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
	}

	async #addStatus() {
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-status"),
				flags: {
					["litm-rn"]: {
						type: "status",
						values: new Array(6).fill(false),
						value: 0,
						isScratched: false,
						isHindering: false,
						isPrivate: true,
					},
				},
			},
		]);

		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
	}

	async #addMight() {
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-might"),
				flags: {
					["litm-rn"]: {
						type: "might",
						values: [0, 3, 6],
						value: 3,
						isScratched: false,
						isHindering: false,
						isPrivate: true,
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
		if (!["tag", "status", "might"].includes(data.type)) return super._onDrop(dragEvent);

		const flagData = {
			type: data.type,
			isScratched: data.isScratched,
			isHindering: data.isHindering || false,
			isPrivate: data.isPrivate ?? true,
		};

		if (data.type === "tag") {
			flagData.isCrispy = data.isCrispy || false;
		}
		if (data.type === "status") {
			flagData.values = data.values;
		}
		if (data.type === "might") {
			flagData.values = data.values;
			flagData.value = data.value !== undefined ? data.value : 3;
		}

		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: data.name,
				flags: {
					["litm-rn"]: flagData,
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
