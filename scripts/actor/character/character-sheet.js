import { AvatarPositionApp } from "../../apps/avatar-position.js";
import { FellowshipAdvancementApp } from "../../apps/fellowship-advancement.js";
import { HeroCreationApp } from "../../apps/hero-creation.js";
import { PromiseFulfillmentApp } from "../../apps/promise-fulfillment.js";
import { ThemeAdvancementApp } from "../../apps/theme-advancement.js";
import { ThemeArchiveApp } from "../../apps/theme-archive.js";
import { createPrivate } from "../../system/private-creation.js";
import { ThemeAdvancement } from "../../system/theme-advancement.js";
import {
	addOrStackActorStatus,
	confirmDelete,
	dispatch,
	getAssignedUser,
	getAvailableFellowships,
	getFellowshipActors,
	getOwningDocument,
	getOwningWindow,
	localize as t,
} from "../../utils.js";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--character"],
		position: {
			width: 625,
			height: 700,
		},
		window: { resizable: false },
		form: { submitOnChange: true },
		actions: {
			editImage: CharacterSheet.#onEditImage,
			sendQuintessence: CharacterSheet.#onSendQuintessence,
			configureAvatarPosition: CharacterSheet.#onConfigureAvatarPosition,
			openThemeArchive: CharacterSheet.#onOpenThemeArchive,
			openHeroCreation: CharacterSheet.#onOpenHeroCreation,
		},
	};

	static PARTS = {
		sheet: { template: "systems/litm-rn/templates/actor/character.html" },
	};

	#dragAvatarTimeout = null;
	#notesEditorStyle = "display: none;";
	#tagsFocused = null;
	#tagsHovered = false;
	#themeHovered = null;
	#backpackHovered = null;
	#backsideStates = new Map();
	#heroHovered = null;
	#hoverLock = null;
	#savedScrollTops = null;
	#suppressHoverEvents = false;
	#roll = game.litm.LitmRollDialog.create({
		actorId: this.actor._id,
	});
	#fellowshipUpdateHook = null;
	#actorUpdateHookId = null;
	#storyTagsHookId = null;
	#actorDataUpdateHookId = null;
	#expandedStories = new Set();
	#themeSortSource = null;
	#themeSortTarget = null;
	#themeSortRects = new Map();
	#tagContextMenu = null;
	#tagContextSourceCard = null;
	#tagContextSourceId = null;
	#editingEffectId = null;
	#blankEditingEffectId = null;
	#editingBackpackTagId = null;
	#blankEditingBackpackTagId = null;
	#editingNoticedTagId = null;
	#blankEditingNoticedTagId = null;
	#notesCardExpanded = false;
	#trackingCardsExpanded = false;
	#draggedEffectType = null;
	#eventDocument = null;
	#onDocumentEffectDragStart = (event) => {
		try {
			const data = JSON.parse(
				event.dataTransfer?.getData("text/plain") || "null",
			);
			this.#draggedEffectType = ["tag", "status"].includes(data?.type)
				? data.type
				: null;
		} catch {
			this.#draggedEffectType = null;
		}
	};
	#onDocumentEffectDragEnd = () => {
		this.#draggedEffectType = null;
		this.element
			?.querySelectorAll(".litm--tag-drop-target")
			.forEach((element) => element.classList.remove("litm--tag-drop-target"));
	};

	get items() {
		return this.actor.items;
	}
	get system() {
		return this.actor.system;
	}

	/** @override */
	get title() {
		return this.actor?.system?.shortDescription ?? "";
	}

	get rollDialog() {
		return this.#roll;
	}

	/** Update roll-selection markers without rebuilding the full character sheet. */
	updateRollSelectionDisplay() {
		if (!this.rendered || !this.element) return;
		const selectedIds =
			game.litm?.getSelectedTagIds?.(this.actor.id) ?? new Set();
		const burnedIds = new Set();
		for (const tagMap of game.litm?.rollSelection
			?.get(this.actor.id)
			?.values() ?? []) {
			for (const [tagId, state] of tagMap)
				if (state === "burned") burnedIds.add(tagId);
		}
		const selector = [
			".litm--story-tag[data-id]",
			".litm--theme-title[data-id]",
			".litm--weakness[data-id]",
			".litm--theme-tag-button[data-id]",
			"[data-selected]",
			"[data-burned]",
		].join(",");
		for (const element of this.element.querySelectorAll(selector)) {
			const tagId = element.dataset.id;
			if (!tagId) continue;
			element.toggleAttribute("data-selected", selectedIds.has(tagId));
			element.toggleAttribute("data-burned", burnedIds.has(tagId));
		}
	}

	get storyTags() {
		const mapEffect = (t) => {
			const tag = { ...t };
			const type =
				tag.type || (tag.values?.some((v) => !!v) ? "status" : "tag");
			tag.type = type;
			if (type === "tag") {
				delete tag.values;
				delete tag.value;
			}
			return tag;
		};
		return [
			...this.system.storyTags.map(mapEffect),
			...this.system.statuses.map(mapEffect),
		];
	}

	get config() {
		const config = game.settings.get("litm-rn", "storytags");
		if (!config || foundry.utils.isEmpty(config))
			return { actors: [], tags: [], selectedTags: [], helpingTags: [] };
		return { helpingTags: [], ...config };
	}

	static #onEditImage(_event, target) {
		if (this.#dragAvatarTimeout) return;
		const attr = target.dataset.edit;
		const current = foundry.utils.getProperty(this.document, attr);
		const fp = new FilePicker({
			type: "image",
			current: current,
			callback: (path) => this.document.update({ [attr]: path }),
		});
		fp.render();
	}

	static #onConfigureAvatarPosition() {
		new AvatarPositionApp(this.actor).render({ force: true });
	}

	static #onOpenThemeArchive() {
		new ThemeArchiveApp(this.actor.uuid).render({ force: true });
	}

	static #onOpenHeroCreation() {
		new HeroCreationApp(this.actor.uuid).render({ force: true });
	}

	/** @override */
	_getHeaderControls() {
		return [
			...super._getHeaderControls(),
			{
				action: "configureAvatarPosition",
				icon: "fas fa-image",
				label: "Litm.ui.avatar-position",
				ownership: "OWNER",
			},
			{
				action: "openThemeArchive",
				icon: "fas fa-box-archive",
				label: "Litm.archive.title",
				ownership: "OWNER",
			},
			{
				action: "openHeroCreation",
				icon: "fas fa-wand-magic-sparkles",
				label: "Litm.hero-creation.title",
				ownership: "OWNER",
			},
		];
	}

	static async #onSendQuintessence(event, target) {
		const specialId = target.dataset.specialId;
		if (!specialId) return;
		const special = (this.actor.system.quintessences || []).find(
			(s) => s.id === specialId,
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

	updateRollDialog(data) {
		this.#roll.receiveUpdate(data);
	}

	renderRollDialog({ toggle } = { toggle: false }) {
		if (game.user.isGM) {
			const gmDialog = game.litm?.gmRollDialog;
			if (
				toggle &&
				gmDialog?.rendered &&
				gmDialog.actorId === this.actor.id &&
				!gmDialog.camp
			) {
				gmDialog.close();
				return;
			}
			game.litm?.LitmRollDialog?.openForGm?.(this.actor.id);
			return;
		}
		if (toggle && this.#roll.rendered) this.#roll.close();
		else this.#roll.render({ force: true });
	}

	resetRollDialog() {
		if (this.#roll.rendered) this.#roll.close();
		this.#roll.reset();
		this.render();
	}

	/** Toggle a tag's scratch state, or set it deterministically when scratched is provided. */
	async toggleScratchTag(tag, { scratched = null } = {}) {
		const nextScratchState = (current) => scratched ?? !current;
		switch (tag.type) {
			case "hero": {
				const rels = foundry.utils.duplicate(this.system.relationships ?? []);
				const match = rels.find((i) => i.id === tag.id);
				if (match) {
					match.isScratched = nextScratchState(match.isScratched);
					await this.actor.update({ "system.relationships": rels });
				}
				break;
			}
			case "powerCrispy": {
				const parentTheme = this.system.fellowship;
				if (!parentTheme) return;
				const { powerTags } = parentTheme.system.toObject();
				powerTags.find((t) => t.id === tag.id).isScratched = nextScratchState(
					tag.isScratched,
				);

				await parentTheme.update({ "system.powerTags": powerTags });
				break;
			}
			case "powerTag": {
				const themeIdx = this.system.themes?.findIndex((t) =>
					t.powerTags?.some((pt) => pt.id === tag.id),
				);
				if (themeIdx !== -1 && themeIdx !== undefined) {
					const themes = foundry.utils.duplicate(this.system.themes);
					const pt = themes[themeIdx].powerTags.find((pt) => pt.id === tag.id);
					if (pt) {
						pt.isScratched = nextScratchState(pt.isScratched);
						await this.#syncMirroredTagScratch(pt.id, pt.isScratched);
					}
					await this.actor.update({ "system.themes": themes });
					break;
				}
				const storyItem = this.items.find(
					(i) =>
						i.type === "story" &&
						i.system.powerTags.some((t) => t.id === tag.id),
				);
				if (storyItem) {
					const { powerTags } = storyItem.system.toObject();
					powerTags.find((t) => t.id === tag.id).isScratched = nextScratchState(
						tag.isScratched,
					);
					await this.actor.updateEmbeddedDocuments("Item", [
						{ _id: storyItem.id, "system.powerTags": powerTags },
					]);
				}
				break;
			}
			case "themeCrispy": {
				const parentTheme = this.system.fellowship;
				if (!parentTheme) return;

				await parentTheme.update({
					"system.themeTag.isScratched": nextScratchState(tag.isScratched),
				});
				break;
			}
			case "themeTag": {
				const themeIdx = this.system.themes?.findIndex(
					(t) => t.themeTag?.id === tag.id,
				);
				if (themeIdx !== -1 && themeIdx !== undefined) {
					const themes = foundry.utils.duplicate(this.system.themes);
					themes[themeIdx].themeTag.isScratched = nextScratchState(
						themes[themeIdx].themeTag.isScratched,
					);
					await this.#syncMirroredTagScratch(
						themes[themeIdx].themeTag.id,
						themes[themeIdx].themeTag.isScratched,
					);
					await this.actor.update({ "system.themes": themes });
					break;
				}
				const storyItem = this.items.find(
					(i) => i.type === "story" && i.system.themeTag.id === tag.id,
				);
				if (storyItem) {
					await this.actor.updateEmbeddedDocuments("Item", [
						{
							_id: storyItem.id,
							"system.themeTag.isScratched": nextScratchState(tag.isScratched),
						},
					]);
					this.render();
				}
				break;
			}
			case "backpack": {
				const tags = foundry.utils.duplicate(this.system.backpackTags ?? []);
				const match = tags.find((i) => i.id === tag.id);
				if (match) {
					match.isScratched = nextScratchState(match.isScratched);
					const effect = this.actor.effects.get(tag.id);
					if (effect) {
						await this.actor.updateEmbeddedDocuments(
							"ActiveEffect",
							[
								{
									_id: effect.id,
									"flags.litm-rn.isScratched": match.isScratched,
								},
							],
							{ render: false },
						);
					}
				}
				await this.actor.update({ "system.backpackTags": tags });
				break;
			}
		}
	}

	async #syncMirroredTagScratch(tagId, isScratched) {
		const effect = this.actor.effects.get(tagId);
		if (effect?.flags?.["litm-rn"]?.ownerType !== "theme") return;
		await this.actor.updateEmbeddedDocuments(
			"ActiveEffect",
			[
				{
					_id: effect.id,
					"flags.litm-rn.isScratched": isScratched,
				},
			],
			{ render: false },
		);
	}

	async gainImprove(tag) {
		const themeIdx = this.system.themes?.findIndex((t) =>
			t.weaknessTags?.some((wt) => wt.id === tag.id),
		);
		if (themeIdx !== -1 && themeIdx !== undefined) {
			await ThemeAdvancement.increaseTrack(this.actor, themeIdx, "improve");
		} else {
			const parentTheme = this.system.fellowship;
			if (!parentTheme) return;
			await ThemeAdvancement.increaseFellowshipTrack(parentTheme, "improve");
		}
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context._id = this.actor.id;
		context.img = this.actor.img;
		context.avatarPosition = AvatarPositionApp.getPosition(this.actor);
		context.name = this.actor.name;
		context.notesEditorStyle = this.#notesEditorStyle;
		context.isEditable = this.isEditable;
		context.showDraftTags =
			this.system.characterOptions?.showDraftTags === true;
		context.noteRaw = this.system.note || "";
		context.note = await TextEditor.enrichHTML(this.system.note || "");
		// context.note = await TextEditor.enrichHTML(context.system.note || "");

		// Fellowship
		const fellowshipItem = this.system.fellowship;
		if (fellowshipItem) {
			const fSystem = fellowshipItem.system.toObject();
			fSystem.specials = await Promise.all(
				(fellowshipItem.system.specials || []).map(async (s) => ({
					...s.toObject(),
					enrichedDescription: await TextEditor.enrichHTML(s.description || ""),
				})),
			);
			fSystem.backside = this.#getBackside(fellowshipItem.id);
			fSystem.improveTrackLength = Number(
				fellowshipItem.system.improveTrackLength ?? 3,
			);
			fSystem.improvementsPerTrack = Number(
				fellowshipItem.system.improvementsPerTrack ?? 1,
			);
			fSystem.weakness = fellowshipItem.system.weakness;
			fSystem.levels = fellowshipItem.system.levels;
			fSystem.themebooks = fellowshipItem.system.themebooks;
			fSystem.enrichedNote = await TextEditor.enrichHTML(
				fellowshipItem.system.note || "",
			);
			context.fellowship = {
				data: {
					_id: fellowshipItem.id,
					name: fellowshipItem.name,
					type: "fellowship",
					system: fSystem,
				},
			};
		} else {
			context.fellowship = null;
		}

		// Themes
		const themeEntries = this.system.themes || [];
		context.themes = await Promise.all(
			themeEntries.map(async (t, idx) => {
				const system = foundry.utils.duplicate(t);
				system.improveTrackLength = Number(t.improveTrackLength ?? 3);
				system.improvementsPerTrack = Number(t.improvementsPerTrack ?? 1);
				system.specials = await Promise.all(
					(t.specials || []).map(async (s) => ({
						...s,
						enrichedDescription: await TextEditor.enrichHTML(
							s.description || "",
						),
					})),
				);
				system.backside = this.#getBackside(t.id);
				system.enrichedNote = await TextEditor.enrichHTML(t.note || "");
				system.weakness = t.weaknessTags ?? [];
				system.levels = Object.keys(CONFIG.litm.theme_levels).reduce(
					(acc, level) => {
						acc[level] = game.i18n.localize(`Litm.levels.${level}`);
						return acc;
					},
					{},
				);
				system.themebooks = CONFIG.litm.theme_levels[t.level] ?? [];
				const level = t.level || "origin";
				const fallbackSrc = ["origin", "adventure", "greatness"].includes(level)
					? level
					: "origin";
				return {
					data: { _id: t.id, name: t.name, type: "theme", system },
					themeIndex: idx,
					themesrc:
						CONFIG.litm.theme_src[level] ||
						`systems/litm-rn/assets/media/${fallbackSrc}`,
					themeiconsrc:
						CONFIG.litm.themeicon_src[level] ||
						`systems/litm-rn/assets/media/icons/${fallbackSrc}`,
				};
			}),
		);

		// Backpack
		const backpackData = this.system.backpack;
		const enrichedNote = await TextEditor.enrichHTML(this.system.note || "");
		const storyEntries = await Promise.all(
			this.items
				.filter((i) => i.type === "story")
				.sort((a, b) => a.sort - b.sort)
				.map(async (s) => {
					const system = s.system.toObject();
					system.weakness = s.system.weakness;
					return {
						data: { _id: s.id, name: s.name, type: "story", system },
						collapsed: !this.#expandedStories.has(s.id),
					};
				}),
		);
		const stories = storyEntries.filter(
			(story) => story.data.system.isArchived !== true,
		);
		const archivedStories = storyEntries.filter(
			(story) => story.data.system.isArchived === true,
		);
		context.backpack = {
			name: game.i18n.localize("TYPES.Item.backpack"),
			id: "backpack",
			backside: this.#getBackside("backpack"),
			contents: backpackData?.contents ?? [],
			draftTags: this.system.backpackDraftTags ?? [],
			archiveContents: this.system.backpackArchive ?? [],
			stories,
			archivedStories,
		};
		context.notesCard = {
			id: "notes",
			backside: this.#getBackside("notes"),
			expanded: this.#notesCardExpanded,
			note: enrichedNote,
			tags: await Promise.all(
				(this.system.noticedTags ?? []).map(async (tag) => ({
					...tag,
					enrichedName: await TextEditor.enrichHTML(`{${tag.name}}`, {
						inline: true,
					}),
				})),
			),
		};

		// Hero
		const sys = this.system;
		const fellowshipId = sys.fellowshipId;
		const fellowMembers = getFellowshipActors(fellowshipId).filter(
			(actor) => actor.id !== this.actor.id,
		);
		const storedRels = sys.relationships || [];
		const relMap = {};
		for (const r of storedRels) relMap[r.fellowActorId] = r;
		const relationships = fellowMembers.map((m) => {
			const existing = relMap[m.id];
			return {
				id: existing?.id ?? foundry.utils.randomID(),
				fellowActorId: m.id,
				fellowName: m.name,
				name: existing?.name ?? game.i18n.localize("Litm.tags.relationship"),
				isScratched: existing
					? existing.isScratched === true || existing.isScratched === "true"
					: true,
				isPrivate: existing?.isPrivate ?? false,
			};
		});

		// Bio and quintessences from character data
		const enrichedBio = await TextEditor.enrichHTML(sys.bio || "");
		const quintessences = await Promise.all(
			(sys.quintessences || []).map(async (s) => ({
				id: s.id,
				name: s.name,
				description: s.description,
				enrichedDescription: await TextEditor.enrichHTML(s.description || ""),
			})),
		);

		context.hero = {
			name: sys.heroTitle || game.i18n.localize("Litm.other.hero"),
			id: "hero",
			backside: this.#getBackside("hero"),
			fulfillment: sys.fulfillment?.length
				? sys.fulfillment
				: CONFIG.litm.fulfillment,
			promise: sys.promise ?? 0,
			availableFulfillments: sys.availableFulfillments ?? 0,
			bio: sys.bio || "",
			enrichedBio,
			relationships,
			quintessences,
			noFellowship: !fellowshipId,
		};

		// Story tags
		context.storyTags = this.storyTags;
		context.editingEffectId = this.#editingEffectId;
		context.blankEditingEffectId = this.#blankEditingEffectId;
		context.editingBackpackTagId = this.#editingBackpackTagId;
		context.blankEditingBackpackTagId = this.#blankEditingBackpackTagId;
		context.editingNoticedTagId = this.#editingNoticedTagId;
		context.blankEditingNoticedTagId = this.#blankEditingNoticedTagId;

		// Roll selection tags — flat array of tagIds selected for this actor
		const rollTagSet =
			game.litm?.getSelectedTagIds?.(this.actor.id) || new Set();
		context.rollTags = [...rollTagSet];
		const burntTagIds = new Set();
		const actorSelection = game.litm?.rollSelection?.get(this.actor.id);
		for (const tagMap of actorSelection?.values() || []) {
			for (const [tagId, state] of tagMap) {
				if (state === "burned") burntTagIds.add(tagId);
			}
		}
		context.burntTags = [...burntTagIds].map((id) => ({ id }));

		context.helpingTags =
			game.settings.get("litm-rn", "storytags")?.helpingTags || [];

		// UI state
		context.tagsFocused = this.#tagsFocused;
		context.trackingCardsExpanded = this.#trackingCardsExpanded;
		context.tagsHovered = this.#tagsHovered;
		context.themeHovered = this.#themeHovered;
		context.backpackHovered = this.#backpackHovered;
		context.heroHovered = this.#heroHovered;
		context.hasAssignedUser = !!getAssignedUser(this.actor);
		context.availableFellowships = getAvailableFellowships(this.actor);

		return context;
	}

	_prepareSubmitData(event, form) {
		// Strip array-managed fields before DocumentSheetV2 validates, otherwise
		// FormData corruption of nested arrays (themes, backpackTags, etc.) fails validation.
		const fd = new foundry.applications.ux.FormDataExtended(form);
		const data = fd.object;
		if (data.system) {
			const keep = ["note", "fellowshipId", "promise"];
			for (const k of Object.keys(data.system)) {
				if (!keep.includes(k)) delete data.system[k];
			}
		}
		return data;
	}

	async _processSubmitData(event, form, submitData, options = {}) {
		// Only scalar-ish fields — array fields are managed by event handlers/cards
		const allowed = new Set([
			"name",
			"system.note",
			"system.fellowshipId",
			"system.promise",
		]);
		for (const key of Object.keys(submitData)) {
			if (key === "system" && submitData.system) {
				for (const k of Object.keys(submitData.system)) {
					if (!["note", "fellowshipId", "promise"].includes(k)) {
						delete submitData.system[k];
					}
				}
				if (!Object.keys(submitData.system).length) {
					delete submitData.system;
				}
			} else if (!allowed.has(key)) {
				delete submitData[key];
			}
		}

		// Bypass full-schema validation — existing corrupted themes would fail.
		// Only scalar fields are being saved, safe to skip validate.
		await super._processSubmitData(event, form, submitData, {
			...options,
			validate: false,
		});
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

		this.element.classList.add("litm--no-transitions");
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				this.element.classList.remove("litm--no-transitions");
			}),
		);

		// Restore scroll positions after re-render
		if (this.#savedScrollTops) {
			const saved = this.#savedScrollTops;

			requestAnimationFrame(() => {
				saved.forEach((scrollTop, key) => {
					if (key === "backpack") {
						const el = this.element.querySelector(
							".litm--character-backpack-card:not(.litm--character-notes-card) .litm--theme-front",
						);
						if (el) el.scrollTop = scrollTop;
						return;
					}
					if (key === "heroRelationships") {
						const el = this.element.querySelector(
							".litm--character-hero .litm--hero-relationships",
						);
						if (el) el.scrollTop = scrollTop;
						return;
					}
					if (key === "heroBio") {
						const el = this.element.querySelector(
							".litm--character-hero .litm--hero-bio",
						);
						if (el) el.scrollTop = scrollTop;
						return;
					}
					if (key === "heroTaglist") {
						const el = this.element.querySelector(
							".litm--character-hero .taglist",
						);
						if (el) el.scrollTop = scrollTop;
						return;
					}
					const [type, id, sub] = key.split("-");
					if (type === "theme" && id && sub) {
						const theme = this.element.querySelector(
							`.litm--character-theme[data-id="${id}"]`,
						);
						const el = theme?.querySelector(`.litm--theme-${sub}`);
						if (el) el.scrollTop = scrollTop;
					}
				});
				if (this.#savedScrollTops === saved) this.#savedScrollTops = null;
			});
		}

		const form = this.element;
		const doc = getOwningDocument(form);
		form.app = this;
		if (this.#tagContextMenu && this.#tagContextSourceId) {
			this.#tagContextSourceCard = form.querySelector(
				`.litm--story-tag[data-id="${this.#tagContextSourceId}"]`,
			);
			this.#tagContextSourceCard?.classList.add("litm--tag-context-open");
		}

		form
			.querySelectorAll("[data-click]")
			.forEach((el) =>
				el.addEventListener("click", this.#handleClicks.bind(this)),
			);
		form
			.querySelectorAll("[data-dblclick]")
			.forEach((el) =>
				el.addEventListener("dblclick", this.#handleDblclick.bind(this)),
			);
		form
			.querySelectorAll("[data-context]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#handleContextmenu.bind(this)),
			);
		form
			.querySelectorAll("[data-mousedown]")
			.forEach((el) =>
				el.addEventListener("mousedown", this.#handleMouseDown.bind(this)),
			);
		form
			.querySelectorAll("[data-drag]")
			.forEach((el) =>
				el.addEventListener(
					"mousedown",
					this.#onDragHandleMouseDown.bind(this),
				),
			);
		form
			.querySelectorAll("[data-drag-special]")
			.forEach((el) =>
				el.addEventListener("dragstart", this.#onSpecialDragStart.bind(this)),
			);
		form.querySelectorAll("[data-theme-sort-handle]").forEach((el) => {
			el.addEventListener("dragstart", this.#onThemeSortDragStart.bind(this));
			el.addEventListener("dragend", this.#onThemeSortDragEnd.bind(this));
		});
		form.addEventListener("dragover", this.#onThemeSortDragOver.bind(this), {
			capture: true,
		});
		form.addEventListener("drop", this.#onThemeSortDrop.bind(this), {
			capture: true,
		});
		this.#eventDocument?.removeEventListener(
			"dragstart",
			this.#onDocumentEffectDragStart,
		);
		this.#eventDocument?.removeEventListener(
			"dragend",
			this.#onDocumentEffectDragEnd,
		);
		this.#eventDocument = doc;
		doc.addEventListener("dragstart", this.#onDocumentEffectDragStart);
		doc.addEventListener("dragend", this.#onDocumentEffectDragEnd);
		const backpackDropCard = form.querySelector(
			".litm--character-backpack-card:not(.litm--character-notes-card)",
		);
		if (backpackDropCard) {
			backpackDropCard.addEventListener(
				"dragover",
				this.#onBackpackTagDragOver.bind(this),
			);
			backpackDropCard.addEventListener(
				"dragleave",
				this.#onBackpackTagDragLeave.bind(this),
			);
			backpackDropCard.addEventListener(
				"drop",
				this.#clearBackpackTagDropTarget.bind(this),
			);
		}
		form.addEventListener("mouseover", this.#handleMouseOver.bind(this));
		const effectLeaves = form.querySelectorAll(
			".litm--story-tag[data-context='tag-menu']",
		);
		const leafTooltipAnchor = effectLeaves[0];
		effectLeaves.forEach((leaf) => {
			leaf.addEventListener("mouseenter", () => {
				const type = leaf
					.querySelector(":scope > div")
					?.classList.contains("status")
					? "status"
					: "tag";
				game.tooltip.activate(leafTooltipAnchor, {
					text: t(`Litm.ui.${type}-context-hint`),
					direction: "UP",
				});
			});
			leaf.addEventListener("mouseleave", () => game.tooltip.deactivate());
		});

		// Hover lock: clicks inside a card keep its hover state
		form
			.querySelectorAll(
				".litm--character-theme, .litm--character-backpack-card, .litm--character-hero",
			)
			.forEach((el) => {
				el.addEventListener("click", () => {
					this.#hoverLock = el.dataset.id;
				});
				el.addEventListener("mouseleave", () => {
					if (this.#suppressHoverEvents) return;
					this.#hoverLock = null;
					el.classList.remove("hovered");
					if (this.#themeHovered === el.dataset.id) this.#themeHovered = null;
					if (this.#backpackHovered === el.dataset.id)
						this.#backpackHovered = null;
					if (this.#heroHovered === el.dataset.id) this.#heroHovered = null;
				});
			});

		// Effect value checkboxes
		form
			.querySelectorAll(
				"li.litm--story-tag input.litm--story-checkbox[type='checkbox']",
			)
			.forEach((el) => {
				el.addEventListener("mousedown", (e) => e.stopPropagation());
				el.addEventListener("click", (e) => e.stopPropagation());
				el.addEventListener("change", this.#onEffectValueChange.bind(this));
			});
		// Contenteditable
		form
			.querySelectorAll(".litm--story-label-name[contenteditable='true']")
			.forEach((el) => {
				el.addEventListener(
					"keydown",
					this.#onContenteditableKeyDown.bind(this),
				);
				el.addEventListener("blur", this.#onContenteditableBlur.bind(this));
				el.addEventListener("paste", this.#onContenteditablePaste.bind(this));
			});
		form
			.querySelectorAll("[data-backpack-tag-editor][contenteditable='true']")
			.forEach((el) => {
				el.addEventListener(
					"keydown",
					this.#onContenteditableKeyDown.bind(this),
				);
				el.addEventListener("blur", this.#onBackpackTagEditorBlur.bind(this));
				el.addEventListener("paste", this.#onContenteditablePaste.bind(this));
			});
		form
			.querySelectorAll("[data-noticed-tag-editor][contenteditable='true']")
			.forEach((el) => {
				el.addEventListener(
					"keydown",
					this.#onContenteditableKeyDown.bind(this),
				);
				el.addEventListener("blur", this.#onNoticedTagEditorBlur.bind(this));
				el.addEventListener("paste", this.#onContenteditablePaste.bind(this));
			});
		if (this.#editingEffectId) {
			requestAnimationFrame(() => this.#focusEffectEditor(3));
		}
		if (this.#editingBackpackTagId) {
			requestAnimationFrame(() => {
				const editor = this.element.querySelector(
					`[data-backpack-tag-editor="${this.#editingBackpackTagId}"][contenteditable="true"]`,
				);
				editor?.focus();
			});
		}
		if (this.#editingNoticedTagId) {
			requestAnimationFrame(() =>
				this.element
					.querySelector(
						`[data-noticed-tag-editor="${this.#editingNoticedTagId}"][contenteditable="true"]`,
					)
					?.focus(),
			);
		}

		// Hooks
		if (!this.#fellowshipUpdateHook) {
			this.#fellowshipUpdateHook = Hooks.on("updateItem", (item) => {
				if (item.type !== "fellowship" || item.isEmbedded) return;
				const includesActor = item.system.members?.some(
					(member) => member.actorId === this.actor.id,
				);
				if (item.id === this.system.fellowshipId || includesActor)
					this.render();
			});
		}
		if (!this.#actorUpdateHookId) {
			this.#actorUpdateHookId = Hooks.on("updateActor", (actor, changes) => {
				const fellowshipChanged = foundry.utils.hasProperty(
					changes,
					"system.fellowshipId",
				);
				if (actor.id === this.actor.id && this.rendered) {
					const windowTitle = this.element?.querySelector(".window-title");
					if (windowTitle)
						windowTitle.textContent = actor.system.shortDescription ?? "";
					this.render();
				} else if (fellowshipChanged && this.rendered) {
					this.render();
				}
			});
		}
		if (!this.#storyTagsHookId) {
			this.#storyTagsHookId = Hooks.on("litmStoryTagsUpdated", (opts = {}) => {
				if (opts.sourceAppId !== this.appId && this.rendered) this.render();
			});
		}
		if (!this.#actorDataUpdateHookId) {
			this.#actorDataUpdateHookId = Hooks.on("litmActorDataUpdated", (uuid) => {
				if (uuid === this.actor.uuid && this.rendered) this.render();
			});
		}
	}

	_onClose(options) {
		game.tooltip.deactivate();
		this.#eventDocument?.removeEventListener(
			"dragstart",
			this.#onDocumentEffectDragStart,
		);
		this.#eventDocument?.removeEventListener(
			"dragend",
			this.#onDocumentEffectDragEnd,
		);
		this.#eventDocument = null;
		this.#onDocumentEffectDragEnd();
		this.#closeTagContextMenu();
		if (this.#fellowshipUpdateHook) {
			Hooks.off("updateItem", this.#fellowshipUpdateHook);
			this.#fellowshipUpdateHook = null;
		}
		if (this.#actorUpdateHookId) {
			Hooks.off("updateActor", this.#actorUpdateHookId);
			this.#actorUpdateHookId = null;
		}
		if (this.#storyTagsHookId) {
			Hooks.off("litmStoryTagsUpdated", this.#storyTagsHookId);
			this.#storyTagsHookId = null;
		}
		if (this.#actorDataUpdateHookId) {
			Hooks.off("litmActorDataUpdated", this.#actorDataUpdateHookId);
			this.#actorDataUpdateHookId = null;
		}
		return super._onClose(options);
	}

	async render(options) {
		game.tooltip?.deactivate?.();
		this.#suppressHoverEvents = true;
		if (this.element && !this.#savedScrollTops) {
			const map = new Map();
			this.element
				.querySelectorAll(".litm--character-theme .litm--theme-back")
				.forEach((el) => {
					const id = el.closest(".litm--character-theme")?.dataset.id;
					if (id) map.set(`theme-${id}-back`, el.scrollTop);
				});
			this.element
				.querySelectorAll(".litm--character-theme .litm--theme-front")
				.forEach((el) => {
					const id = el.closest(".litm--character-theme")?.dataset.id;
					if (id) map.set(`theme-${id}-front`, el.scrollTop);
				});
			const backpack = this.element.querySelector(
				".litm--character-backpack-card:not(.litm--character-notes-card) .litm--theme-front",
			);
			if (backpack) map.set("backpack", backpack.scrollTop);
			const heroRelationships = this.element.querySelector(
				".litm--character-hero .litm--hero-relationships",
			);
			if (heroRelationships)
				map.set("heroRelationships", heroRelationships.scrollTop);
			const heroTaglist = this.element.querySelector(
				".litm--character-hero .taglist",
			);
			if (heroTaglist) map.set("heroTaglist", heroTaglist.scrollTop);
			const heroBio = this.element.querySelector(
				".litm--character-hero .litm--hero-bio",
			);
			if (heroBio) map.set("heroBio", heroBio.scrollTop);
			this.#savedScrollTops = map;
		}
		const result = await super.render(options);
		requestAnimationFrame(() => {
			this.#suppressHoverEvents = false;
		});
		return result;
	}

	async _onDrop(dragEvent) {
		// Handle specials via shared utility
		const specialData = game.litm.specials.readSpecialDragData(dragEvent);
		if (specialData) return this.#onDropSpecial(dragEvent, specialData);

		// Fall back to raw parsing for tags/statuses
		const dragData = dragEvent.dataTransfer.getData("text/plain");
		if (!dragData) return;
		let data;
		try {
			data = JSON.parse(dragData);
		} catch {
			return;
		}

		// Handle dropping tags and statuses
		if (!["tag", "status"].includes(data.type)) return super._onDrop(dragEvent);

		// The notes mini-card is not an effect drop target.
		if (dragEvent.target.closest(".litm--character-notes-card")) return;

		// Check if dropped on a story-theme inside backpack
		const storyElement = dragEvent.target.closest(".litm--backpack-story-item");
		const backpackElement = dragEvent.target.closest(
			".litm--character-backpack-card:not(.litm--character-notes-card)",
		);

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
			const tags = foundry.utils.duplicate(this.system.backpackTags ?? []);
			tags.push({
				id: foundry.utils.randomID(),
				name: data.name,
				type: "backpack",
				isScratched: false,
				isPrivate: createPrivate(dragEvent),
			});
			await this.actor.update({ "system.backpackTags": tags });
			return;
		}

		// Default behavior — add as ActiveEffect on the actor
		const flagData = {
			type: data.type,
			isScratched: data.isScratched,
			isPrivate: createPrivate(dragEvent),
		};
		if (data.type === "status") {
			flagData.values = data.values;
			flagData.value = data.value || 0;
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

	#focusEffectEditor(retries = 0) {
		const editor = this.element?.querySelector(
			`.litm--story-tag[data-id="${this.#editingEffectId}"] .litm--story-label-name[contenteditable="true"]`,
		);
		if (!editor) {
			if (retries > 0)
				requestAnimationFrame(() => this.#focusEffectEditor(retries - 1));
			return;
		}
		const doc = getOwningDocument(editor);
		editor.focus({ preventScroll: true });
		const range = doc.createRange();
		range.selectNodeContents(editor);
		const selection = doc.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		if (doc.activeElement !== editor && retries > 0) {
			requestAnimationFrame(() => this.#focusEffectEditor(retries - 1));
		}
	}

	#onBackpackTagDragOver(event) {
		if (this.#draggedEffectType !== "tag") return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		event.currentTarget.classList.add("litm--tag-drop-target");
	}

	#onBackpackTagDragLeave(event) {
		if (
			event.relatedTarget &&
			event.currentTarget.contains(event.relatedTarget)
		)
			return;
		this.#clearBackpackTagDropTarget(event);
	}

	#clearBackpackTagDropTarget(event) {
		event.currentTarget.classList.remove("litm--tag-drop-target");
	}

	// Prevent dropping more than 4 themes on the character sheet
	async _onDropItem(event, data) {
		const item = await CONFIG.Item.documentClass.fromDropData(data);
		if (!["fellowship", "story"].includes(item.type)) return;

		if (this.items.get(item.id)) return this._onSortItem(event, item);

		if (item.type === "fellowship") {
			return ui.notifications.warn(
				game.i18n.localize("Litm.ui.warn-fellowship-drop"),
			);
		}

		const itemData = item.toObject();
		delete itemData._id;
		this.#regenerateInternalIds(itemData);

		return this.actor.createEmbeddedDocuments("Item", [itemData]);
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
		if (this.#hoverLock) return;

		const el = event.currentTarget;

		el.querySelectorAll(".litm--character-theme").forEach((el) =>
			el.classList.remove("hovered"),
		);
		el.querySelectorAll(".litm--character-backpack-card").forEach((el) =>
			el.classList.remove("hovered"),
		);
		el.querySelectorAll(".litm--character-hero").forEach((el) =>
			el.classList.remove("hovered"),
		);

		const t = event.target.closest(".litm--character-theme");
		const b = event.target.closest(".litm--character-backpack-card");
		const h = event.target.closest(".litm--character-hero");

		if (t) {
			t.classList.add("hovered");
			this.#themeHovered = t.dataset.id;
		} else this.#themeHovered = null;

		if (b) {
			b.classList.add("hovered");
			this.#backpackHovered = b.dataset.id;
		} else this.#backpackHovered = null;

		if (h) {
			h.classList.add("hovered");
			this.#heroHovered = h.dataset.id;
		} else this.#heroHovered = null;

		if (event.target.closest(".litm--character-story-tags"))
			this.#tagsHovered = true;
		else this.#tagsHovered = false;
	}

	#handleClicks(event) {
		const t = event.currentTarget;
		if (t.isContentEditable) return;
		event.preventDefault();
		const action = t.dataset.click;
		const id = t.dataset.id;

		switch (action) {
			case "open-fellowship-advancement":
				event.stopPropagation();
				new FellowshipAdvancementApp(this.system.fellowship.uuid).render({
					force: true,
				});
				break;
			case "add-tag":
				this.#addTag(event);
				break;
			case "add-status":
				this.#addStatus(event);
				break;
			case "add-story":
				this.#addStory();
				break;
			case "add-backpack-tag":
				this.#addBackpackTag(event);
				break;
			case "add-archived-backpack-tag":
				this.#addArchivedBackpackTag(event);
				break;
			case "add-archived-story":
				this.#addArchivedStory();
				break;
			case "toggle-notes-card":
				this.#notesCardExpanded = !this.#notesCardExpanded;
				this.element
					.querySelector(".litm--character-notes-card")
					?.classList.toggle("expanded", this.#notesCardExpanded);
				t.classList.toggle("active", this.#notesCardExpanded);
				break;
			case "add-noticed-tag":
				this.#addNoticedTag();
				break;
			case "open-reference":
				game.litm.reference.open(t.dataset.referenceRole || "quickRules");
				break;
			case "remove-noticed-tag":
				this.#removeNoticedTag(id);
				break;
			case "increase":
				this.#increase(event);
				break;
			case "open-theme-advancement":
				event.stopImmediatePropagation();
				new ThemeAdvancementApp(this.actor.uuid, {
					themeIndex: Number(t.dataset.themeIndex),
					mode: t.dataset.mode,
				}).render({ force: true });
				break;
			case "open-promise-fulfillment":
				event.stopImmediatePropagation();
				new PromiseFulfillmentApp(this.actor.uuid).render({ force: true });
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
			case "toggle-tag-scratch":
				this.#toggleTagScratch(id);
				break;
			case "send-special-to-chat":
				this.#sendSpecialToChat(event);
				break;
			case "toggle-backside":
				this.#toggleBackside(id);
				break;
			case "toggle-collapse":
				this.#toggleCollapse(t);
				break;
			case "toggle-tracking-cards":
				this.#trackingCardsExpanded = !this.#trackingCardsExpanded;
				this.render();
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
			case "tag-menu":
				event.preventDefault();
				event.stopPropagation();
				this.#openTagContextMenu(event, t.dataset.id, t);
				break;
		}
	}

	#findCharacterTag(id) {
		const fellowship = this.system.fellowship;
		if (fellowship?.system.themeTag?.id === id)
			return {
				tag: { ...fellowship.system.themeTag, type: "themeCrispy" },
				kind: "fellowship",
			};
		const fellowshipPower = fellowship?.system.powerTags?.find(
			(tag) => tag.id === id,
		);
		if (fellowshipPower)
			return {
				tag: { ...fellowshipPower, type: "powerCrispy" },
				kind: "fellowship",
			};
		const fellowshipWeakness = fellowship?.system.weaknessTags?.find(
			(tag) => tag.id === id,
		);
		if (fellowshipWeakness)
			return {
				tag: { ...fellowshipWeakness, type: "weaknessTag" },
				kind: "fellowship",
			};

		for (const theme of this.system.themes ?? []) {
			if (theme.themeTag?.id === id)
				return {
					tag: {
						...theme.themeTag,
						type: "themeTag",
						ownerType: "theme",
						ownerId: theme.id,
					},
					kind: "theme-title",
				};
			const powerTag = (theme.powerTags ?? []).find((tag) => tag.id === id);
			if (powerTag)
				return {
					tag: {
						...powerTag,
						type: "powerTag",
						ownerType: "theme",
						ownerId: theme.id,
					},
					kind: "theme-power",
				};
			const weaknessTag = (theme.weaknessTags ?? []).find(
				(tag) => tag.id === id,
			);
			if (weaknessTag)
				return {
					tag: {
						...weaknessTag,
						type: "weaknessTag",
						ownerType: "theme",
						ownerId: theme.id,
						isHindering: true,
					},
					kind: "theme-weakness",
				};
		}

		const backpackTag = (this.system.backpackTags ?? []).find(
			(tag) => tag.id === id,
		);
		if (backpackTag)
			return { tag: { ...backpackTag, type: "backpack" }, kind: "backpack" };

		const relationship = (this.system.relationships ?? []).find(
			(tag) => tag.id === id,
		);
		if (relationship)
			return { tag: { ...relationship, type: "hero" }, kind: "hero" };

		for (const story of this.items.filter((item) => item.type === "story")) {
			if (story.system.themeTag?.id === id)
				return {
					tag: {
						...story.system.themeTag,
						type: "themeTag",
						ownerType: "story",
						ownerId: story.id,
					},
					kind: "story-title",
					story,
				};
			const powerTag = (story.system.powerTags ?? []).find(
				(tag) => tag.id === id,
			);
			if (powerTag)
				return {
					tag: {
						...powerTag,
						type: "powerTag",
						ownerType: "story",
						ownerId: story.id,
					},
					kind: "story-tag",
					story,
				};
			const weaknessTag = (story.system.weakness ?? []).find(
				(tag) => tag.id === id,
			);
			if (weaknessTag)
				return {
					tag: {
						...weaknessTag,
						type: "weaknessTag",
						ownerType: "story",
						ownerId: story.id,
						isHindering: true,
					},
					kind: "story-tag",
					story,
				};
		}

		// Structured character tags take precedence over their mirrored effects.
		// Starter pregens intentionally use the tag ID as the ActiveEffect ID, so
		// resolving effects first would misclassify theme tags as generic tags.
		const effect = this.actor.effects.get(id);
		const effectFlags = effect?.flags?.["litm-rn"];
		if (effect && ["tag", "status"].includes(effectFlags?.type)) {
			return {
				tag: {
					...foundry.utils.deepClone(effectFlags),
					id: effect.id,
					name: effect.name,
					type: effectFlags.type,
				},
				kind: "effect",
				effect,
			};
		}

		const found = this.system.allTags.find((tag) => tag.id === id);
		return found
			? { tag: foundry.utils.duplicate(found), kind: "other" }
			: null;
	}

	#openTagContextMenu(event, id, trigger) {
		const resolved = this.#findCharacterTag(id);
		if (!resolved) return;
		const doc = getOwningDocument(trigger);
		const win = getOwningWindow(trigger);
		this.#closeTagContextMenu();
		this.#tagContextSourceCard = trigger.closest(
			".litm--story-tag, .litm--character-theme, .litm--character-backpack-card, .litm--character-hero",
		);
		this.#tagContextSourceId =
			resolved.kind === "effect" ? resolved.tag.id : null;
		this.#tagContextSourceCard?.classList.add("litm--tag-context-open");

		const menu = doc.createElement("div");
		menu.className = "litm--character-tag-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;

		const addOption = (
			label,
			icon,
			callback = null,
			{ close = true, separator = false } = {},
		) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle("litm--character-tag-menu-separator", separator);
			button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
			button.addEventListener("click", async () => {
				if (close) this.#closeTagContextMenu();
				if (callback) await callback(button);
				else ui.notifications.info(t("Litm.ui.tag-menu-placeholder"));
			});
			menu.append(button);
		};

		if (resolved.kind === "effect") {
			addOption(t("Litm.ui.edit-effect"), "fa-solid fa-pen", () =>
				this.#editEffectTag(resolved.tag.id),
			);
		}

		addOption(
			t(
				resolved.tag.isPrivate
					? "Litm.ui.reveal-secret-tag"
					: "Litm.ui.make-secret",
			),
			"fa-solid fa-mask",
			() => this.#toggleTagPrivate(resolved),
		);

		const share = doc.createElement("div");
		share.className = "litm--character-tag-menu-share";
		const shareLabel = doc.createElement("div");
		shareLabel.className = "litm--character-tag-menu-label";
		shareLabel.innerHTML = `<i class="fa-solid fa-share-nodes" aria-hidden="true"></i><span>${t("Litm.ui.share-roll-with")}</span>`;
		share.append(shareLabel);
		const portraits = doc.createElement("div");
		portraits.className = "litm--character-tag-menu-portraits";
		const fellowshipId = this.system.fellowshipId;
		const fellowMembers = getFellowshipActors(fellowshipId).filter(
			(actor) => actor.type === "character" && actor.id !== this.actor.id,
		);
		for (const actor of fellowMembers) {
			const button = doc.createElement("button");
			button.type = "button";
			button.dataset.actorId = actor.id;
			button.dataset.tooltip = actor.name;
			const image = doc.createElement("img");
			image.src = actor.img;
			image.alt = actor.name;
			button.append(image);
			button.addEventListener("click", async (event) => {
				event.stopPropagation();
				this.#closeTagContextMenu();
				await this.#shareTagInRoll(resolved, actor);
			});
			portraits.append(button);
		}
		share.append(portraits);
		menu.append(share);

		const isBurnedInRoll = [
			...(game.litm?.rollSelection?.get(this.actor.id)?.values() || []),
		].some((tagMap) => tagMap.get(resolved.tag.id) === "burned");
		if (
			(["theme-title", "theme-power", "story-title", "backpack"].includes(
				resolved.kind,
			) ||
				(resolved.kind === "effect" && resolved.tag.type === "tag")) &&
			!resolved.tag.isCrispy &&
			!isBurnedInRoll
		) {
			addOption(t("Litm.ui.burn-in-roll"), "fa-solid fa-fire", () =>
				this.#burnTagInRoll(resolved.tag),
			);
		}
		if (resolved.kind === "effect" && resolved.tag.type === "tag") {
			addOption(
				t(
					resolved.tag.isCrispy
						? "Litm.ui.single-use-active"
						: "Litm.ui.make-single-use",
				),
				"fa-solid fa-hourglass-half",
				async () => {
					const isCrispy = !resolved.tag.isCrispy;
					if (isCrispy)
						game.litm?.normalizeBurnedTagSelections?.(resolved.tag.id);
					await this.#toggleEffectFlag(resolved.tag.id, "isCrispy", isCrispy);
					if (isCrispy)
						game.litm?.normalizeBurnedTagSelections?.(resolved.tag.id);
				},
			);
		}
		if (resolved.kind === "effect" && resolved.tag.type === "status") {
			addOption(
				t("Litm.ui.decrease-status"),
				"fa-solid fa-arrow-left",
				async () => {
					const keepOpen = await this.#decreaseEffectStatus(resolved.tag.id);
					if (!keepOpen) this.#closeTagContextMenu();
				},
				{ close: false },
			);
		}
		if (resolved.kind === "effect" && resolved.tag.type === "tag") {
			addOption(t("Litm.ui.to-backpack"), "fa-solid fa-backpack", () =>
				this.#moveEffectTagToBackpack(resolved),
			);
		}
		if (resolved.kind === "backpack" && !resolved.tag.isScratched) {
			addOption(
				t("Litm.ui.move-to-tracking-cards"),
				"fa-solid fa-arrow-right-to-bracket",
				() => this.#moveBackpackTagToTracking(resolved.tag),
			);
		}
		if (["story-title", "story-tag"].includes(resolved.kind))
			addOption(t("Litm.ui.open-story-theme"), "fa-solid fa-book-open", () =>
				resolved.story?.sheet.render({ force: true }),
			);
		if (["backpack", "story-tag"].includes(resolved.kind))
			addOption(
				t("Litm.ui.remove"),
				"fa-solid fa-trash",
				() => this.#removeCharacterTag(resolved),
				{ separator: true },
			);
		if (resolved.kind === "effect")
			addOption(
				t("Litm.ui.remove"),
				"fa-solid fa-trash",
				() => this.#deleteEffectTag(resolved.tag.id),
				{ separator: true },
			);
		if (resolved.kind === "story-title")
			addOption(
				t("Litm.ui.remove-story-theme"),
				"fa-solid fa-trash",
				() => this.#removeStoryTheme(resolved.story),
				{ separator: true },
			);

		doc.body.append(menu);
		this.#tagContextMenu = menu;
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			if (rect.right > win.innerWidth)
				menu.style.left = `${Math.max(8, win.innerWidth - rect.width - 8)}px`;
			if (rect.bottom > win.innerHeight)
				menu.style.top = `${Math.max(8, win.innerHeight - rect.height - 8)}px`;
		});
		setTimeout(
			() => doc.addEventListener("pointerdown", this.#onTagContextOutside),
			0,
		);
	}

	#onTagContextOutside = (event) => {
		if (!this.#tagContextMenu?.contains(event.target))
			this.#closeTagContextMenu();
	};

	#closeTagContextMenu() {
		this.#tagContextMenu?.ownerDocument.removeEventListener(
			"pointerdown",
			this.#onTagContextOutside,
		);
		this.#tagContextMenu?.remove();
		this.#tagContextMenu = null;
		this.#tagContextSourceCard?.classList.remove("litm--tag-context-open");
		this.#tagContextSourceCard = null;
		this.#tagContextSourceId = null;
	}

	#burnTagInRoll(tag) {
		if (
			tag.isCrispy ||
			["crispy", "powerCrispy", "themeCrispy"].includes(tag.type)
		)
			return;
		const ref =
			this.#findCharacterTag(tag.id)?.kind === "fellowship"
				? "fellowship"
				: this.actor.uuid;
		game.litm?.addTagToRoll?.(this.actor.id, ref, tag.id, "burned");
		this.updateRollSelectionDisplay();
	}

	async #editEffectTag(id) {
		if (!this.actor.effects.get(id)) return;
		this.#blankEditingEffectId = null;
		this.#editingEffectId = id;
		await this.render({ force: true });
		this.#focusEffectEditor(3);
	}

	async #shareTagInRoll({ tag, kind }, targetActor) {
		if (targetActor.type !== "character") return;

		const senderUser = getAssignedUser(this.actor) ?? game.user;
		const targetUser = getAssignedUser(targetActor);
		if (!targetUser) {
			ui.notifications.warn(t("Litm.ui.tag-share-no-recipient"));
			return;
		}

		const isWeakness =
			kind === "theme-weakness" ||
			tag.type === "weaknessTag" ||
			tag.type === "weaknessStoryTag" ||
			tag.isHindering;
		const shareId = foundry.utils.randomID();
		const sharedTag = {
			...foundry.utils.deepClone(tag),
			id: shareId,
			sourceTagId: tag.id,
			// A status keeps its roll semantics even when it is hindering. Converting
			// it to a weakness tag would make the shared copy burnable and award XP.
			type:
				tag.type === "status"
					? "status"
					: isWeakness
						? "weaknessTag"
						: tag.type || "tag",
			isHindering: isWeakness,
			senderActorId: this.actor.id,
			targetActorId: targetActor.id,
			actorRef: this.actor.uuid,
		};
		const enrichedTag = await TextEditor.enrichHTML(
			`[@${isWeakness ? "tw" : "t"} ${tag.name}]`,
			{ async: true },
		);
		const content = await foundry.applications.handlebars.renderTemplate(
			"systems/litm-rn/templates/chat/tag-share.html",
			{
				senderName: this.actor.name,
				targetName: targetActor.name,
				enrichedTag,
			},
		);
		const whisper = new Set(
			[
				senderUser?.id,
				targetUser.id,
				...game.users.filter((user) => user.isGM).map((user) => user.id),
			].filter(Boolean),
		);

		await CONFIG.ChatMessage.documentClass.create({
			content,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: this.actor,
			}),
			whisper: [...whisper],
			flags: {
				["litm-rn"]: {
					tagShare: {
						status: "pending",
						shareId,
						senderActorId: this.actor.id,
						senderUserId: senderUser?.id ?? game.user.id,
						targetActorId: targetActor.id,
						targetUserId: targetUser.id,
						tag: sharedTag,
					},
				},
			},
		});
	}

	async #moveBackpackTagToTracking(tag) {
		const tags = foundry.utils.duplicate(this.system.backpackTags ?? []);
		const index = tags.findIndex((entry) => entry.id === tag.id);
		if (index < 0 || tags[index].isScratched) return;
		const [movedTag] = tags.splice(index, 1);
		const linkedEffect = this.actor.effects.get(movedTag.id);
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
					name: movedTag.name,
					flags: {
						["litm-rn"]: {
							type: "tag",
							isScratched: false,
							isPrivate: movedTag.isPrivate ?? false,
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
		game.litm?.removeTagFromAllRolls?.(tag.id);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	async #moveEffectTagToBackpack({ tag }) {
		const tags = foundry.utils.duplicate(this.system.backpackTags ?? []);
		tags.push({
			id: tag.id,
			name: tag.name,
			type: "backpack",
			isScratched: tag.isScratched ?? false,
			isPrivate: tag.isPrivate ?? false,
		});
		await this.actor.update(
			{ "system.backpackTags": tags },
			{ validate: false, render: false },
		);
		await this.actor.updateEmbeddedDocuments(
			"ActiveEffect",
			[
				{
					_id: tag.id,
					"flags.litm-rn.ownerType": "backpack",
					"flags.litm-rn.ownerId": "backpack",
				},
			],
			{ render: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	async #toggleEffectFlag(id, flag, value) {
		await this.actor.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: id, [`flags.litm-rn.${flag}`]: value },
		]);
		this.#refreshEffectTags();
	}

	async #decreaseEffectStatus(id) {
		const effect = this.actor.effects.get(id);
		if (!effect) return false;
		const values = [...(effect.flags?.["litm-rn"]?.values ?? [])];
		const highest = values.findLastIndex(Boolean);
		if (highest <= 0) {
			await this.#deleteEffectTag(id);
			return false;
		}
		const shifted = new Array(Math.max(6, values.length)).fill(false);
		for (let index = 1; index < values.length; index += 1) {
			if (values[index]) shifted[index - 1] = index;
		}
		await this.actor.updateEmbeddedDocuments(
			"ActiveEffect",
			[
				{
					_id: id,
					"flags.litm-rn.values": shifted,
					"flags.litm-rn.value": Math.max(0, highest),
				},
			],
			{ render: false },
		);
		const li = this.element.querySelector(`.litm--story-tag[data-id="${id}"]`);
		li?.querySelectorAll(".litm--story-checkbox").forEach((checkbox, index) => {
			checkbox.checked = Boolean(shifted[index]);
		});
		this.#refreshEffectTags();
		return highest > 1;
	}

	async #deleteEffectTag(id) {
		game.litm?.removeTagFromAllRolls?.(id);
		await this.actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
		this.#refreshEffectTags();
	}

	#refreshEffectTags() {
		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();
		Hooks.callAll("litmStoryTagsUpdated", { sourceAppId: this.appId });
	}

	async #removeCharacterTag({ tag, kind, story }) {
		if (kind === "backpack") {
			const tags = (this.system.backpackTags ?? []).filter(
				(entry) => entry.id !== tag.id,
			);
			await this.actor.update(
				{ "system.backpackTags": tags },
				{ validate: false },
			);
		} else if (kind === "story-tag" && story) {
			const field =
				tag.type === "weaknessTag" || tag.type === "weaknessStoryTag"
					? "weaknessTags"
					: "powerTags";
			const tags = (story.system[field] ?? []).filter(
				(entry) => entry.id !== tag.id,
			);
			await story.update({ [`system.${field}`]: tags });
		} else {
			return;
		}
		game.litm?.removeTagFromAllRolls?.(tag.id);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	async #removeStoryTheme(story) {
		if (!story || story.type !== "story") return;
		if (!(await confirmDelete("Litm.other.story-theme"))) return;
		await this.actor.deleteEmbeddedDocuments("Item", [story.id]);
	}

	async #toggleTagPrivate({ tag, kind, story }) {
		const isPrivate = !tag.isPrivate;

		if (kind === "effect") {
			await this.#toggleEffectFlag(tag.id, "isPrivate", isPrivate);
		} else if (
			["theme-title", "theme-power", "theme-weakness"].includes(kind)
		) {
			const themes = foundry.utils.duplicate(this.system.themes ?? []);
			for (const theme of themes) {
				if (theme.themeTag?.id === tag.id) theme.themeTag.isPrivate = isPrivate;
				const powerTag = theme.powerTags?.find((entry) => entry.id === tag.id);
				if (powerTag) powerTag.isPrivate = isPrivate;
				const weaknessTag = theme.weaknessTags?.find(
					(entry) => entry.id === tag.id,
				);
				if (weaknessTag) weaknessTag.isPrivate = isPrivate;
			}
			await this.actor.update({ "system.themes": themes }, { validate: false });
		} else if (kind === "backpack") {
			const tags = foundry.utils.duplicate(this.system.backpackTags ?? []);
			const match = tags.find((entry) => entry.id === tag.id);
			if (match) match.isPrivate = isPrivate;
			await this.actor.update(
				{ "system.backpackTags": tags },
				{ validate: false },
			);
		} else if (kind === "hero") {
			const relationships = foundry.utils.duplicate(
				this.system.relationships ?? [],
			);
			const match = relationships.find((entry) => entry.id === tag.id);
			if (match) match.isPrivate = isPrivate;
			await this.actor.update(
				{ "system.relationships": relationships },
				{ validate: false },
			);
		} else if (story && ["story-title", "story-tag"].includes(kind)) {
			if (kind === "story-title") {
				await story.update({ "system.themeTag.isPrivate": isPrivate });
			} else {
				const powerTags = foundry.utils.duplicate(story.system.powerTags ?? []);
				const weakness = foundry.utils.duplicate(story.system.weakness ?? []);
				const powerTag = powerTags.find((entry) => entry.id === tag.id);
				const weaknessTag = weakness.find((entry) => entry.id === tag.id);
				if (powerTag) powerTag.isPrivate = isPrivate;
				if (weaknessTag) weaknessTag.isPrivate = isPrivate;
				await story.update({
					"system.powerTags": powerTags,
					"system.weaknessTags": weakness,
				});
			}
		}

		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	async #toggleTagScratch(id) {
		const resolved = this.#findCharacterTag(id);
		if (!resolved) return;
		const selectedElement = this.element.querySelector(
			`[data-id="${id}"][data-selected]`,
		);
		if (selectedElement) {
			game.litm?.removeTagFromActorRoll?.(this.actor.id, id);
			this.updateRollSelectionDisplay();
		}
		await this.toggleScratchTag(resolved.tag);
	}

	#onThemeSortDragStart(event) {
		if (!this.actor.isOwner) {
			event.preventDefault();
			return;
		}

		const card = event.currentTarget.closest(".litm--character-theme");
		if (!card) return;

		this.#themeSortSource = card;
		this.#themeSortRects = new Map(
			[
				...card.parentElement.querySelectorAll(
					":scope > .litm--character-theme",
				),
			].map((theme) => [theme, theme.getBoundingClientRect()]),
		);
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(
			"text/plain",
			JSON.stringify({
				type: "litmThemeSort",
				themeIndex: Number(event.currentTarget.dataset.themeIndex),
			}),
		);

		card
			.closest(".litm--character-themes")
			?.classList.add("litm--theme-sort-active");
		requestAnimationFrame(() => card.classList.add("litm--theme-sort-source"));
	}

	#onThemeSortDragOver(event) {
		if (!this.#themeSortSource) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";

		const candidates = [...this.#themeSortRects.entries()].filter(
			([, rect]) =>
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom,
		);
		const target =
			candidates.reduce((nearest, [card, rect]) => {
				const distance = Math.hypot(
					event.clientX - (rect.left + rect.width / 2),
					event.clientY - (rect.top + rect.height / 2),
				);
				return !nearest || distance < nearest.distance
					? { card, distance }
					: nearest;
			}, null)?.card ?? this.#themeSortSource;
		if (target !== this.#themeSortTarget) this.#setThemeSortPreview(target);
	}

	async #onThemeSortDrop(event) {
		if (!this.#themeSortSource) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const target = this.#themeSortTarget;
		if (!target) {
			this.#clearThemeSortPreview();
			return;
		}
		const sourceIndex = Number(
			this.#themeSortSource.querySelector("[data-theme-sort-handle]")?.dataset
				.themeIndex,
		);
		const targetIndex = Number(
			target.querySelector("[data-theme-sort-handle]")?.dataset.themeIndex,
		);

		this.#clearThemeSortPreview();
		if (
			!Number.isInteger(sourceIndex) ||
			!Number.isInteger(targetIndex) ||
			sourceIndex === targetIndex
		)
			return;

		const themes = foundry.utils.duplicate(this.actor.system.themes ?? []);
		if (!themes[sourceIndex] || !themes[targetIndex]) return;
		[themes[sourceIndex], themes[targetIndex]] = [
			themes[targetIndex],
			themes[sourceIndex],
		];
		await this.actor.update({ "system.themes": themes });
	}

	#onThemeSortDragEnd() {
		this.#clearThemeSortPreview();
	}

	#setThemeSortPreview(target) {
		const source = this.#themeSortSource;
		if (!source) return;

		if (this.#themeSortTarget) {
			this.#themeSortTarget.classList.remove("litm--theme-sort-target");
			this.#themeSortTarget.style.translate = "";
		}
		source.style.translate = "";
		this.#themeSortTarget = null;
		if (target === source) return;

		const deltaX = target.offsetLeft - source.offsetLeft;
		const deltaY = target.offsetTop - source.offsetTop;
		source.style.translate = `${deltaX}px ${deltaY}px`;
		target.style.translate = `${-deltaX}px ${-deltaY}px`;
		target.classList.add("litm--theme-sort-target");
		this.#themeSortTarget = target;
	}

	#clearThemeSortPreview() {
		const container =
			this.#themeSortSource?.closest(".litm--character-themes") ??
			this.element?.querySelector(".litm--character-themes");
		container?.classList.remove("litm--theme-sort-active");

		for (const card of [this.#themeSortSource, this.#themeSortTarget]) {
			if (!card) continue;
			card.classList.remove(
				"litm--theme-sort-source",
				"litm--theme-sort-target",
			);
			card.style.translate = "";
		}

		this.#themeSortSource = null;
		this.#themeSortTarget = null;
		this.#themeSortRects.clear();
	}

	#onDragHandleMouseDown(event) {
		this.#dragAvatarTimeout = null;

		const t = event.currentTarget;
		const doc = getOwningDocument(t);
		const target = t.dataset.drag;
		const parent = t.closest(target);
		if (!parent) return;
		const isWindowDrag = target === ".application" || target === ".window-app";

		const parentRect = parent.getBoundingClientRect();
		const offsetParent = parent.offsetParent;
		const opRect = offsetParent
			? offsetParent.getBoundingClientRect()
			: { left: 0, top: 0 };
		const parentLeft = parentRect.left - opRect.left;
		const parentTop = parentRect.top - opRect.top;
		const offsetX = event.clientX - parentLeft;
		const offsetY = event.clientY - parentTop;

		let isDragging = false;

		const handleDrag = (event) => {
			event.preventDefault();
			if (!isDragging) return;
			if (isWindowDrag) this.#dragAvatarTimeout = true;

			parent.style.left = `${event.clientX - offsetX}px`;
			parent.style.top = `${event.clientY - offsetY}px`;
		};

		const handleFirstMove = (event) => {
			const dx = event.clientX - (offsetX + parentLeft);
			const dy = event.clientY - (offsetY + parentTop);
			if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

			isDragging = true;
			doc.removeEventListener("mousemove", handleFirstMove);
			doc.addEventListener("mousemove", handleDrag);
			handleDrag(event);
		};

		const handleMouseUp = () => {
			if (isWindowDrag && this.#dragAvatarTimeout) {
				const parentRect = parent.getBoundingClientRect();
				this.setPosition({
					left: parentRect.left,
					top: parentRect.top,
				});
				this.#dragAvatarTimeout = setTimeout(() => {
					this.#dragAvatarTimeout = null;
				}, 100);
			}

			if (target === "#note")
				this.#notesEditorStyle = parent.getAttribute("style");

			doc.removeEventListener("mousemove", handleFirstMove);
			doc.removeEventListener("mousemove", handleDrag);
			doc.removeEventListener("mouseup", handleMouseUp);
		};

		doc.addEventListener("mousemove", handleFirstMove);
		doc.addEventListener("mouseup", handleMouseUp);
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

	async #onEffectValueChange(event) {
		event.stopPropagation();
		const li = event.currentTarget.closest("li[data-id]");
		const id = li.dataset.id;
		if (!id) return;

		const checkboxes = li.querySelectorAll(
			"input.litm--story-checkbox[type='checkbox']",
		);
		const values = Array.from(checkboxes).map((cb, i) =>
			cb.checked ? i + 1 : false,
		);

		await this.actor.updateEmbeddedDocuments(
			"ActiveEffect",
			[
				{
					_id: id,
					"flags.litm-rn.values": values,
					"flags.litm-rn.type": "status",
				},
			],
			{ render: false },
		);

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();
		Hooks.callAll("litmStoryTagsUpdated", { sourceAppId: this.appId });
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
		const hiddenInput = this.element.querySelector(
			`input[name="${originalName}"]`,
		);
		const li = el.closest("li.litm--story-tag[data-id]");
		const id = li?.dataset.id;

		if (id && !newValue) {
			this.#editingEffectId = null;
			this.#blankEditingEffectId = null;
			await this.#deleteEffectTag(id);
			return;
		}

		if (hiddenInput && hiddenInput.value !== newValue) {
			hiddenInput.value = newValue;

			if (li) {
				if (!id) return;

				await this.actor.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: id, name: newValue },
				]);

				this.#roll.refreshTags();
				if (this.#roll.rendered) this.#roll.render();
			} else {
				this.submit();
			}
		}
		if (id) {
			this.#editingEffectId = null;
			this.#blankEditingEffectId = null;
			this.render();
		}
	}

	#onContenteditablePaste(event) {
		event.preventDefault();
		const text = (event.clipboardData || window.clipboardData)
			.getData("text/plain")
			.replace(/\n/g, " ");
		document.execCommand("insertText", false, text);
	}

	async #addTag(event) {
		const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: t("Litm.ui.name-tag"),
				flags: {
					["litm-rn"]: {
						type: "tag",
						isScratched: false,
						isPrivate: createPrivate(event),
						isCrispy: false,
					},
				},
			},
		]);
		if (!effect) return;
		this.#editingEffectId = effect.id;
		this.#blankEditingEffectId = effect.id;
		await this.render({ force: true });
		this.#focusEffectEditor(3);

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();
	}

	async #addBackpackTag(event) {
		const tags = foundry.utils.duplicate(this.system.backpackTags ?? []);
		const id = foundry.utils.randomID();
		tags.push({
			id,
			name: t("Litm.ui.name-tag"),
			type: "backpack",
			isScratched: false,
			isPrivate: createPrivate(event),
		});
		this.#editingBackpackTagId = id;
		this.#blankEditingBackpackTagId = id;
		await this.actor.update(
			{ "system.backpackTags": tags },
			{ validate: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	async #onBackpackTagEditorBlur(event) {
		const id = event.currentTarget.dataset.backpackTagEditor;
		if (!id) return;

		const field =
			event.currentTarget.dataset.backpackTagField || "backpackTags";
		const name = event.currentTarget.textContent.trim();
		const tags = foundry.utils.duplicate(this.system[field] ?? []);
		const tag = tags.find((entry) => entry.id === id);
		if (!tag) return;

		this.#editingBackpackTagId = null;
		this.#blankEditingBackpackTagId = null;
		if (name) tag.name = name;
		else tags.splice(tags.indexOf(tag), 1);

		await this.actor.update({ [`system.${field}`]: tags }, { validate: false });
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	/** Add a tag directly to the Backpack archive and focus its editor. */
	async #addArchivedBackpackTag(event) {
		const tags = foundry.utils.duplicate(this.system.backpackArchive ?? []);
		const id = foundry.utils.randomID();
		tags.push({
			id,
			name: t("Litm.ui.name-tag"),
			type: "backpack",
			isScratched: false,
			isPrivate: createPrivate(event),
		});
		this.#editingBackpackTagId = id;
		this.#blankEditingBackpackTagId = id;
		await this.actor.update(
			{ "system.backpackArchive": tags },
			{ validate: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	/** Create a noticed tag and focus its inline editor. */
	async #addNoticedTag() {
		const tags = foundry.utils.duplicate(this.system.noticedTags ?? []);
		const id = foundry.utils.randomID();
		tags.push({ id, name: "", type: "tag" });
		this.#editingNoticedTagId = id;
		this.#blankEditingNoticedTagId = id;
		await this.actor.update(
			{ "system.noticedTags": tags },
			{ validate: false },
		);
	}

	/** Save a noticed tag and infer status markup from a trailing rating. */
	async #onNoticedTagEditorBlur(event) {
		const id = event.currentTarget.dataset.noticedTagEditor;
		const name = event.currentTarget.textContent.trim();
		const tags = foundry.utils.duplicate(this.system.noticedTags ?? []);
		const tag = tags.find((entry) => entry.id === id);
		if (!tag) return;
		this.#editingNoticedTagId = null;
		this.#blankEditingNoticedTagId = null;
		if (!name) tags.splice(tags.indexOf(tag), 1);
		else {
			tag.name = name;
			tag.type = /-\d+$/.test(name) ? "status" : "tag";
		}
		await this.actor.update(
			{ "system.noticedTags": tags },
			{ validate: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}

	/** Remove a noticed tag. */
	async #removeNoticedTag(id) {
		const tags = (this.system.noticedTags ?? []).filter((tag) => tag.id !== id);
		await this.actor.update(
			{ "system.noticedTags": tags },
			{ validate: false },
		);
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
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
						isPrivate: createPrivate(event),
					},
				},
			},
		]);
		if (!effect) return;
		this.#editingEffectId = effect.id;
		this.#blankEditingEffectId = effect.id;
		await this.render({ force: true });
		this.#focusEffectEditor(3);

		this.#roll.refreshTags();
		if (this.#roll.rendered) this.#roll.render();
	}

	async #addStory() {
		const [story] = await this.actor.createEmbeddedDocuments("Item", [
			{ name: t("Litm.other.story-theme"), type: "story" },
		]);
		story.sheet.render({ force: true });
	}

	/** Create a Story Theme directly in the Backpack archive. */
	async #addArchivedStory() {
		const [story] = await this.actor.createEmbeddedDocuments("Item", [
			{
				name: t("Litm.other.story-theme"),
				type: "story",
				system: { isArchived: true },
			},
		]);
		story?.sheet.render({ force: true });
	}

	async #increase(event) {
		const t = event.currentTarget;
		const attrib = t.dataset.id;
		const id = t.dataset.itemId || t.closest(".item")?.dataset.id;

		if (attrib.startsWith("system.")) {
			if (attrib === "system.promise") {
				return ThemeAdvancement.addPromises(this.actor, 1);
			}
			const themeMatch = attrib.match(/^system\.themes\.(\d+)\.(\w+)$/);
			if (themeMatch) {
				const [, idx, field] = themeMatch;
				return ThemeAdvancement.increaseTrack(this.actor, Number(idx), field);
			}
			const fellowMatch = attrib.match(/^system\.fellowship\.(\w+)$/);
			if (fellowMatch) {
				const fellowship = this.system.fellowship;
				if (fellowship) {
					const field = fellowMatch[1];
					return ThemeAdvancement.increaseFellowshipTrack(fellowship, field);
				}
			}
			const val = foundry.utils.getProperty(this.actor, attrib) || 0;
			const maxKey =
				attrib.includes("improve") ||
				attrib.includes("abandon") ||
				attrib.includes("milestone")
					? 3
					: 5;
			return this.actor.update({ [attrib]: Math.min(val + 1, maxKey) });
		}

		let item = this.actor.items.get(id);
		if (!item) {
			const fellowship = this.system.fellowship;
			if (fellowship?.id === id) item = fellowship;
		}
		if (!item) return;
		if (item.type === "fellowship" && attrib.startsWith("system.")) {
			return ThemeAdvancement.increaseFellowshipTrack(
				item,
				attrib.replace("system.", ""),
			);
		}

		const value = foundry.utils.getProperty(item, attrib);
		const maxValue = item.type === "hero" ? 5 : 3;

		return item.update({ [attrib]: Math.min(value + 1, maxValue) });
	}

	async #decrease(event) {
		const t = event.currentTarget;
		const attrib = t.dataset.id;
		const id = t.dataset.itemId || t.closest(".item")?.dataset.id;

		if (attrib.startsWith("system.")) {
			const themeMatch = attrib.match(/^system\.themes\.(\d+)\.(\w+)$/);
			if (themeMatch) {
				const [, idx, field] = themeMatch;
				return ThemeAdvancement.decreaseTrack(this.actor, Number(idx), field);
			}
			const fellowMatch = attrib.match(/^system\.fellowship\.(\w+)$/);
			if (fellowMatch) {
				const fellowship = this.system.fellowship;
				if (fellowship) {
					const field = fellowMatch[1];
					return ThemeAdvancement.decreaseFellowshipTrack(fellowship, field);
				}
			}
			const val = foundry.utils.getProperty(this.actor, attrib) || 0;
			return this.actor.update({ [attrib]: Math.max(val - 1, 0) });
		}

		let item = this.actor.items.get(id);
		if (!item) {
			const fellowship = this.system.fellowship;
			if (fellowship?.id === id) item = fellowship;
		}
		if (!item) return;
		if (item.type === "fellowship" && attrib.startsWith("system.")) {
			return ThemeAdvancement.decreaseFellowshipTrack(
				item,
				attrib.replace("system.", ""),
			);
		}

		const value = foundry.utils.getProperty(item, attrib);

		return item.update({ [attrib]: Math.max(value - 1, 0) });
	}

	#openStorySheet(button) {
		const item = this.items.get(button.dataset.id);
		if (item) item.sheet.render({ force: true });
	}

	#open(id) {
		switch (id) {
			case "note":
				this.element.querySelector("#note").style.display = "flex";
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
				const notes = this.element.querySelector("#note");
				this.#notesEditorStyle = notes.style.cssText.replace(
					/display:\s*\S+/,
					"display: none",
				);
				notes.style.display = "none";
			}
		}
	}

	#openItem(id) {
		if (id === "hero") {
			new game.litm.HeroCard(this.actor.uuid).render({ force: true });
			return;
		}
		if (id === "backpack") {
			new game.litm.BackpackCard(this.actor.uuid).render({ force: true });
			return;
		}
		if (id === "notes") {
			new game.litm.NotesCard(this.actor.uuid).render({ force: true });
			return;
		}
		const themeIdx = this.system.themes?.findIndex((t) => t.id === id);
		if (themeIdx !== -1 && themeIdx !== undefined) {
			if (this.system.themes[themeIdx].isEmpty) {
				new HeroCreationApp(this.actor.uuid).render({ force: true });
				return;
			}
			new game.litm.ThemeCard(this.actor.uuid, { themeIndex: themeIdx }).render(
				{ force: true },
			);
			return;
		}
		const fellowship = this.system.fellowship;
		if (fellowship?.id === id) {
			fellowship.sheet.render({ force: true });
			return;
		}
		const item = this.items.get(id) || game.items.get(id);
		if (item) item.sheet.render({ force: true });
	}

	async #select(event) {
		// Prevent double clicks from selecting the tag
		if (event.detail > 1) return;

		const t = event.currentTarget;
		const id = t.dataset.id;
		const selected = Boolean(t.closest("[data-selected]"));

		const resolved = this.#findCharacterTag(id);
		let tag = resolved?.tag;

		// Try to find tag in allTags (items/effects)
		if (!tag) {
			const found = this.system.allTags.find((t) => t.id === id);
			tag = found ? foundry.utils.duplicate(found) : undefined;
		}

		// If not found in allTags, try story tags (global effects)
		if (!tag) {
			const st = this.storyTags.find((t) => t.id === id);
			if (st) {
				tag = { ...st, actorId: this.actor.id };
			}
		}

		if (!tag) {
			return;
		}
		const isWeakness =
			tag.isHindering ||
			tag.type === "weaknessTag" ||
			tag.type === "weaknessStoryTag";
		if (!selected && tag.isScratched && !isWeakness) return;

		if (selected) {
			game.litm?.removeTagFromActorRoll?.(this.actor.id, id);
		} else {
			const ref =
				resolved?.kind === "fellowship" ? "fellowship" : this.actor.uuid;
			const state = isWeakness ? "negative" : "positive";
			game.litm?.addTagToRoll?.(this.actor.id, ref, id, state);
		}
		this.updateRollSelectionDisplay();
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

	#getBackside(id) {
		return this.#backsideStates.get(id) ?? false;
	}

	async #toggleBackside(id) {
		if (!id) return;
		this.#backsideStates.set(id, !this.#getBackside(id));
		this.render(false);
	}

	async #sendSpecialToChat(event) {
		const btn = event.currentTarget;
		const specialId = btn.dataset.specialId;
		if (!specialId) return;
		const fellowship = this.system.fellowship;
		if (fellowship) {
			const special = (fellowship.system.specials ?? []).find(
				(s) => s.id === specialId,
			);
			if (special) {
				const enriched = await TextEditor.enrichHTML(special.description || "");
				CONFIG.ChatMessage.documentClass.create({
					content: `<strong>${special.name}</strong>: ${enriched}`,
					speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
						actor: this.actor,
					}),
				});
				return;
			}
		}
		for (const theme of this.actor.system.themes ?? []) {
			const special = (theme.specials ?? []).find((s) => s.id === specialId);
			if (!special) continue;
			const enriched = await TextEditor.enrichHTML(special.description || "");
			CONFIG.ChatMessage.documentClass.create({
				content: `<strong>${special.name}</strong>: ${enriched}`,
				speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
					actor: this.actor,
				}),
			});
			return;
		}
	}

	#toggleCollapse(button) {
		const targetId = button.dataset.target;
		if (this.#expandedStories.has(targetId)) {
			this.#expandedStories.delete(targetId);
		} else {
			this.#expandedStories.add(targetId);
		}
		const container = this.element.querySelector(
			`[data-collapse-id="${targetId}"]`,
		);
		const icon = button.querySelector("i");
		container.classList.toggle("litm--collapsed");
		icon.classList.toggle("fa-angle-down");
		icon.classList.toggle("fa-angle-right");
	}

	async setHelpingTags(helpingTags) {
		await game.settings.set("litm-rn", "storytags", {
			...this.config,
			helpingTags,
		});
	}

	#onSpecialDragStart(event) {
		const el = event.currentTarget;
		const specialId = el.dataset.dragSpecial;
		const containerPath = el.dataset.dragSpecialPath;
		if (!specialId || !containerPath) return;

		// Resolve source document and container
		let sourceDoc = this.actor;
		let dataPath = containerPath;
		// Handle paths like "items.ITEMID.system.specials".
		if (containerPath.startsWith("items.")) {
			const parts = containerPath.split(".");
			const itemId = parts[1];
			const item = this.items.get(itemId) || game.items.get(itemId);
			if (!item) return;
			sourceDoc = item;
			dataPath = parts.slice(2).join(".");
		}

		const container = foundry.utils.deepClone(
			foundry.utils.getProperty(sourceDoc.toObject(), dataPath) || [],
		);
		const special = container.find((s) => s.id === specialId);
		if (!special) return;

		const dragData = game.litm.specials.makeSpecialDragData(
			special,
			sourceDoc.uuid,
			dataPath,
		);
		event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		event.dataTransfer.effectAllowed = "copyMove";
	}

	async #onDropSpecial(event, data) {
		// Resolve target: dropped on a theme → theme specials, else → quintessences
		const themeEl = event.target.closest(".litm--character-theme");
		let targetPath;
		if (themeEl) {
			const themeId = themeEl.dataset.id;
			const themeIdx = this.system.themes?.findIndex((t) => t.id === themeId);
			if (themeIdx === -1 || themeIdx === undefined) return;
			targetPath = `system.themes.${themeIdx}.specials`;
		} else {
			targetPath = "system.quintessences";
		}

		if (data.source?.containerPath === targetPath) return;

		await game.litm.specials.addSpecialToContainer(
			this.actor,
			targetPath,
			data.special,
		);
		this.render();
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
		if (this.#actorDataUpdateHookId) {
			Hooks.off("litmActorDataUpdated", this.#actorDataUpdateHookId);
			this.#actorDataUpdateHookId = null;
		}
		if (this.element) {
			this.element.style.display = "none";
		}
		return super.close(options);
	}
}
