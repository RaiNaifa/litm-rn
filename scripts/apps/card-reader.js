import { ThemebookSheet } from "../item/themebook/themebook-sheet.js";
import { ThemeAdvancement } from "../system/theme-advancement.js";
import { ThemeSources } from "../system/theme-sources.js";
import { confirmDelete, getFellowshipActors, localize as t } from "../utils.js";
import { PromiseFulfillmentApp } from "./promise-fulfillment.js";
import { ThemeAdvancementApp } from "./theme-advancement.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid, fromUuidSync } = foundry.utils;
const { ApplicationV2 } = foundry.applications.api;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

class CardReader extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actorUuid, options) {
		super(options);
		this.actor = fromUuidSync(actorUuid);
		// Re-render when the actor is updated from outside the card
		this.#updateHookId = Hooks.on("updateActor", (actor, changes) => {
			if (actor.uuid !== this.actor.uuid) return;
			if (!this.constructor.RELEVANT_SYSTEM_FIELDS?.length) return;
			const hit = this.constructor.RELEVANT_SYSTEM_FIELDS.some((r) => {
				// Flat format: { "system.promise": 5 }
				if (changes[`system.${r}`] !== undefined) return true;
				// Nested format: { system: { promise: 5 } }
				if (changes.system && changes.system[r] !== undefined) return true;
				return false;
			});
			if (hit) this.render();
		});
	}

	async close(options) {
		if (this.#updateHookId) {
			Hooks.off("updateActor", this.#updateHookId);
			this.#updateHookId = null;
		}
		this.#themeObserver?.disconnect();
		this.#themeObserver = null;
		if (this.element) {
			this.element.style.display = "none";
		}
		return super.close(options);
	}

	/** Native change handler: bypass AppV2 form event infrastructure */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#watchActorTheme();
		this.element.addEventListener("change", this.#onFormChange);
	}

	#watchActorTheme() {
		const source = this.actor.sheet?.element;
		if (!source) return;

		this.#applyTheme(source);
		if (this.#themeSource === source) return;

		this.#themeObserver?.disconnect();
		this.#themeSource = source;
		this.#themeObserver = new MutationObserver(() => this.#applyTheme(source));
		this.#themeObserver.observe(source, {
			attributes: true,
			attributeFilter: ["class"],
		});
	}

	#applyTheme(source) {
		const theme = source.classList.contains("theme-dark")
			? "theme-dark"
			: source.classList.contains("theme-light")
				? "theme-light"
				: null;
		this.element.classList.toggle("themed", Boolean(theme));
		this.element.classList.toggle("theme-dark", theme === "theme-dark");
		this.element.classList.toggle("theme-light", theme === "theme-light");
	}

	#onFormChange = (event) => {
		const el = event.target;
		if (!el?.name) return;
		this._processSubmitData(event, el.form ?? this.element, null, {
			_changedName: el.name,
		});
	};

	#updateHookId = null;
	#themeObserver = null;
	#themeSource = null;
}

