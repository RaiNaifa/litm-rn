import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, dispatch, getAssignedUser, getAvailableFellowships } from "../../utils.js";
import { localize as t } from "../../utils.js";
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class CharacterSheet extends SheetMixin(foundry.appv1.sheets.ActorSheet) {
	static defaultOptions = foundry.utils.mergeObject(foundry.appv1.sheets.ActorSheet.defaultOptions, {
		classes: ["litm", "litm--character"],
		width: 250,
		height: 350,
		left: window.innerWidth / 2 - 250,
		top: window.innerHeight / 2 - 350,
		scrollY: [".taglist", ".editor", ".litm--theme-front", ".litm--theme-back"],
		resizable: false,
		dragDrop: [{ dragSelector: null, dropSelector: "form" }],
	});

	#dragAvatarTimeout = null;
	#notesEditorStyle = "display: none;";
	#tagsFocused = null;
	#tagsHovered = false;
	#themeHovered = null;
	#backpackHovered = null;
	#backsideStates = new Map();
	#heroHovered = null;
	#contextmenu = null;
	#isLocked = true;
	#roll = game.litm.LitmRollDialog.create({
		actorId: this.actor._id,
		characterTags: [],
		shouldRoll: () => game.settings.get("litm-rn", "skip_roll_moderation"),
	});
	#fellowshipUpdateHook = null;
	#storyTagsHookId = null;
	#expandedStories = new Set();

	get template() {
		return "systems/litm-rn/templates/actor/character.html";
	}

	get items() {
		return this.actor.items;
	}

	get system() {
		return this.actor.system;
	}

	get storyTags() {
		const mapEffect = (t) => {
			const tag = { ...t };
			let type = tag.type || (tag.values?.some((v) => !!v) ? "status" : "tag");
			tag.type = type;
			if (type === "tag"){
				delete tag.values;
				delete tag.value;
			}
			return tag;
		};
	
		return [
			...this.system.storyTags.map(mapEffect),
			...this.system.statuses.map(mapEffect)
		];
	}

	get config() {
		const config = game.settings.get("litm-rn", "storytags");
		if (!config || foundry.utils.isEmpty(config))
			return { actors: [], tags: [], selectedTags: [], helpingTags: [] };
		return { helpingTags: [], ...config };
	}

	updateRollDialog(data) {
		this.#roll.receiveUpdate(data);
	}

	renderRollDialog({ toggle } = { toggle: false }) {
		if (toggle && this.#roll.rendered) this.#roll.close();
		else this.#roll.render(true);
	}

	resetRollDialog() {
		if (this.#roll.rendered) this.#roll.close();
		this.#roll.reset();
		this.render();
	}

	async toggleScratchTag(tag) {
		switch (tag.type) {
			case "hero": {
				const hero = this.items.find((i) => i.type === "hero");
				const { contents } = hero.system.toObject();

				contents.find((i) => i.id === tag.id).isActive = !tag.isActive;
				await this.actor.updateEmbeddedDocuments("Item", [
					{
						_id: hero.id,
						"system.contents": contents,
					},
				]);
				break;
			}
			case "powerCrispy": {
				const parentTheme = this.system.fellowship;
				if (!parentTheme) return;
				const { powerTags } = parentTheme.system.toObject();
				powerTags.find((t) => t.id === tag.id).isScratched = !tag.isScratched;

				await parentTheme.update({ "system.powerTags": powerTags });
				break;
			}
			case "powerTag": {
				const parentItem = this.items.find(
					(i) =>
						(i.type === "theme" || i.type === "story") &&
						i.system.powerTags.some((t) => t.id === tag.id),
				);
				const { powerTags } = parentItem.system.toObject();
				powerTags.find((t) => t.id === tag.id).isScratched = !tag.isScratched;
				await this.actor.updateEmbeddedDocuments("Item", [
					{
						_id: parentItem.id,
						"system.powerTags": powerTags,
					},
				]);
				break;
			}
			case "themeCrispy":
				const parentTheme = this.system.fellowship;
				if (!parentTheme) return;

				await parentTheme.update({ "system.themeTag.isScratched": !tag.isScratched });
				break;
			case "themeTag": {
				const parentItem = this.items.find(
					(i) =>
						(i.type === "theme" || i.type === "story") &&
						i.system.themeTag.id === tag.id,
				);
				await this.actor.updateEmbeddedDocuments("Item", [
					{
						_id: parentItem.id,
						"system.themeTag.isScratched": !tag.isScratched,
					},
				]);
				this.render(); 
				break;
			}
			case "backpack": {
				const backpack = this.items.find((i) => i.type === "backpack");
				const { contents } = backpack.system.toObject();
				contents.find((i) => i.id === tag.id).isScratched = !tag.isScratched;
				await this.actor.updateEmbeddedDocuments("Item", [
					{
						_id: backpack.id,
						"system.contents": contents,
					},
				]);
				break;
			}
		}
	}

	async gainImprove(tag) {
		let parentTheme = this.items.find(
			(i) =>
				i.type === "theme" &&
				i.system.weaknessTags.some((t) => t.id === tag.id),
		);
		if (parentTheme) {
			await this.actor.updateEmbeddedDocuments("Item", [
				{
					_id: parentTheme.id,
					"system.improve": parentTheme.system.improve + 1,
				},
			]);
		} else {
			const parentTheme = this.system.fellowship;
			if (!parentTheme) return;

			await parentTheme.update({ "system.improve": parentTheme.system.improve + 1 });
		}
	}

	async getData() {
		const assignedUser = getAssignedUser(this.actor);
		const availableFellowships = getAvailableFellowships(this.actor);

		let fellowship = null;
		const fellowshipItem = this.system.fellowship;

		if (fellowshipItem) {
			const fData = await fellowshipItem.sheet.getData();

			fData.data.system.specials = await Promise.all(
				fellowshipItem.system.specials.map(async (special) => ({
					...special,
					enrichedDescription: await TextEditor.enrichHTML(special.description),
				}))
			);
			fData.data.system.backside = this.#getBackside(fellowshipItem.id);

			fellowship = fData;
		}

		const themes = await Promise.all(
			this.items
				.filter((i) => i.type === "theme")
				.sort((a, b) => a.sort - b.sort)
				.map(async (i) => {
					const data = await i.sheet.getData();
					data.data.system.specials = data.data.system.specials
					data.data.system.backside = this.#getBackside(i.id);
					return data;
				}),
		);
		const note = await TextEditor.enrichHTML(this.system.note);
		const backpackItem = this.items.find((i) => i.type === "backpack");
		const enrichedBackpackSpecials = backpackItem ? await Promise.all(
				(this.system.backpack.specials || []).map(async (special) => ({
					...special,
					enrichedDescription: await TextEditor.enrichHTML(special.description),
				}))
			) : [];
		const stories = await Promise.all(
			this.items
				.filter((i) => i.type === "story")
				.sort((a, b) => a.sort - b.sort)
				.map(async (s) => {
					const data = await s.sheet.getData();
					data.collapsed = !this.#expandedStories.has(s.id);
					return data;
				}),
		);
		const backpack = {
			name: backpackItem?.name,
			id: backpackItem?._id,
			backside: this.#getBackside(backpackItem?._id),
			contents: this.system.backpack?.contents ?? [],
			specials: enrichedBackpackSpecials,
			stories,
		};
		const heroItem = this.items.find((i) => i.type === "hero");
		const hero = {
			name: heroItem?.name,
			id: heroItem?._id,
			backside: this.#getBackside(heroItem?.id),
			fulfillment: this.system.hero?.fulfillment,
			promise: this.system.hero?.promise,
			contents: this.system.hero?.contents,
		};
		return {
			...this.object.system,
			isLocked: this.#isLocked,
			backpack,
			hero,
			note,
			themes,
			_id: this.actor.id,
			fellowship,
			availableFellowships,
			hasAssignedUser: !!assignedUser,
			scratchedTags: this.#roll.characterTags.filter(
				(t) => t.isScratched || t.state === "scratched",
			),
			burntTags: this.#roll.characterTags.filter(
				(t) => t.state === "burned",
			),
			helpingTags: game.settings.get("litm-rn", "storytags")?.helpingTags || [],
			img: this.actor.img,
			name: this.actor.name,
			notesEditorStyle: this.#notesEditorStyle,
			rollTags: this.#roll.characterTags,
			storyTags: this.storyTags,
			tagsFocused: this.#tagsFocused,
			tagsHovered: this.#tagsHovered,
			themeHovered: this.#themeHovered,
			backpackHovered: this.#backpackHovered,
			heroHovered: this.#heroHovered,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find("[data-click]").on("click", this.#handleClicks.bind(this));
		html.find("[data-dblclick").on("dblclick", this.#handleDblclick.bind(this));
		html
			.find("[data-context]")
			.on("contextmenu", this.#handleContextmenu.bind(this));
		html
			.find("[data-mousedown]")
			.on("mousedown", this.#handleMouseDown.bind(this));
		html
			.find("[data-drag]")
			.on("mousedown", this.#onDragHandleMouseDown.bind(this));
		html.on("mouseover", this.#handleMouseOver.bind(this));
		html.find("[data-action='select-fellowship']")
			.on("change", this.#onSelectFellowship.bind(this));
		html.find("[data-click='unlink-fellowship']")
			.on("click", this.#onUnlinkFellowship.bind(this));
		html.find("li.litm--story-tag input[type='checkbox']")
			.on("change", this.#onEffectValueChange.bind(this));

		const contenteditable = html.find(".litm--story-label-name[contenteditable='true']");
		contenteditable.on("keydown", this.#onContenteditableKeyDown.bind(this));
		contenteditable.on("blur", this.#onContenteditableBlur.bind(this));
		contenteditable.on("paste", this.#onContenteditablePaste.bind(this));

		this.#contextmenu = foundry.applications.ux.ContextMenu.implementation.create(
			this,
			html[0],
			"[data-context='menu']",
			[
				{
					name: game.i18n.localize("Litm.ui.edit"),
					icon: '<i class="fas fa-edit"></i>',
					callback: (targetElement) => {
						const id = targetElement.parentElement.dataset.id;
						const item = this.actor.items.get(id);
						item.sheet.render(true);
					},
				},
				{
					name: game.i18n.localize("Litm.ui.remove"),
					icon: "<i class='fas fa-trash'></i>",
					condition: () => !this.#isLocked,
					callback: (targetElement) => {
						const id = targetElement.parentElement.dataset.id;
						this.#removeItem(id);
					},
				},
			],
			{
				hookName: "LitmItemContextMenu",
				fixed: true,
				jQuery: false,
			},
		);

		if (!this.#fellowshipUpdateHook) {
			this.#fellowshipUpdateHook = Hooks.on("updateItem", (item, changes, options, userId) => {
				if (item.type !== "fellowship" || item.isEmbedded) return;
				if (item.id !== this.system.fellowshipId) return;

				this.render();
			});
		}

		if (!this.#storyTagsHookId) {
			this.#storyTagsHookId = Hooks.on("litmStoryTagsUpdated", () => {
				if (this.rendered) this.render();
			});
		}

	}

	// Hack to allow updating the embedded items
	async _updateObject(event, formData) {
		delete formData.effects;
		for (const key of Object.keys(formData)) {
			if (key.startsWith("effects.")) {
				delete formData[key];
			}
		}
		return super._updateObject(event, formData);
	}

	async _onDrop(dragEvent) {
		const dragData = dragEvent.dataTransfer.getData("text/plain");
		const data = JSON.parse(dragData);

		// Handle dropping tags and statuses
		if (!["tag", "status"].includes(data.type)) return super._onDrop(dragEvent);

		// Check if dropped on a story-theme inside backpack
		const storyElement = dragEvent.target.closest(".litm--story-item");
		const backpackElement = dragEvent.target.closest(".litm--character-backpack");

		if (storyElement && backpackElement && data.type === "tag") {
			const storyId = storyElement.dataset.id;
			if (!storyId) return;

			const storyItem = this.items.get(storyId);
			if (!storyItem || storyItem.type !== "story") return;

			const powerTags = storyItem.system.powerTags.slice();
			powerTags.push({
				id: foundry.utils.randomID(),
				name: data.name,
				type: "powerTag",
				isScratched: false,
			});
			await storyItem.update({ "system.powerTags": powerTags });
			return;
		}

		if (backpackElement && data.type === "tag") {
			// Dropped on backpack but not on a story-theme — add to backpack contents
			const backpack = this.items.find((i) => i.type === "backpack");
			if (!backpack) return;

			const contents = backpack.system.contents.slice();
			contents.push({
				id: foundry.utils.randomID(),
				name: data.name,
				type: "backpack",
				isScratched: false,
			});
			await backpack.update({ "system.contents": contents });
			return;
		}

		// Default behavior — add as ActiveEffect on the actor
		const flagData = {
			type: data.type,
			isScratched: data.isScratched,
			isPrivate: data.isPrivate ?? true,
		};
		if (data.type === "status") {
			flagData.values = data.values;
			flagData.value = data.value || 0;
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

	// Prevent dropping more than 4 themes on the character sheet
	async _onDropItem(event, data) {
		// TODO: сделать проходку по всем внутренним id чтобы не дублировать
		const item = await Item.implementation.fromDropData(data);
		if (!["backpack", "theme", "hero", "fellowship", "story"].includes(item.type)) return;

		if (this.items.get(item.id)) return this._onSortItem(event, item);

		if (item.type === "story") {
			const backpack = this.items.find((i) => i.type === "backpack");
			if (!backpack) {
				return ui.notifications.warn(
					game.i18n.localize("Litm.ui.error-no-backpack"),
				);
			}
		}

		const numThemes = this.items.filter((i) => i.type === "theme").length;
		if (item.type === "theme" && numThemes >= 4)
			return ui.notifications.warn(
				game.i18n.localize("Litm.ui.warn-theme-limit"),
			);

		const numBackpacks = this.items.filter((i) => i.type === "backpack").length;
		if (item.type === "backpack" && numBackpacks >= 1)
			return this.#handleLootDrop(item);

		const numHeroes = this.items.filter((i) => i.type === "hero").length;
		if (item.type === "hero" && numHeroes >= 1)
			return ui.notifications.warn(
				game.i18n.localize("Litm.ui.warn-theme-limit"),
			);

		if (item.type === "fellowship") {
			return ui.notifications.warn(
				game.i18n.localize("Litm.ui.warn-fellowship-drop")
			);
		}

		const itemData = item.toObject();
		delete itemData._id;
		this.#regenerateInternalIds(itemData);

		return this.actor.createEmbeddedDocuments("Item", [itemData]);
		// return super._onDropItem(event, data);
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

	_onEditImage(event) {
		if (this.#dragAvatarTimeout) return clearTimeout(this.#dragAvatarTimeout);
		return super._onEditImage(event);
	}

	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();

		buttons.unshift({
			class: "litm--lock-btn",
			icon: `fas ${this.#isLocked ? "fa-lock" : "fa-lock-open"}`,
			tooltip: t("Litm.ui.lock-actor"),
			onclick: (event) => {
				event.preventDefault();

				this.#isLocked = !this.#isLocked;

				const icon = event.currentTarget.querySelector("i");
				icon.classList.toggle("fa-lock");
				icon.classList.toggle("fa-lock-open");

				this.render(false); // with no save in DB
			}
		});

		return buttons;
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

	#handleMouseOver(event) {
		const html = $(event.currentTarget);

		html.find(".litm--character-theme").removeClass("hovered");
		html.find(".litm--character-backpack").removeClass("hovered");
		html.find(".litm--character-hero").removeClass("hovered");
		html.find(".litm--character-story-tags").removeClass("hovered");

		const t = event.target.classList.contains("litm--character-theme")
			? event.target
			: event.target.closest(".litm--character-theme");

		const b = event.target.classList.contains("litm--character-backpack")
			? event.target
			: event.target.closest(".litm--character-backpack");

		const h = event.target.classList.contains("litm--character-hero")
			? event.target
			: event.target.closest(".litm--character-hero");

		if (t) this.#themeHovered = t.dataset.id;
		else this.#themeHovered = null;

		if (b) this.#backpackHovered = b.dataset.id;
		else this.#backpackHovered = null;

		if (h) this.#heroHovered = h.dataset.id;
		else this.#heroHovered = null;

		if (event.target.closest(".litm--character-story-tags"))
			this.#tagsHovered = true;
		else this.#tagsHovered = false;
	}

	#handleClicks(event) {
		const t = event.currentTarget;
		const action = t.dataset.click;
		const id = t.dataset.id;

		switch (action) {
			case "add-tag":
				this.#addTag();
				break;
			case "add-status":
				this.#addStatus();
				break;
			case "add-story":
				this.#addStory();
				break;
			case "increase":
				this.#increase(event);
				break;
			case "open":
				this.#open(id);
				break;
			case "open-item":
				this.#openItem(id);
				break;
			case "close":
				this.#close(id);
				break;
			case "select":
				this.#select(event);
				break;
			case "toggle-backside":
				this.#toggleBackside(id);
				break;
			case "toggle-collapse":
				this.#toggleCollapse(t);
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
			case "open-story":
				this.#openStorySheet(t);
				break;
		}
	}

	#handleContextmenu(event) {
		const t = event.currentTarget;
		const action = t.dataset.context;

		switch (action) {
			case "decrease":
				event.preventDefault();
				event.stopPropagation();
				this.#decrease(event);
				break;
			case "remove-effect":
				event.preventDefault();
				event.stopPropagation();
				this.#removeEffect(t.dataset.id);
				break;
			case "remove-story":
				event.preventDefault();
				event.stopPropagation();
				this.#removeStory(t.dataset.id);
				break;
		}
	}

	#onDragHandleMouseDown(event) {
		this.#dragAvatarTimeout = null;

		const t = event.currentTarget;
		const target = t.dataset.drag;
		const parent = $(t).parents(target).first();

		const x = event.clientX - parent.position().left;
		const y = event.clientY - parent.position().top;

		const handleDrag = (event) => {
			if (target === ".window-app") this.#dragAvatarTimeout = true;

			parent.css({
				left: event.clientX - x,
				top: event.clientY - y,
			});
		};

		const handleMouseUp = () => {
			if (this.#dragAvatarTimeout) {
				this.setPosition({
					left: parent.position().left,
					top: parent.position().top,
				});
				this.#dragAvatarTimeout = setTimeout(() => {
					this.#dragAvatarTimeout = null;
				}, 100);
			}

			if (target === "#note") this.#notesEditorStyle = parent.attr("style");

			$(document).off("mousemove", handleDrag);
			$(document).off("mouseup", handleMouseUp);
		};

		$(document).on("mousemove", handleDrag);
		$(document).on("mouseup", handleMouseUp);
	}

	#regenerateInternalIds(data) {
		const regen = (arr) => {
			if (!Array.isArray(arr)) return;
			for (const item of arr) {
				if (item.id) item.id = foundry.utils.randomID();
			}
		};

		switch (data.type) {
			case "theme":
				if (data.system.themeTag?.id) {
					data.system.themeTag.id = foundry.utils.randomID();
				}
				regen(data.system.powerTags);
				regen(data.system.weaknessTags);
				regen(data.system.specials);
				break;
			case "story":
				if (data.system.themeTag?.id) {
					data.system.themeTag.id = foundry.utils.randomID();
				}
				regen(data.system.powerTags);
				regen(data.system.weaknessTags);
				break;
			case "backpack":
				regen(data.system.contents);
				regen(data.system.specials);
				break;
			case "hero":
				regen(data.system.contents);
				break;
		}
	}

	async #onSelectFellowship(event) {
		const selectedId = event.currentTarget.value || null;
		await this.actor.update({ "system.fellowshipId": selectedId });
	}

	async #onUnlinkFellowship(event) {
		event.preventDefault();
		await this.actor.update({ "system.fellowshipId": null });
	}

	async #onEffectValueChange(event) {
		const li = $(event.currentTarget).closest("li[data-id]");
		const id = li.data("id");
		if (!id) return;

		const checkboxes = li.find("input[type='checkbox']");
		const values = checkboxes.map((i, cb) => cb.checked ? i + 1 : false).get();

		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, "flags.litm-rn.values": values, "flags.litm-rn.type": "status" },
		]);

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();

		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });
	}

	#onContenteditableKeyDown(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.blur();
		}
	}

	async #onContenteditableBlur(event) {
		const el = event.currentTarget;
		const originalName = el.dataset.originalName;
		if (!originalName) return;

		const newValue = el.textContent.trim();
		const hiddenInput = this.element.find(`input[name="${originalName}"]`)[0];

		if (hiddenInput && hiddenInput.value !== newValue) {
			hiddenInput.value = newValue;

			const li = $(el).closest("li.litm--story-tag[data-id]");
			if (li.length > 0) {
				const id = li.data("id");
				if (!id) return;

				await this.actor.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: id, name: newValue },
				]);

				this.#roll.refreshTags();
				if (this.#roll.rendered) this.#roll.render();

				game.litm.storyTags.render();
				dispatch({ app: "story-tags", type: "render" });
					
			} else {
				this.submit();
			}
		}
	}
	
	#onContenteditablePaste(event) {
		event.preventDefault();
		const text = (event.originalEvent.clipboardData || window.clipboardData)
			.getData("text/plain")
			.replace(/\n/g, " ");
		document.execCommand("insertText", false, text);
	}

	async #addTag() {
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-tag"),
				flags: {
					["litm-rn"]: {
						type: "tag",
						isScratched: false,
						isPrivate: false,
						isCrispy: false,
					},
				},
			},
		]);

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();

		game.litm.storyTags.render();
		dispatch({
			app: "story-tags",
			type: "render",
		});
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
						isPrivate: false,
					},
				},
			},
		]);

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();

		game.litm.storyTags.render();
		dispatch({
			app: "story-tags",
			type: "render",
		});
	}

	async #addStory() {
		const [story] = await this.actor.createEmbeddedDocuments("Item", [
			{ name: t("Litm.other.story-theme"), type: "story" },
		]);
		story.sheet.render(true);
	}

	async #removeItem(id) {
		const item = this.items.get(id);
		if (!(await confirmDelete(`TYPES.Item.${item.type}`))) return;

		return item.delete();
	}

	async #removeEffect(id) {
		const effect = this.actor.effects.get(id);
		if (!(await confirmDelete())) return;

		await effect.delete();

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();

		game.litm.storyTags.render();
		dispatch({
			app: "story-tags",
			type: "render",
		});
	}

	async #removeStory(id) {
		if (!(await confirmDelete("TYPES.Item.story"))) return;
		const item = this.items.get(id);
		if (item) await item.delete();
	}

	async #increase(event) {
		const t = event.currentTarget;
		const attrib = t.dataset.id;
		const id = t.dataset.itemId || $(t).parents(".item").data("id");

		let item = this.actor.items.get(id);
		if (!item) {
			const fellowship = this.system.fellowship;
			if (fellowship?.id === id) item = fellowship;
		}
		if (!item) return;

		const value = foundry.utils.getProperty(item, attrib);
		const maxValue = item.type === "hero" ? 5 : 3;

		return item.update({ [attrib]: Math.min(value + 1, maxValue) });
	}

	async #decrease(event) {
		const t = event.currentTarget;
		const attrib = t.dataset.id;
		const id = t.dataset.itemId || $(t).parents(".item").data("id");

		let item = this.actor.items.get(id);
		if (!item) {
			const fellowship = this.system.fellowship;
			if (fellowship?.id === id) item = fellowship;
		}
		if (!item) return;

		const value = foundry.utils.getProperty(item, attrib);

		return item.update({ [attrib]: Math.max(value - 1, 0) });
	}

	#openStorySheet(button) {
		const item = this.items.get(button.dataset.id);
		if (item) item.sheet.render(true);
	}

	#open(id) {
		switch (id) {
			case "note":
				this.element.find("#note").show(100);
				this.#notesEditorStyle = "display: block;";
				break;
			case "roll":
				this.renderRollDialog();
				break;
		}
	}

	#close(id) {
		switch (id) {
			case "note": {
				const notes = this.element.find("#note");
				this.#notesEditorStyle = notes.attr("style").replace("block", "none");
				notes.hide(100);
			}
		}
	}

	#openItem(id) {
		const item = game.items.get(id);
		if (item) item.sheet.render(true);
	}

	async #select(event) {
		// Prevent double clicks from selecting the tag
		if (event.detail > 1) return;

		const t = event.currentTarget;
		const toBurn = event.shiftKey;
		const toScratch = event.altKey;
		const toHelp = event.ctrlKey;
		const id = t.dataset.id;
		const tag = this.system.allTags.find((t) => t.id === id)?.toObject();
		const selected = t.hasAttribute("data-selected");

		if (tag) tag.actorId = this.actor.id; // for "toHelp" tags
    if (!tag) {
			if (!toScratch) return;

			const storyItem = this.items.find(
				(i) => i.type === "story" && i.system.themeTag.id === id,
			);
			if (storyItem) {
				await this.actor.updateEmbeddedDocuments("Item", [
					{
						_id: storyItem.id,
						"system.themeTag.isScratched": !storyItem.system.themeTag.isScratched,
					},
				]);
				this.render();
				return;
			}

			let parentItem = this.items.find(
				(i) => i.type === "theme" && i.system.specials.some((s) => s.id === id),
			);
			if (!parentItem) {
					parentItem = this.items.find(
							(i) => i.type === "backpack" && i.system.specials.some((s) => s.id === id),
					);
			}
			if (!parentItem) {
				const fellowship = this.system.fellowship;
				if (fellowship?.system?.specials?.some((s) => s.id === id)) {
					parentItem = fellowship;
				}
			}
			if (parentItem) {
				const { specials } = parentItem.system.toObject();
				const special = specials.find((s) => s.id === id);
				if (special) {
					special.isActive = !special.isActive;
					return parentItem.update({ "system.specials": specials });
				}
			}
			return;
		} else {
			// select tag
			const freshConfig = game.settings.get("litm-rn", "storytags")
				|| { tags: [], actors: [], selectedTags: [], helpingTags: [] };
			const freshHelping = freshConfig.helpingTags || [];
			const alreadyHelping = freshHelping.some(ht => ht.id === tag.id);

			if (toScratch && !alreadyHelping) {
				if (selected) {
					this.#roll.removeTag(tag);
					if (this.#roll.rendered) this.#roll.render();
				}
				return this.toggleScratchTag(tag);
			}

			if (!selected && tag.isScratched && !alreadyHelping)
				return;

			if (selected) {
				this.#roll.removeTag(tag);
				if (toBurn) {
					this.#roll.addTag(tag, toBurn);
				}
			} else {
				if (toHelp && this.system.embeddedTags.find((t) => t.id === id)) {
					let currentHelping;

					if (alreadyHelping) {
						currentHelping = freshHelping.filter((t) => t.id !== id);
					} else {
						currentHelping = [...freshHelping, tag];
					}

					if (game.user.isGM)
						return this.setHelpingTags(currentHelping);
					return dispatch({ app: "helping-tags", type: "update", "helpingTags": currentHelping });
				}

				this.#roll.addTag(tag, toBurn);
			}

			// Render the roll dialog if it's open
			if (this.#roll.rendered) this.#roll.render();
			this.render();
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

	async #handleLootDrop(item) {
		const { contents } = item.system;
		const chosenLoot = await Dialog.wait({
			title: game.i18n.localize("Litm.ui.item-transfer-title"),
			content: await foundry.applications.handlebars.renderTemplate(
				"systems/litm-rn/templates/apps/loot-dialog.html",
				{ contents, cssClass: "litm--loot-dialog" },
			),
			buttons: {
				loot: {
					icon: '<i class="fas fa-check"></i>',
					label: game.i18n.localize("Litm.other.transfer"),
					callback: (html) => {
						const chosenLoot = html
							.find("input[type=checkbox]:checked")
							.map((_, i) => i.value)
							.get();
						return chosenLoot;
					},
				},
			},
		});
		if (!chosenLoot || !chosenLoot.length) return;

		const loot = contents.filter((i) => chosenLoot.includes(i.id));
		const backpack = this.items.find((i) => i.type === "backpack");

		if (!backpack) {
			error("Litm.ui.error-no-backpack");
			throw new Error("Litm.ui.error-no-backpack");
		}

		// Add the loot to the backpack
		await backpack.update({
			"system.contents": [...this.system.backpack.contents, ...loot],
		});
		// Remove the loot from the item
		await item.update({
			"system.contents": contents.filter((i) => !chosenLoot.includes(i.id)),
		});

		ui.notifications.info(
			game.i18n.format("Litm.ui.item-transfer-success", {
				items: loot.map((i) => i.name).join(", "),
			}),
		);
		backpack.sheet.render(true);
	}

	#getBackside(id) {
    return this.#backsideStates.get(id) ?? false;
	}

	async #toggleBackside(id) {
		if (!id) return;
		this.#backsideStates.set(id, !this.#getBackside(id));
		this.render(false);
	}

	#toggleCollapse(button) {
		const targetId = button.dataset.target;
		if (this.#expandedStories.has(targetId)) {
			this.#expandedStories.delete(targetId);
		} else {
			this.#expandedStories.add(targetId);
		}
		const container = this.element.find(`[data-collapse-id="${targetId}"]`);
		const icon = $(button).find("i");
		container.slideToggle(150);
		icon.toggleClass("fa-angle-down fa-angle-right");
	}

	async setHelpingTags(helpingTags) {
		await game.settings.set("litm-rn", "storytags", { ...this.config, helpingTags });
	}

	async close(options) {
		if (this.#fellowshipUpdateHook) {
			Hooks.off("updateItem", this.#fellowshipUpdateHook);
			this.#fellowshipUpdateHook = null;
		}
		if (this.#storyTagsHookId) {
			Hooks.off("litmStoryTagsUpdated", this.#storyTagsHookId);
			this.#storyTagsHookId = null;
		}
		return super.close(options);
	}
}
