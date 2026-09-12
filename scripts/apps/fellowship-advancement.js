import { ThemeAdvancement } from "../system/theme-advancement.js";
import {
	enhanceAdvancementSelects,
	fitAdvancementPopover,
} from "./advancement-select.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid, fromUuidSync } = foundry.utils;

/** Guided Improvement workflow for a Fellowship theme. */
export class FellowshipAdvancementApp extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-fellowship-advancement",
		classes: ["litm", "litm--theme-advancement"],
		position: { width: 780, height: 640 },
		window: { resizable: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/fellowship-advancement.html",
		},
	};

	constructor(itemUuid, options = {}) {
		super(options);
		this.item = fromUuidSync(itemUuid);
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
		const theme = this.item?.system?.toObject();
		const { tagSources, specialOptions } = await this.#getSourceOptions(theme);
		return {
			...context,
			theme: { ...theme, name: this.item?.name },
			canSpend: Number(theme?.availableImprovements ?? 0) > 0,
			tagSources,
			specialOptions,
			rewriteTags: [
				...(theme?.powerTags ?? []).map((tag) => ({ ...tag, kind: "power" })),
				...(theme?.weaknessTags ?? []).map((tag) => ({
					...tag,
					kind: "weakness",
				})),
			],
			weaknessTags: theme?.weaknessTags ?? [],
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#bindPopoverDismissal();
		enhanceAdvancementSelects(this.element, this.dismissController.signal);
		this.element
			.querySelectorAll("[data-advancement-action]")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#onAction(event));
			});
		this.element
			.querySelector('[name="choice"]')
			?.addEventListener("change", () => {
				this.#syncFields();
			});
		this.element
			.querySelector('[name="specialSource"]')
			?.addEventListener("change", () => {
				this.#syncFields();
			});
		this.#syncFields();
	}

	#bindPopoverDismissal() {
		this.dismissController?.abort();
		this.dismissController = new AbortController();
		const { signal } = this.dismissController;
		document.addEventListener(
			"pointerdown",
			(event) => {
				for (const picker of this.element.querySelectorAll(
					".litm--advancement-source-picker.open, .litm--advancement-select.open",
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
						".litm--advancement-source-picker.open, .litm--advancement-select.open",
					)
					.forEach((picker) => picker.classList.remove("open"));
			},
			{ signal },
		);
	}

	async #onAction(event) {
		event.preventDefault();
		const action = event.currentTarget.dataset.advancementAction;
		if (action === "apply-improvement") return this.#applyImprovement();
		if (action === "reset-available") {
			if (await ThemeAdvancement.resetFellowshipAvailable(this.item))
				this.close();
			return;
		}
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
		if (action === "select-tag-source")
			this.#selectTagSource(event.currentTarget);
	}

	#selectTagSource(option) {
		if (!option) return;
		const picker = option.closest(".litm--advancement-source-picker");
		picker.querySelector('[name="tagSource"]').value = option.dataset.value;
		picker.querySelector(
			".litm--advancement-source-selected span",
		).textContent = option.querySelector("span")?.textContent ?? "";
		const value = this.element.querySelector('[name="value"]');
		if (value && option.dataset.name) value.value = option.dataset.name;
		picker.classList.remove("open");
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
		const themebook = theme?.themebookUuid
			? await fromUuid(theme.themebookUuid)
			: null;
		if (
			!themebook ||
			themebook.type !== "themebook" ||
			!themebook.system.isFellowship
		) {
			return { tagSources, specialOptions };
		}
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
		const activeSpecialIds = new Set(
			(theme.specials ?? []).map((special) => special.id),
		);
		const claimed = new Set(
			(theme.claimedSpecials ?? [])
				.filter(
					(claim) =>
						claim.retired || activeSpecialIds.has(claim.themeSpecialId),
				)
				.map((claim) => `${claim.sourceUuid}:${claim.specialId}`),
		);
		for (const special of themebook.system.specials ?? []) {
			const value = `${themebook.uuid}:${special.id}`;
			specialOptions.push({
				value,
				name: special.name,
				description: special.description,
				enrichedDescription:
					await foundry.applications.ux.TextEditor.implementation.enrichHTML(
						special.description || "",
					),
				sourceName: themebook.name,
				claimed: claimed.has(value),
			});
		}
		return { tagSources, specialOptions };
	}

	#syncFields() {
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
		for (const option of this.element.querySelectorAll(
			'[data-advancement-action="select-tag-source"]',
		)) {
			option.hidden =
				option.dataset.kind !== "all" && option.dataset.kind !== choice;
		}
		const source = this.element.querySelector('[name="tagSource"]');
		const selected = this.element.querySelector(
			`[data-advancement-action="select-tag-source"][data-value="${CSS.escape(source.value)}"]`,
		);
		if (selected?.hidden)
			this.#selectTagSource(
				this.element.querySelector('[data-value="manual"]'),
			);
	}

	async #applyImprovement() {
		const theme = this.item.system.toObject();
		if (!theme.availableImprovements) return;
		const choice = this.#value("choice");
		const source = this.#value("tagSource");
		const value = this.#value("value");
		let result;
		if ((choice === "power" || choice === "weakness") && !value) return;

		if (choice === "power" || choice === "weakness") {
			const field = choice === "power" ? "powerTags" : "weaknessTags";
			const type = choice === "power" ? "powerCrispy" : "weaknessTag";
			theme[field] ??= [];
			const tag = {
				id: foundry.utils.randomID(),
				name: value,
				type,
				isScratched: false,
			};
			theme[field].push(tag);
			result = { kind: choice, tag };
			if (source.startsWith("draft:")) {
				const draftId = source.slice("draft:".length);
				theme.draftTags = (theme.draftTags ?? []).filter(
					(tag) => tag.id !== draftId,
				);
			}
			this.#recordQuestionAnswer(theme, source, value, choice, tag.id);
		} else if (choice === "remove-weakness") {
			const id = this.#value("weaknessTarget");
			if (!id) return;
			const tag = (theme.weaknessTags ?? []).find((tag) => tag.id === id);
			if (!tag) return;
			theme.weaknessTags = (theme.weaknessTags ?? []).filter(
				(tag) => tag.id !== id,
			);
			result = { kind: choice, tag };
		} else if (choice === "special") {
			const select = this.element.querySelector('[name="specialSource"]');
			const option = select?.selectedOptions[0];
			if (!option?.value || option.disabled) return;
			theme.specials ??= [];
			const themeSpecialId = foundry.utils.randomID();
			const special = {
				id: themeSpecialId,
				name:
					option.value === "custom"
						? this.#value("customSpecialName")
						: option.dataset.name,
				description:
					option.value === "custom"
						? this.#value("customSpecialDescription")
						: option.dataset.description,
			};
			if (!special.name) return;
			theme.specials.push(special);
			if (option.value !== "custom") {
				const splitAt = option.value.lastIndexOf(":");
				const sourceUuid = option.value.slice(0, splitAt);
				const specialId = option.value.slice(splitAt + 1);
				theme.claimedSpecials ??= [];
				const existingClaim = theme.claimedSpecials.find(
					(claim) =>
						claim.sourceUuid === sourceUuid && claim.specialId === specialId,
				);
				if (existingClaim) {
					existingClaim.name = special.name;
					existingClaim.themeSpecialId = themeSpecialId;
				} else {
					theme.claimedSpecials.push({
						sourceUuid,
						specialId,
						name: special.name,
						themeSpecialId,
						retired: false,
						claimedAt: Date.now(),
					});
				}
			}
			result = { kind: choice, special };
		} else if (choice === "reset-abandon") {
			theme.abandon = 0;
			theme.thresholdNotifications ??= { milestone: false, abandon: false };
			theme.thresholdNotifications.abandon = false;
			result = { kind: choice };
		} else if (choice === "reset-milestone") {
			theme.milestone = 0;
			theme.thresholdNotifications ??= { milestone: false, abandon: false };
			theme.thresholdNotifications.milestone = false;
			result = { kind: choice };
		} else if (choice === "reset-both") {
			theme.abandon = 0;
			theme.milestone = 0;
			theme.thresholdNotifications = { milestone: false, abandon: false };
			result = { kind: choice };
		} else return;

		result.rewrite = this.#applyRewrite(theme);
		theme.availableImprovements -= 1;
		await this.item.update({ system: theme });
		await ThemeAdvancement.notifyFellowshipImprovement(this.item, result);
		if (theme.availableImprovements <= 0) this.close();
		else this.render();
	}

	#applyRewrite(theme) {
		const target = this.#value("rewriteTarget");
		const value = this.#value("rewriteValue");
		if (!target || !value) return null;
		const [kind, id] = target.split(":");
		const tags = kind === "power" ? theme.powerTags : theme.weaknessTags;
		const tag = tags?.find((entry) => entry.id === id);
		if (!tag) return null;
		const oldName = tag.name;
		tag.name = value;
		return { oldName, newName: value };
	}

	#recordQuestionAnswer(theme, sourceValue, value, fallbackKind, tagId) {
		if (!sourceValue.startsWith("question:")) return;
		const parts = sourceValue.split(":");
		const questionId = parts.at(-2);
		const kind = parts.at(-1) || fallbackKind;
		const sourceUuid = parts.slice(1, -2).join(":");
		theme.themebookAnswers ??= [];
		theme.themebookAnswers.push({
			id: foundry.utils.randomID(),
			sourceUuid,
			questionId,
			kind,
			question: "",
			answer: value,
			tagId,
			role: fallbackKind,
			createdAt: Date.now(),
		});
	}

	#value(name) {
		return this.element.querySelector(`[name="${name}"]`)?.value?.trim() ?? "";
	}
}