export class HeroCard extends CardReader {
	static RELEVANT_SYSTEM_FIELDS = [
		"fellowshipId",
		"promise",
		"availableFulfillments",
		"fulfillment",
		"relationships",
		"heroTitle",
		"shortDescription",
		"bio",
		"quintessences",
	];

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--hero-card"],
		tag: "form",
		position: { width: 920, height: 600 },
		window: { resizable: true },
		form: { submitOnChange: true },
	};

	get title() {
		return this.actor?.name ?? game.i18n.localize("Litm.other.hero");
	}

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/hero-card.html" },
	};

	async _prepareContext(options) {
		const ctx = await super._prepareContext(options);
		const sys = this.actor.system;
		const fellowshipId = sys.fellowshipId;

		// Resolve fellowName from fellowship members (like CharacterSheet does)
		const fellowMembers = getFellowshipActors(fellowshipId).filter(
			(actor) => actor.id !== this.actor.id,
		);
		const storedRels = sys.relationships ?? [];
		const relMap = {};
		for (const r of storedRels) relMap[r.fellowActorId] = r;
		const relationships = fellowMembers.map((m) => {
			const existing = relMap[m.id];
			return {
				id: existing?.id ?? foundry.utils.randomID(),
				fellowActorId: m.id,
				fellowName: m.name,
				name: existing?.name ?? t("Litm.tags.relationship"),
				isScratched: existing
					? existing.isScratched === true || existing.isScratched === "true"
					: true,
				isPrivate: existing?.isPrivate ?? false,
			};
		});

		ctx.hero = {
			name: sys.heroTitle || t("Litm.other.hero"),
			promise: sys.promise ?? 0,
			availableFulfillments: sys.availableFulfillments ?? 0,
			fulfillment: sys.fulfillment?.length
				? sys.fulfillment
				: CONFIG.litm.fulfillment,
			relationships,
			shortDescription: sys.shortDescription ?? "",
			bio: sys.bio ?? "",
			enrichedBio: await TextEditor.enrichHTML(sys.bio || ""),
		};
		this.#relationships = relationships;
		ctx.quintessences = await Promise.all(
			(sys.quintessences ?? []).map(async (special) => ({
				...special,
				isEditing: this.#editingSpecials.has(special.id),
				enrichedDescription: await TextEditor.enrichHTML(
					special.description || "",
				),
			})),
		);
		ctx.actor = this.actor;
		ctx.portrait = this.actor.img;
		ctx.noFellowship = !fellowshipId;
		return ctx;
	}

	async _processSubmitData(event, form, formData, options = {}) {
		const changed = options._changedName;
		const updates = {};
		// Array fields must be saved as full replacement (flat paths with numeric indices break arrays)
		const arrayUpdates = {};

		for (const el of form.elements) {
			if (!el.name || !el.name.startsWith("system.")) continue;
			if (changed && el.name !== changed) continue;
			if (el.name === "system.bio") continue; // prose-mirror: handled separately
			if (el.type === "hidden" && changed !== el.name) continue;
			const value =
				el.type === "checkbox"
					? el.checked
					: el.type === "number"
						? Number(el.value)
						: el.value;

			// Check for numeric index in path — indicates array element access
			// e.g. "system.relationships.0.isScratched" → parts: [system, relationships, 0, isScratched]
			const parts = el.name.split(".");
			const hasIdx = parts.some((p, i) => i >= 2 && /^\d+$/.test(p));
			if (hasIdx) {
				const field = parts[1];
				const source =
					field === "relationships"
						? this.#relationships
						: this.actor.system[field];
				const arr =
					arrayUpdates[`system.${field}`] ??
					foundry.utils.duplicate(source ?? []);
				foundry.utils.setProperty(arr, parts.slice(2).join("."), value);
				arrayUpdates[`system.${field}`] = arr;
			} else {
				updates[el.name] = value;
			}
		}

		// prose-mirror bio
		if (!changed || changed === "system.bio") {
			const fd =
				formData ?? new foundry.applications.ux.FormDataExtended(form).object;
			const bioVal = foundry.utils.getProperty(fd, "system.bio");
			if (bioVal !== undefined) updates["system.bio"] = bioVal;
		}

		const all = { ...updates, ...arrayUpdates };
		if (!Object.keys(all).length) return;
		await this.actor.update(all, { validate: false });
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelectorAll("[data-click]")
			.forEach((el) => el.addEventListener("click", this.#onClick.bind(this)));
		this.element
			.querySelectorAll("[data-context]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#onContext.bind(this)),
			);
		this.element
			.querySelectorAll("[data-drag-special]")
			.forEach((el) =>
				el.addEventListener("dragstart", this.#onSpecialDragStart.bind(this)),
			);
		this.element.querySelectorAll("[data-input]").forEach((el) => {
			el.addEventListener("input", (event) => {
				const target = event.currentTarget;
				const input = this.element.querySelector(`#${target.dataset.input}`);
				if (input) input.value = target.textContent;
				target.classList.toggle("empty", !target.innerText.trim());
			});
			el.addEventListener("blur", (event) => {
				const target = event.currentTarget;
				const input = this.element.querySelector(`#${target.dataset.input}`);
				input?.dispatchEvent(new Event("change", { bubbles: true }));
			});
			el.classList.toggle("empty", !el.innerText.trim());
		});
		// Auto-resize textareas to fit content
		this.element.querySelectorAll("textarea").forEach((el) => {
			const autoResize = () => {
				el.style.height = "auto";
				el.style.height = `${el.scrollHeight}px`;
			};
			el.addEventListener("input", autoResize);
			autoResize();
		});

		if (this.#focusTarget) {
			const next = this.element.querySelector(
				`[data-input="${this.#focusTarget}"]`,
			);
			if (next) {
				const sel = window.getSelection();
				const range = document.createRange();
				range.selectNodeContents(next);
				sel.removeAllRanges();
				sel.addRange(range);
				next.focus();
			}
			this.#focusTarget = null;
		}
		if (this.#dropReady) return;
		this.#dropReady = true;
		this.element.addEventListener("drop", this.#onDrop.bind(this));
		this.element.addEventListener("dragover", (e) => e.preventDefault());
	}

	#dropReady = false;

	#focusTarget = null;

	#relationships = [];

	#editingSpecials = new Set();

	#onDragOver(e) {
		e.preventDefault();
	}

	async #onDrop(e) {
		const dragData = game.litm.specials.readSpecialDragData(e);
		if (!dragData) return;
		e.preventDefault();
		e.stopPropagation();
		await game.litm.specials.addSpecialToContainer(
			this.actor,
			"system.quintessences",
			dragData.special,
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	#onClick(event) {
		const btn = event.currentTarget;
		const action = btn.dataset.click;
		switch (action) {
			case "increase":
				this.#increase(btn.dataset.id);
				break;
			case "open-promise-fulfillment":
				event.stopPropagation();
				event.stopImmediatePropagation();
				new PromiseFulfillmentApp(this.actor.uuid).render({ force: true });
				break;
			case "add-special":
				this.#addSpecial();
				break;
			case "toggle-edit-special":
				this.#toggleEditSpecial(btn.dataset.id);
				break;
			case "remove-special":
				this.#removeSpecial(btn.dataset.id);
				break;
			case "send-special-to-chat":
				this.#sendSpecialToChat(btn.dataset.specialId);
				break;
			case "toggle-secret":
				this.#toggleRelationshipSecret(btn.dataset.id);
				break;
		}
	}

	#onContext(event) {
		const btn = event.currentTarget;
		switch (btn.dataset.context) {
			case "decrease":
				this.#decrease(btn.dataset.id);
				break;
		}
	}

	async #removeTag(btn) {
		const id = btn.dataset.id;
		const relationships = (this.actor.system.relationships ?? []).filter(
			(r) => r.id !== id,
		);
		await this.actor.update(
			{ "system.relationships": relationships },
			{ validate: false },
		);
		this.render();
	}

	#onSpecialDragStart(event) {
		const el = event.currentTarget;
		const special = (this.actor.system.quintessences ?? []).find(
			(item) => item.id === el.dataset.dragSpecial,
		);
		if (!special) return;
		const dragData = game.litm.specials.makeSpecialDragData(
			special,
			this.actor.uuid,
			"system.quintessences",
		);
		event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		event.dataTransfer.effectAllowed = "copyMove";
	}

	async #addSpecial() {
		const quintessences = foundry.utils.deepClone(
			this.actor.system.quintessences ?? [],
		);
		quintessences.push({
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-quintessence"),
			description: t("Litm.ui.name-quintessence-description"),
		});
		await this.actor.update(
			{ "system.quintessences": quintessences },
			{ validate: false },
		);
		this.render();
	}

	async #toggleRelationshipSecret(id) {
		const relationships = foundry.utils.duplicate(
			this.actor.system.relationships ?? [],
		);
		const relationship = relationships.find((item) => item.id === id);
		if (!relationship) return;
		relationship.isPrivate = !relationship.isPrivate;
		await this.actor.update(
			{ "system.relationships": relationships },
			{ validate: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #toggleEditSpecial(id) {
		if (this.#editingSpecials.has(id)) {
			const row = this.element.querySelector(`[data-special-id="${id}"]`);
			const quintessences = foundry.utils.deepClone(
				this.actor.system.quintessences ?? [],
			);
			const special = quintessences.find((item) => item.id === id);
			if (row && special) {
				special.name =
					row.querySelector("[data-input^='quint-name']")?.textContent.trim() ??
					special.name;
				special.description =
					row.querySelector("[data-input^='quint-desc']")?.textContent.trim() ??
					special.description;
				await this.actor.update(
					{ "system.quintessences": quintessences },
					{ validate: false },
				);
			}
			this.#editingSpecials.delete(id);
		} else {
			this.#editingSpecials.add(id);
		}
		this.render();
	}

	async #removeSpecial(id) {
		const quintessences = (this.actor.system.quintessences ?? []).filter(
			(item) => item.id !== id,
		);
		await this.actor.update(
			{ "system.quintessences": quintessences },
			{ validate: false },
		);
		this.render();
	}

	async #sendSpecialToChat(id) {
		const special = (this.actor.system.quintessences ?? []).find(
			(item) => item.id === id,
		);
		if (!special) return;
		const enriched = await TextEditor.enrichHTML(special.description || "");
		CONFIG.ChatMessage.documentClass.create({
			content: `<strong>${special.name}</strong>: ${enriched}`,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: this.actor,
			}),
		});
	}

	async #increase(field) {
		if (field === "system.promise") {
			await ThemeAdvancement.addPromises(this.actor, 1);
			this.render();
			return;
		}
		const val = foundry.utils.getProperty(this.actor, field) || 0;
		await this.actor.update({ [field]: val + 1 }, { validate: false });
		this.render();
	}

	async #decrease(field) {
		const val = foundry.utils.getProperty(this.actor, field) || 0;
		await this.actor.update(
			{ [field]: Math.max(0, val - 1) },
			{ validate: false },
		);
		this.render();
	}
}

