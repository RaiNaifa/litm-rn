import { ThemeAdvancement } from "../system/theme-advancement.js";
import { ThemeSources } from "../system/theme-sources.js";
import {
	enhanceAdvancementSelects,
	fitAdvancementPopover,
} from "./advancement-select.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid, fromUuidSync } = foundry.utils;

/** Guided improvement, evolution, and replacement workflow for a Hero theme. */
export class ThemeAdvancementApp extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-theme-advancement",
		classes: ["litm", "litm--theme-advancement"],
		position: { width: 780, height: 700 },
		window: { resizable: true },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/theme-advancement.html" },
	};

	constructor(actorUuid, options = {}) {
		super(options);
		this.actor = fromUuidSync(actorUuid);
		this.themeIndex = Number(options.themeIndex);
		this.mode = options.mode || "improve";
		this.expansionTargetIndex = null;
		this.replacementThemebook = { uuid: "", name: "", custom: true };
		const theme = this.actor?.system?.themes?.[this.themeIndex];
		this.evolutionThemebook = {
			uuid: theme?.themebookUuid ?? "",
			name: theme?.themebook ?? "",
			custom: theme?.themebookCustom !== false || !theme?.themebookUuid,
		};
		this.evolutionDraft = null;
		this.primaryQuestDraft = null;
		this.scrollPosition = 0;
		this.dismissController = null;
	}

	/** @override */
	async close(options) {
		this.dismissController?.abort();
		this.dismissController = null;
		return super.close(options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const primaryTheme = this.actor.system.themes?.[this.themeIndex];
		const expansionTargets = (this.actor.system.themes ?? [])
			.map((entry, index) => ({ entry, index }))
			.filter(({ entry, index }) => index !== this.themeIndex && !entry.isEmpty)
			.map(({ entry, index }) => ({
				index,
				name: entry.themeTag?.name || entry.name,
			}));
		this.expansionTargetIndex ??= expansionTargets[0]?.index ?? null;
		const expansionTheme =
			this.expansionTargetIndex == null
				? null
				: this.actor.system.themes?.[this.expansionTargetIndex];
		const theme =
			this.mode === "expand" && expansionTheme ? expansionTheme : primaryTheme;
		const powerCount =
			(theme?.powerTags?.length ?? 0) + (theme?.themeTag?.name ? 1 : 0);
		const { tagSources, specialOptions } = await this.#getSourceOptions(theme);
		const themebooks = (await ThemeSources.getThemebooks())
			.map((item) => ({
				uuid: item.uuid,
				name: item.name,
				might: item.system.might || "variable",
				icon:
					item.system.might === "variable"
						? "systems/litm-rn/assets/media/icons/variable-color_litm_icn.svg"
						: `${CONFIG.litm.themeicon_src[item.system.might]}-color-light_litm_icn.svg`,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		const replacementPromiseAward =
			1 +
			Math.max(0, (theme?.powerTags?.length ?? 0) - 2) +
			Math.max(0, (theme?.weaknessTags?.length ?? 0) - 1) +
			(theme?.specials?.length ?? 0);
		const replacementPromiseGain = replacementPromiseAward;
		const replacementSource = this.replacementThemebook.uuid
			? await fromUuid(this.replacementThemebook.uuid)
			: null;
		const replacementFirstQuestion =
			replacementSource?.system?.powerQuestions?.[0]?.text ?? "";
		const nascentOutstanding = Math.max(
			0,
			Number(theme?.nascentPowerNeeded ?? 0) -
				Number(theme?.availableImprovements ?? 0),
		);
		const evolutionSourceTheme = {
			...(theme?.toObject?.() ?? theme),
			themebookUuid: this.evolutionThemebook.uuid,
		};
		const evolutionSources = await this.#getSourceOptions(evolutionSourceTheme);
		const tradePowerLimit = Math.max(0, (theme?.powerTags?.length ?? 0) - 2);
		const tradeWeaknessLimit = Math.max(
			0,
			(theme?.weaknessTags?.length ?? 0) - 1,
		);
		const tradeSlotCount =
			tradePowerLimit + tradeWeaknessLimit + (theme?.specials?.length ?? 0);
		const draftTrades = new Set(this.evolutionDraft?.trades ?? []);
		return {
			...context,
			theme,
			primaryTheme,
			themeIndex: this.themeIndex,
			mode: this.mode,
			isImprove: this.mode === "improve",
			isEvolve: this.mode === "evolve" || this.mode === "expand",
			isReplace: this.mode === "replace",
			isExpand: this.mode === "expand",
			canSpend: Number(theme?.availableImprovements ?? 0) > 0,
			powerCount,
			tagSources,
			specialOptions,
			replacementPromiseGain,
			replacementFirstQuestion,
			nascentOutstanding,
			nascentReady:
				Number(theme?.nascentPowerNeeded ?? 0) > 0 && nascentOutstanding === 0,
			evolutionThemebook: this.evolutionThemebook,
			evolutionTagSources: evolutionSources.tagSources,
			evolutionSpecialOptions: evolutionSources.specialOptions,
			evolutionDraft: this.evolutionDraft,
			evolutionLevel: this.evolutionDraft?.values?.level ?? theme?.level,
			evolutionTitle:
				this.evolutionDraft?.values?.themeTag ?? theme?.themeTag?.name,
			evolutionQuest: this.evolutionDraft?.values?.quest ?? theme?.motivation,
			primaryQuestDraft: this.primaryQuestDraft ?? primaryTheme?.motivation,
			evolutionPromiseGain: 1,
			tradePowerLimit,
			tradeWeaknessLimit,
			tradeSlotCount,
			tradeSlots: Array.from({ length: tradeSlotCount }, (_, index) => ({
				index,
				...(this.evolutionDraft?.allocations?.[index] ?? {}),
			})),
			replacementThemebook: this.replacementThemebook,
			themebookGroups: ["origin", "adventure", "greatness", "variable"]
				.map((might) => ({
					might,
					label: game.i18n.localize(`Litm.theme-content.might-${might}`),
					items: themebooks.filter((item) => item.might === might),
				}))
				.filter((group) => group.items.length),
			rewriteTags: [
				...(theme?.powerTags ?? []).map((tag) => ({
					...(tag.toObject?.() ?? tag),
					kind: "power",
				})),
				...(theme?.weaknessTags ?? []).map((tag) => ({
					...(tag.toObject?.() ?? tag),
					kind: "weakness",
				})),
			],
			weaknessTags: (theme?.weaknessTags ?? []).map(
				(tag) => tag.toObject?.() ?? tag,
			),
			tradePowerTags: (theme?.powerTags ?? []).map((tag) => ({
				...(tag.toObject?.() ?? tag),
				name: this.evolutionDraft?.tagNames?.[tag.id] ?? tag.name,
				traded: draftTrades.has(`power:${tag.id}`),
			})),
			tradeWeaknessTags: (theme?.weaknessTags ?? []).map((tag) => ({
				...(tag.toObject?.() ?? tag),
				name: this.evolutionDraft?.tagNames?.[tag.id] ?? tag.name,
				traded: draftTrades.has(`weakness:${tag.id}`),
			})),
			tradeSpecials: (theme?.specials ?? []).map((special) => ({
				...(special.toObject?.() ?? special),
				traded: draftTrades.has(`special:${special.id}`),
			})),
			expansionTargets,
			expansionTargetIndex: this.expansionTargetIndex,
			expansionTheme,
			expansionTradePower: (expansionTheme?.powerTags ?? [])
				.slice(2)
				.map((tag) => tag.toObject?.() ?? tag),
			expansionTradeWeakness: (expansionTheme?.weaknessTags ?? [])
				.slice(1)
				.map((tag) => tag.toObject?.() ?? tag),
			expansionTradeSpecials: (expansionTheme?.specials ?? []).map(
				(special) => special.toObject?.() ?? special,
			),
			mightOptions: ["origin", "adventure", "greatness"],
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#bindPopoverDismissal();
		enhanceAdvancementSelects(this.element, this.dismissController.signal);
		const scroll = this.element.querySelector(".litm--advancement-content");
		if (scroll) {
			scroll.scrollTop = this.scrollPosition;
			scroll.addEventListener(
				"scroll",
				() => {
					this.scrollPosition = scroll.scrollTop;
				},
				{ passive: true },
			);
		}
		this.element
			.querySelectorAll("[data-advancement-action]")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#onAction(event));
			});
		this.element
			.querySelector('[name="choice"]')
			?.addEventListener("change", () => {
				this.#syncImprovementFields();
			});
		this.element
			.querySelector('[name="specialSource"]')
			?.addEventListener("change", () => {
				this.#syncImprovementFields();
			});
		this.element
			.querySelector('[name="expansionTarget"]')
			?.addEventListener("change", (event) => {
				this.primaryQuestDraft = this.#value("primaryQuest");
				this.expansionTargetIndex = Number(event.currentTarget.value);
				const target = this.actor.system.themes?.[this.expansionTargetIndex];
				this.evolutionThemebook = {
					uuid: target?.themebookUuid ?? "",
					name: target?.themebook ?? "",
					custom: target?.themebookCustom !== false || !target?.themebookUuid,
				};
				this.evolutionDraft = null;
				this.render();
			});
		this.element
			.querySelector("[data-replacement-themebook-search]")
			?.addEventListener("input", (event) =>
				this.#filterReplacementThemebooks(event),
			);
		this.element.querySelectorAll("[data-evolution-trade]").forEach((input) => {
			input.addEventListener("change", (event) =>
				this.#onEvolutionTrade(event),
			);
		});
		this.element
			.querySelectorAll("[data-evolution-allocation-choice]")
			.forEach((select) => {
				select.addEventListener("change", () =>
					this.#syncEvolutionAllocations(),
				);
			});
		this.element
			.querySelectorAll("[data-evolution-special-source]")
			.forEach((select) => {
				select.addEventListener("change", () =>
					this.#syncEvolutionAllocations(),
				);
			});
		this.element
			.querySelectorAll("[data-evolution-source]")
			.forEach((select) => {
				select.addEventListener("change", (event) => {
					const option = event.currentTarget.selectedOptions[0];
					const row = event.currentTarget.closest(
						"[data-evolution-allocation]",
					);
					const value = row?.querySelector("[data-evolution-value]");
					if (value && option?.dataset.name) value.value = option.dataset.name;
				});
			});
		this.#syncImprovementFields();
		this.#syncEvolutionAllocations();
	}

	#bindPopoverDismissal() {
		this.dismissController?.abort();
		this.dismissController = new AbortController();
		const { signal } = this.dismissController;
		document.addEventListener(
			"pointerdown",
			(event) => {
				for (const picker of this.element.querySelectorAll(
					".litm--advancement-source-picker.open, .litm--advancement-themebook-picker.open, .litm--advancement-select.open",
				)) {
					if (!picker.contains(event.target)) picker.classList.remove("open");
				}
			},
			{ capture: true, signal },
		);
		document.addEventListener(
			"keydown",
			(event) => {
				if (event.key !== "Escape") return;
				this.element
					.querySelectorAll(
						".litm--advancement-source-picker.open, .litm--advancement-themebook-picker.open, .litm--advancement-select.open",
					)
					.forEach((picker) => picker.classList.remove("open"));
			},
			{ signal },
		);
	}

	async #getSourceOptions(theme) {
		const tagSources = (theme?.draftTags ?? []).map((tag) => ({
			value: `draft:${tag.id}`,
			name: tag.name,
			label: tag.name,
			sourceType: "draft",
			isWeakness: tag.isWeakness,
		}));
		const specialOptions = [];
		const activeSpecialIds = new Set(
			(theme?.specials ?? []).map((entry) => entry.id),
		);
		const claimed = new Set(
			(theme?.claimedSpecials ?? [])
				.filter(
					(entry) =>
						entry.retired || activeSpecialIds.has(entry.themeSpecialId),
				)
				.map((entry) => `${entry.sourceUuid}:${entry.specialId}`),
		);
		const addSpecials = async (source, sourceName, sourceType) => {
			for (const special of source?.system?.specials ?? []) {
				const key = `${source.uuid}:${special.id}`;
				specialOptions.push({
					value: key,
					name: special.name,
					description: special.description,
					enrichedDescription:
						await foundry.applications.ux.TextEditor.implementation.enrichHTML(
							special.description || "",
						),
					sourceName,
					sourceType,
					claimed: claimed.has(key),
				});
			}
		};

		const themebook = theme?.themebookUuid
			? await fromUuid(theme.themebookUuid)
			: null;
		if (themebook) {
			const savedAnswers = (theme.themebookAnswers ?? []).filter(
				(answer) =>
					answer.answer?.trim() &&
					(!answer.sourceUuid || answer.sourceUuid === themebook.uuid),
			);
			const answerByQuestion = new Map();
			for (const answer of savedAnswers) {
				answerByQuestion.set(answer.questionId || answer.id, answer);
			}
			const answered = new Set(
				savedAnswers.map((answer) => answer.questionId || answer.id),
			);
			for (const answer of savedAnswers.filter((entry) => !entry.tagId)) {
				const questionId = answer.questionId || answer.id;
				const questions =
					answer.kind === "weakness"
						? themebook.system.weaknessQuestions
						: themebook.system.powerQuestions;
				const question = (questions ?? []).find(
					(entry) => entry.id === questionId,
				);
				if (!question || answer.kind === "introduction") continue;
				tagSources.push({
					value: `answer:${answer.id}:${answer.kind}`,
					name: answer.answer,
					label: `${question.text} — ${answer.answer}`,
					sourceType: "themebook",
					isWeakness: answer.kind === "weakness",
					used: true,
				});
			}
			for (const question of themebook.system.powerQuestions ?? []) {
				tagSources.push({
					value: `question:${themebook.uuid}:${question.id}:power`,
					name: answerByQuestion.get(question.id)?.answer ?? "",
					label: question.text,
					sourceType: "themebook",
					isWeakness: false,
					used: answered.has(question.id),
				});
			}
			for (const question of themebook.system.weaknessQuestions ?? []) {
				tagSources.push({
					value: `question:${themebook.uuid}:${question.id}:weakness`,
					name: answerByQuestion.get(question.id)?.answer ?? "",
					label: question.text,
					sourceType: "themebook",
					isWeakness: true,
					used: answered.has(question.id),
				});
			}
			await addSpecials(themebook, themebook.name, "themebook");
		}

		const themekit = theme?.themekitUuid
			? await fromUuid(theme.themekitUuid)
			: null;
		if (themekit) {
			const knownTagNames = new Set([
				...(theme.powerTags ?? []).map((tag) => tag.name),
				...(theme.weaknessTags ?? []).map((tag) => tag.name),
				...(theme.draftTags ?? []).map((tag) => tag.name),
			]);
			for (const tag of themekit.system.powerTags ?? []) {
				if (knownTagNames.has(tag.name)) continue;
				tagSources.push({
					value: `kit:${themekit.uuid}:${tag.id}:power`,
					name: tag.name,
					label: tag.name,
					sourceType: "themekit",
					isWeakness: false,
				});
			}
			for (const tag of themekit.system.weaknessTags ?? []) {
				if (knownTagNames.has(tag.name)) continue;
				tagSources.push({
					value: `kit:${themekit.uuid}:${tag.id}:weakness`,
					name: tag.name,
					label: tag.name,
					sourceType: "themekit",
					isWeakness: true,
				});
			}
			await addSpecials(themekit, themekit.name, "themekit");
		}
		specialOptions.sort((a, b) => {
			const sourceOrder =
				(a.sourceType === "themekit" ? 0 : 1) -
				(b.sourceType === "themekit" ? 0 : 1);
			return sourceOrder || a.name.localeCompare(b.name);
		});
		return { tagSources, specialOptions };
	}

	async #onAction(event) {
		event.preventDefault();
		const action = event.currentTarget.dataset.advancementAction;
		if (action === "reset-available") {
			if (await ThemeAdvancement.resetAvailable(this.actor, this.themeIndex))
				this.close();
			return;
		}
		if (action === "apply-improvement") return this.#applyImprovement();
		if (action === "toggle-tag-sources") {
			const picker = event.currentTarget.closest(
				".litm--advancement-source-picker",
			);
			picker?.classList.toggle("open");
			if (picker?.classList.contains("open")) {
				fitAdvancementPopover(
					picker,
					picker.querySelector(".litm--advancement-source-options"),
					this.element,
				);
			}
			return;
		}
		if (action === "select-tag-source") {
			this.#selectTagSource(event.currentTarget);
			return;
		}
		if (action === "toggle-replacement-themebooks") {
			const picker = event.currentTarget.closest(
				".litm--advancement-themebook-picker",
			);
			picker?.classList.toggle("open");
			if (picker?.classList.contains("open")) {
				fitAdvancementPopover(
					picker,
					picker.querySelector(".litm--advancement-themebook-popover"),
					this.element,
				);
			}
			return;
		}
		if (action === "select-replacement-custom") {
			this.replacementThemebook = { uuid: "", name: "", custom: true };
			this.render();
			return;
		}
		if (action === "select-replacement-themebook") {
			const source = await fromUuid(event.currentTarget.dataset.uuid);
			if (!source) return;
			this.replacementThemebook = {
				uuid: source.uuid,
				name: source.name,
				custom: false,
			};
			this.render();
			return;
		}
		if (action === "preview-replacement-themebook") {
			const source = await fromUuid(event.currentTarget.dataset.uuid);
			if (!source) return;
			const level = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
			if (!source.testUserPermission(game.user, level)) {
				ui.notifications.error(
					game.i18n.localize("Litm.themebook-picker.permission-error"),
				);
				return;
			}
			source.sheet.render({ force: true });
			return;
		}
		if (action === "toggle-evolution-themebooks") {
			const picker = event.currentTarget.closest(
				".litm--advancement-themebook-picker",
			);
			picker?.classList.toggle("open");
			if (picker?.classList.contains("open")) {
				fitAdvancementPopover(
					picker,
					picker.querySelector(".litm--advancement-themebook-popover"),
					this.element,
				);
			}
			return;
		}
		if (action === "select-evolution-custom") {
			this.#captureEvolutionDraft();
			this.evolutionThemebook = { uuid: "", name: "", custom: true };
			this.render();
			return;
		}
		if (action === "select-evolution-themebook") {
			const source = await fromUuid(event.currentTarget.dataset.uuid);
			if (!source) return;
			this.#captureEvolutionDraft();
			this.evolutionThemebook = {
				uuid: source.uuid,
				name: source.name,
				custom: false,
			};
			this.render();
			return;
		}
		if (action === "preview-evolution-themebook") {
			const source = await fromUuid(event.currentTarget.dataset.uuid);
			if (!source) return;
			const level = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
			if (!source.testUserPermission(game.user, level)) {
				ui.notifications.error(
					game.i18n.localize("Litm.themebook-picker.permission-error"),
				);
				return;
			}
			source.sheet.render({ force: true });
			return;
		}
		if (action === "apply-evolution") return this.#applyEvolution();
		if (action === "show-expansion") {
			this.mode = "expand";
			const target = this.actor.system.themes?.[this.expansionTargetIndex];
			this.evolutionThemebook = {
				uuid: target?.themebookUuid ?? "",
				name: target?.themebook ?? "",
				custom: target?.themebookCustom !== false || !target?.themebookUuid,
			};
			this.evolutionDraft = null;
			this.render();
			return;
		}
		if (action === "show-evolution") {
			this.mode = "evolve";
			const source = this.actor.system.themes?.[this.themeIndex];
			this.evolutionThemebook = {
				uuid: source?.themebookUuid ?? "",
				name: source?.themebook ?? "",
				custom: source?.themebookCustom !== false || !source?.themebookUuid,
			};
			this.evolutionDraft = null;
			this.render();
			return;
		}
		if (action === "apply-expansion") return this.#applyExpansion();
		if (action === "apply-replacement") return this.#applyReplacement();
	}

	#value(name) {
		return this.element.querySelector(`[name="${name}"]`)?.value?.trim() ?? "";
	}

	#checked(name) {
		return [...this.element.querySelectorAll(`[name="${name}"]:checked`)].map(
			(input) => input.value,
		);
	}

	#syncImprovementFields() {
		const choice = this.#value("choice");
		const tagChoice = choice === "power" || choice === "weakness";
		const customSpecial =
			choice === "special" && this.#value("specialSource") === "custom";
		for (const section of this.element.querySelectorAll(
			"[data-improvement-section]",
		)) {
			const kind = section.dataset.improvementSection;
			if (kind === "tag") section.hidden = !tagChoice;
			else if (kind === "special-custom") section.hidden = !customSpecial;
			else section.hidden = kind !== choice;
		}
		if (!tagChoice) return;
		const picker = this.element.querySelector(
			".litm--advancement-source-picker",
		);
		if (!picker) return;
		for (const option of picker.querySelectorAll(
			"[data-advancement-action='select-tag-source']",
		)) {
			option.hidden =
				option.dataset.kind !== "all" && option.dataset.kind !== choice;
		}
		const source = picker.querySelector('[name="tagSource"]');
		const selected = picker.querySelector(
			`[data-advancement-action="select-tag-source"][data-value="${CSS.escape(source.value)}"]`,
		);
		if (selected?.hidden) {
			const manual = picker.querySelector('[data-value="manual"]');
			this.#selectTagSource(manual);
		}
	}

	#selectTagSource(option) {
		if (!option) return;
		const picker = option.closest(".litm--advancement-source-picker");
		const input = picker?.querySelector('[name="tagSource"]');
		const selected = picker?.querySelector(
			".litm--advancement-source-selected",
		);
		if (!input || !selected) return;
		input.value = option.dataset.value;
		selected.innerHTML = option.innerHTML;
		selected.insertAdjacentHTML(
			"beforeend",
			'<i class="fa-solid fa-angle-down"></i>',
		);
		const valueInput = this.element.querySelector('[name="value"]');
		if (valueInput) valueInput.value = option.dataset.name || "";
		picker.classList.remove("open");
	}

	#filterReplacementThemebooks(event) {
		const query = event.currentTarget.value.trim().toLocaleLowerCase();
		const picker = event.currentTarget.closest(
			".litm--advancement-themebook-picker",
		);
		for (const row of picker?.querySelectorAll("[data-themebook-row]") ?? []) {
			row.hidden =
				Boolean(query) &&
				!row.dataset.search.toLocaleLowerCase().includes(query);
		}
		for (const group of picker?.querySelectorAll("[data-themebook-group]") ??
			[]) {
			group.hidden = !group.querySelector("[data-themebook-row]:not([hidden])");
		}
	}

	#tag(name, type) {
		return {
			id: foundry.utils.randomID(),
			name,
			type,
			isScratched: false,
		};
	}

	async #applyImprovement() {
		const themes = foundry.utils.duplicate(
			this.actor.toObject().system.themes ?? [],
		);
		const theme = themes[this.themeIndex];
		if (!theme?.availableImprovements) return;
		const choice = this.#value("choice");
		const sourceValue = this.#value("tagSource");
		const value = this.#value("value");
		if ((choice === "power" || choice === "weakness") && !value) return;

		if (theme.nascentPowerNeeded > 0 || choice === "power") {
			theme.powerTags ??= [];
			const tag = this.#tag(value, "powerTag");
			theme.powerTags.push(tag);
			if (Number(theme.nascentPowerNeeded ?? 0) > 0) {
				theme.nascentPowerNeeded = Math.max(0, 2 - theme.powerTags.length);
			}
			this.#consumeDraft(theme, sourceValue);
			this.#recordQuestionAnswer(theme, sourceValue, value, "power", tag.id);
		} else if (choice === "weakness") {
			theme.weaknessTags ??= [];
			const tag = this.#tag(value, "weaknessTag");
			theme.weaknessTags.push(tag);
			this.#consumeDraft(theme, sourceValue);
			this.#recordQuestionAnswer(theme, sourceValue, value, "weakness", tag.id);
		} else if (choice === "remove-weakness") {
			const id = this.#value("weaknessTarget");
			if (!id) return;
			theme.weaknessTags = (theme.weaknessTags ?? []).filter(
				(tag) => tag.id !== id,
			);
		} else if (choice === "special") {
			const specialSelect = this.element.querySelector(
				'[name="specialSource"]',
			);
			const option = specialSelect?.selectedOptions[0];
			if (!option?.value || option.disabled) return;
			theme.specials ??= [];
			const themeSpecialId = foundry.utils.randomID();
			if (option.value === "custom") {
				const name = this.#value("customSpecialName");
				if (!name) return;
				theme.specials.push({
					id: themeSpecialId,
					name,
					description: this.#value("customSpecialDescription"),
				});
			} else {
				theme.specials.push({
					id: themeSpecialId,
					name: option.dataset.name,
					description: option.dataset.description,
				});
				const splitAt = option.value.lastIndexOf(":");
				const sourceUuid = option.value.slice(0, splitAt);
				const specialId = option.value.slice(splitAt + 1);
				theme.claimedSpecials ??= [];
				const existingClaim = theme.claimedSpecials.find(
					(claim) =>
						claim.sourceUuid === sourceUuid && claim.specialId === specialId,
				);
				if (existingClaim) {
					existingClaim.name = option.dataset.name;
					existingClaim.themeSpecialId = themeSpecialId;
				} else {
					theme.claimedSpecials.push({
						sourceUuid,
						specialId,
						name: option.dataset.name,
						themeSpecialId,
						retired: false,
						claimedAt: Date.now(),
					});
				}
			}
		} else if (choice === "promise") {
			await ThemeAdvancement.addPromises(this.actor, 1);
		} else if (choice === "reset-abandon") {
			theme.abandon = 0;
		} else if (choice === "reset-milestone") {
			theme.milestone = 0;
		} else if (choice === "reset-both") {
			theme.abandon = 0;
			theme.milestone = 0;
		} else return;

		this.#applyRewrite(theme);
		theme.availableImprovements -= 1;
		await this.actor.update({ "system.themes": themes });
		await ThemeAdvancement.syncThemeEffects(this.actor, theme.id, theme);
		if (theme.availableImprovements <= 0) this.close();
		else this.render();
	}

	#consumeDraft(theme, sourceValue) {
		if (!sourceValue.startsWith("draft:")) return;
		const id = sourceValue.slice("draft:".length);
		theme.draftTags = (theme.draftTags ?? []).filter((tag) => tag.id !== id);
	}

	#recordQuestionAnswer(theme, sourceValue, value, fallbackKind, tagId) {
		if (sourceValue.startsWith("answer:")) {
			const answerId = sourceValue.split(":")[1];
			const existing = (theme.themebookAnswers ?? []).find(
				(answer) => answer.id === answerId,
			);
			if (!existing) return;
			existing.answer = value;
			existing.tagId = tagId;
			existing.role = fallbackKind;
			return;
		}
		if (!sourceValue.startsWith("question:")) return;
		const parts = sourceValue.split(":");
		const id = parts.at(-2);
		const kind = parts.at(-1) || fallbackKind;
		const sourceUuid = parts.slice(1, -2).join(":");
		const existing = (theme.themebookAnswers ?? []).find(
			(answer) =>
				(!answer.sourceUuid || answer.sourceUuid === sourceUuid) &&
				(answer.questionId || answer.id) === id &&
				!answer.answer?.trim(),
		);
		if (existing) {
			existing.answer = value;
			existing.sourceUuid ||= sourceUuid;
			existing.questionId ||= id;
			existing.tagId = tagId;
			existing.role = fallbackKind;
			return;
		}
		theme.themebookAnswers ??= [];
		theme.themebookAnswers.push({
			id: foundry.utils.randomID(),
			sourceUuid,
			questionId: id,
			kind,
			question: "",
			answer: value,
			tagId,
			role: fallbackKind,
			createdAt: Date.now(),
		});
	}

	#applyRewrite(theme) {
		const target = this.#value("rewriteTarget");
		const value = this.#value("rewriteValue");
		if (!target || !value) return;
		const [kind, id] = target.split(":");
		const list = kind === "weakness" ? theme.weaknessTags : theme.powerTags;
		const tag = list?.find((entry) => entry.id === id);
		if (tag) tag.name = value;
	}

	#onEvolutionTrade(event) {
		const input = event.currentTarget;
		const kind = input.dataset.evolutionTrade;
		const limit = Number(input.dataset.limit ?? 0);
		const checked = this.element.querySelectorAll(
			`[data-evolution-trade="${kind}"]:checked`,
		).length;
		if (checked > limit) {
			input.checked = false;
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.trade-minimum-warning"),
			);
		}
		input
			.closest(".litm--advancement-trade-row")
			?.classList.toggle("is-traded", input.checked);
		this.#syncEvolutionAllocations();
	}

	#syncEvolutionAllocations() {
		const traded = this.element.querySelectorAll(
			"[data-evolution-trade]:checked",
		).length;
		const rows = [
			...this.element.querySelectorAll("[data-evolution-allocation]"),
		];
		let selected = 0;
		let promiseChoices = 0;
		for (const row of rows) {
			const choice =
				row.querySelector("[data-evolution-allocation-choice]")?.value ?? "";
			if (choice) selected += 1;
			if (choice === "promise") promiseChoices += 1;
			row.hidden =
				Number(row.dataset.evolutionAllocation) >= Math.max(traded, selected);
			for (const section of row.querySelectorAll("[data-allocation-section]")) {
				const kind = section.dataset.allocationSection;
				section.hidden =
					kind !== choice &&
					!(kind === "tag" && (choice === "power" || choice === "weakness")) &&
					!(
						kind === "special-custom" &&
						choice === "special" &&
						row.querySelector("[data-evolution-special-source]")?.value ===
							"custom"
					);
			}
			for (const option of row.querySelectorAll(
				"[data-evolution-source] option[data-kind]",
			)) {
				option.hidden = option.dataset.kind !== choice;
				option.disabled = option.hidden;
			}
			const source = row.querySelector("[data-evolution-source]");
			if (source?.selectedOptions[0]?.disabled) source.value = "manual";
		}
		const block = this.element.querySelector(".litm--evolution-allocations");
		if (block) block.hidden = traded === 0 && selected === 0;
		const invalid = traded !== selected;
		block?.classList.toggle("is-invalid", invalid);
		const status = this.element.querySelector(
			"[data-evolution-allocation-status]",
		);
		if (status) {
			status.textContent = game.i18n.format(
				"Litm.advancement.allocation-status",
				{
					selected,
					available: traded,
				},
			);
		}
		const promise = this.element.querySelector(
			"[data-evolution-promise-count]",
		);
		if (promise) promise.textContent = String(1 + promiseChoices);
		for (const confirm of this.element.querySelectorAll(
			'[data-advancement-action="apply-evolution"], [data-advancement-action="apply-expansion"]',
		)) {
			confirm.disabled = invalid;
		}
	}

	#captureEvolutionDraft() {
		if (!this.element) return;
		const values = {};
		for (const field of this.element.querySelectorAll(
			'[name^="evolution"], [name="level"], [name="themeTag"], [name="quest"]',
		)) {
			if (field.type !== "checkbox") values[field.name] = field.value;
		}
		const trades = [
			...this.element.querySelectorAll("[data-evolution-trade]:checked"),
		].map((input) => `${input.dataset.evolutionTrade}:${input.value}`);
		const tagNames = Object.fromEntries(
			[...this.element.querySelectorAll("[data-evolution-tag-name]")].map(
				(input) => [input.dataset.evolutionTagName, input.value],
			),
		);
		const allocations = [
			...this.element.querySelectorAll("[data-evolution-allocation]"),
		].map((row) => ({
			choice:
				row.querySelector("[data-evolution-allocation-choice]")?.value ?? "",
			source: row.querySelector("[data-evolution-source]")?.value ?? "manual",
			value: row.querySelector("[data-evolution-value]")?.value ?? "",
			specialSource:
				row.querySelector("[data-evolution-special-source]")?.value ?? "custom",
			specialName:
				row.querySelector("[data-evolution-special-name]")?.value ?? "",
			specialDescription:
				row.querySelector("[data-evolution-special-description]")?.value ?? "",
		}));
		this.evolutionDraft = { values, trades, allocations, tagNames };
	}

	#applyEvolutionAllocation(theme, row) {
		const choice = row.querySelector(
			"[data-evolution-allocation-choice]",
		)?.value;
		if (choice === "defer") {
			theme.availableImprovements =
				Number(theme.availableImprovements ?? 0) + 1;
			return 0;
		}
		if (choice === "promise") return 1;
		if (choice === "power" || choice === "weakness") {
			const value = row.querySelector("[data-evolution-value]")?.value.trim();
			if (!value) throw new Error("missing-allocation-value");
			const list = choice === "power" ? "powerTags" : "weaknessTags";
			const type = choice === "power" ? "powerTag" : "weaknessTag";
			const tag = this.#tag(value, type);
			theme[list] ??= [];
			theme[list].push(tag);
			const source =
				row.querySelector("[data-evolution-source]")?.value ?? "manual";
			this.#recordQuestionAnswer(theme, source, value, choice, tag.id);
			return 0;
		}
		if (choice === "special") {
			const select = row.querySelector("[data-evolution-special-source]");
			const option = select?.selectedOptions[0];
			const custom = option?.value === "custom";
			const name = custom
				? row.querySelector("[data-evolution-special-name]")?.value.trim()
				: option?.dataset.name;
			if (!name) throw new Error("missing-allocation-value");
			const themeSpecialId = foundry.utils.randomID();
			theme.specials ??= [];
			theme.specials.push({
				id: themeSpecialId,
				name,
				description: custom
					? row
							.querySelector("[data-evolution-special-description]")
							?.value.trim()
					: option.dataset.description,
			});
			if (!custom) {
				const splitAt = option.value.lastIndexOf(":");
				theme.claimedSpecials ??= [];
				theme.claimedSpecials.push({
					sourceUuid: option.value.slice(0, splitAt),
					specialId: option.value.slice(splitAt + 1),
					name,
					themeSpecialId,
					retired: false,
					claimedAt: Date.now(),
				});
			}
		}
		return 0;
	}

	async #applyEvolution() {
		const themes = foundry.utils.duplicate(
			this.actor.toObject().system.themes ?? [],
		);
		const theme = themes[this.themeIndex];
		const archiveSnapshot = foundry.utils.duplicate(theme);
		const oldLevel = theme.level;
		const level = this.#value("level") || oldLevel;
		const themebook = this.evolutionThemebook.custom
			? this.#value("evolutionThemebookName")
			: this.evolutionThemebook.name;
		const changedThemebook =
			themebook !== theme.themebook ||
			this.evolutionThemebook.uuid !== theme.themebookUuid;
		if (level === oldLevel && !changedThemebook) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.evolve-change-warning"),
			);
			return;
		}
		const tradedPower = new Set(this.#checked("tradePower"));
		const tradedWeakness = new Set(this.#checked("tradeWeakness"));
		const tradedSpecials = new Set(this.#checked("tradeSpecial"));
		const tradeCount =
			tradedPower.size + tradedWeakness.size + tradedSpecials.size;
		const allocationRows = [
			...this.element.querySelectorAll("[data-evolution-allocation]"),
		].filter((row) => !row.hidden);
		const chosenRows = allocationRows.filter(
			(row) => row.querySelector("[data-evolution-allocation-choice]")?.value,
		);
		if (chosenRows.length !== tradeCount) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.allocation-mismatch"),
			);
			return;
		}
		if (!themebook) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.themebook-required"),
			);
			return;
		}
		const newTitle = this.#value("themeTag");
		const newQuest = this.#value("quest");
		if (
			!newTitle ||
			!newQuest ||
			newTitle === archiveSnapshot.themeTag?.name ||
			newQuest === archiveSnapshot.motivation
		) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.evolution-new-title-quest"),
			);
			return;
		}
		for (const tag of [
			...(theme.powerTags ?? []),
			...(theme.weaknessTags ?? []),
		]) {
			const field = this.element.querySelector(
				`[data-evolution-tag-name="${tag.id}"]`,
			);
			if (field?.value.trim()) tag.name = field.value.trim();
		}
		this.#retireClaimedSpecials(theme, tradedSpecials);
		theme.powerTags = (theme.powerTags ?? []).filter(
			(tag) => !tradedPower.has(tag.id),
		);
		theme.weaknessTags = (theme.weaknessTags ?? []).filter(
			(tag) => !tradedWeakness.has(tag.id),
		);
		theme.specials = (theme.specials ?? []).filter(
			(special) => !tradedSpecials.has(special.id),
		);
		let promiseGain = 1;
		try {
			for (const row of chosenRows)
				promiseGain += this.#applyEvolutionAllocation(theme, row);
		} catch {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.allocation-required"),
			);
			return;
		}
		await ThemeAdvancement.archive(this.actor, archiveSnapshot, "evolution");
		theme.level = level;
		theme.themebook = themebook;
		theme.themebookUuid = this.evolutionThemebook.uuid;
		theme.themebookCustom = this.evolutionThemebook.custom;
		theme.themeTag.name = newTitle;
		theme.name = theme.themeTag.name;
		theme.motivation = newQuest;
		theme.abandon = 0;
		theme.milestone = 0;
		theme.thresholdNotifications = { milestone: false, abandon: false };
		const promiseProgress = ThemeAdvancement.promiseProgress(
			this.actor,
			promiseGain,
		);
		await this.actor.update({
			"system.promise": promiseProgress.promise,
			"system.availableFulfillments": promiseProgress.availableFulfillments,
			"system.themes": themes,
		});
		await ThemeAdvancement.syncThemeEffects(this.actor, theme.id, theme);
		this.close();
	}

	async #applyReplacement() {
		const themes = foundry.utils.duplicate(
			this.actor.toObject().system.themes ?? [],
		);
		const oldTheme = themes[this.themeIndex];
		const oldThemeId = oldTheme.id;
		const title = this.#value("themeTag");
		const weakness = this.#value("weakness");
		const quest = this.#value("quest");
		const themebook = this.replacementThemebook.custom
			? this.#value("replacementThemebookName")
			: this.replacementThemebook.name;
		if (!title || !weakness || !quest || !themebook) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.replacement-required"),
			);
			return;
		}
		await ThemeAdvancement.archive(this.actor, oldTheme, "replacement");
		const excessPower = Math.max(0, (oldTheme.powerTags?.length ?? 0) - 2);
		const excessWeakness = Math.max(
			0,
			(oldTheme.weaknessTags?.length ?? 0) - 1,
		);
		const bonusPromise =
			1 + excessPower + excessWeakness + (oldTheme.specials?.length ?? 0);
		themes[this.themeIndex] = {
			...oldTheme,
			id: foundry.utils.randomID(),
			isEmpty: false,
			creationMode: this.replacementThemebook.custom ? "custom" : "themebook",
			name: title,
			themebook,
			themebookUuid: this.replacementThemebook.uuid,
			themebookCustom: this.replacementThemebook.custom,
			themekitUuid: "",
			themekitName: "",
			themebookAnswers: [],
			themeTag: this.#tag(title, "themeTag"),
			powerTags: [],
			weaknessTags: weakness ? [this.#tag(weakness, "weaknessTag")] : [],
			draftTags: [],
			specials: [],
			improve: 0,
			abandon: 0,
			milestone: 0,
			availableImprovements: 0,
			nascentPowerNeeded: 2,
			claimedSpecials: [],
			thresholdNotifications: { milestone: false, abandon: false },
			motivation: quest,
		};
		const promiseProgress = ThemeAdvancement.promiseProgress(
			this.actor,
			bonusPromise,
		);
		await this.actor.update({
			"system.promise": promiseProgress.promise,
			"system.availableFulfillments": promiseProgress.availableFulfillments,
			"system.themes": themes,
		});
		await ThemeAdvancement.syncThemeEffects(
			this.actor,
			oldThemeId,
			themes[this.themeIndex],
		);
		this.close();
	}

	async #applyExpansion() {
		if (this.expansionTargetIndex == null) return;
		const themes = foundry.utils.duplicate(
			this.actor.toObject().system.themes ?? [],
		);
		const evolved = themes[this.themeIndex];
		const expanded = themes[this.expansionTargetIndex];
		if (!evolved || !expanded || evolved === expanded) return;
		const archiveSnapshot = foundry.utils.duplicate(expanded);
		const expansionLevel = this.#value("level") || expanded.level;
		const expansionThemebook = this.evolutionThemebook.custom
			? this.#value("evolutionThemebookName")
			: this.evolutionThemebook.name;
		if (
			expansionLevel === expanded.level &&
			expansionThemebook === expanded.themebook
		) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.evolve-change-warning"),
			);
			return;
		}
		if (!expansionThemebook) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.themebook-required"),
			);
			return;
		}
		const newTitle = this.#value("themeTag");
		const newQuest = this.#value("quest");
		if (
			!newTitle ||
			!newQuest ||
			newTitle === archiveSnapshot.themeTag?.name ||
			newQuest === archiveSnapshot.motivation
		) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.evolution-new-title-quest"),
			);
			return;
		}
		const primaryQuest = this.#value("primaryQuest");
		if (!primaryQuest || primaryQuest === evolved.motivation) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.expansion-new-quest"),
			);
			return;
		}
		const tradedPower = new Set(this.#checked("tradePower"));
		const tradedWeakness = new Set(this.#checked("tradeWeakness"));
		const tradedSpecials = new Set(this.#checked("tradeSpecial"));
		const tradeCount =
			tradedPower.size + tradedWeakness.size + tradedSpecials.size;
		const chosenRows = [
			...this.element.querySelectorAll("[data-evolution-allocation]"),
		].filter(
			(row) =>
				!row.hidden &&
				row.querySelector("[data-evolution-allocation-choice]")?.value,
		);
		if (chosenRows.length !== tradeCount) {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.allocation-mismatch"),
			);
			return;
		}
		for (const tag of [
			...(expanded.powerTags ?? []),
			...(expanded.weaknessTags ?? []),
		]) {
			const field = this.element.querySelector(
				`[data-evolution-tag-name="${tag.id}"]`,
			);
			if (field?.value.trim()) tag.name = field.value.trim();
		}
		this.#retireClaimedSpecials(expanded, tradedSpecials);
		expanded.powerTags = (expanded.powerTags ?? []).filter(
			(tag) => !tradedPower.has(tag.id),
		);
		expanded.weaknessTags = (expanded.weaknessTags ?? []).filter(
			(tag) => !tradedWeakness.has(tag.id),
		);
		expanded.specials = (expanded.specials ?? []).filter(
			(special) => !tradedSpecials.has(special.id),
		);
		let promiseGain = 1;
		try {
			for (const row of chosenRows)
				promiseGain += this.#applyEvolutionAllocation(expanded, row);
		} catch {
			ui.notifications.warn(
				game.i18n.localize("Litm.advancement.allocation-required"),
			);
			return;
		}
		await ThemeAdvancement.archive(this.actor, archiveSnapshot, "expansion");

		evolved.milestone = 0;
		evolved.abandon = 0;
		evolved.motivation = primaryQuest;
		evolved.thresholdNotifications = { milestone: false, abandon: false };

		expanded.abandon = 0;
		expanded.milestone = 0;
		expanded.thresholdNotifications = { milestone: false, abandon: false };
		expanded.level = expansionLevel;
		expanded.themebook = expansionThemebook;
		expanded.themebookUuid = this.evolutionThemebook.uuid;
		expanded.themebookCustom = this.evolutionThemebook.custom;
		expanded.themeTag.name = newTitle;
		expanded.name = expanded.themeTag.name;
		expanded.motivation = newQuest;

		const promiseProgress = ThemeAdvancement.promiseProgress(
			this.actor,
			promiseGain,
		);
		await this.actor.update({
			"system.promise": promiseProgress.promise,
			"system.availableFulfillments": promiseProgress.availableFulfillments,
			"system.themes": themes,
		});
		await ThemeAdvancement.syncThemeEffects(this.actor, evolved.id, evolved);
		await ThemeAdvancement.syncThemeEffects(this.actor, expanded.id, expanded);
		this.close();
	}

	#retireClaimedSpecials(theme, tradedIds) {
		for (const claim of theme.claimedSpecials ?? []) {
			if (claim.themeSpecialId && tradedIds.has(claim.themeSpecialId))
				claim.retired = true;
		}
	}
}
