import { RollTargetPopup } from "../../apps/roll-target-popup.js";
import { normalizeSpecialText } from "../../data/specials.js";
import { registerDataInputSync } from "../../mixins/sheet-utils.js";
import { createPrivate } from "../../system/private-creation.js";
import {
	addOrStackActorStatus,
	compareTagTypes,
	confirmDelete,
	dispatch,
	getOwningDocument,
	getOwningWindow,
	localize as t,
} from "../../utils.js";

/* Re-render only challenge sheets referenced by a targeted selection change. */
Hooks.on("litmRollSelectionUpdated", (change = {}) => {
	const refs = new Set(
		[change.ref, ...(change.changes ?? []).map((entry) => entry.ref)].filter(
			Boolean,
		),
	);
	const refreshAll =
		change.operation === "refresh" || change.scope === "all" || refs.size === 0;
	for (const actor of game.actors) {
		if (actor.type !== "challenge") continue;
		if (!refreshAll && !refs.has(actor.uuid)) continue;
		const sheet = actor.sheet;
		if (sheet instanceof ChallengeSheet && sheet.rendered) {
			sheet.render();
		}
	}
});
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

export class ChallengeSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--challenge"],
		tag: "form",
		position: { width: 320, height: 700 },
		window: {
			resizable: true,
			title: (app) => app.document.name,
		},
		form: { submitOnChange: true },
		actions: {
			editImage: ChallengeSheet.#onEditImage,
			challengeLayoutCompact: ChallengeSheet.#onLayoutCompact,
			challengeLayoutWide: ChallengeSheet.#onLayoutWide,
		},
	};

	#editingTagId = null;
	#editingLimitIndex = null;
	#selectEditingText = false;
	#pendingFocusSelector = null;
	#scrollPositions = { content: 0, wrapper: 0 };
	#contextMenu = null;
	#contextMenuAnchor = null;
	#defaultLayoutApplied = false;
	#resizeObserver = null;
	#layoutWindow = null;
	#layoutResizeHandler = null;
	#sortDragData = null;
	#storyTagsHookId = null;

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/actor/challenge.html",
			scrollable: [],
		},
	};

	isEditing = false;

	get system() {
		return this.actor.system;
	}

	get items() {
		return this.actor.items;
	}

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

	#isStoryActor(actors) {
		const refs = this.#storyRefs;
		return (actors || []).some((ref) => refs.has(ref));
	}

	static #onEditImage(_event, target) {
		const attr = target.dataset.edit;
		const current = foundry.utils.getProperty(this.document, attr);
		const fp = new FilePicker({
			type: "image",
			current: current,
			callback: (path) => this.document.update({ [attr]: path }),
		});
		fp.render();
	}

	static #onLayoutCompact() {
		this.#setLayoutWidth("compact");
	}

	static #onLayoutWide() {
		this.#setLayoutWidth("wide");
	}

	/** @override */
	_getHeaderControls() {
		return [
			...super._getHeaderControls(),
			{
				action: "challengeLayoutCompact",
				icon: "fa-solid fa-mobile-screen",
				label: "Litm.ui.challenge-layout-compact",
				ownership: "OWNER",
			},
			{
				action: "challengeLayoutWide",
				icon: "fa-solid fa-table-columns",
				label: "Litm.ui.challenge-layout-wide",
				ownership: "OWNER",
			},
		];
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.system = this.document.system.toObject();
		context.document = this.document;
		context.isEditing = this.isEditing;
		context.isEditable = this.isEditable;

		context.system.challenges = this.document.system.challenges;
		const note = context.system.note || "";
		context.system.noteRaw = note;
		context.system.note = await TextEditor.enrichHTML(note);

		context.system.enrichedSpecials = await Promise.all(
			(context.system.specials || []).map(async (s, index) => ({
				index,
				id: s.id,
				name: s.name,
				description: s.description,
				enrichedDescription: await TextEditor.enrichHTML(s.description || ""),
			})),
		);

		context.system.enrichedSecrets = await Promise.all(
			(context.system.secrets || []).map(async (s, index) => ({
				index,
				name: s.name,
				description: s.description,
				isRevealed: s.isRevealed || false,
				enrichedDescription: await TextEditor.enrichHTML(s.description || ""),
			})),
		);

		context.system.enrichedLimits = await Promise.all(
			(context.system.limits || []).map(async (limit, index) => ({
				...limit,
				index,
				enrichedConsequence: limit.consequence
					? await TextEditor.enrichHTML(limit.consequence)
					: "",
			})),
		);

		context.items = await Promise.all(
			this.items.map(async (item) => {
				const obj = item.toObject();
				obj.system.enrichedConsequences = await Promise.all(
					(obj.system.consequences || []).map((c) =>
						TextEditor.enrichHTML(c || "", {
							secrets: this.document.isOwner,
							relativeTo: this.document,
						}),
					),
				);
				return obj;
			}),
		);

		// Soft Migration
		context.effects = this.actor.effects
			.map((e) => {
				const effect = e.toObject();
				const flags = effect.flags["litm-rn"] || {};
				if (flags.type) return effect;

				const type =
					flags.type ||
					(flags.values?.length === 3
						? "might"
						: flags.values?.some((v) => !!v)
							? "status"
							: "tag");

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
				return (
					compareTagTypes({ type: typeA }, { type: typeB }) ||
					(a.sort ?? 0) - (b.sort ?? 0)
				);
			});

		// Roll selection lookup: tagId → array of { actorId, state, portrait }
		const selMap = {};
		const allCharacters =
			game.actors?.filter((a) => a.type === "character") || [];
		if (game.litm?.rollSelection) {
			for (const [actorId, refMap] of game.litm.rollSelection) {
				for (const [ref, tagMap] of refMap) {
					for (const [tagId, state] of tagMap) {
						if (!selMap[tagId]) selMap[tagId] = [];
						const char = allCharacters.find((c) => c.id === actorId);
						selMap[tagId].push({
							actorId,
							actorName: char?.name || actorId,
							state,
							portrait:
								char?.img ||
								"systems/litm-rn/assets/media/litm-custom-logo.webp",
						});
					}
				}
			}
		}
		context.rollSelMap = selMap;
		context.editingTagId = this.#editingTagId;
		context.editingLimitIndex = this.#editingLimitIndex;
		context.isGM = game.user.isGM;
		const storyConfig = game.settings.get("litm-rn", "storytags") || {
			actors: [],
		};
		context.isStoryActor = this.#isStoryActor(storyConfig.actors);

		return context;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#storyTagsHookId ??= Hooks.on(
			"litmStoryTagsUpdated",
			this.#syncStoryActorButton,
		);
		this.#syncStoryActorButton();
		this.#closeContextMenu(false);
		this.element.setAttribute("autocomplete", "off");
		const form = this.element;
		this.#bindScrollPosition(form.querySelector(".window-content"), "content");
		this.#bindScrollPosition(
			form.querySelector(".litm--challenge-wrapper"),
			"wrapper",
		);
		this.#initializeResponsiveLayout();
		requestAnimationFrame(() => {
			this.#restoreScrollPosition(
				form.querySelector(".window-content"),
				"content",
			);
			this.#restoreScrollPosition(
				form.querySelector(".litm--challenge-wrapper"),
				"wrapper",
			);
		});

		// data-input contenteditable sync (name, tags, limit consequences)
		registerDataInputSync(form, this);

		// data-size-input auto-width
		form.querySelectorAll("[data-size-input]").forEach((el) => {
			el.style.width = `${Math.ceil(Math.max(el.value.length * 1.5, 6))}ch`;
			el.addEventListener("input", (event) => {
				const input = event.currentTarget;
				input.style.width = `${Math.ceil(Math.max(input.value.length * 1.5, 6))}ch`;
			});
		});

		form
			.querySelectorAll("[data-click]")
			.forEach((el) =>
				el.addEventListener("click", this.#handleClick.bind(this)),
			);
		form
			.querySelectorAll('[data-click^="add-"]')
			.forEach((el) =>
				el.addEventListener("pointerdown", (event) => event.preventDefault()),
			);
		form
			.querySelectorAll("[data-context]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#handleContext.bind(this)),
			);
		form.querySelectorAll("[data-context-entity]").forEach((el) => {
			if (el.dataset.contextEntity === "threat") {
				el.dataset.tooltip = t("Litm.ui.challenge-context-threat");
			}
			el.addEventListener("contextmenu", this.#openContextMenu.bind(this));
		});
		form.querySelectorAll("[data-tooltip]").forEach((el) => {
			el.dataset.tooltipDirection = "LEFT";
		});
		form.querySelectorAll(".litm--limit-name:not([readonly])").forEach((el) => {
			el.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				event.currentTarget.blur();
			});
			el.addEventListener("blur", () => {
				if (this.#editingLimitIndex === null) return;
				this.#editingLimitIndex = null;
				this.submit()
					.then(() => this.render())
					.catch(console.error);
			});
		});

		// Limit consequences
		form
			.querySelectorAll(".litm--limit-consequence-display")
			.forEach((el) =>
				el.addEventListener(
					"click",
					this.#onConsequenceDisplayClick.bind(this),
				),
			);
		form
			.querySelectorAll(".litm--limit-consequence-edit[contenteditable]")
			.forEach((el) =>
				el.addEventListener("blur", this.#onConsequenceEditBlur.bind(this)),
			);

		// Specials
		form
			.querySelectorAll("[data-drag-special]")
			.forEach((el) =>
				el.addEventListener("dragstart", this.#onSpecialDragStart.bind(this)),
			);
		form
			.querySelectorAll("[data-drag-threat]")
			.forEach((el) =>
				el.addEventListener("dragstart", this.#onThreatDragStart.bind(this)),
			);
		form
			.querySelectorAll("[data-drag-limit], [data-drag-effect]")
			.forEach((el) => {
				el.addEventListener("dragstart", this.#onSortDragStart.bind(this));
				el.addEventListener("dragend", () => {
					this.#sortDragData = null;
					this.#clearSortIndicator();
				});
			});
		form.addEventListener("dragover", this.#onSortDragOver.bind(this));
		form.addEventListener("dragleave", (event) => {
			if (!form.contains(event.relatedTarget)) this.#clearSortIndicator();
		});
		form
			.querySelectorAll(".litm--special-name[contenteditable]")
			.forEach((el) =>
				el.addEventListener("blur", this.#onSpecialFieldBlur.bind(this)),
			);
		form
			.querySelectorAll(".litm--special-description-display")
			.forEach((el) =>
				el.addEventListener(
					"click",
					this.#onSpecialDescriptionClick.bind(this),
				),
			);
		form
			.querySelectorAll(".litm--special-description-edit[contenteditable]")
			.forEach((el) =>
				el.addEventListener("blur", this.#onSpecialDescriptionBlur.bind(this)),
			);

		// Secrets
		form
			.querySelectorAll(".litm--secret-name[contenteditable]")
			.forEach((el) =>
				el.addEventListener("blur", this.#onSecretFieldBlur.bind(this)),
			);
		form
			.querySelectorAll(".litm--secret-description-display")
			.forEach((el) =>
				el.addEventListener("click", this.#onSecretDescriptionClick.bind(this)),
			);
		form
			.querySelectorAll(".litm--secret-description-edit[contenteditable]")
			.forEach((el) =>
				el.addEventListener("blur", this.#onSecretDescriptionBlur.bind(this)),
			);
		form
			.querySelectorAll(".litm--secret-torch")
			.forEach((el) =>
				el.addEventListener("click", this.#onSecretRevealToggle.bind(this)),
			);

		// Edit mode: focus the editing tag name input
		if (this.#editingTagId) {
			const el = this.element?.querySelector(
				`[data-tag-id="${this.#editingTagId}"]`,
			);
			const nameEl = el?.querySelector(".litm--tm-tag-name[contenteditable]");
			if (nameEl) {
				nameEl.addEventListener("keydown", this.#onNameKeydown.bind(this));
				nameEl.addEventListener("blur", this.#onNameBlur.bind(this));
				this.#pendingFocusSelector = `[data-tag-id="${this.#editingTagId}"] .litm--tm-tag-name[contenteditable]`;
			}
		}

		if (this.#contextMenuAnchor)
			queueMicrotask(() => this.#restoreContextMenu());
		if (this.#pendingFocusSelector) {
			const selector = this.#pendingFocusSelector;
			requestAnimationFrame(() => this.#focusNewEntity(selector, 3));
		}
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

	#initializeResponsiveLayout() {
		if (!this.#defaultLayoutApplied) {
			this.#defaultLayoutApplied = true;
			const defaultLayout = game.settings.get(
				"litm-rn",
				"challengeDefaultLayout",
			);
			requestAnimationFrame(() => {
				requestAnimationFrame(() => this.#setLayoutWidth(defaultLayout));
			});
		}

		// AppV2 can replace the root element during a re-render. Rebind the
		// observer so it never remains attached to a detached form.
		this.#resizeObserver?.disconnect();
		if (this.#layoutWindow && this.#layoutResizeHandler) {
			this.#layoutWindow.removeEventListener(
				"resize",
				this.#layoutResizeHandler,
			);
		}
		const element = this.element;
		const doc = getOwningDocument(element);
		const win = getOwningWindow(element);
		const isDetached = doc !== globalThis.document;
		const applyLayout = (width) => {
			element.dataset.layout = width >= 550 ? "wide" : "compact";
			this.#fitCompactAvatar(element);
		};
		const getLayoutWidth = (measuredWidth) =>
			isDetached
				? Math.max(
						measuredWidth,
						doc.documentElement.clientWidth,
						win.innerWidth,
					)
				: measuredWidth;
		this.#resizeObserver = new ResizeObserver((entries) => {
			const width =
				entries[0]?.borderBoxSize?.[0]?.inlineSize ??
				entries[0]?.contentRect.width ??
				element.getBoundingClientRect().width;
			applyLayout(getLayoutWidth(width));
		});
		this.#resizeObserver.observe(element);
		this.#layoutWindow = win;
		this.#layoutResizeHandler = () =>
			applyLayout(getLayoutWidth(element.getBoundingClientRect().width));
		win.addEventListener("resize", this.#layoutResizeHandler);
		this.#layoutResizeHandler();
	}

	#fitCompactAvatar(element) {
		const avatar = element.querySelector(".litm--challenge-avatar");
		if (!avatar) return;
		avatar.style.removeProperty("width");
		avatar.style.removeProperty("height");
		avatar.style.removeProperty("object-fit");
		if (element.dataset.layout !== "compact") return;

		const fit = () => {
			if (!avatar.naturalWidth || !avatar.naturalHeight) return;
			const availableWidth =
				avatar.parentElement?.clientWidth || element.clientWidth;
			const maxHeight =
				Number.parseFloat(
					getOwningWindow(element)
						.getComputedStyle(element)
						.getPropertyValue("--litm-challenge-compact-avatar-max-height"),
				) || 312;
			const fullHeight =
				(availableWidth * avatar.naturalHeight) / avatar.naturalWidth;
			if (fullHeight <= maxHeight) return;

			const width =
				fullHeight * 0.8 <= maxHeight
					? availableWidth
					: (availableWidth * maxHeight) / (fullHeight * 0.8);
			avatar.style.width = `${Math.floor(width)}px`;
			avatar.style.height = `${maxHeight}px`;
			avatar.style.objectFit = "cover";
		};
		if (avatar.complete) fit();
		else avatar.addEventListener("load", fit, { once: true });
	}

	/** @override */
	_onClose(options) {
		this.#resizeObserver?.disconnect();
		if (this.#storyTagsHookId !== null)
			Hooks.off("litmStoryTagsUpdated", this.#storyTagsHookId);
		this.#storyTagsHookId = null;
		if (this.#layoutWindow && this.#layoutResizeHandler) {
			this.#layoutWindow.removeEventListener(
				"resize",
				this.#layoutResizeHandler,
			);
		}
		this.#layoutWindow = null;
		this.#layoutResizeHandler = null;
		return super._onClose(options);
	}

	#setLayoutWidth(layout) {
		const widths = { compact: 400, wide: 800 };
		const resolvedLayout = Object.hasOwn(widths, layout) ? layout : "wide";
		if (this.element) {
			this.element.dataset.layout = resolvedLayout;
			this.#fitCompactAvatar(this.element);
		}
		this.setPosition({ width: widths[resolvedLayout] });
	}

	async _processSubmitData(event, form, formData) {
		this.isEditing = false;

		// Clamp limit values
		const limitData = formData.system?.limits;
		if (Array.isArray(limitData)) {
			for (const limit of limitData) {
				if (limit.value != null) {
					const val = Number(limit.value);
					limit.value =
						!Number.isFinite(val) || val <= 0 ? null : Math.min(val, 6);
				}
			}
		}

		// Preserve statusIds
		const currentLimits = this.system.limits || [];
		if (Array.isArray(limitData)) {
			for (let i = 0; i < limitData.length; i++) {
				if (
					limitData[i].statusIds === undefined &&
					currentLimits[i]?.statusIds
				) {
					limitData[i].statusIds = currentLimits[i].statusIds;
				}
			}
		}

		await super._processSubmitData(event, form, formData);

		Hooks.callAll("litmStoryTagsUpdated");
	}

	// Prevent dropping non-threat items
	async _onDropItem(event, data) {
		const item = await CONFIG.Item.documentClass.fromDropData(data);
		if (item.type !== "threat") return;

		if (this.items.get(item.id)) return this._onSortItem(event, item);

		return super._onDropItem(event, data);
	}

	async #handleClick(event) {
		event.preventDefault();

		const button = event.currentTarget;
		const action = button.dataset.click;

		switch (action) {
			case "add-limit":
				await this.#commitActiveEditing();
				await this.#addLimit(event);
				break;
			case "add-threat":
				await this.#commitActiveEditing();
				await this.#addThreat();
				break;
			case "add-tag":
				await this.#commitActiveEditing();
				await this.#addTag(event);
				break;
			case "add-special":
				await this.#commitActiveEditing();
				await this.#addSpecial();
				break;
			case "add-secret":
				await this.#commitActiveEditing();
				await this.#addSecret();
				break;
			case "add-status":
				await this.#commitActiveEditing();
				await this.#addStatus(event);
				break;
			case "add-might":
				await this.#commitActiveEditing();
				await this.#addMight(event);
				break;
			case "move-to-story":
				await this.#moveToStory();
				break;
			case "increase":
				this.#increase(button);
				break;
			case "select":
				this.#selectTag(event);
				break;
		}
	}

	async #selectTag(event) {
		if (!game.user.isGM) return;
		if (this.#editingTagId) return;
		if (event.detail > 1) return;
		const t = event.currentTarget;
		const id = t.dataset.id || t.closest("[data-id]")?.dataset.id;
		if (!id) return;
		const tagName =
			t.textContent.trim() ||
			t.querySelector(".litm--tm-tag-name")?.textContent?.trim() ||
			"";
		const result = await RollTargetPopup.show(event, {
			tagId: id,
			tagName,
			ref: this.document.uuid,
		});
		if (!result) return;
		const { action, actorId, state } = result;
		if (action === "remove") {
			game.litm?.removeTagFromRoll?.(actorId, this.document.uuid, id);
		} else {
			game.litm?.addTagToRoll?.(actorId, this.document.uuid, id, state);
		}
		this.render();
	}

	#handleContext(event) {
		event.preventDefault();

		const button = event.currentTarget;
		const action = button.dataset.context;

		switch (action) {
			case "decrease":
				this.#decrease(button);
				break;
		}
	}

	async #commitActiveEditing() {
		const active = this.element?.ownerDocument.activeElement;
		if (active && this.element?.contains(active)) {
			if (active.matches(".litm--limit-consequence-edit"))
				await this.#onConsequenceEditBlur({ currentTarget: active });
			else if (active.matches(".litm--special-name"))
				await this.#onSpecialFieldBlur({ currentTarget: active });
			else if (active.matches(".litm--special-description-edit"))
				await this.#onSpecialDescriptionBlur({ currentTarget: active });
			else if (active.matches(".litm--secret-name"))
				await this.#onSecretFieldBlur({ currentTarget: active });
			else if (active.matches(".litm--secret-description-edit"))
				await this.#onSecretDescriptionBlur({ currentTarget: active });
			else if (active.matches(".litm--tm-tag-name[contenteditable]"))
				await this.#onNameBlur({ currentTarget: active });
			else active.blur();
		}
		await this.submit();
	}

	#focusNewEntity(selector, retries = 0) {
		const element = this.element?.querySelector(selector);
		if (!element) {
			if (retries > 0)
				requestAnimationFrame(() =>
					this.#focusNewEntity(selector, retries - 1),
				);
			return;
		}
		const content = this.element.querySelector(".window-content");
		const wrapper = this.element.querySelector(".litm--challenge-wrapper");
		const scrollPositions = { ...this.#scrollPositions };
		element.focus({ preventScroll: true });
		if (element instanceof element.ownerDocument.defaultView.HTMLInputElement) {
			if (this.#selectEditingText) element.select();
			else
				element.setSelectionRange(element.value.length, element.value.length);
		} else {
			const doc = getOwningDocument(element);
			const range = doc.createRange();
			range.selectNodeContents(element);
			const selection = doc.defaultView.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		}
		requestAnimationFrame(() => {
			this.#scrollPositions = scrollPositions;
			this.#restoreScrollPosition(content, "content");
			this.#restoreScrollPosition(wrapper, "wrapper");
			if (element.ownerDocument.activeElement === element) {
				this.#pendingFocusSelector = null;
				this.#selectEditingText = false;
			} else if (retries > 0) {
				this.#focusNewEntity(selector, retries - 1);
			}
		});
	}

	#openContextMenu(event) {
		event.preventDefault();
		event.stopPropagation();
		this.#closeContextMenu();

		const trigger = event.currentTarget;
		const doc = getOwningDocument(trigger);
		const win = getOwningWindow(trigger);
		const kind = trigger.dataset.contextEntity;
		const id = trigger.dataset.id;
		this.#contextMenuAnchor = { kind, id, x: event.clientX, y: event.clientY };
		const menu = doc.createElement("div");
		menu.className = "litm--character-tag-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;

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
				const buttonClass = className.includes("status")
					? "litm--tm-popup-status-btn"
					: className.includes("might")
						? "litm--tm-popup-might-btn"
						: "litm--tm-popup-limit-btn";
				button.className = `${buttonClass} ${value.className || ""}`.trim();
				button.classList.toggle("active", !!value.active);
				button.classList.toggle("filled", !!value.filled);
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

		let hasAdditionalOptions = false;
		if (kind === "limit") {
			const limit = this.system.limits?.[Number(id)];
			addOption(t("Litm.ui.edit"), "fa-solid fa-pen", async () => {
				this.#editingLimitIndex = Number(id);
				this.#selectEditingText = false;
				this.#pendingFocusSelector = `#limit-${id}-name`;
				await this.render({ force: true });
				this.#focusNewEntity(`#limit-${id}-name`, 3);
			});
			addOption(
				t(
					limit?.isPrivate
						? "Litm.ui.reveal-secret-tag"
						: "Litm.ui.make-secret",
				),
				"fa-solid fa-mask",
				() =>
					this.#updateLimit(id, (current) => ({
						...current,
						isPrivate: !current.isPrivate,
					})),
			);
			addValueGroup(
				"litm--tm-popup-limits",
				[null, 1, 2, 3, 4, 5, 6].map((value) => ({
					value,
					label: value?.toString() || "~",
					active: value === (limit?.value ?? null),
				})),
				(value) => this.#updateLimit(id, (current) => ({ ...current, value })),
			);
			addOption(
				t(
					limit?.consequence
						? "Litm.ui.remove-consequence"
						: "Litm.ui.add-consequence",
				),
				limit?.consequence
					? "fa-solid fa-arrow-rotate-left"
					: "fa-solid fa-arrow-right",
				() =>
					limit?.consequence
						? this.#removeConsequence(id)
						: this.#addConsequence(id),
			);
			hasAdditionalOptions = true;
		}
		if (["tag", "status", "might"].includes(kind)) {
			const effect = this.actor.effects.get(id);
			const flags = effect?.flags?.["litm-rn"] || {};
			if (!effect) return;
			addOption(t("Litm.ui.edit"), "fa-solid fa-pen", () =>
				this["edit-tag"](null, null, { id, ref: trigger.dataset.ref }),
			);
			addOption(
				t(
					flags.isPrivate ? "Litm.ui.reveal-secret-tag" : "Litm.ui.make-secret",
				),
				"fa-solid fa-mask",
				() => this["toggle-private"](null, null, { id }),
			);
			if (kind === "status") {
				addValueGroup(
					"litm--tm-popup-status",
					(flags.values || Array(6).fill(null)).map((filled, index) => ({
						value: index,
						label: "",
						tooltip: String(index + 1),
						filled: !!filled,
					})),
					(value) => this["toggle-status-value"](null, null, { id, value }),
				);
				addOption(
					t("Litm.ui.decrease-status"),
					"fa-solid fa-arrow-left",
					() => this["decrease-status"](null, null, { id }),
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
							label: "",
							className: "litm--might-origin",
							active: flags.value === 0,
							tooltip: t("Litm.tags.origin-0"),
						},
						{
							value: 3,
							label: "",
							className: "litm--might-adventure",
							active: flags.value === 3,
							tooltip: t("Litm.tags.adventure-3"),
						},
						{
							value: 6,
							label: "",
							className: "litm--might-greatness",
							active: flags.value === 6,
							tooltip: t("Litm.tags.greatness-6"),
						},
					],
					(value) => this["set-might-value"](null, null, { id, value }),
				);
			}
			if (
				kind === "tag" &&
				!game.user.isGM &&
				game.user.character &&
				!flags.isCrispy
			) {
				const actorId = game.user.character.id;
				const ref = this.document.uuid;
				const isBurned =
					game.litm?.rollSelection?.get(actorId)?.get(ref)?.get(id) ===
					"burned";
				if (!isBurned)
					addOption(t("Litm.ui.burn-in-roll"), "fa-solid fa-fire", () =>
						game.litm?.addTagToRoll?.(actorId, ref, id, "burned"),
					);
			}
			if (kind === "tag")
				addOption(
					t(
						flags.isCrispy
							? "Litm.ui.single-use-active"
							: "Litm.ui.make-single-use",
					),
					"fa-solid fa-hourglass-half",
					() => this["toggle-crispy"](null, null, { id }),
				);
			hasAdditionalOptions = true;
		}
		if (kind === "threat") {
			addOption(t("Litm.ui.edit-threat"), "fa-solid fa-pen", () =>
				this.#openItemSheetById(id),
			);
			hasAdditionalOptions = true;
		}

		addOption(
			t("Litm.ui.remove"),
			"fa-solid fa-trash",
			() => this.#removeContextEntity(kind, id),
			hasAdditionalOptions,
		);

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
			...(this.element?.querySelectorAll("[data-context-entity]") || []),
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

	async #removeContextEntity(kind, id) {
		switch (kind) {
			case "limit":
				return this.#removeLimit(id);
			case "special":
				return this.#removeSpecial(id);
			case "secret":
				return this.#removeSecret(id);
			case "threat":
				return this.#removeThreat(id);
			case "tag":
			case "status":
			case "might":
				return this.#removeEffect(id);
		}
	}

	async #updateLimit(id, updater) {
		const index = Number(id);
		const limits = foundry.utils.deepClone(this.system.limits || []);
		if (!Number.isInteger(index) || !limits[index]) return;
		limits[index] = updater(limits[index]);
		await this.actor.update({ "system.limits": limits });
	}

	async #addLimit(event) {
		const limits = foundry.utils.deepClone(this.system.limits);
		const index = limits.length;
		limits.push({
			name: t("Litm.ui.new-limit"),
			value: 6,
			consequence: "",
			isPrivate: createPrivate(event),
			statusIds: [],
		});

		this.#editingLimitIndex = index;
		this.#selectEditingText = true;
		this.#pendingFocusSelector = `#limit-${index}-name`;
		await this.actor.update({ "system.limits": limits });
		await this.render({ force: true });
		this.#focusNewEntity(`#limit-${index}-name`, 3);

		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #addConsequence(id) {
		const index = Number(id);
		const limits = foundry.utils.deepClone(this.system.limits);
		if (!limits[index] || limits[index].consequence) return;

		limits[index].consequence = t("Litm.ui.name-limit-consequence");

		await this.actor.update({ "system.limits": limits });

		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #removeConsequence(id) {
		const index = Number(id);
		const limits = foundry.utils.deepClone(this.system.limits);
		if (!limits[index]) return;

		limits[index].consequence = "";
		await this.actor.update({ "system.limits": limits });
		Hooks.callAll("litmStoryTagsUpdated");
	}

	#onConsequenceDisplayClick(event) {
		const display = event.currentTarget;
		const wrapper = display.closest(".litm--limit-consequence-wrapper");
		const editField = wrapper.querySelector(".litm--limit-consequence-edit");

		display.style.display = "none";
		editField.style.display = "";
		editField.focus();

		// Place cursor at end
		const range = document.createRange();
		const sel = window.getSelection();
		if (editField.childNodes.length > 0) {
			range.selectNodeContents(editField);
			range.collapse(false);
		} else {
			range.setStart(editField, 0);
			range.collapse(true);
		}
		sel.removeAllRanges();
		sel.addRange(range);
	}

	async #onConsequenceEditBlur(event) {
		const editField = event.currentTarget;
		const index = Number(editField.dataset.limitIndex);
		const value = editField.textContent.trim();
		const wrapper = editField.closest(".litm--limit-consequence-wrapper");
		const display = wrapper.querySelector(".litm--limit-consequence-display");

		const limits = foundry.utils.deepClone(this.system.limits || []);
		if (!limits[index]) return;

		if (limits[index].consequence !== value) {
			limits[index].consequence = value;
			await this.actor.update({ "system.limits": limits });

			Hooks.callAll("litmStoryTagsUpdated");
			return;
		}

		editField.style.display = "none";
		display.style.display = "";
	}

	async #addThreat() {
		const threats = await this.actor.createEmbeddedDocuments("Item", [
			{ name: t("Litm.ui.new-threat"), type: "threat" },
		]);
		threats[0].sheet.focusNameOnRender?.();
		threats[0].sheet.render({ force: true });
	}

	async #addSpecial() {
		const specials = foundry.utils.deepClone(this.system.specials || []);
		const id = foundry.utils.randomID();
		specials.push({
			id,
			name: t("Litm.ui.new-special"),
			description: t("Litm.ui.new-special-description"),
		});
		this.#pendingFocusSelector = `.litm--special-name[data-special-id="${id}"]`;
		await this.actor.update({ "system.specials": specials });
		queueMicrotask(() =>
			this.#focusNewEntity(`.litm--special-name[data-special-id="${id}"]`),
		);
	}

	async #addSecret() {
		const secrets = foundry.utils.deepClone(this.system.secrets || []);
		const index = secrets.length;
		secrets.push({
			name: t("Litm.ui.new-secret"),
			description: t("Litm.ui.new-secret-description"),
			isRevealed: false,
		});
		this.#pendingFocusSelector = `.litm--secret-name[data-secret-index="${index}"]`;
		await this.actor.update({ "system.secrets": secrets });
		queueMicrotask(() =>
			this.#focusNewEntity(`.litm--secret-name[data-secret-index="${index}"]`),
		);
	}

	async #removeLimit(id) {
		const index = Number(id);
		const limits = foundry.utils.deepClone(this.system.limits || []);

		limits.splice(index, 1);
		await this.actor.update({ "system.limits": limits });

		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #removeSpecial(id) {
		if (!(await confirmDelete("Litm.other.special"))) return;
		const specials = (this.system.specials || []).filter((s) => s.id !== id);
		await this.actor.update({ "system.specials": specials });
	}

	async #removeSecret(id) {
		if (!(await confirmDelete("Litm.other.secret"))) return;
		const index = Number(id);
		const secrets = foundry.utils.deepClone(this.system.secrets || []);

		secrets.splice(index, 1);
		await this.actor.update({ "system.secrets": secrets });
	}

	async #removeThreat(id) {
		const item = this.items.get(id);
		if (!item || !(await confirmDelete("TYPES.Item.threat"))) return;
		await item?.delete();
	}

	async #removeEffect(id) {
		const effect = this.actor.effects.get(id);
		if (!effect) return;

		game.litm?.removeTagFromAllRolls?.(id);
		game.litm?.gmRemoveTagFromAllRolls?.(id);

		await effect.delete();

		// Clean up limit statusIds
		const limits = foundry.utils.deepClone(this.system.limits || []);
		let needsCleanup = false;
		for (const limit of limits) {
			if (limit.statusIds?.includes(id)) {
				limit.statusIds = limit.statusIds.filter((sid) => sid !== id);
				needsCleanup = true;
			}
		}
		if (needsCleanup) {
			await this.actor.update({ "system.limits": limits });
		}

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

	#openItemSheetById(id) {
		const item = this.items.get(id);
		item?.sheet.render({ force: true });
	}

	async #onSpecialFieldBlur(event) {
		const el = event.currentTarget;
		const id = el.dataset.specialId;
		const field = el.dataset.specialField; // "name" or "description"
		const value = normalizeSpecialText(el.innerText ?? el.textContent);
		el.textContent = value;

		const specials = foundry.utils.deepClone(this.system.specials || []);
		const special = specials.find((s) => s.id === id);
		if (!special) return;

		if (special[field] === value) return;

		special[field] = value;
		await this.actor.update({ "system.specials": specials });
	}

	#onSpecialDescriptionClick(event) {
		const display = event.currentTarget;
		const id = display.dataset.specialId;
		const wrapper = display.closest(".litm--special-description-wrapper");
		const editField = wrapper.querySelector(".litm--special-description-edit");

		display.style.display = "none";
		editField.style.display = "";
		editField.focus();

		// Place cursor at end
		const range = document.createRange();
		const sel = window.getSelection();
		if (editField.childNodes.length > 0) {
			range.selectNodeContents(editField);
			range.collapse(false);
		} else {
			range.setStart(editField, 0);
			range.collapse(true);
		}
		sel.removeAllRanges();
		sel.addRange(range);
	}

	async #onSpecialDescriptionBlur(event) {
		const editField = event.currentTarget;
		const id = editField.dataset.specialId;
		const value = normalizeSpecialText(
			editField.innerText ?? editField.textContent,
		);
		editField.textContent = value;
		const wrapper = editField.closest(".litm--special-description-wrapper");
		const display = wrapper.querySelector(".litm--special-description-display");

		const specials = foundry.utils.deepClone(this.system.specials || []);
		const special = specials.find((s) => s.id === id);
		if (!special) return;

		if (special.description !== value) {
			special.description = value;
			await this.actor.update({ "system.specials": specials });

			return;
		}

		editField.style.display = "none";
		display.style.display = "";
	}

	async #onSecretFieldBlur(event) {
		const el = event.currentTarget;
		const index = Number(el.dataset.secretIndex);
		const field = el.dataset.secretField;
		const value = el.textContent.trim();

		const secrets = foundry.utils.deepClone(this.system.secrets || []);
		if (!secrets[index]) return;

		if (secrets[index][field] === value) return;

		secrets[index][field] = value;
		await this.actor.update({ "system.secrets": secrets });
	}

	#onSecretDescriptionClick(event) {
		const display = event.currentTarget;
		const wrapper = display.closest(".litm--secret-description-wrapper");
		const editField = wrapper.querySelector(".litm--secret-description-edit");

		display.classList.add("hidden");
		editField.classList.remove("hidden");
		editField.focus();

		// Place cursor at end
		const range = document.createRange();
		const sel = window.getSelection();
		if (editField.childNodes.length > 0) {
			range.selectNodeContents(editField);
			range.collapse(false);
		} else {
			range.setStart(editField, 0);
			range.collapse(true);
		}
		sel.removeAllRanges();
		sel.addRange(range);
	}

	async #onSecretDescriptionBlur(event) {
		const editField = event.currentTarget;
		const index = Number(editField.dataset.secretIndex);
		const value = editField.textContent.trim();
		const wrapper = editField.closest(".litm--secret-description-wrapper");
		const display = wrapper.querySelector(".litm--secret-description-display");

		const secrets = foundry.utils.deepClone(this.system.secrets || []);
		if (!secrets[index]) return;

		if (secrets[index].description !== value) {
			secrets[index].description = value;
			await this.actor.update({ "system.secrets": secrets });
			return;
		}

		editField.classList.add("hidden");
		display.classList.remove("hidden");
	}

	async #onSecretRevealToggle(event) {
		event.preventDefault();
		event.stopPropagation();
		const index = Number(event.currentTarget.dataset.secretIndex);

		const secrets = foundry.utils.deepClone(this.system.secrets || []);
		if (!secrets[index]) return;

		secrets[index].isRevealed = !secrets[index].isRevealed;
		await this.actor.update({ "system.secrets": secrets });
	}

	// ── Tag popup action handlers ──

	async "edit-tag"(event, target, { id, ref }) {
		if (!id) return;
		this.#selectEditingText = false;
		this.#editingTagId = id;
		this.render();
	}

	// async "toggle-hindering"(event, target, { id, ref }) {
	// 	if (!id) return;
	// 	const effect = this.actor.effects.get(id);
	// 	if (!effect) return;
	// 	const flags = foundry.utils.deepClone(effect.flags["litm-rn"] || {});
	// 	flags.isHindering = !flags.isHindering;
	// 	await this.actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: id, flags: { ["litm-rn"]: flags } }]);
	// 	game.litm?.storyTags?.render();
	// 	dispatch({ app: "story-tags", type: "render" });
	// 	Hooks.callAll("litmStoryTagsUpdated");
	// }

	async "toggle-crispy"(event, target, { id, ref }) {
		if (!id) return;
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		const flags = foundry.utils.deepClone(effect.flags["litm-rn"] || {});
		flags.isCrispy = !flags.isCrispy;
		if (flags.isCrispy) game.litm?.normalizeBurnedTagSelections?.(id);
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, flags: { ["litm-rn"]: flags } },
		]);
		if (flags.isCrispy) game.litm?.normalizeBurnedTagSelections?.(id);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async "toggle-private"(event, target, { id, ref }) {
		if (!id) return;
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		const flags = foundry.utils.deepClone(effect.flags["litm-rn"] || {});
		flags.isPrivate = !flags.isPrivate;
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, flags: { ["litm-rn"]: flags } },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async "toggle-status-value"(event, target, { id, ref, value }) {
		if (!id || value == null) return;
		const idx = Number.parseInt(value, 10);
		if (!Number.isFinite(idx)) return;
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		const flags = foundry.utils.deepClone(effect.flags["litm-rn"] || {});
		const values = [...(flags.values || Array(6).fill(false))];
		values[idx] = !values[idx];
		flags.values = values;
		flags.value = values.findLast((v) => !!v) || 0;
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, flags: { ["litm-rn"]: flags } },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async "decrease-status"(event, target, { id }) {
		if (!id) return;
		const effect = this.actor.effects.get(id);
		if (!effect) return;
		const flags = foundry.utils.deepClone(effect.flags["litm-rn"] || {});
		const values = [...(flags.values || [])];
		const highest = values.findLastIndex((value) => !!value);
		if (highest <= 0) return this.#removeEffect(id);
		const shifted = new Array(Math.max(6, values.length)).fill(false);
		for (let index = 1; index < values.length; index += 1) {
			if (values[index]) shifted[index - 1] = index;
		}
		flags.values = shifted;
		flags.value = highest;
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, flags: { ["litm-rn"]: flags } },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async "set-might-value"(event, target, { id, ref, value }) {
		if (!id || value == null) return;
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, "flags.litm-rn.value": Number(value) },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async "remove-tag"(event, target, { id, ref }) {
		if (!id) return;
		await this.#removeEffect(id);
	}

	async "save-edit-tag"(event, target, { id, ref }) {
		if (!id) {
			this.#editingTagId = null;
			return;
		}
		const nameEl = this.element?.querySelector(
			`[data-tag-id="${id}"] .litm--tm-tag-name[contenteditable]`,
		);
		if (!nameEl) {
			this.#editingTagId = null;
			return;
		}
		const newName = nameEl.textContent.trim();
		if (!newName) {
			this.#editingTagId = null;
			return this.render();
		}
		this.#editingTagId = null;
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, name: newName },
		]);
		Hooks.callAll("litmStoryTagsUpdated");
		await this.render({ force: true });
	}

	// Name edit keyboard handling
	#onNameKeydown(event) {
		const nameEl = event.currentTarget;
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			nameEl.blur();
		} else if (event.key === "Escape") {
			this.#editingTagId = null;
			this.render();
		}
	}

	async #onNameBlur(event) {
		if (!this.#editingTagId) return;
		const nameEl = event.currentTarget;
		const id = nameEl.dataset.id;
		const ref = nameEl.dataset.ref;
		const newName = nameEl.textContent.trim();
		if (!newName) {
			this.#editingTagId = null;
			this.render();
			return;
		}
		try {
			await this["save-edit-tag"](null, null, { id, ref });
		} catch {
			this.#editingTagId = null;
			this.render();
		}
	}

	async #addTag(event) {
		const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-tag"),
				flags: {
					["litm-rn"]: {
						type: "tag",
						isScratched: false,
						isHindering: false,
						isPrivate: createPrivate(event),
					},
				},
			},
		]);
		this.#selectEditingText = true;
		this.#editingTagId = effect.id;
		this.#pendingFocusSelector = `[data-tag-id="${effect.id}"] .litm--tm-tag-name[contenteditable]`;
		await this.render({ force: true });
		this.#focusNewEntity(this.#pendingFocusSelector, 3);
	}

	async #addStatus(event) {
		const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-status"),
				flags: {
					["litm-rn"]: {
						type: "status",
						values: new Array(6).fill(false),
						value: 0,
						isScratched: false,
						isHindering: false,
						isPrivate: createPrivate(event),
					},
				},
			},
		]);
		this.#selectEditingText = true;
		this.#editingTagId = effect.id;
		this.#pendingFocusSelector = `[data-tag-id="${effect.id}"] .litm--tm-tag-name[contenteditable]`;
		await this.render({ force: true });
		this.#focusNewEntity(this.#pendingFocusSelector, 3);
	}

	async #addMight(event) {
		const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-might"),
				flags: {
					["litm-rn"]: {
						type: "might",
						values: [0, 3, 6],
						value: 3,
						isScratched: false,
						isHindering: false,
						isPrivate: createPrivate(event),
					},
				},
			},
		]);
		this.#selectEditingText = true;
		this.#editingTagId = effect.id;
		this.#pendingFocusSelector = `[data-tag-id="${effect.id}"] .litm--tm-tag-name[contenteditable]`;
		await this.render({ force: true });
		this.#focusNewEntity(this.#pendingFocusSelector, 3);
	}

	async #moveToStory() {
		const ref = this.#storyRef;
		const config = game.settings.get("litm-rn", "storytags") || {
			actors: [],
			tags: [],
		};
		const actors = config.actors || [];
		const refs = this.#storyRefs;
		const updatedActors = this.#isStoryActor(actors)
			? actors.filter((actorRef) => !refs.has(actorRef))
			: [...actors, ref];

		await game.settings.set("litm-rn", "storytags", {
			...config,
			actors: updatedActors,
		});
		Hooks.callAll("litmStoryTagsUpdated");
		await this.render({ force: true });
	}

	#syncStoryActorButton = () => {
		const button = this.element?.querySelector('[data-click="move-to-story"]');
		if (!button) return;
		const config = game.settings.get("litm-rn", "storytags") || { actors: [] };
		const active = this.#isStoryActor(config.actors);
		const label = t(
			active ? "Litm.ui.remove-from-story" : "Litm.ui.move-to-story",
		);
		button.classList.toggle("active", active);
		button.setAttribute("aria-pressed", String(active));
		button.setAttribute("aria-label", label);
		button.dataset.tooltip = label;
		const icon = button.querySelector("i");
		icon?.classList.toggle("fas", active);
		icon?.classList.toggle("far", !active);
	};

	#onSpecialDragStart(event) {
		const el = event.currentTarget;
		const specialId = el.dataset.dragSpecial;
		const containerPath = el.dataset.dragSpecialPath;
		if (!specialId || !containerPath) return;

		const specials = foundry.utils.deepClone(
			foundry.utils.getProperty(this.actor.toObject(), containerPath) || [],
		);
		const special = specials.find((s) => s.id === specialId);
		if (!special) return;

		const dragData = game.litm.specials.makeSpecialDragData(
			special,
			this.actor.uuid,
			containerPath,
		);
		event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		event.dataTransfer.effectAllowed = "copyMove";
	}

	#onThreatDragStart(event) {
		const item = this.items.get(event.currentTarget.dataset.dragThreat);
		if (!item) return;
		event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
		event.dataTransfer.effectAllowed = "copyMove";
	}

	#onSortDragStart(event) {
		const handle = event.currentTarget;
		let data;
		if (handle.dataset.dragLimit !== undefined) {
			const index = Number(handle.dataset.dragLimit);
			const limit = this.system.limits?.[index];
			if (!limit) return;
			data = {
				id: `_limit_${index}`,
				name: limit.name,
				type: "limit",
				value: limit.value,
				isPrivate: limit.isPrivate,
				sourceActorUuid: this.actor.uuid,
				sourceKind: "limit",
				sourceId: String(index),
			};
		} else {
			const effect = this.actor.effects.get(handle.dataset.dragEffect);
			if (!effect) return;
			const flags = effect.flags?.["litm-rn"] || {};
			data = {
				id: effect.id,
				name: effect.name,
				type: flags.type || "tag",
				values: flags.values,
				value: flags.value,
				isScratched: flags.isScratched,
				isHindering: flags.isHindering,
				isPrivate: flags.isPrivate,
				sourceActorUuid: this.actor.uuid,
				sourceKind: "effect",
				sourceId: effect.id,
			};
		}
		event.dataTransfer.setData("text/plain", JSON.stringify(data));
		event.dataTransfer.effectAllowed = "copyMove";
		this.#sortDragData = data;
	}

	#onSortDragOver(event) {
		const targetHandle = this.#getSortTargetHandle(event.target);
		const data = this.#sortDragData;
		const sameChallenge = data?.sourceActorUuid === this.actor.uuid;
		const sameKind =
			(data?.sourceKind === "limit" &&
				targetHandle?.dataset.dragLimit !== undefined) ||
			(data?.sourceKind === "effect" && targetHandle?.dataset.dragEffect);
		const sourceType =
			data?.sourceKind === "effect"
				? this.actor.effects.get(data.sourceId)?.flags?.["litm-rn"]?.type
				: null;
		const targetType = targetHandle?.dataset.dragEffect
			? this.actor.effects.get(targetHandle.dataset.dragEffect)?.flags?.[
					"litm-rn"
				]?.type
			: null;
		const sameType = data?.sourceKind !== "effect" || sourceType === targetType;
		if (!targetHandle || !sameChallenge || !sameKind || !sameType) {
			this.#clearSortIndicator();
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		const rect = targetHandle.getBoundingClientRect();
		const item = targetHandle.closest(
			".litm--challenge-limit, .litm--tag-item",
		);
		const position =
			event.clientY > rect.top + rect.height / 2 ? "after" : "before";
		if (!item?.classList.contains(`litm--sort-${position}`)) {
			this.#clearSortIndicator();
			item?.classList.add(`litm--sort-${position}`);
		}
	}

	#clearSortIndicator() {
		this.element
			?.querySelectorAll(".litm--sort-before, .litm--sort-after")
			.forEach((el) => {
				el.classList.remove("litm--sort-before", "litm--sort-after");
			});
	}

	async #onSortDrop(event, data) {
		const targetHandle = this.#getSortTargetHandle(event.target);
		if (!targetHandle) return;
		this.#clearSortIndicator();
		event.preventDefault();
		event.stopPropagation();
		const rect = targetHandle.getBoundingClientRect();
		const after = event.clientY > rect.top + rect.height / 2;

		if (
			data.sourceKind === "limit" &&
			targetHandle.dataset.dragLimit !== undefined
		) {
			const sourceIndex = Number(data.sourceId);
			let targetIndex = Number(targetHandle.dataset.dragLimit);
			if (
				!Number.isInteger(sourceIndex) ||
				!Number.isInteger(targetIndex) ||
				sourceIndex === targetIndex
			)
				return;
			const limits = foundry.utils.deepClone(this.system.limits || []);
			const [limit] = limits.splice(sourceIndex, 1);
			if (!limit) return;
			if (sourceIndex < targetIndex) targetIndex -= 1;
			limits.splice(targetIndex + (after ? 1 : 0), 0, limit);
			await this.actor.update({ "system.limits": limits });
			return;
		}

		if (data.sourceKind === "effect" && targetHandle.dataset.dragEffect) {
			const source = this.actor.effects.get(data.sourceId);
			const target = this.actor.effects.get(targetHandle.dataset.dragEffect);
			const sourceType = source?.flags?.["litm-rn"]?.type;
			if (
				!source ||
				!target ||
				sourceType !== target.flags?.["litm-rn"]?.type ||
				source.id === target.id
			)
				return;
			const effects = this.actor.effects
				.filter((effect) => effect.flags?.["litm-rn"]?.type === sourceType)
				.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
			const sourceIndex = effects.findIndex(
				(effect) => effect.id === source.id,
			);
			let targetIndex = effects.findIndex((effect) => effect.id === target.id);
			const [moved] = effects.splice(sourceIndex, 1);
			if (sourceIndex < targetIndex) targetIndex -= 1;
			effects.splice(targetIndex + (after ? 1 : 0), 0, moved);
			await this.actor.updateEmbeddedDocuments(
				"ActiveEffect",
				effects.map((effect, index) => ({
					_id: effect.id,
					sort: (index + 1) * 1000,
				})),
			);
		}
	}

	#getSortTargetHandle(target) {
		return (
			target.closest("[data-drag-limit], [data-drag-effect]") ??
			target
				.closest("[data-context-entity='limit']")
				?.querySelector("[data-drag-limit]") ??
			target.closest("[data-tag-id]")?.querySelector("[data-drag-effect]")
		);
	}

	async #onDropSpecial(event, data) {
		const containerPath = "system.specials";
		if (
			data.source?.uuid === this.actor.uuid &&
			data.source.containerPath === containerPath
		)
			return;
		await game.litm.specials.addSpecialToContainer(
			this.actor,
			containerPath,
			data.special,
		);
		this.render();
	}

	async _onDrop(dragEvent) {
		this.#sortDragData = null;
		this.#clearSortIndicator();
		// Handle specials via shared utility
		const specialData = game.litm.specials.readSpecialDragData(dragEvent);
		if (specialData) return this.#onDropSpecial(dragEvent, specialData);

		// Fall back to raw parsing for tags/statuses
		const dragData = dragEvent.dataTransfer.getData("text/plain");
		if (!dragData) return super._onDrop(dragEvent);
		let data;
		try {
			data = JSON.parse(dragData);
		} catch {
			return super._onDrop(dragEvent);
		}
		if (data.sourceActorUuid === this.actor.uuid && data.sourceKind) {
			const target = this.#getSortTargetHandle(dragEvent.target);
			if (target) return this.#onSortDrop(dragEvent, data);
			return;
		}

		// Handle dropping tags and statuses
		if (!["tag", "status", "might", "limit"].includes(data.type))
			return super._onDrop(dragEvent);
		if (data.type === "limit") {
			const limits = foundry.utils.deepClone(this.system.limits || []);
			limits.push({
				name: data.name,
				value: data.value ?? null,
				consequence: "",
				isPrivate: createPrivate(dragEvent),
				statusIds: [],
			});
			await this.actor.update({ "system.limits": limits });
			return;
		}

		const flagData = {
			type: data.type,
			isScratched: data.isScratched,
			isHindering: data.isHindering || false,
			isPrivate: createPrivate(dragEvent),
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

		const effectData = {
			name: data.name,
			flags: {
				["litm-rn"]: flagData,
			},
		};
		if (data.type === "status")
			await addOrStackActorStatus(this.actor, effectData);
		else await this.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
	}

	async close(options) {
		if (this.element) {
			this.element.style.display = "none";
		}
		return super.close(options);
	}
}