export class ThemeCard extends CardReader {
	static RELEVANT_SYSTEM_FIELDS = ["themes"];

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--theme-card"],
		tag: "form",
		position: { width: 920, height: 600 },
		window: { resizable: true },
		form: { submitOnChange: true },
		actions: {
			configureProgression: ThemeCard.#onConfigureProgression,
			rebuildTheme: ThemeCard.#onRebuildTheme,
		},
	};

	get title() {
		return this.theme?.name ?? "Theme";
	}

	/** Add theme actions to Foundry's standard window-controls menu. */
	_getHeaderControls() {
		return [
			...super._getHeaderControls(),
			{
				action: "configureProgression",
				icon: "fa-solid fa-sliders",
				label: "Litm.advancement.configure-progression",
			},
			{
				action: "rebuildTheme",
				icon: "fa-solid fa-wand-magic-sparkles",
				label: "Litm.theme-builder.rebuild",
			},
		];
	}

	static #onRebuildTheme() {
		new game.litm.ThemeBuilder(this.actor.uuid, {
			themeIndex: this.themeIndex,
		}).render({ force: true });
	}

	static async #onConfigureProgression() {
		const theme = this.theme;
		if (!theme) return;
		const makeOptions = (maximum, selected) =>
			Array.from({ length: maximum }, (_, index) => {
				const value = index + 1;
				return `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`;
			}).join("");
		const currentTrackLength = Number(theme.improveTrackLength ?? 3);
		const currentAwardSize = Number(theme.improvementsPerTrack ?? 1);
		const result = await foundry.applications.api.DialogV2.wait({
			window: {
				title: game.i18n.localize("Litm.advancement.configure-progression"),
			},
			position: { width: 400 },
			classes: ["litm--progression-settings"],
			content: `<div class="standard-form">
				<div class="form-group">
					<label>${game.i18n.localize("Litm.advancement.experience-points")}</label>
					<div class="form-fields"><select name="trackLength">${makeOptions(6, currentTrackLength)}</select></div>
				</div>
				<div class="form-group">
					<label>${game.i18n.localize("Litm.advancement.improvements-per-track")}</label>
					<div class="form-fields"><select name="awardSize">${makeOptions(3, currentAwardSize)}</select></div>
				</div>
			</div>`,
			buttons: [
				{
					action: "cancel",
					label: game.i18n.localize("Litm.ui.cancel"),
					callback: () => null,
				},
				{
					action: "save",
					label: game.i18n.localize("Save"),
					icon: "fa-solid fa-floppy-disk",
					default: true,
					callback: (_event, _button, dialog) => ({
						trackLength: Number(
							dialog.element.querySelector('[name="trackLength"]')?.value,
						),
						awardSize: Number(
							dialog.element.querySelector('[name="awardSize"]')?.value,
						),
					}),
				},
			],
			rejectClose: false,
		});
		if (!result) return;
		const trackLength =
			Number.isInteger(result.trackLength) &&
			result.trackLength >= 1 &&
			result.trackLength <= 6
				? result.trackLength
				: 3;
		const awardSize =
			Number.isInteger(result.awardSize) &&
			result.awardSize >= 1 &&
			result.awardSize <= 3
				? result.awardSize
				: 1;
		await this.#updateTheme({
			improveTrackLength: trackLength,
			improvementsPerTrack: awardSize,
		});
		this.render();
	}

	get targetSpecialsPath() {
		return `system.themes.${this.themeIndex}.specials`;
	}

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/theme-card.html" },
	};

	constructor(actorUuid, options) {
		super(actorUuid, options);
		this.themeIndex = options.themeIndex;
		this.#themebookItemHooks = [
			Hooks.on("createItem", (item) => {
				if (item.type === "themebook") this.render();
			}),
			Hooks.on("updateItem", (item) => {
				if (item.type === "themebook") this.render();
			}),
			Hooks.on("deleteItem", (item) => {
				if (item.type === "themebook") this.render();
			}),
		];
	}

	#customThemebookEditing = false;

	#themebookItemHooks = [];

	#handleCloseThemebooks = (event) => {
		if (!this.element) {
			document.removeEventListener("click", this.#handleCloseThemebooks);
			return;
		}
		const picker = this.element.querySelector(
			".litm--tc-themebook-picker.open",
		);
		if (!picker || picker.contains(event.target)) return;
		picker.classList.remove("open");
		document.removeEventListener("click", this.#handleCloseThemebooks);
	};

	get theme() {
		return this.actor?.system?.themes?.[this.themeIndex];
	}

	/** @override */
	async close(options) {
		document.removeEventListener("click", this.#handleCloseThemebooks);
		for (const [index, hook] of [
			"createItem",
			"updateItem",
			"deleteItem",
		].entries()) {
			Hooks.off(hook, this.#themebookItemHooks[index]);
		}
		return super.close(options);
	}

	async _prepareContext(options) {
		const ctx = await super._prepareContext(options);
		const theme = this.theme;
		if (!theme) return ctx;
		const level = theme.level || "origin";
		const fallbackSrc = ["origin", "adventure", "greatness"].includes(level)
			? level
			: "origin";
		ctx.transitionSrc = `systems/litm-rn/assets/media/transition-left-${fallbackSrc}-dark.webp`;
		ctx.currentLevelLabel = game.i18n.localize(`Litm.levels.${fallbackSrc}`);
		const draftTags = theme.draftTags || [];
		ctx.theme = {
			...theme,
			improveTrackLength: Number(theme.improveTrackLength ?? 3),
			improvementsPerTrack: Number(theme.improvementsPerTrack ?? 1),
			enrichedNote: await TextEditor.enrichHTML(theme.note || ""),
			hasAnyDrafts: draftTags.length > 0,
			hasWeaknessDrafts: draftTags.some((d) => d.isWeakness),
			specials: await Promise.all(
				(theme.specials || []).map(async (s) => ({
					...s,
					isEditing: this.#editingSpecials.has(s.id),
					enrichedDescription: await TextEditor.enrichHTML(s.description || ""),
				})),
			),
		};
		ctx.themeIndex = this.themeIndex;
		ctx.themesrc =
			CONFIG.litm.theme_src[level] ||
			`systems/litm-rn/assets/media/${fallbackSrc}`;
		ctx.themeiconsrc =
			CONFIG.litm.themeicon_src[level] ||
			`systems/litm-rn/assets/media/icons/${fallbackSrc}`;
		ctx.themeLevels = Object.keys(CONFIG.litm.theme_levels).reduce((acc, k) => {
			acc[k] = game.i18n.localize(`Litm.levels.${k}`);
			return acc;
		}, {});
		const customThemebooks =
			CONFIG.litm.theme_levels[level] ??
			CONFIG.litm.theme_levels[fallbackSrc] ??
			[];
		ctx.customThemebookSuggestions = customThemebooks.map((key) =>
			game.i18n.localize(`Litm.themes.${key}`),
		);
		ctx.themebookSuggestionListId = `litm-themebook-suggestions-${this.actor.id}-${this.themeIndex}`;
		const themebooks = (await ThemeSources.getThemebooks())
			.map((item) => {
				const might = item.system.might || "variable";
				const iconBase = CONFIG.litm.themeicon_src[might];
				return {
					uuid: item.uuid,
					name: item.name,
					might,
					icon:
						might === "variable"
							? "systems/litm-rn/assets/media/icons/variable-color_litm_icn.svg"
							: `${iconBase}-color-light_litm_icn.svg`,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		ctx.themebookGroups = ["origin", "adventure", "greatness", "variable"]
			.map((might) => ({
				might,
				label: game.i18n.localize(`Litm.theme-content.might-${might}`),
				items: themebooks.filter((item) => item.might === might),
			}))
			.filter((group) => group.items.length);
		const linkedThemebook = theme.themebookUuid
			? await fromUuid(theme.themebookUuid)
			: null;
		ctx.theme.themebookDisplayName = linkedThemebook?.name || theme.themebook;
		ctx.themebookSourceMissing = !!theme.themebookUuid && !linkedThemebook;
		ctx.customThemebookEditing =
			this.#customThemebookEditing || theme.themebookCustom;
		ctx.hasLinkedThemebook = !!theme.themebookUuid && !theme.themebookCustom;
		return ctx;
	}

	async _processSubmitData(event, form, formData, options = {}) {
		const changed = options._changedName;
		const prefix = `system.themes.${this.themeIndex}.`;

		// Lazy FormDataExtended for prose-mirror
		let fd;
		const getFd = () => {
			fd ??= new foundry.applications.ux.FormDataExtended(form).object;
			return fd;
		};

		const theme = foundry.utils.duplicate(this.theme);

		if (!changed || changed.startsWith(prefix)) {
			for (const el of form.elements) {
				if (!el.name || !el.name.startsWith(prefix)) continue;
				if (changed && el.name !== changed) continue;
				const path = el.name.slice(prefix.length);
				if (!path || path === "note") continue;

				let value;
				if (el.type === "checkbox") {
					value = el.checked;
				} else if (el.type === "number") {
					value = Number(el.value);
				} else {
					value = el.value;
				}
				foundry.utils.setProperty(theme, path, value);
			}
		}

		if (changed === `${prefix}themebook`) {
			theme.themebookUuid = "";
			theme.themebookCustom = true;
			theme.creationMode = "custom";
			theme.themekitUuid = "";
			theme.themekitName = "";
		}

		// prose-mirror note
		if (!changed || changed === `${prefix}note`) {
			const noteVal = foundry.utils.getProperty(getFd(), `${prefix}note`);
			if (noteVal !== undefined) theme.note = noteVal;
		}

		await this.#updateTheme(theme);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	#onClick(event) {
		const btn = event.currentTarget;
		const action = btn.dataset.click;
		switch (action) {
			case "add-power-tag":
				this.#addTag("powerTag");
				break;
			case "add-weakness-tag":
				this.#addTag("weaknessTag");
				break;
			case "add-draft-tag":
				this.#addDraftTag();
				break;
			case "promote-draft":
				this.#promoteDraft(btn.dataset.id);
				break;
			case "toggle-draft-weakness":
				this.#toggleDraftWeakness(btn.dataset.id);
				break;
			case "add-special":
				this.#addSpecial();
				break;
			case "increase":
				this.#increase(btn.dataset.id);
				break;
			case "open-theme-advancement":
				event.preventDefault();
				event.stopImmediatePropagation();
				new ThemeAdvancementApp(this.actor.uuid, {
					themeIndex: this.themeIndex,
					mode: btn.dataset.mode,
				}).render({ force: true });
				break;
			case "toggle-themebooks":
				this.#toggleThemebooks(event);
				break;
			case "select-themebook":
				this.#selectThemebook(btn.dataset.uuid);
				break;
			case "select-custom-themebook":
				this.#selectCustomThemebook();
				break;
			case "view-themebook":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.#viewThemebook(btn.dataset.uuid);
				break;
			case "preview-themebook":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.#previewThemebook(btn.dataset.uuid);
				break;
			case "open-levels":
				this.#openLevels(event);
				break;
			case "select-level":
				this.#selectLevel(event);
				break;
			case "remove-power-tag":
				this.#removeTag(btn, "powerTag");
				break;
			case "remove-weakness-tag":
				this.#removeTag(btn, "weaknessTag");
				break;
			case "remove-draft-tag":
				this.#removeDraftTag(btn.dataset.id);
				break;
			case "toggle-secret":
				this.#toggleThemeTagSecret(btn.dataset.field, btn.dataset.id);
				break;
			case "toggle-edit-special":
				this.#toggleEditSpecial(btn.dataset.id);
				break;
			case "remove-special-tag":
				this.#removeSpecial(btn);
				break;
			case "send-special-to-chat":
				this.#sendSpecialToChat(btn.dataset.specialId);
				break;
		}
	}

	#onContext(event) {
		const btn = event.currentTarget;
		switch (btn.dataset.context) {
			case "decrease":
				this.#decrease(btn.dataset.id);
				break;
		}
	}

	async #updateTheme(changes) {
		const data = this.actor.toObject();
		const themes = data.system.themes || [];
		Object.assign(themes[this.themeIndex], changes);
		await this.actor.update({ "system.themes": themes }, { validate: false });
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelectorAll(".litm--advancement-tab")
			.forEach((button) => {
				button.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					event.stopImmediatePropagation();
				});
			});
		this.element
			.querySelectorAll("[data-click]")
			.forEach((el) => el.addEventListener("click", this.#onClick.bind(this)));
		this.element
			.querySelector("[data-themebook-search]")
			?.addEventListener("input", (event) =>
				this.#filterThemebooks(event.currentTarget.value),
			);
		const customThemebookInput = this.element.querySelector(
			".litm--tc-themebook-custom",
		);
		customThemebookInput?.addEventListener("focus", () => {
			try {
				customThemebookInput.showPicker?.();
			} catch (_error) {
				// The browser may require a direct user gesture; native datalist behavior remains available.
			}
		});
		this.element
			.querySelectorAll("[data-context]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#onContext.bind(this)),
			);
		this.element
			.querySelectorAll("[data-drag-special]")
			.forEach((el) =>
				el.addEventListener("dragstart", this.#onSpecialDragStart.bind(this)),
			);
		this.element.querySelectorAll("[data-input]").forEach((el) => {
			el.addEventListener("input", (event) => {
				const t = event.currentTarget;
				const input = t.parentElement.querySelector(`input#${t.dataset.input}`);
				if (input)
					input.value = t.isContentEditable
						? (t.textContent ?? "")
						: (t.value ?? "");
				t.classList.toggle("empty", !t.innerText.trim());
			});
			el.addEventListener("blur", (event) => {
				this.#focusTarget = event.relatedTarget?.dataset?.input || null;
				const t = event.currentTarget;
				const targetId = t.dataset.input;
				const input = t.parentElement.querySelector(`input#${targetId}`);
				if (input) input.dispatchEvent(new Event("change", { bubbles: true }));
			});
			el.classList.toggle("empty", !el.innerText.trim());
		});
		if (this.#focusTarget) {
			const next = this.element.querySelector(
				`[data-input="${this.#focusTarget}"]`,
			);
			if (next) {
				const sel = window.getSelection();
				const range = document.createRange();
				range.selectNodeContents(next);
				sel.removeAllRanges();
				sel.addRange(range);
				next.focus();
			}
			this.#focusTarget = null;
		}
		if (this.#customThemebookEditing) {
			requestAnimationFrame(() => {
				const input = this.element?.querySelector(".litm--tc-themebook-custom");
				input?.focus();
				input?.select();
			});
		}
		if (this.#dropReady) return;
		this.#dropReady = true;
		this.element.addEventListener("drop", this.#onDrop.bind(this));
		this.element.addEventListener("dragover", (e) => e.preventDefault());
	}

	#toggleThemebooks(event) {
		event.preventDefault();
		event.stopImmediatePropagation();
		const picker = event.currentTarget.closest(".litm--tc-themebook-picker");
		if (!picker) return;
		picker.classList.toggle("open");
		if (picker.classList.contains("open")) {
			document.addEventListener("click", this.#handleCloseThemebooks);
			requestAnimationFrame(() =>
				picker.querySelector("[data-themebook-search]")?.focus(),
			);
		} else {
			document.removeEventListener("click", this.#handleCloseThemebooks);
		}
	}

	async #selectThemebook(uuid) {
		const source = uuid ? await fromUuid(uuid) : null;
		if (!source || source.type !== "themebook") return;
		this.#customThemebookEditing = false;
		await this.#updateTheme({
			themebook: source.name,
			themebookUuid: source.uuid,
			themebookCustom: false,
			creationMode: this.theme.themekitUuid ? "themekit" : "themebook",
		});
		this.render();
	}

	async #selectCustomThemebook() {
		this.#customThemebookEditing = true;
		await this.#updateTheme({
			themebook: this.theme.themebookCustom ? this.theme.themebook : "",
			themebookUuid: "",
			themebookCustom: true,
			creationMode: this.theme.themekitUuid ? "themekit" : "custom",
		});
		this.render();
	}

	async #viewThemebook(uuid) {
		if (!uuid) return;
		const source = await fromUuid(uuid);
		if (!this.#canViewThemebook(source)) return;
		new ThemebookSheet({
			document: source,
			id: `litm-themebook-theme-${this.actor.id}-${this.themeIndex}`,
			forceObserver: true,
			actorUuid: this.actor.uuid,
			themeIndex: this.themeIndex,
		}).render({ force: true });
	}

	async #previewThemebook(uuid) {
		const source = uuid ? await fromUuid(uuid) : null;
		if (!this.#canViewThemebook(source)) return;
		source.sheet.render({ force: true });
	}

	#canViewThemebook(source) {
		const level = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
		if (
			source?.type === "themebook" &&
			source.testUserPermission(game.user, level)
		)
			return true;
		ui.notifications.error(
			game.i18n.localize("Litm.themebook-picker.permission-error"),
		);
		return false;
	}

	#filterThemebooks(query) {
		const normalized = query.trim().toLocaleLowerCase();
		for (const group of this.element.querySelectorAll(
			"[data-themebook-group]",
		)) {
			let visible = 0;
			for (const row of group.querySelectorAll("[data-themebook-row]")) {
				const matches =
					!normalized ||
					row.dataset.search?.toLocaleLowerCase().includes(normalized);
				row.hidden = !matches;
				if (matches) visible += 1;
			}
			group.hidden = visible === 0;
		}
	}

	#dropReady = false;

	#focusTarget = null;

	#editingSpecials = new Set();

	#onSpecialDragStart(event) {
		const el = event.currentTarget;
		const specialId = el.dataset.dragSpecial;
		const containerPath = el.dataset.dragSpecialPath;
		if (!specialId || !containerPath) return;
		const container = foundry.utils.deepClone(
			foundry.utils.getProperty(this.actor.toObject(), containerPath) || [],
		);
		const special = container.find((s) => s.id === specialId);
		if (!special) return;
		const dragData = game.litm.specials.makeSpecialDragData(
			special,
			this.actor.uuid,
			containerPath,
		);
		event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		event.dataTransfer.effectAllowed = "copyMove";
	}

	async #onDrop(event) {
		const dragData = game.litm.specials.readSpecialDragData(event);
		if (!dragData) return;
		event.preventDefault();

		const containerPath = this.targetSpecialsPath;
		if (!containerPath) return;

		if (dragData.source?.containerPath === containerPath) return;

		await game.litm.specials.addSpecialToContainer(
			this.actor,
			containerPath,
			dragData.special,
		);

		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #addTag(type) {
		const label = type === "weaknessTag" ? "weakness" : "power";
		const tag = {
			id: foundry.utils.randomID(),
			name: t(`Litm.ui.name-${label}`),
			type,
			isScratched: false,
			isPrivate: false,
		};
		const field = `${type}s`;
		const tags =
			foundry.utils.getProperty(
				this.actor.system.themes[this.themeIndex],
				field,
			) || [];
		await this.#updateTheme({ [field]: [...tags, tag] });
		this.render();
	}

	async #toggleThemeTagSecret(field, id) {
		const theme = foundry.utils.duplicate(this.theme);
		if (!theme) return;
		if (field === "themeTag") {
			if (theme.themeTag?.id !== id) return;
			theme.themeTag.isPrivate = !theme.themeTag.isPrivate;
		} else {
			const tag = (theme[field] ?? []).find((item) => item.id === id);
			if (!tag) return;
			tag.isPrivate = !tag.isPrivate;
		}
		await this.#updateTheme(theme);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #removeTag(btn, type) {
		const id = btn.dataset.id;
		const field = `${type}s`;
		const tags = (
			foundry.utils.getProperty(
				this.actor.system.themes[this.themeIndex],
				field,
			) || []
		).filter((t) => t.id !== id);
		await this.#updateTheme({ [field]: tags });
		this.render();
	}

	async #addSpecial() {
		const sourceOptions = await this.#getThemekitSpecialOptions();
		if (sourceOptions.length) {
			const mode = await foundry.applications.api.DialogV2.wait({
				window: { title: t("Litm.advancement.add-special-title") },
				classes: ["litm", "litm--special-source-dialog"],
				content: `<p>${t("Litm.advancement.add-special-method-hint")}</p>`,
				buttons: [
					{
						action: "manual",
						label: t("Litm.advancement.source-manual"),
						callback: () => "manual",
					},
					{
						action: "themekit",
						label: t("Litm.advancement.source-themekit"),
						default: true,
						callback: () => "themekit",
					},
				],
				rejectClose: false,
			});
			if (!mode) return;
			if (mode === "themekit")
				return this.#chooseThemekitSpecial(sourceOptions);
		}
		const specials = (
			this.actor.system.themes[this.themeIndex]?.specials || []
		).concat([
			{
				id: foundry.utils.randomID(),
				name: t("Litm.ui.name-special"),
				description: t("Litm.ui.name-special-description"),
			},
		]);
		await this.#updateTheme({ specials });
		this.render();
	}

	async #toggleEditSpecial(specialId) {
		if (this.#editingSpecials.has(specialId)) {
			const row = this.element.querySelector(
				`[data-special-id="${specialId}"]`,
			);
			if (row) {
				const nameEl = row.querySelector("[data-input^='special-name']");
				const descEl = row.querySelector("[data-input^='special-desc']");
				const specials = foundry.utils.deepClone(
					this.actor.system.themes[this.themeIndex]?.specials || [],
				);
				const special = specials.find((s) => s.id === specialId);
				if (special) {
					if (nameEl) special.name = nameEl.textContent.trim();
					if (descEl) special.description = descEl.textContent.trim();
					await this.#updateTheme({ specials });
				}
			}
			this.#editingSpecials.delete(specialId);
		} else {
			this.#editingSpecials.add(specialId);
		}
		this.render();
	}

	async #removeSpecial(btn) {
		const id = btn.dataset.id;
		const specials = (
			this.actor.system.themes[this.themeIndex]?.specials || []
		).filter((s) => s.id !== id);
		await this.#updateTheme({ specials });
		this.render();
	}

	async #sendSpecialToChat(specialId) {
		const special = (
			this.actor.system.themes[this.themeIndex]?.specials || []
		).find((s) => s.id === specialId);
		if (!special) return;
		const enriched = await TextEditor.enrichHTML(special.description || "");
		CONFIG.ChatMessage.documentClass.create({
			content: `<strong>${special.name}</strong>: ${enriched}`,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: this.actor,
			}),
		});
	}

	async #increase(field) {
		await ThemeAdvancement.increaseTrack(this.actor, this.themeIndex, field);
		this.render();
	}

	async #getThemekitSpecialOptions() {
		const theme = this.actor.system.themes[this.themeIndex];
		if (!theme?.themekitUuid) return [];
		const source = await fromUuid(theme.themekitUuid);
		if (!source) return [];
		const activeIds = new Set(
			(theme.specials ?? []).map((special) => special.id),
		);
		const claims = new Map(
			(theme.claimedSpecials ?? [])
				.filter((claim) => claim.sourceUuid === source.uuid)
				.map((claim) => [claim.specialId, claim]),
		);
		return Promise.all(
			(source.system.specials ?? [])
				.filter((special) => {
					const claim = claims.get(special.id);
					return (
						!claim?.retired &&
						!(claim?.themeSpecialId && activeIds.has(claim.themeSpecialId))
					);
				})
				.map(async (special) => ({
					id: special.id,
					name: special.name,
					description: special.description,
					enrichedDescription: await TextEditor.enrichHTML(
						special.description || "",
					),
					sourceUuid: source.uuid,
					sourceName: source.name,
				})),
		);
	}

	async #chooseThemekitSpecial(options) {
		const escapeHtml = foundry.utils.escapeHTML;
		const content = `<div class="litm--special-source-options">${options
			.map(
				(option, index) => `
			<label><input type="radio" name="specialSourceChoice" value="${escapeHtml(option.id)}" ${index === 0 ? "checked" : ""} />
			<span><strong>${escapeHtml(option.name)}</strong><small>${escapeHtml(option.sourceName)}</small><div>${option.enrichedDescription}</div></span></label>`,
			)
			.join("")}</div>`;
		const selectedId = await foundry.applications.api.DialogV2.wait({
			window: { title: t("Litm.advancement.choose-themekit-special") },
			position: { width: 560 },
			classes: ["litm", "litm--special-source-dialog"],
			content,
			buttons: [
				{
					action: "add",
					label: t("Litm.ui.add-special"),
					default: true,
					callback: (_event, _button, dialog) =>
						dialog.element.querySelector('[name="specialSourceChoice"]:checked')
							?.value ?? null,
				},
			],
			rejectClose: false,
		});
		const selected = options.find((option) => option.id === selectedId);
		if (!selected) return;
		const theme = foundry.utils.deepClone(
			this.actor.system.themes[this.themeIndex].toObject?.() ??
				this.actor.system.themes[this.themeIndex],
		);
		const themeSpecialId = foundry.utils.randomID();
		theme.specials ??= [];
		theme.specials.push({
			id: themeSpecialId,
			name: selected.name,
			description: selected.description,
		});
		theme.claimedSpecials ??= [];
		const claim = theme.claimedSpecials.find(
			(entry) =>
				entry.sourceUuid === selected.sourceUuid &&
				entry.specialId === selected.id,
		);
		if (claim) {
			claim.name = selected.name;
			claim.themeSpecialId = themeSpecialId;
		} else
			theme.claimedSpecials.push({
				sourceUuid: selected.sourceUuid,
				specialId: selected.id,
				name: selected.name,
				themeSpecialId,
				retired: false,
				claimedAt: Date.now(),
			});
		await this.#updateTheme(theme);
		this.render();
	}

	async #decrease(field) {
		await ThemeAdvancement.decreaseTrack(this.actor, this.themeIndex, field);
		this.render();
	}

	async #addDraftTag() {
		const drafts = (
			this.actor.system.themes[this.themeIndex]?.draftTags || []
		).concat([
			{
				id: foundry.utils.randomID(),
				name: t("Litm.ui.name-tag"),
				isWeakness: false,
			},
		]);
		await this.#updateTheme({ draftTags: drafts });
		this.render();
	}

	async #removeDraftTag(id) {
		const drafts = (
			this.actor.system.themes[this.themeIndex]?.draftTags || []
		).filter((d) => d.id !== id);
		await this.#updateTheme({ draftTags: drafts });
		this.render();
	}

	async #toggleDraftWeakness(id) {
		const drafts = foundry.utils.duplicate(
			this.actor.system.themes[this.themeIndex]?.draftTags || [],
		);
		const draft = drafts.find((d) => d.id === id);
		if (!draft) return;
		draft.isWeakness = !draft.isWeakness;
		await this.#updateTheme({ draftTags: drafts });
		this.render();
	}

	async #promoteDraft(id) {
		const drafts = foundry.utils.duplicate(
			this.actor.system.themes[this.themeIndex]?.draftTags || [],
		);
		const draftIndex = drafts.findIndex((d) => d.id === id);
		if (draftIndex === -1) return;

		const draft = drafts[draftIndex];
		const type = draft.isWeakness ? "weaknessTag" : "powerTag";
		const newTag = {
			name: draft.name,
			isScratched: false,
			isPrivate: false,
			type,
			id: foundry.utils.randomID(),
		};

		const tags = foundry.utils.duplicate(
			this.actor.system.themes[this.themeIndex]?.[`${type}s`] || [],
		);
		tags.push(newTag);
		drafts.splice(draftIndex, 1);

		await this.#updateTheme({ [`${type}s`]: tags, draftTags: drafts });
		this.render();
	}

	#handleCloseLevels = (event) => {
		if (!this.element) {
			document.removeEventListener("click", this.#handleCloseLevels);
			return;
		}
		const dropdown = this.element.querySelector(".litm--image-dropdown.open");
		if (!dropdown) return;
		const icon = dropdown.querySelector(".selected-image i.fas");
		if (dropdown.contains(event.target)) return;
		dropdown.classList.remove("open");
		icon?.classList.toggle("fa-angle-down", true);
		icon?.classList.toggle("fa-angle-up", false);
		document.removeEventListener("click", this.#handleCloseLevels);
	};

	#openLevels(event) {
		const dropdown = event.currentTarget.closest(".litm--image-dropdown");
		if (!dropdown) return;
		const icon = dropdown.querySelector(".selected-image i.fas");
		dropdown.classList.toggle("open");
		icon?.classList.toggle("fa-angle-down");
		icon?.classList.toggle("fa-angle-up");
		if (dropdown.classList.contains("open")) {
			document.addEventListener("click", this.#handleCloseLevels);
		} else {
			document.removeEventListener("click", this.#handleCloseLevels);
		}
	}

	async #selectLevel(event) {
		const option = event.currentTarget;
		const value = option.dataset.value;
		const dropdown = option.closest(".litm--image-dropdown");
		if (!dropdown) return;
		const input = dropdown.querySelector("input[type=hidden]");
		if (input) input.value = value;
		await this.#updateTheme({ level: value });
		this.render();
	}
}

