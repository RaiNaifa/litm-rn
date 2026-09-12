import { ThemeSources } from "../system/theme-sources.js";
import { localize as t } from "../utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid, fromUuidSync } = foundry.utils;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** Guided creator for an empty or replaced character Theme. */
export class ThemeBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "litm-theme-builder",
		classes: ["litm", "litm--theme-builder"],
		position: { width: 780, height: 720 },
		window: {
			title: "Litm.theme-builder.title",
			resizable: true,
		},
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/theme-builder.html" },
	};

	constructor(actorUuid, options = {}) {
		super(options);
		this.actor = fromUuidSync(actorUuid);
		this.themeIndex = options.themeIndex;
		this.#minimumStep = options.lockedSource ? 2 : 0;
		this.#onComplete = options.onComplete;
		if (options.sourceUuid) {
			this.#draft.mode = "themekit";
			this.#draft.sourceUuid = options.sourceUuid;
			this.#draft.level = options.level || "";
			this.#step = options.startStep ?? 2;
			const source = fromUuidSync(options.sourceUuid);
			if (source) this.#seedDraft(source);
		}
	}

	#step = 0;
	#minimumStep = 0;
	#onComplete = null;
	#draft = {
		mode: "",
		sourceUuid: "",
		level: "",
		themeTag: "",
		quest: "",
		introductionAnswers: {},
		powerAnswers: {},
		weaknessAnswers: {},
		selectedPower: [],
		selectedWeakness: [],
		selectedSpecials: [],
	};

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const themebooks = await ThemeSources.getThemebooks();
		const kits = await ThemeSources.getThemeKits();
		const themebookMap = new Map(themebooks.map((item) => [item.uuid, item]));
		const kitOptions = kits.map((item) => {
			const book = themebookMap.get(item.system.themebookUuid);
			return {
				uuid: item.uuid,
				name: item.name,
				themebookName: book?.name || item.system.themebookName,
				might: item.system.mightOverride || "origin",
			};
		});
		const selected = this.#draft.sourceUuid
			? await fromUuid(this.#draft.sourceUuid)
			: null;
		if (selected && this.#minimumStep > 0 && !this.#draft.themeTag)
			this.#seedDraft(selected);
		const selectedThemebook =
			selected?.type === "themebook"
				? selected
				: selected?.type === "themekit"
					? themebookMap.get(selected.system.themebookUuid) ||
						(selected.system.themebookUuid
							? await fromUuid(selected.system.themebookUuid)
							: null)
					: null;
		const specials = await this.#buildSpecialOptions(
			selectedThemebook,
			selected,
		);
		const themebookOptions = themebooks.map((item) => ({
			uuid: item.uuid,
			name: item.name,
			might: item.system.might,
		}));
		return {
			...context,
			step: this.#step,
			displayStep:
				this.#minimumStep > 0 ? this.#step - this.#minimumStep : this.#step,
			stepCount: this.#minimumStep > 0 ? 2 : 4,
			showBack: this.#minimumStep === 0 || this.#step > this.#minimumStep,
			draft: this.#draft,
			themebookGroups: this.#groupSources(themebookOptions),
			kitGroups: this.#groupSources(kitOptions),
			selected: selected?.toObject() ?? null,
			selectedThemebook: selectedThemebook?.toObject() ?? null,
			specials,
			preview: this.#buildTheme(selectedThemebook, selected),
			isThemebookMode: this.#draft.mode === "themebook",
			isThemekitMode: this.#draft.mode === "themekit",
			mightOptions: ["origin", "adventure", "greatness"],
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[data-builder-action]").forEach((button) => {
			button.addEventListener("click", (event) => this.#onAction(event));
		});
		this.element.querySelectorAll('[name="sourceUuid"]').forEach((input) => {
			input.addEventListener("change", (event) => this.#onSourceChange(event));
		});
		this.element
			.querySelectorAll('[name="selectedPower"], [name="selectedWeakness"]')
			.forEach((input) => {
				input.addEventListener("change", () => {
					this.#draft.selectedPower = this.#checkedValues("selectedPower");
					this.#draft.selectedWeakness =
						this.#checkedValues("selectedWeakness");
				});
			});
	}

	async #onAction(event) {
		event.preventDefault();
		switch (event.currentTarget.dataset.builderAction) {
			case "choose-mode":
				await this.#chooseMode(event.currentTarget.dataset.mode);
				break;
			case "back":
				this.#captureStep();
				this.#step = Math.max(this.#minimumStep, this.#step - 1);
				this.render();
				break;
			case "next":
				await this.#next();
				break;
			case "save":
				await this.#save();
				break;
			case "use-quest":
				this.element.querySelector('[name="quest"]').value =
					event.currentTarget.dataset.text || "";
				break;
			case "preview-source":
				await this.#previewSource(event.currentTarget.dataset.uuid);
				break;
		}
	}

	#groupSources(sources) {
		const order = ["origin", "adventure", "greatness", "variable"];
		return order
			.map((might) => ({
				might,
				label: t(`Litm.theme-content.might-${might}`),
				sources: sources
					.filter((source) => source.might === might)
					.sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.filter((group) => group.sources.length);
	}

	async #previewSource(uuid) {
		const source = uuid ? await fromUuid(uuid) : null;
		if (!source || !["themebook", "themekit"].includes(source.type)) return;
		source.sheet.render({ force: true });
	}

	async #chooseMode(mode) {
		if (mode === "custom") {
			await this.#saveCustom();
			return;
		}
		this.#draft.mode = mode;
		this.#step = 1;
		this.render();
	}

	#onSourceChange(event) {
		const input = event.currentTarget;
		this.#draft.sourceUuid = input.value;
		const level = input.dataset.might;
		const select = this.element.querySelector('[name="level"]');
		if (select && level !== "variable") select.value = level || "origin";
		if (select && level === "variable") select.value = "";
	}

	async #next() {
		this.#captureStep();
		if (this.#step === 1) {
			if (!this.#draft.sourceUuid) {
				ui.notifications.warn(t("Litm.theme-builder.choose-source-warning"));
				return;
			}
			const source = await fromUuid(this.#draft.sourceUuid);
			const sourceMight = await this.#sourceMight(source);
			if (sourceMight === "variable" && !this.#draft.level) {
				ui.notifications.warn(t("Litm.theme-builder.choose-might-warning"));
				return;
			}
			if (!this.#draft.level) this.#draft.level = sourceMight || "origin";
			this.#seedDraft(source);
		}
		this.#step = Math.min(3, this.#step + 1);
		this.render();
	}

	#captureStep() {
		if (!this.element) return;
		if (this.#step === 1) {
			this.#draft.sourceUuid =
				this.element.querySelector('[name="sourceUuid"]:checked')?.value ||
				this.#draft.sourceUuid;
			this.#draft.level =
				this.element.querySelector('[name="level"]')?.value || "";
			return;
		}
		if (this.#step !== 2) return;
		this.#draft.themeTag =
			this.element.querySelector('[name="themeTag"]')?.value || "";
		this.#draft.quest =
			this.element.querySelector('[name="quest"]')?.value || "";
		for (const input of this.element.querySelectorAll("[data-answer-kind]")) {
			this.#draft[`${input.dataset.answerKind}Answers`][input.dataset.id] =
				input.value;
		}
		this.#draft.selectedPower = this.#checkedValues("selectedPower");
		this.#draft.selectedWeakness = this.#checkedValues("selectedWeakness");
		this.#draft.selectedSpecials = this.#checkedValues("selectedSpecials");
	}

	#checkedValues(name) {
		return [...this.element.querySelectorAll(`[name="${name}"]:checked`)].map(
			(input) => input.value,
		);
	}

	async #sourceMight(source) {
		if (source?.type === "themebook") return source.system.might;
		if (source?.type !== "themekit") return "origin";
		return source.system.mightOverride || "origin";
	}

	#seedDraft(source) {
		if (source.type === "themebook") {
			this.#draft.themeTag ||= source.name;
			return;
		}
		if (source.type === "themekit") {
			this.#draft.themeTag ||= source.system.themeTag?.name || source.name;
			this.#draft.quest ||= source.system.quest || "";
		}
	}

	async #buildSpecialOptions(themebook, source) {
		const options = [];
		if (source?.type === "themebook") {
			for (const special of themebook?.system.specials ?? []) {
				options.push({
					...special.toObject(),
					key: `themebook:${special.id}`,
					source: themebook.name,
					enrichedDescription: await TextEditor.enrichHTML(
						special.description || "",
						{
							async: true,
							relativeTo: themebook,
						},
					),
				});
			}
		}
		if (source?.type === "themekit") {
			for (const special of source.system.specials ?? []) {
				options.push({
					...special.toObject(),
					key: `themekit:${special.id}`,
					source: source.name,
					enrichedDescription: await TextEditor.enrichHTML(
						special.description || "",
						{
							async: true,
							relativeTo: source,
						},
					),
				});
			}
		}
		return options;
	}

	#buildTheme(themebook, source) {
		if (!source) return null;
		const powerTags = [];
		const weaknessTags = [];
		const draftTags = [];
		if (source.type === "themebook") {
			for (const question of themebook?.system.weaknessQuestions ?? []) {
				const name = this.#draft.weaknessAnswers[question.id]?.trim();
				if (name) weaknessTags.push(this.#makeTag(name, "weaknessTag"));
			}
		} else {
			for (const tag of source.system.powerTags ?? []) {
				if (this.#draft.selectedPower.includes(tag.id)) {
					powerTags.push(this.#makeTag(tag.name, "powerTag"));
				} else
					draftTags.push({
						id: foundry.utils.randomID(),
						name: tag.name,
						isWeakness: false,
					});
			}
			for (const tag of source.system.weaknessTags ?? []) {
				if (this.#draft.selectedWeakness.includes(tag.id)) {
					weaknessTags.push(this.#makeTag(tag.name, "weaknessTag"));
				} else
					draftTags.push({
						id: foundry.utils.randomID(),
						name: tag.name,
						isWeakness: true,
					});
			}
		}
		const specials = [];
		const powerQuestions = themebook?.system.powerQuestions ?? [];
		const answeredPower =
			source.type === "themebook"
				? powerQuestions
						.slice(1)
						.map((question) => this.#draft.powerAnswers[question.id]?.trim())
						.filter(Boolean)
				: [];
		const titleTag =
			source.type === "themebook"
				? this.#draft.powerAnswers[powerQuestions[0]?.id]?.trim() ||
					this.#draft.themeTag ||
					source.name
				: this.#draft.themeTag || source.name;
		if (source.type === "themebook") {
			powerTags.splice(
				0,
				powerTags.length,
				...answeredPower.map((name) => this.#makeTag(name, "powerTag")),
			);
		}
		const themeTag = this.#makeTag(titleTag, "themeTag");
		let powerTagIndex = 0;
		const titleQuestionId = powerQuestions[0]?.id;
		const themebookAnswers =
			source.type === "themebook"
				? [
						[
							"power",
							themebook?.system.powerQuestions ?? [],
							this.#draft.powerAnswers,
						],
						[
							"weakness",
							themebook?.system.weaknessQuestions ?? [],
							this.#draft.weaknessAnswers,
						],
					].flatMap(([kind, questions, answers]) =>
						questions
							.filter((question) => answers[question.id]?.trim())
							.map((question) => {
								const isTitle =
									kind === "power" && question.id === titleQuestionId;
								const tag = isTitle
									? themeTag
									: kind === "power"
										? powerTags[powerTagIndex++]
										: weaknessTags.find(
												(entry) => entry.name === answers[question.id]?.trim(),
											);
								return {
									id: foundry.utils.randomID(),
									sourceUuid: themebook.uuid,
									questionId: question.id,
									kind,
									question: question.text,
									answer: answers[question.id] ?? "",
									tagId: tag?.id ?? "",
									role: isTitle ? "title" : kind,
									createdAt: Date.now(),
								};
							}),
					)
				: [];
		return {
			id: this.actor.system.themes[this.themeIndex].id,
			type: "theme",
			isEmpty: false,
			creationMode: this.#draft.mode,
			name: titleTag,
			themebook: themebook?.name || "",
			themebookUuid: themebook?.uuid || "",
			themebookCustom: false,
			themekitUuid: source.type === "themekit" ? source.uuid : "",
			themekitName: source.type === "themekit" ? source.name : "",
			themebookAnswers,
			level: this.#draft.level || "origin",
			themeTag,
			powerTags,
			weaknessTags,
			draftTags,
			specials,
			improve: 0,
			abandon: 0,
			milestone: 0,
			availableImprovements: 0,
			nascentPowerNeeded: 0,
			claimedSpecials: [],
			thresholdNotifications: { milestone: false, abandon: false },
			motivation: this.#draft.quest,
			note: "",
		};
	}

	#makeTag(name, type) {
		return {
			id: foundry.utils.randomID(),
			name,
			type,
			isScratched: false,
		};
	}

	async #saveCustom() {
		const current = this.actor.system.themes[this.themeIndex];
		const theme = {
			...(current.toObject
				? current.toObject()
				: foundry.utils.deepClone(current)),
			isEmpty: false,
			creationMode: "custom",
			themebook: "",
			themebookUuid: "",
			themebookCustom: true,
			themekitUuid: "",
			themekitName: "",
			themeTag: this.#makeTag(t("Litm.ui.name-theme-tag"), "themeTag"),
			powerTags: Array.from({ length: 2 }, () =>
				this.#makeTag(t("Litm.ui.name-power"), "powerTag"),
			),
			weaknessTags: [this.#makeTag(t("Litm.ui.name-weakness"), "weaknessTag")],
			draftTags: [],
			specials: [],
			improve: 0,
			abandon: 0,
			milestone: 0,
			availableImprovements: 0,
			nascentPowerNeeded: 0,
			claimedSpecials: [],
			thresholdNotifications: { milestone: false, abandon: false },
			motivation: t("Litm.ui.name-motivation"),
			note: t("Litm.ui.name-note"),
		};
		await this.#applyTheme(theme);
		await this.#onComplete?.(theme);
		await this.close();
		new game.litm.ThemeCard(this.actor.uuid, {
			themeIndex: this.themeIndex,
		}).render({ force: true });
	}

	async #save() {
		this.#captureStep();
		const source = await fromUuid(this.#draft.sourceUuid);
		if (!source) return;
		const themebook =
			source?.type === "themebook"
				? source
				: source.system.themebookUuid
					? await fromUuid(source.system.themebookUuid)
					: null;
		const theme = this.#buildTheme(themebook, source);
		if (!theme) return;
		await this.#applyTheme(theme);
		await this.#onComplete?.(theme);
		await this.close();
		new game.litm.ThemeCard(this.actor.uuid, {
			themeIndex: this.themeIndex,
		}).render({ force: true });
	}

	async #applyTheme(theme) {
		const themes = foundry.utils.deepClone(
			this.actor.toObject().system.themes ?? [],
		);
		themes[this.themeIndex] = theme;
		await this.actor.update({ "system.themes": themes }, { validate: false });
		const existing = this.actor.effects
			.filter((effect) => {
				const flags = effect.flags?.["litm-rn"];
				return flags?.ownerType === "theme" && flags.ownerId === theme.id;
			})
			.map((effect) => effect.id);
		if (existing.length) {
			await this.actor.deleteEmbeddedDocuments("ActiveEffect", existing);
		}
		const effects = [
			{ tag: theme.themeTag, hindering: false },
			...theme.powerTags.map((tag) => ({ tag, hindering: false })),
			...theme.weaknessTags.map((tag) => ({ tag, hindering: true })),
		]
			.filter((entry) => entry.tag?.name)
			.map(({ tag, hindering }) => ({
				name: tag.name,
				disabled: false,
				transfer: false,
				flags: {
					"litm-rn": {
						type: "tag",
						ownerType: "theme",
						ownerId: theme.id,
						isScratched: tag.isScratched ?? false,
						isHindering: hindering,
						isCrispy: tag.isCrispy ?? false,
					},
				},
			}));
		if (effects.length) {
			await this.actor.createEmbeddedDocuments("ActiveEffect", effects);
		}
		Hooks.callAll("litmActorDataUpdated", this.actor.uuid);
	}
}
