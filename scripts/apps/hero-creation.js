import { TropeSheet } from "../item/trope/trope-sheet.js";
import { TropePicker } from "./trope-picker.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } =
	foundry.applications.api;
const { fromUuidSync } = foundry.utils;

/** Persistent overview for creating a Hero's four themes with mixed methods. */
export class HeroCreationApp extends HandlebarsApplicationMixin(ApplicationV2) {
	#updatingOptions = false;

	static DEFAULT_OPTIONS = {
		id: "litm-hero-creation",
		classes: ["litm", "litm--hero-creation"],
		position: { width: 860, height: 720 },
		window: { title: "Litm.hero-creation.title", resizable: true },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/hero-creation.html" },
	};

	constructor(actorUuid, options = {}) {
		super(options);
		this.actor = fromUuidSync(actorUuid);
		this.updateHookId = Hooks.on("updateActor", (actor) => {
			if (
				actor.uuid === this.actor.uuid &&
				this.rendered &&
				!this.#updatingOptions
			)
				this.render();
		});
	}

	/** @override */
	async close(options) {
		if (this.updateHookId) Hooks.off("updateActor", this.updateHookId);
		this.updateHookId = null;
		return super.close(options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const themes = this.actor.system.themes ?? [];
		const draft = this.actor.system.themeCreationDraft ?? null;
		return {
			...context,
			actor: this.actor,
			tropeDraft: draft,
			characterOptions: this.actor.system.characterOptions ?? {},
			themes: themes.map((theme, index) => {
				const pending = theme.isEmpty ? draft?.slots?.[index] : null;
				return {
					index,
					number: index + 1,
					empty: theme.isEmpty && !pending,
					pending: Boolean(pending),
					name: pending?.name || theme.themeTag?.name || theme.name,
					level: pending?.might || theme.level,
					themebook: pending?.themebookName || theme.themebook,
				};
			}),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelectorAll("[data-creation-action]")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#onAction(event));
			});
		this.element
			.querySelectorAll("[data-character-option]")
			.forEach((input) => {
				input.addEventListener("change", (event) =>
					this.#onOptionChange(event),
				);
			});
	}