export class NotesCard extends CardReader {
	static RELEVANT_SYSTEM_FIELDS = ["noticedTags", "note"];

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--backpack-card", "litm--notes-card"],
		tag: "form",
		position: { width: 920, height: 600 },
		window: { resizable: true },
		form: { submitOnChange: true },
	};

	get title() {
		return t("Litm.other.notes");
	}

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/notes-card.html" },
	};

	async _prepareContext(options) {
		const ctx = await super._prepareContext(options);
		ctx.tags = this.actor.system.noticedTags ?? [];
		ctx.note = this.actor.system.note || "";
		ctx.enrichedNote = await TextEditor.enrichHTML(ctx.note);
		return ctx;
	}

	async _processSubmitData(event, form, _formData, options = {}) {
		const changed = options._changedName;
		const tags = foundry.utils.duplicate(this.actor.system.noticedTags ?? []);
		if (!changed || changed.startsWith("system.noticedTags.")) {
			for (const el of form.elements) {
				if (!el.name?.startsWith("system.noticedTags.")) continue;
				if (changed && el.name !== changed) continue;
				const path = el.name.slice("system.noticedTags.".length);
				foundry.utils.setProperty(tags, path, el.value);
			}
		}
		for (const tag of tags)
			tag.type = /-\d+$/.test(tag.name) ? "status" : "tag";
		const updates = { "system.noticedTags": tags };
		if (!changed || changed === "system.note") {
			const data = new foundry.applications.ux.FormDataExtended(form).object;
			const note = foundry.utils.getProperty(data, "system.note");
			if (note !== undefined) updates["system.note"] = note;
		}
		await this.actor.update(updates, { validate: false });
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[data-input]").forEach((editor) => {
			editor.addEventListener("input", (event) => {
				const hidden = event.currentTarget.parentElement.querySelector(
					`#${event.currentTarget.dataset.input}`,
				);
				if (hidden) hidden.value = event.currentTarget.textContent.trim();
			});
			editor.addEventListener("blur", (event) => {
				event.currentTarget.parentElement
					.querySelector(`#${event.currentTarget.dataset.input}`)
					?.dispatchEvent(new Event("change", { bubbles: true }));
			});
		});
		this.element.querySelectorAll("[data-click]").forEach((button) =>
			button.addEventListener("click", (event) => {
				const id = event.currentTarget.dataset.id;
				if (event.currentTarget.dataset.click === "add-tag") this.#addTag();
				if (event.currentTarget.dataset.click === "remove-tag")
					this.#removeTag(id);
			}),
		);
		this.element
			.querySelector('prose-mirror[name="system.note"]')
			?.addEventListener("change", (event) => {
				event.stopPropagation();
				this._processSubmitData(event, this.element, null, {
					_changedName: "system.note",
				});
			});
	}

	async #addTag() {
		const tags = foundry.utils.duplicate(this.actor.system.noticedTags ?? []);
		tags.push({
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-tag"),
			type: "tag",
		});
		await this.actor.update(
			{ "system.noticedTags": tags },
			{ validate: false },
		);
		this.render();
	}

	async #removeTag(id) {
		const tags = (this.actor.system.noticedTags ?? []).filter(
			(tag) => tag.id !== id,
		);
		await this.actor.update(
			{ "system.noticedTags": tags },
			{ validate: false },
		);
		this.render();
	}
}

