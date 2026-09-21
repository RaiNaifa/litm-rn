import { RollTargetPopup } from "../../apps/roll-target-popup.js";
import {
	ThemeContentBackgroundApp,
	positionThemeContentArt,
} from "../../apps/theme-content-background.js";
import { registerDataInputSync } from "../../mixins/sheet-utils.js";
import { createPrivate } from "../../system/private-creation.js";
import { confirmDelete, localize as t } from "../../utils.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const FilePicker = foundry.applications.apps.FilePicker.implementation;
const DEFAULT_ICON = "systems/litm-rn/assets/media/icons/treasure-map.svg";

/** Independent ApplicationV2 sheet for Journey actors. */
export class JourneySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--journey"],
		tag: "form",
		position: { width: 800, height: 760 },
		window: { resizable: true, title: (app) => app.document.name },
		form: { submitOnChange: true },
		actions: {
			configureBackground: JourneySheet.#configureBackground,
			editImage: JourneySheet.#onEditImage,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/actor/journey.html",
			scrollable: [],
		},
	};

	#artObserver = null;
	#contextMenu = null;
	#contextMenuAnchor = null;
	#editingTagId = null;
	#layoutObserver = null;
	#pendingConsequenceIndex = null;
	#rollSelectionHookId = null;
	#scrollPositions = { content: 0, wrapper: 0 };
	#storyTagsHookId = null;

	get #storyRef() {
		return this.actor.isToken && !this.token?.actorLink
			? this.token.uuid
			: this.actor.id;
	}

	get #storyRefs() {
		return new Set(
			[this.#storyRef, this.actor.id, this.actor.uuid].filter(Boolean),
		);
	}

	#isStoryActor(actors = []) {
		const refs = this.#storyRefs;
		return actors.some((ref) => refs.has(ref));
	}

	static #onEditImage(_event, target) {
		const attr = target.dataset.edit;
		if (!attr) return;
		new FilePicker({
			type: "image",
			current: foundry.utils.getProperty(this.document, attr),
			callback: (path) => this.document.update({ [attr]: path }),
		}).render();
	}

	static #configureBackground() {
		new ThemeContentBackgroundApp(this.actor, { mode: "journey" }).render({
			force: true,
		});
	}

	/** @override */
	_getHeaderControls() {
		return [
			...super._getHeaderControls(),
			{
				action: "configureBackground",
				icon: "fas fa-image",
				label: "Litm.ui.journey-illustration-settings",
				ownership: "OWNER",
			},
		];
	}

	/** @override */
	render(options = {}, _options = {}) {
		this.#captureScrollPositions();
		return super.render(options, _options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.document = this.document;
		context.isEditable = this.isEditable;
		context.isGM = game.user.isGM;
		context.system = this.document.system.toObject();
		context.system.journeys = this.document.system.journeys;
		const note = context.system.note || "";
		context.system.noteRaw = note;
		context.system.note = await TextEditor.enrichHTML(note, {
			relativeTo: this.actor,
		});
		context.consequences = context.system.consequences || [];
		context.consequencesHTML = await Promise.all(
			context.consequences.map((consequence) =>
				TextEditor.enrichHTML(consequence, {
					secrets: this.document.isOwner,
					relativeTo: this.actor,
				}),
			),
		);
		context.effects = this.actor.effects
			.filter((effect) => effect.getFlag("litm-rn", "type") !== "limit")
			.map((effect) => effect.toObject())
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
		context.effectGroups = ["status", "tag", "might"].map((type) => ({
			type,
			effects: context.effects.filter(
				(effect) => effect.flags["litm-rn"]?.type === type,
			),
		}));
		context.editingTagId = this.#editingTagId;
		const rollSelMap = {};
		const characters =
			game.actors?.filter((actor) => actor.type === "character") || [];
		for (const [actorId, refMap] of game.litm?.rollSelection || []) {
			for (const [, tagMap] of refMap) {
				for (const [tagId, state] of tagMap) {
					rollSelMap[tagId] ??= [];
					const character = characters.find((actor) => actor.id === actorId);
					rollSelMap[tagId].push({
						actorId,
						actorName: character?.name || actorId,
						state,
						portrait:
							character?.img ||
							"systems/litm-rn/assets/media/litm-custom-logo.webp",
					});
				}
			}
		}
		context.rollSelMap = rollSelMap;
		context.items = await Promise.all(
			this.actor.items
				.filter((item) => item.type === "threat")
				.map(async (item) => {
					const data = item.toObject();
					data.system.enrichedThreat = await TextEditor.enrichHTML(
						data.system.threat || "",
						{
							secrets: this.document.isOwner,
							relativeTo: item,
						},
					);
					data.system.enrichedConsequences = await Promise.all(
						(data.system.consequences || []).map((value) =>
							TextEditor.enrichHTML(value, { relativeTo: item }),
						),
					);
					return data;
				}),
		);
		const story = game.settings.get("litm-rn", "storytags") || { actors: [] };
		context.isStoryActor = this.#isStoryActor(story.actors || []);
		context.isDefaultIcon = this.actor.img === DEFAULT_ICON;
		return context;
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#closeContextMenu(false);
		const content = this.#getWindowContent();
		const wrapper = this.element.querySelector(".litm--journey-wrapper");
		const artSurface = this.element.querySelector(".litm--journey-art-surface");
		const syncArtWidth = () => {
			if (artSurface && content?.offsetWidth) {
				artSurface.style.width = `${content.offsetWidth}px`;
			}
		};
		syncArtWidth();
		this.#layoutObserver?.disconnect();
		const layoutRoot = this.element;
		const applyLayout = (width) => {
			layoutRoot.dataset.layout = width >= 550 ? "wide" : "compact";
			syncArtWidth();
		};
		this.#layoutObserver = new ResizeObserver((entries) => {
			const width =
				entries[0]?.borderBoxSize?.[0]?.inlineSize ??
				entries[0]?.contentRect.width ??
				layoutRoot.getBoundingClientRect().width;
			applyLayout(width);
		});
		this.#layoutObserver.observe(layoutRoot);
		applyLayout(layoutRoot.getBoundingClientRect().width);
		this.#bindScrollPosition(content, "content");
		this.#bindScrollPosition(wrapper, "wrapper");
		registerDataInputSync(this.element, this);
		this.element.querySelectorAll("[data-size-input]").forEach((input) => {
			const resize = () => {
				const style = getComputedStyle(input);
				const canvas = document.createElement("canvas");
				const context = canvas.getContext("2d");
				if (!context) return;
				context.font = style.font;
				const metrics = context.measureText(input.value || " ");
				const italicOverhang = Math.max(
					0,
					(metrics.actualBoundingBoxRight || metrics.width) - metrics.width,
				);
				input.style.width = `${Math.ceil(metrics.width + italicOverhang + 10)}px`;
			};
			resize();
			input.addEventListener("input", resize);
		});
		this.element
			.querySelectorAll("[data-click]")
			.forEach((element) =>
				element.addEventListener("click", this.#handleClick.bind(this)),
			);
		this.element
			.querySelectorAll("[data-context-entity]")
			.forEach((element) =>
				element.addEventListener(
					"contextmenu",
					this.#openContextMenu.bind(this),
				),
			);
		this.element
			.querySelectorAll("[data-context-consequence]")
			.forEach((element) =>
				element.addEventListener(
					"contextmenu",
					this.#openConsequenceMenu.bind(this),
				),
			);
		this.element
			.querySelectorAll("[data-drag-threat]")
			.forEach((element) =>
				element.addEventListener(
					"dragstart",
					this.#onThreatDragStart.bind(this),
				),
			);
		this.element
			.querySelectorAll("[data-drag-effect]")
			.forEach((element) =>
				element.addEventListener(
					"dragstart",
					this.#onEffectDragStart.bind(this),
				),
			);
		this.#activateEffectEditor();
		this.#artObserver?.disconnect();
		this.#artObserver = positionThemeContentArt(
			this.element.querySelector(".litm--journey-art"),
			this.actor.system,
			{ referenceWidth: 800 },
		);
		this.#storyTagsHookId ??= Hooks.on(
			"litmStoryTagsUpdated",
			this.#syncStoryActorButton,
		);
		this.#rollSelectionHookId ??= Hooks.on(
			"litmRollSelectionUpdated",
			this.#onRollSelectionUpdated,
		);
		this.#syncStoryActorButton();
		this.#activatePendingConsequence();
		requestAnimationFrame(() => {
			this.#restoreScrollPosition(content, "content");
			this.#restoreScrollPosition(wrapper, "wrapper");
		});
	}

	#getWindowContent() {
		if (this.element?.matches?.(".window-content")) return this.element;
		return this.element?.querySelector?.(".window-content") || null;
	}

	#captureScrollPositions() {
		const content = this.#getWindowContent();
		const wrapper = this.element?.querySelector?.(".litm--journey-wrapper");
		if (content) this.#scrollPositions.content = content.scrollTop;
		if (wrapper) this.#scrollPositions.wrapper = wrapper.scrollTop;
	}

	#bindScrollPosition(element, key) {
		if (!element) return;
		this.#restoreScrollPosition(element, key);
		element.addEventListener(
			"scroll",
			() => {
				this.#scrollPositions[key] = element.scrollTop;
			},
			{ passive: true },
		);
	}

	#restoreScrollPosition(element, key) {
		if (element) element.scrollTop = this.#scrollPositions[key];
	}

	#activateEffectEditor() {
		const editing = this.element.querySelector(
			`.litm--tm-tag-name[data-id="${this.#editingTagId}"][contenteditable]`,
		);
		if (!editing) return;
		editing.addEventListener("blur", this.#saveEffectName.bind(this));
		editing.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			editing.blur();
		});
		requestAnimationFrame(() => {
			const scrollPositions = { ...this.#scrollPositions };
			editing.focus({ preventScroll: true });
			editing.ownerDocument.getSelection()?.selectAllChildren(editing);
			this.#scrollPositions = scrollPositions;
			this.#restoreScrollPosition(this.#getWindowContent(), "content");
			this.#restoreScrollPosition(
				this.element.querySelector(".litm--journey-wrapper"),
				"wrapper",
			);
		});
	}

	/** @override */
	async _processSubmitData(event, form, formData) {
		await super._processSubmitData(event, form, formData);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	/** @override */
	async _onDropItem(event, data) {
		const item = await CONFIG.Item.documentClass.fromDropData(data);
		if (item.type !== "threat") return;
		if (this.actor.items.get(item.id)) return this._onSortItem(event, item);
		return super._onDropItem(event, data);
	}

	/** @override */
	async _onDrop(event) {
		const raw = event.dataTransfer.getData("text/plain");
		if (!raw) return super._onDrop(event);
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return super._onDrop(event);
		}
		if (data.type === "limit") return;
		if (!["tag", "status", "might"].includes(data.type)) {
			return super._onDrop(event);
		}
		const targetJourneyBlock = event.target
			.closest("[data-journey-drop-block]")
			?.dataset.journeyDropBlock;
		if (
			data.sourceActorUuid === this.actor.uuid &&
			data.sourceJourneyBlock &&
			data.sourceJourneyBlock === targetJourneyBlock
		) {
			return;
		}
		const flags = this.#effectFlags(data.type, data, event);
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{ name: data.name, flags: { "litm-rn": flags } },
		]);
	}

	#effectFlags(type, data, event) {
		const flags = {
			type,
			isScratched: Boolean(data.isScratched),
			isHindering: Boolean(data.isHindering),
			isPrivate: createPrivate(event),
		};
		if (type === "tag") flags.isCrispy = Boolean(data.isCrispy);
		if (type === "status") {
			flags.values = data.values || new Array(6).fill(false);
			flags.value = data.value ?? 0;
		}
		if (type === "might") {
			flags.values = data.values || [0, 3, 6];
			flags.value = data.value ?? 3;
		}
		return flags;
	}

	async #handleClick(event) {
		event.preventDefault();
		switch (event.currentTarget.dataset.click) {
			case "add-tag":
				return this.#addEffect("tag", event);
			case "add-status":
				return this.#addEffect("status", event);
			case "add-might":
				return this.#addEffect("might", event);
			case "add-vignette":
				return this.#addVignette();
			case "add-consequence":
				return this.#addConsequence();
			case "move-to-story":
				return this.#moveToStory();
			case "select":
				return this.#selectTag(event);
		}
	}

	async #addEffect(type, event) {
		const nameKeys = {
			tag: "Litm.ui.name-tag",
			status: "Litm.ui.name-status",
			might: "Litm.ui.name-might",
		};
		const flags = this.#effectFlags(type, {}, event);
		const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{ name: t(nameKeys[type]), flags: { "litm-rn": flags } },
		]);
		this.#editingTagId = effect.id;
		await this.render({ force: true });
	}

	async #addVignette() {
		const [vignette] = await this.actor.createEmbeddedDocuments("Item", [
			{
				name: t("Litm.ui.new-vignette"),
				type: "threat",
				system: { threat: t("Litm.ui.new-vignette-description") },
			},
		]);
		vignette.sheet.focusNameOnRender?.();
		vignette.sheet.render({ force: true });
	}

	async #addConsequence() {
		await this.#commitActiveConsequenceEditor();
		const consequences = this.actor.system.consequences || [];
		this.#pendingConsequenceIndex = consequences.length;
		await this.actor.update({
			"system.consequences": [...consequences, t("Litm.ui.name-consequence")],
		});
	}

	async #commitActiveConsequenceEditor() {
		const save = this.element?.querySelector(
			'.litm--journey-consequence-editor.active button[data-action="save"]',
		);
		if (!save) return;
		save.click();
		await new Promise((resolve) => queueMicrotask(resolve));
	}

	#activatePendingConsequence() {
		if (this.#pendingConsequenceIndex === null) return;
		const index = this.#pendingConsequenceIndex;
		queueMicrotask(() => {
			const row = this.element.querySelector(
				`[data-context-consequence][data-id="${index}"]`,
			);
			if (!row) return;
			this.#pendingConsequenceIndex = null;
			const scrollPositions = { ...this.#scrollPositions };
			row.querySelector("prose-mirror button.toggle")?.click();
			queueMicrotask(() => {
				const editor = row.querySelector(
					'.editor-content[contenteditable="true"]',
				);
				if (editor) {
					editor.focus({ preventScroll: true });
					const selection = editor.ownerDocument.defaultView.getSelection();
					selection?.selectAllChildren(editor);
				}
				this.#scrollPositions = scrollPositions;
				this.#restoreScrollPosition(this.#getWindowContent(), "content");
			});
		});
	}

	async #saveEffectName(event) {
		const element = event.currentTarget;
		const effect = this.actor.effects.get(element.dataset.id);
		const name = element.textContent.trim();
		this.#editingTagId = null;
		if (effect && name && effect.name !== name) await effect.update({ name });
		else this.render();
	}

	async #selectTag(event) {
		if (!game.user.isGM || this.#editingTagId || event.detail > 1) return;
		const target = event.currentTarget;
		const id = target.dataset.id || target.closest("[data-id]")?.dataset.id;
		if (!id) return;
		const result = await RollTargetPopup.show(event, {
			tagId: id,
			tagName: target.textContent.trim(),
			ref: this.document.uuid,
		});
		if (!result) return;
		if (result.action === "remove") {
			game.litm?.removeTagFromRoll?.(result.actorId, this.document.uuid, id);
		} else {
			game.litm?.addTagToRoll?.(
				result.actorId,
				this.document.uuid,
				id,
				result.state,
			);
		}
		this.render();
	}

	async #moveToStory() {
		const config = game.settings.get("litm-rn", "storytags") || {
			actors: [],
			tags: [],
		};
		const actors = config.actors || [];
		const refs = this.#storyRefs;
		const nextActors = this.#isStoryActor(actors)
			? actors.filter((ref) => !refs.has(ref))
			: [...actors, this.#storyRef];
		await game.settings.set("litm-rn", "storytags", {
			...config,
			actors: nextActors,
		});
		Hooks.callAll("litmStoryTagsUpdated");
		await this.render({ force: true });
	}

	#syncStoryActorButton = () => {
		const button = this.element?.querySelector('[data-click="move-to-story"]');
		if (!button) return;
		const config = game.settings.get("litm-rn", "storytags") || { actors: [] };
		const active = this.#isStoryActor(config.actors || []);
		const label = t(
			active
				? "Litm.ui.remove-journey-from-story"
				: "Litm.ui.move-journey-to-story",
		);
		button.classList.toggle("active", active);
		button.setAttribute("aria-pressed", String(active));
		button.dataset.tooltip = label;
		const icon = button.querySelector("i");
		icon?.classList.toggle("fas", active);
		icon?.classList.toggle("far", !active);
	};

	#onRollSelectionUpdated = (change = {}) => {
		const refs = new Set(
			[change.ref, ...(change.changes || []).map((entry) => entry.ref)].filter(
				Boolean,
			),
		);
		if (
			change.operation === "refresh" ||
			change.scope === "all" ||
			refs.size === 0 ||
			refs.has(this.actor.uuid)
		) {
			this.render();
		}
	};

	#openConsequenceMenu(event) {
		event.preventDefault();
		event.stopPropagation();
		this.#closeContextMenu();
		const row = event.currentTarget;
		const doc = row.ownerDocument;
		const win = doc.defaultView;
		const menu = doc.createElement("div");
		menu.className = "litm--journey-consequence-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		const addOption = (label, icon, callback, separator = false) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle(
				"litm--journey-consequence-menu-separator",
				separator,
			);
			button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
			button.addEventListener("click", async () => {
				this.#closeContextMenu();
				await callback();
			});
			menu.append(button);
		};
		addOption(t("Litm.ui.edit"), "fa-solid fa-pen", () => {
			row.querySelector("prose-mirror button.toggle")?.click();
		});
		addOption(
			t("Litm.ui.remove"),
			"fa-solid fa-trash",
			() => this.#removeConsequence(row.dataset.id),
			true,
		);
		doc.body.append(menu);
		this.#contextMenu = menu;
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			if (rect.right > win.innerWidth) {
				menu.style.left = `${Math.max(8, win.innerWidth - rect.width - 8)}px`;
			}
			if (rect.bottom > win.innerHeight) {
				menu.style.top = `${Math.max(8, win.innerHeight - rect.height - 8)}px`;
			}
		});
		setTimeout(
			() => doc.addEventListener("pointerdown", this.#onContextMenuOutside),
			0,
		);
	}

	async #removeConsequence(id) {
		await this.#commitActiveConsequenceEditor();
		const consequences = foundry.utils.deepClone(
			this.actor.system.consequences || [],
		);
		consequences.splice(Number(id), 1);
		await this.actor.update({ "system.consequences": consequences });
	}

	#openContextMenu(event) {
		event.preventDefault();
		event.stopPropagation();
		this.#closeContextMenu(false);
		const entity = event.currentTarget;
		const kind = entity.dataset.contextEntity;
		const id = entity.dataset.id;
		const doc = entity.ownerDocument;
		const win = doc.defaultView;
		this.#contextMenuAnchor = { kind, id, x: event.clientX, y: event.clientY };
		const menu = doc.createElement("div");
		menu.className = "litm--character-tag-menu";
		menu.setAttribute("role", "menu");
		const reopen = () => this.#restoreContextMenu();
		const addOption = (
			label,
			icon,
			callback,
			separator = false,
			keepOpen = false,
		) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle("litm--character-tag-menu-separator", separator);
			button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
			button.addEventListener("click", async () => {
				if (!keepOpen) this.#closeContextMenu();
				await callback();
				if (keepOpen) reopen();
			});
			menu.append(button);
		};
		const addValueGroup = (className, values, callback) => {
			const group = doc.createElement("div");
			group.className = `litm--tag-menu-values ${className}`;
			for (const value of values) {
				const button = doc.createElement("button");
				button.type = "button";
				button.className =
					`${className.includes("status") ? "litm--tm-popup-status-btn" : "litm--tm-popup-might-btn"} ${value.className || ""}`.trim();
				button.classList.toggle("active", Boolean(value.active));
				button.classList.toggle("filled", Boolean(value.filled));
				button.dataset.tooltip = value.tooltip || value.label;
				button.textContent = value.label || "";
				button.addEventListener("click", async () => {
					await callback(value.value);
					reopen();
				});
				group.append(button);
			}
			menu.append(group);
		};
		if (kind === "threat") {
			addOption(t("Litm.ui.edit-vignette"), "fa-solid fa-pen", () =>
				this.actor.items.get(id)?.sheet.render({ force: true }),
			);
		} else {
			const effect = this.actor.effects.get(id);
			if (!effect) return;
			const flags = effect.flags?.["litm-rn"] || {};
			addOption(t("Litm.ui.edit"), "fa-solid fa-pen", async () => {
				this.#editingTagId = id;
				await this.render({ force: true });
			});
			addOption(
				t(
					flags.isPrivate ? "Litm.ui.reveal-secret-tag" : "Litm.ui.make-secret",
				),
				"fa-solid fa-mask",
				() => this.#togglePrivate(id),
			);
			if (kind === "status") {
				addValueGroup(
					"litm--tm-popup-status",
					(flags.values || Array(6).fill(false)).map((filled, index) => ({
						value: index,
						label: "",
						tooltip: String(index + 1),
						filled: Boolean(filled),
					})),
					(value) => this.#toggleStatusValue(id, value),
				);
				addOption(
					t("Litm.ui.decrease-status"),
					"fa-solid fa-arrow-left",
					() => this.#decreaseStatus(id),
					false,
					true,
				);
			}
			if (kind === "might") {
				addValueGroup(
					"litm--tm-popup-might",
					[
						{
							value: 0,
							className: "litm--might-origin",
							active: flags.value === 0,
							tooltip: t("Litm.tags.origin-0"),
						},
						{
							value: 3,
							className: "litm--might-adventure",
							active: flags.value === 3,
							tooltip: t("Litm.tags.adventure-3"),
						},
						{
							value: 6,
							className: "litm--might-greatness",
							active: flags.value === 6,
							tooltip: t("Litm.tags.greatness-6"),
						},
					],
					(value) => this.#setMightValue(id, value),
				);
			}
			if (kind === "tag") {
				if (!game.user.isGM && game.user.character && !flags.isCrispy) {
					const actorId = game.user.character.id;
					const isBurned =
						game.litm?.rollSelection
							?.get(actorId)
							?.get(this.document.uuid)
							?.get(id) === "burned";
					if (!isBurned) {
						addOption(t("Litm.ui.burn-in-roll"), "fa-solid fa-fire", () =>
							game.litm?.addTagToRoll?.(
								actorId,
								this.document.uuid,
								id,
								"burned",
							),
						);
					}
				}
				addOption(
					t(
						flags.isCrispy
							? "Litm.ui.single-use-active"
							: "Litm.ui.make-single-use",
					),
					"fa-solid fa-hourglass-half",
					() => this.#toggleCrispy(id),
				);
			}
		}
		addOption(
			t("Litm.ui.remove"),
			"fa-solid fa-trash",
			() =>
				kind === "threat" ? this.#removeVignette(id) : this.#removeEffect(id),
			true,
		);
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		doc.body.append(menu);
		this.#contextMenu = menu;
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			if (rect.right > win.innerWidth)
				menu.style.left = `${Math.max(8, win.innerWidth - rect.width - 8)}px`;
			if (rect.bottom > win.innerHeight)
				menu.style.top = `${Math.max(8, win.innerHeight - rect.height - 8)}px`;
		});
		setTimeout(
			() => doc.addEventListener("pointerdown", this.#onContextMenuOutside),
			0,
		);
	}

	#onContextMenuOutside = (event) => {
		if (!this.#contextMenu?.contains(event.target)) this.#closeContextMenu();
	};

	#restoreContextMenu() {
		const anchor = this.#contextMenuAnchor;
		if (!anchor) return;
		const trigger = [
			...this.element.querySelectorAll("[data-context-entity]"),
		].find(
			(element) =>
				element.dataset.contextEntity === anchor.kind &&
				element.dataset.id === anchor.id,
		);
		if (!trigger) return this.#closeContextMenu();
		this.#openContextMenu({
			preventDefault() {},
			stopPropagation() {},
			currentTarget: trigger,
			clientX: anchor.x,
			clientY: anchor.y,
		});
	}

	#closeContextMenu(clearAnchor = true) {
		this.#contextMenu?.ownerDocument.removeEventListener(
			"pointerdown",
			this.#onContextMenuOutside,
		);
		this.#contextMenu?.remove();
		this.#contextMenu = null;
		if (clearAnchor) this.#contextMenuAnchor = null;
	}

	async #updateEffectFlags(id, update) {
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		const flags = foundry.utils.deepClone(effect.flags?.["litm-rn"] || {});
		update(flags);
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, flags: { "litm-rn": flags } },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #togglePrivate(id) {
		await this.#updateEffectFlags(id, (flags) => {
			flags.isPrivate = !flags.isPrivate;
		});
	}

	async #toggleCrispy(id) {
		let isCrispy = false;
		await this.#updateEffectFlags(id, (flags) => {
			flags.isCrispy = !flags.isCrispy;
			isCrispy = flags.isCrispy;
		});
		if (isCrispy) game.litm?.normalizeBurnedTagSelections?.(id);
	}

	async #toggleStatusValue(id, value) {
		const index = Number.parseInt(value, 10);
		if (!Number.isFinite(index)) return;
		await this.#updateEffectFlags(id, (flags) => {
			const values = [...(flags.values || Array(6).fill(false))];
			values[index] = !values[index];
			flags.values = values;
			flags.value = values.findLastIndex((filled) => Boolean(filled)) + 1;
		});
	}

	async #decreaseStatus(id) {
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		const values = [...(effect.flags?.["litm-rn"]?.values || [])];
		const highest = values.findLastIndex((value) => Boolean(value));
		if (highest <= 0) return this.#removeEffect(id);
		await this.#updateEffectFlags(id, (flags) => {
			const shifted = new Array(Math.max(6, values.length)).fill(false);
			for (let index = 1; index < values.length; index += 1) {
				if (values[index]) shifted[index - 1] = index;
			}
			flags.values = shifted;
			flags.value = highest;
		});
	}

	async #setMightValue(id, value) {
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, "flags.litm-rn.value": Number(value) },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #removeEffect(id) {
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		game.litm?.removeTagFromAllRolls?.(id);
		game.litm?.gmRemoveTagFromAllRolls?.(id);
		await effect.delete();
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #removeVignette(id) {
		const item = this.actor.items.get(id);
		if (!item || !(await confirmDelete("Litm.other.vignette"))) return;
		await item.delete();
	}

	#onThreatDragStart(event) {
		const item = this.actor.items.get(event.currentTarget.dataset.dragThreat);
		if (!item) return;
		event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
	}

	#onEffectDragStart(event) {
		const effect = this.actor.effects.get(
			event.currentTarget.dataset.dragEffect,
		);
		if (!effect) return;
		const flags = effect.flags?.["litm-rn"] || {};
		event.dataTransfer.setData(
			"text/plain",
			JSON.stringify({
				type: flags.type,
				name: effect.name,
				values: flags.values,
				value: flags.value,
				isScratched: flags.isScratched,
				isHindering: flags.isHindering,
				isCrispy: flags.isCrispy,
				sourceActorUuid: this.actor.uuid,
				sourceJourneyBlock: "effects",
			}),
		);
	}

	/** @override */
	_onClose(options) {
		this.#artObserver?.disconnect();
		this.#layoutObserver?.disconnect();
		this.#closeContextMenu();
		if (this.#storyTagsHookId) {
			Hooks.off("litmStoryTagsUpdated", this.#storyTagsHookId);
		}
		if (this.#rollSelectionHookId) {
			Hooks.off("litmRollSelectionUpdated", this.#rollSelectionHookId);
		}
		this.#storyTagsHookId = null;
		this.#rollSelectionHookId = null;
		return super._onClose(options);
	}
}