	async #onOptionChange(event) {
		const input = event.currentTarget;
		const option = input.dataset.characterOption;
		if (!option) return;
		const updates = { [`system.characterOptions.${option}`]: input.checked };
		if (option === "enableBackpackDrafts" && input.checked) {
			const available =
				this.actor.system.themeCreationDraft?.availableBackpackDraftTags ?? [];
			const drafts = foundry.utils.deepClone(
				this.actor.toObject().system.backpackDraftTags ?? [],
			);
			const existingIds = new Set(drafts.map((tag) => tag.id));
			updates["system.backpackDraftTags"] = [
				...drafts,
				...available.filter((tag) => !existingIds.has(tag.id)),
			];
		}
		this.#updatingOptions = true;
		try {
			await this.actor.update(updates, { validate: false });
		} finally {
			this.#updatingOptions = false;
		}
	}

	async #onAction(event) {
		event.preventDefault();
		const button = event.currentTarget;
		const action = button.dataset.creationAction;
		if (action === "choose-trope") {
			new TropePicker({
				selectedUuid: this.actor.system.themeCreationDraft?.tropeUuid,
				onSelect: (trope) => this.#configureTrope(trope),
			}).render({ force: true });
			return;
		}
		if (action === "edit-theme") {
			const themeIndex = Number(button.dataset.themeIndex);
			const pending = this.actor.system.themes[themeIndex]?.isEmpty
				? this.actor.system.themeCreationDraft?.slots?.[themeIndex]
				: null;
			new game.litm.ThemeBuilder(
				this.actor.uuid,
				pending
					? {
							themeIndex,
							sourceUuid: pending.uuid,
							level: pending.might,
							startStep: 2,
							lockedSource: true,
							onComplete: () => this.#completeDraftSlot(themeIndex),
						}
					: { themeIndex },
			).render({ force: true });
			return;
		}
	}

	async #configureTrope(trope) {
		new TropeSheet({
			document: trope,
			id: `litm-trope-selection-${trope.id}`,
			selectionMode: true,
			onConfirmSelection: (selection) => this.#applyTropeSelection(selection),
		}).render({ force: true });
	}

	async #applyTropeSelection(selection) {
		const currentThemes = foundry.utils.deepClone(
			this.actor.toObject().system.themes ?? [],
		);
		const replacedThemes = currentThemes.filter((theme) => !theme.isEmpty);
		if (replacedThemes.length) {
			const confirmed = await DialogV2.confirm({
				window: {
					title: game.i18n.localize("Litm.hero-creation.replace-themes-title"),
					icon: "fa-solid fa-triangle-exclamation",
				},
				content: `<p>${game.i18n.format(
					"Litm.hero-creation.replace-themes-confirm",
					{
						count: replacedThemes.length,
					},
				)}</p>`,
				rejectClose: false,
			});
			if (!confirmed) return false;
		}
		const previousIds = new Set(
			(this.actor.system.themeCreationDraft?.backpackTags ?? []).map(
				(tag) => tag.id,
			),
		);
		const previousDraftIds = new Set(
			(this.actor.system.themeCreationDraft?.backpackDraftTags ?? []).map(
				(tag) => tag.id,
			),
		);
		const existing = foundry.utils
			.deepClone(this.actor.toObject().system.backpackTags ?? [])
			.filter((tag) => !previousIds.has(tag.id));
		const existingDrafts = foundry.utils
			.deepClone(this.actor.toObject().system.backpackDraftTags ?? [])
			.filter((tag) => !previousDraftIds.has(tag.id));
		const slots = selection.slots.map((option) => ({
			uuid: option.uuid,
			name: option.name,
			themebookName: option.themebookName || "",
			might: option.might || "origin",
		}));
		const useBackpackDrafts =
			this.actor.system.characterOptions?.enableBackpackDrafts === true;
		const draft = {
			...selection,
			slots,
			backpackDraftTags: useBackpackDrafts ? selection.backpackDraftTags : [],
			availableBackpackDraftTags: selection.backpackDraftTags,
		};
		const archive = foundry.utils.deepClone(
			this.actor.toObject().system.themeArchive ?? [],
		);
		for (const theme of replacedThemes) {
			archive.push({
				id: foundry.utils.randomID(),
				archivedAt: Date.now(),
				reason: "replacement",
				theme: foundry.utils.deepClone(theme),
			});
		}
		const themes = Array.from({ length: 4 }, (_, index) =>
			this.#emptyTheme(index),
		);
		await this.actor.update(
			{
				"system.themeCreationDraft": draft,
				"system.backpackTags": [...existing, ...selection.backpackTags],
				"system.backpackDraftTags": [
					...existingDrafts,
					...(useBackpackDrafts ? selection.backpackDraftTags : []),
				],
				"system.themeArchive": archive,
				"system.themes": themes,
			},
			{ validate: false },
		);
		const replacedBackpackEffectIds = this.actor.effects
			.filter((effect) => previousIds.has(effect.id))
			.map((effect) => effect.id);
		if (replacedBackpackEffectIds.length) {
			await this.actor.deleteEmbeddedDocuments(
				"ActiveEffect",
				replacedBackpackEffectIds,
			);
		}
		const selectedEffects = selection.backpackTags
			.filter((tag) => !this.actor.effects.has(tag.id))
			.map((tag) => ({
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
						isPrivate: false,
						ownerType: "backpack",
						ownerId: "backpack",
					},
				},
			}));
		if (selectedEffects.length) {
			await this.actor.createEmbeddedDocuments("ActiveEffect", selectedEffects);
		}
		if (replacedThemes.length) {
			const ownerIds = new Set(replacedThemes.map((theme) => theme.id));
			const effectIds = this.actor.effects
				.filter((effect) => {
					const flags = effect.flags?.["litm-rn"];
					return flags?.ownerType === "theme" && ownerIds.has(flags.ownerId);
				})
				.map((effect) => effect.id);
			if (effectIds.length)
				await this.actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
		}
		this.render();
		return true;
	}

	#emptyTheme(index) {
		const name = `${game.i18n.localize("TYPES.Item.theme")} ${index + 1}`;
		return {
			id: foundry.utils.randomID(),
			type: "theme",
			isEmpty: true,
			creationMode: "custom",
			name,
			themebook: "",
			themebookUuid: "",
			themebookCustom: true,
			themekitUuid: "",
			themekitName: "",
			level: Object.keys(CONFIG.litm.theme_levels)[0],
			themeTag: {
				id: foundry.utils.randomID(),
				name,
				type: "themeTag",
				isScratched: false,
			},
			powerTags: [],
			weaknessTags: [],
			draftTags: [],
			specials: [],
			improve: 0,
			abandon: 0,
			milestone: 0,
			motivation: "",
			note: "",
		};
	}

	async #completeDraftSlot(themeIndex) {
		const draft = foundry.utils.deepClone(
			this.actor.toObject().system.themeCreationDraft,
		);
		if (!draft?.slots) return;
		draft.slots[themeIndex] = null;
		await this.actor.update(
			{ "system.themeCreationDraft": draft },
			{ validate: false },
		);
	}
}