export class BackpackCard extends CardReader {
	static RELEVANT_SYSTEM_FIELDS = [
		"backpackTags",
		"backpackDraftTags",
		"backpackArchive",
		"characterOptions",
	];

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--backpack-card"],
		tag: "form",
		position: { width: 920, height: 600 },
		window: { resizable: true },
		form: { submitOnChange: true },
	};

	constructor(actorUuid, options) {
		super(actorUuid, options);
		const refreshStories = (item) => {
			if (item.type !== "story" || item.parent?.uuid !== this.actor.uuid)
				return;
			if (this.rendered) this.render();
		};
		this.#itemHookIds = [
			["createItem", Hooks.on("createItem", refreshStories)],
			["updateItem", Hooks.on("updateItem", refreshStories)],
			["deleteItem", Hooks.on("deleteItem", refreshStories)],
		];
	}

	/**
	 * Remove Story Theme hooks before closing the card.
	 * @param {object} [options] Application close options.
	 * @returns {Promise<ApplicationV2>} The closed application.
	 */
	async close(options) {
		for (const [hook, id] of this.#itemHookIds) Hooks.off(hook, id);
		this.#itemHookIds = [];
		return super.close(options);
	}

	get title() {
		return t("Litm.other.backpack");
	}

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/backpack-card.html" },
	};

	#archiveView = false;
	#itemHookIds = [];

	async _prepareContext(options) {
		const ctx = await super._prepareContext(options);
		ctx.tags = this.#archiveView
			? (this.actor.system.backpackArchive ?? [])
			: (this.actor.system.backpackTags ?? []);
		ctx.archiveView = this.#archiveView;
		ctx.tagPath = this.#archiveView ? "backpackArchive" : "backpackTags";
		ctx.draftTags = this.actor.system.backpackDraftTags ?? [];
		ctx.enableBackpackDrafts =
			this.actor.system.characterOptions?.enableBackpackDrafts === true;
		const stories = this.actor.items
			.filter((item) => item.type === "story")
			.sort((a, b) => a.sort - b.sort)
			.map((item) => {
				const system = item.system;
				const asTag = (tag, isWeakness = false) => ({
					id: tag.id,
					name: tag.name,
					isScratched: tag.isScratched ?? false,
					isWeakness,
				});
				return {
					id: item.id,
					name: item.name,
					img: item.img,
					level: system.level || "origin",
					isArchived: system.isArchived === true,
					tags: [
						asTag(system.themeTag),
						...system.powerTags.map((tag) => asTag(tag)),
						...system.weaknessTags.map((tag) => asTag(tag, true)),
					],
				};
			});
		ctx.stories = stories.filter((story) => !story.isArchived);
		ctx.archivedStories = stories.filter((story) => story.isArchived);
		return ctx;
	}

	async _processSubmitData(event, form, formData, options = {}) {
		const changed = options._changedName;

		// Lazy FormDataExtended for prose-mirror
		let fd;
		const getFd = () => {
			fd ??= new foundry.applications.ux.FormDataExtended(form).object;
			return fd;
		};

		const tags = foundry.utils.duplicate(this.actor.system.backpackTags ?? []);
		const draftTags = foundry.utils.duplicate(
			this.actor.system.backpackDraftTags ?? [],
		);
		const archive = foundry.utils.duplicate(
			this.actor.system.backpackArchive ?? [],
		);

		if (!changed || changed.startsWith("system.backpackTags.")) {
			const tagsPrefix = "system.backpackTags.";
			for (const el of form.elements) {
				if (!el.name || !el.name.startsWith(tagsPrefix)) continue;
				if (changed && el.name !== changed) continue;
				if (el.type === "hidden" && changed !== el.name) continue;
				const path = el.name.slice(tagsPrefix.length);
				if (!path) continue;
				const value =
					el.type === "checkbox"
						? el.checked
						: el.type === "number"
							? Number(el.value)
							: el.value;
				foundry.utils.setProperty(tags, path, value);
			}
		}

		if (!changed || changed.startsWith("system.backpackArchive.")) {
			const qPrefix = "system.backpackArchive.";
			for (const el of form.elements) {
				if (!el.name || !el.name.startsWith(qPrefix)) continue;
				if (changed && el.name !== changed) continue;
				if (el.type === "hidden" && changed !== el.name) continue;
				const path = el.name.slice(qPrefix.length);
				if (!path) continue;
				const value =
					el.type === "checkbox"
						? el.checked
						: el.type === "number"
							? Number(el.value)
							: el.value;
				foundry.utils.setProperty(archive, path, value);
			}
		}

		if (!changed || changed.startsWith("system.backpackDraftTags.")) {
			const draftPrefix = "system.backpackDraftTags.";
			for (const el of form.elements) {
				if (!el.name || !el.name.startsWith(draftPrefix)) continue;
				if (changed && el.name !== changed) continue;
				if (el.type === "hidden" && changed !== el.name) continue;
				const path = el.name.slice(draftPrefix.length);
				if (!path) continue;
				foundry.utils.setProperty(draftTags, path, el.value);
			}
		}

		const updateData = {
			"system.backpackTags": tags,
			"system.backpackDraftTags": draftTags,
			"system.backpackArchive": archive,
		};

		// Handle prose-mirror note
		if (!changed || changed === "system.note") {
			const noteVal = foundry.utils.getProperty(getFd(), "system.note");
			if (noteVal !== undefined) updateData["system.note"] = noteVal;
		}

		await this.actor.update(updateData, { validate: false });
		const effectUpdates = [];
		for (const tag of tags) {
			const effect = this.actor.effects.get(tag.id);
			if (!effect) continue;
			const update = { _id: effect.id };
			if (effect.name !== tag.name) update.name = tag.name;
			if (
				effect.flags?.["litm-rn"]?.isScratched !== (tag.isScratched ?? false)
			) {
				update["flags.litm-rn.isScratched"] = tag.isScratched ?? false;
			}
			if (effect.flags?.["litm-rn"]?.isPrivate !== (tag.isPrivate ?? false)) {
				update["flags.litm-rn.isPrivate"] = tag.isPrivate ?? false;
			}
			if (Object.keys(update).length > 1) effectUpdates.push(update);
		}
		if (effectUpdates.length) {
			await this.actor.updateEmbeddedDocuments("ActiveEffect", effectUpdates, {
				render: false,
			});
		}
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelectorAll("[data-click]")
			.forEach((el) => el.addEventListener("click", this.#onClick.bind(this)));
		this.element
			.querySelectorAll("[data-context]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#onContext.bind(this)),
			);
		this.element.querySelectorAll("[data-drag-story]").forEach((el) => {
			el.addEventListener("dragstart", this.#onStoryDragStart.bind(this));
			el.addEventListener("dragend", () => {
				this.#draggingStory = false;
				this.#clearStoryDropIndicator();
			});
		});
		this.element.querySelectorAll("[data-input]").forEach((el) => {
			el.addEventListener("input", (event) => {
				const t = event.currentTarget;
				const input = t.parentElement.querySelector(`input#${t.dataset.input}`);
				if (input) input.value = t.textContent.trim();
			});
			el.addEventListener("blur", (event) => {
				const target = event.currentTarget;
				const input = target.parentElement.querySelector(
					`input#${target.dataset.input}`,
				);
				input?.dispatchEvent(new Event("change", { bubbles: true }));
			});
		});
		const noteEditor = this.element.querySelector(
			'prose-mirror[name="system.note"]',
		);
		noteEditor?.addEventListener("change", (event) => {
			event.stopPropagation();
			this._processSubmitData(event, this.element, null, {
				_changedName: "system.note",
			});
		});
		if (this.#dropReady) return;
		this.#dropReady = true;
		this.element.addEventListener("drop", this.#onDrop.bind(this));
		this.element.addEventListener("dragover", this.#onDragOver.bind(this));
		this.element.addEventListener("dragleave", (event) => {
			if (!this.element.contains(event.relatedTarget))
				this.#clearStoryDropIndicator();
		});
	}

	#dropReady = false;
	#draggingStory = false;

	#onDragOver(event) {
		let isStory = this.#draggingStory;
		const raw = event.dataTransfer.getData("text/plain");
		if (!isStory && raw) {
			let data;
			try {
				data = JSON.parse(raw);
			} catch {
				data = null;
			}
			if (data?.type !== "Item") {
				this.#clearStoryDropIndicator();
				return;
			}
			let item = null;
			try {
				item = data.uuid ? fromUuidSync(data.uuid) : null;
			} catch {
				item = null;
			}
			if (item && item.type !== "story") {
				this.#clearStoryDropIndicator();
				return;
			}
			isStory = !item || item.type === "story";
		}
		if (
			!isStory &&
			!Array.from(event.dataTransfer.types).includes("text/plain")
		) {
			this.#clearStoryDropIndicator();
			return;
		}
		event.preventDefault();
		const story = event.target.closest("[data-story-id]");
		if (!story) {
			this.#clearStoryDropIndicator();
			const container = event.target.closest(".litm--bc-stories");
			const dropTarget =
				container?.querySelector(".litm--bc-story-list") ?? container;
			dropTarget?.classList.add("litm--bc-drop-empty");
			return;
		}
		const rect = story.getBoundingClientRect();
		const position =
			event.clientX < rect.left + rect.width / 2 ? "before" : "after";
		if (story.classList.contains(`litm--bc-drop-${position}`)) return;
		this.#clearStoryDropIndicator();
		story.classList.add(`litm--bc-drop-${position}`);
	}

	#clearStoryDropIndicator() {
		this.element
			.querySelectorAll(".litm--bc-drop-before, .litm--bc-drop-after")
			.forEach((element) =>
				element.classList.remove("litm--bc-drop-before", "litm--bc-drop-after"),
			);
		this.element
			.querySelectorAll(".litm--bc-drop-empty")
			.forEach((element) => element.classList.remove("litm--bc-drop-empty"));
	}

	#onStoryDragStart(event) {
		const item = this.actor.items.get(event.currentTarget.dataset.dragStory);
		if (!item || item.type !== "story") return;
		this.#draggingStory = true;
		event.dataTransfer.setData(
			"text/plain",
			JSON.stringify({
				type: "Item",
				uuid: item.uuid,
			}),
		);
		event.dataTransfer.effectAllowed = "copyMove";
	}

	async #onDrop(event) {
		const raw = event.dataTransfer.getData("text/plain");
		if (!raw) return;
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}
		if (data.type !== "Item") return;
		const item = await CONFIG.Item.documentClass.fromDropData(data);
		if (!item || item.type !== "story") return;
		event.preventDefault();

		const targetElement = event.target.closest("[data-story-id]");
		const targetId = targetElement?.dataset.storyId;
		const destination = event.target.closest("[data-story-archive]");
		const isArchived = destination?.dataset.storyArchive === "true";
		const sortBefore = !targetElement?.classList.contains(
			"litm--bc-drop-after",
		);
		this.#draggingStory = false;
		this.#clearStoryDropIndicator();
		if (item.parent?.uuid === this.actor.uuid) {
			const archiveChanged = item.system.isArchived !== isArchived;
			if (archiveChanged)
				await item.update({ "system.isArchived": isArchived });
			if (!targetId || targetId === item.id) {
				if (archiveChanged) this.render();
				return;
			}
			const target = this.actor.items.get(targetId);
			if (!target) return;
			const updates = foundry.utils
				.performIntegerSort(item, {
					target,
					siblings: this.actor.items.filter(
						(entry) =>
							entry.type === "story" &&
							entry.id !== item.id &&
							entry.system.isArchived === isArchived,
					),
					sortBefore,
				})
				.map(({ target: entry, update }) => ({ _id: entry.id, ...update }));
			if (updates.length)
				await this.actor.updateEmbeddedDocuments("Item", updates);
			this.render();
			return;
		}

		const itemData = item.toObject();
		delete itemData._id;
		itemData.system.isArchived = isArchived;
		const [created] = await this.actor.createEmbeddedDocuments("Item", [
			itemData,
		]);
		const target = this.actor.items.get(targetId);
		if (created && target && created.id !== target.id) {
			const updates = foundry.utils
				.performIntegerSort(created, {
					target,
					siblings: this.actor.items.filter(
						(entry) =>
							entry.type === "story" &&
							entry.id !== created.id &&
							entry.system.isArchived === isArchived,
					),
					sortBefore,
				})
				.map(({ target: entry, update }) => ({ _id: entry.id, ...update }));
			if (updates.length)
				await this.actor.updateEmbeddedDocuments("Item", updates);
		}
		this.render();
	}

	#onClick(event) {
		const btn = event.currentTarget;
		switch (btn.dataset.click) {
			case "add-tag":
				this.#addTag();
				break;
			case "add-draft-tag":
				this.#addDraftTag();
				break;
			case "promote-draft-tag":
				this.#promoteDraftTag(btn.dataset.id);
				break;
			case "remove-draft-tag":
				this.#removeDraftTag(btn.dataset.id);
				break;
			case "toggle-archive":
				this.#archiveView = !this.#archiveView;
				this.render();
				break;
			case "archive-tag":
				this.#moveTag(btn.dataset.id, true);
				break;
			case "move-tag-to-tracking":
				if (btn.disabled) break;
				btn.disabled = true;
				this.#moveTagToTracking(btn.dataset.id);
				break;
			case "restore-tag":
				this.#moveTag(btn.dataset.id, false);
				break;
			case "remove-tag":
				this.#removeTag(btn);
				break;
			case "open-story":
				this.actor.items.get(btn.dataset.id)?.sheet.render({ force: true });
				break;
			case "add-story":
				this.#addStory();
				break;
			case "remove-story":
				this.#removeStory(btn.dataset.id);
				break;
			case "archive-story":
				this.#setStoryArchived(btn.dataset.id, true);
				break;
			case "restore-story":
				this.#setStoryArchived(btn.dataset.id, false);
				break;
			case "toggle-secret":
				this.#toggleTagSecret(btn.dataset.id);
				break;
		}
	}

	#onContext(event) {
		event.preventDefault();
	}

	async #addTag() {
		const field = this.#archiveView ? "backpackArchive" : "backpackTags";
		const tags = foundry.utils.duplicate(this.actor.system[field] ?? []);
		const tag = {
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-tag"),
			type: "backpack",
			isScratched: false,
			isPrivate: false,
		};
		tags.push(tag);
		await this.actor.update({ [`system.${field}`]: tags }, { validate: false });
		if (!this.#archiveView) await this.#createBackpackEffect(tag);
		this.render();
	}

	async #addDraftTag() {
		if (!this.actor.system.characterOptions?.enableBackpackDrafts) return;
		const drafts = foundry.utils.duplicate(
			this.actor.system.backpackDraftTags ?? [],
		);
		drafts.push({ id: foundry.utils.randomID(), name: t("Litm.ui.name-tag") });
		await this.actor.update(
			{ "system.backpackDraftTags": drafts },
			{ validate: false },
		);
		this.render();
	}

	async #promoteDraftTag(id) {
		const drafts = foundry.utils.duplicate(
			this.actor.system.backpackDraftTags ?? [],
		);
		const tags = foundry.utils.duplicate(this.actor.system.backpackTags ?? []);
		const index = drafts.findIndex((tag) => tag.id === id);
		if (index < 0) return;
		const [draft] = drafts.splice(index, 1);
		const tag = {
			...draft,
			type: "backpack",
			isScratched: false,
			isPrivate: false,
		};
		tags.push(tag);
		await this.actor.update(
			{
				"system.backpackDraftTags": drafts,
				"system.backpackTags": tags,
			},
			{ validate: false },
		);
		await this.#createBackpackEffect(tag);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #removeDraftTag(id) {
		const drafts = (this.actor.system.backpackDraftTags ?? []).filter(
			(tag) => tag.id !== id,
		);
		await this.actor.update(
			{ "system.backpackDraftTags": drafts },
			{ validate: false },
		);
		this.render();
	}

	async #createBackpackEffect(tag) {
		if (this.actor.effects.has(tag.id)) return;
		await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				_id: tag.id,
				name: tag.name,
				disabled: false,
				transfer: false,
				flags: {
					"litm-rn": {
						type: "tag",
						values: Array(6).fill(null),
						value: "",
						isScratched: false,
						isHindering: false,
						isCrispy: false,
						isPrivate: tag.isPrivate ?? false,
						ownerType: "backpack",
						ownerId: "backpack",
					},
				},
			},
		]);
	}

	async #deleteBackpackEffect(tag) {
		const effect =
			this.actor.effects.get(tag.id) ??
			this.actor.effects.find((entry) => {
				const flags = entry.flags?.["litm-rn"];
				return flags?.ownerType === "backpack" && entry.name === tag.name;
			});
		if (effect)
			await this.actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
	}

	async #toggleTagSecret(id) {
		const field = this.#archiveView ? "backpackArchive" : "backpackTags";
		const tags = foundry.utils.duplicate(this.actor.system[field] ?? []);
		const tag = tags.find((item) => item.id === id);
		if (!tag) return;
		tag.isPrivate = !tag.isPrivate;
		await this.actor.update({ [`system.${field}`]: tags }, { validate: false });
		const effect = !this.#archiveView ? this.actor.effects.get(id) : null;
		if (effect) {
			await this.actor.updateEmbeddedDocuments(
				"ActiveEffect",
				[
					{
						_id: effect.id,
						"flags.litm-rn.isPrivate": tag.isPrivate,
					},
				],
				{ render: false },
			);
		}
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #removeTag(btn) {
		const id = btn.dataset.id;
		const field = this.#archiveView ? "backpackArchive" : "backpackTags";
		const removed = this.actor.system[field]?.find((tag) => tag.id === id);
		const tags = (this.actor.system[field] ?? []).filter(
			(tag) => tag.id !== id,
		);
		await this.actor.update({ [`system.${field}`]: tags }, { validate: false });
		if (!this.#archiveView && removed)
			await this.#deleteBackpackEffect(removed);
		this.render();
	}

	async #moveTag(id, toArchive) {
		const sourceField = toArchive ? "backpackTags" : "backpackArchive";
		const targetField = toArchive ? "backpackArchive" : "backpackTags";
		const source = foundry.utils.duplicate(
			this.actor.system[sourceField] ?? [],
		);
		const target = foundry.utils.duplicate(
			this.actor.system[targetField] ?? [],
		);
		const index = source.findIndex((tag) => tag.id === id);
		if (index < 0) return;
		const [tag] = source.splice(index, 1);
		target.push(tag);
		await this.actor.update(
			{
				[`system.${sourceField}`]: source,
				[`system.${targetField}`]: target,
			},
			{ validate: false },
		);
		if (toArchive) await this.#deleteBackpackEffect(tag);
		else await this.#createBackpackEffect(tag);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #moveTagToTracking(id) {
		const tags = foundry.utils.duplicate(this.actor.system.backpackTags ?? []);
		const index = tags.findIndex((tag) => tag.id === id);
		if (index < 0 || tags[index].isScratched) return;
		const [tag] = tags.splice(index, 1);
		const linkedEffect = this.actor.effects.get(tag.id);
		if (linkedEffect) {
			await this.actor.updateEmbeddedDocuments(
				"ActiveEffect",
				[
					{
						_id: linkedEffect.id,
						"flags.litm-rn.-=ownerType": null,
						"flags.litm-rn.-=ownerId": null,
					},
				],
				{ render: false },
			);
		} else {
			await this.actor.createEmbeddedDocuments("ActiveEffect", [
				{
					name: tag.name,
					flags: {
						["litm-rn"]: {
							type: "tag",
							isScratched: false,
							isPrivate: tag.isPrivate ?? false,
							isCrispy: false,
						},
					},
				},
			]);
		}
		await this.actor.update(
			{ "system.backpackTags": tags },
			{ validate: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
		this.render();
	}

	async #addStory() {
		const [story] = await this.actor.createEmbeddedDocuments("Item", [
			{
				name: t("Litm.other.story-theme"),
				type: "story",
			},
		]);
		story.sheet.render({ force: true });
	}

	async #removeStory(id) {
		const story = this.actor.items.get(id);
		if (!story || story.type !== "story") return;
		if (!(await confirmDelete("Litm.other.story-theme"))) return;
		await this.actor.deleteEmbeddedDocuments("Item", [id]);
	}

	/** Move a Story Theme between the active and archived sections. */
	async #setStoryArchived(id, isArchived) {
		const story = this.actor.items.get(id);
		if (!story || story.type !== "story") return;
		await story.update({ "system.isArchived": isArchived });
		this.render();
	}
}
