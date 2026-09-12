import { Sockets } from "../../system/sockets.js";
import { ThemeAdvancement } from "../../system/theme-advancement.js";
import { ThemeContentSheet } from "./theme-content-sheet.js";

const TextEditor = foundry.applications.ux.TextEditor.implementation;
const { fromUuidSync } = foundry.utils;

/** Sidebar Item sheet for authoring Themebooks. */
export class ThemebookSheet extends ThemeContentSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--theme-content", "litm--themebook"],
		position: { width: 920, height: 675 },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/item/themebook.html" },
	};

	constructor(options = {}) {
		super(options);
		this.forceObserver = Boolean(options.forceObserver);
		this.contextActor = options.actorUuid
			? fromUuidSync(options.actorUuid)
			: null;
		this.contextFellowship = options.fellowshipUuid
			? fromUuidSync(options.fellowshipUuid)
			: null;
		this.answerSaveQueue = Promise.resolve();
		this.themeIndex = Number.isInteger(Number(options.themeIndex))
			? Number(options.themeIndex)
			: null;
		if (this.contextActor) {
			this.actorUpdateHook = Hooks.on("updateActor", (actor) => {
				if (actor.uuid === this.contextActor.uuid) this.render();
			});
		}
		if (this.contextFellowship) {
			this.fellowshipUpdateHook = Hooks.on("updateItem", (item) => {
				if (item.uuid === this.contextFellowship.uuid) this.render();
			});
		}
	}

	get theme() {
		return (
			this.contextActor?.system?.themes?.[this.themeIndex] ??
			this.contextFellowship?.system
		);
	}

	/** Allow character controls while the source Item itself remains read-only. */
	get isEditable() {
		if (
			this.forceObserver &&
			(this.contextActor || this.contextFellowship) &&
			this.theme
		)
			return true;
		return super.isEditable;
	}

	/** @override */
	_getHeaderControls() {
		const controls = super._getHeaderControls();
		if (!this.forceObserver && (game.user.isGM || this.item.isOwner))
			return controls;
		return controls.filter(
			(control) => control.action !== "configureBackground",
		);
	}

	/** Remove the character update hook used by the contextual observer view. */
	async close(options) {
		if (this.actorUpdateHook != null)
			Hooks.off("updateActor", this.actorUpdateHook);
		if (this.fellowshipUpdateHook != null)
			Hooks.off("updateItem", this.fellowshipUpdateHook);
		return super.close(options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const system = this.item.system.toObject();
		const canEdit =
			!this.forceObserver && (game.user.isGM || this.item.isOwner);
		const themeView =
			this.forceObserver &&
			Boolean((this.contextActor || this.contextFellowship) && this.theme);
		const answerRecords = this.theme?.themebookAnswers ?? [];
		const prepareQuestions = (questions, kind) =>
			(questions ?? []).map((question, index) => {
				const answers = answerRecords.filter((answer) => {
					const sourceMatches = answer.sourceUuid
						? answer.sourceUuid === this.item.uuid
						: this.theme?.themebookUuid === this.item.uuid;
					return (
						sourceMatches && (answer.questionId || answer.id) === question.id
					);
				});
				const answer = answers.find((entry) => !entry.tagId) ?? answers[0];
				return {
					...question,
					index,
					kind,
					answer: answer
						? {
								id: answer.id,
								value: answer.answer,
								tagId: answer.tagId,
								selected: Boolean(answer.tagId),
							}
						: { id: "", value: "", tagId: "", selected: false },
				};
			});
		const claims = new Map(
			(this.theme?.claimedSpecials ?? [])
				.filter((claim) => claim.sourceUuid === this.item.uuid)
				.map((claim) => [claim.specialId, claim]),
		);
		const activeSpecialIds = new Set(
			(this.theme?.specials ?? []).map((special) => special.id),
		);
		const specials = (await this._prepareSpecialEntries(system.specials)).map(
			(special) => {
				const claim = claims.get(special.id);
				return {
					...special,
					claimed: Boolean(claim),
					retired: Boolean(claim?.retired),
					active: Boolean(
						claim?.themeSpecialId && activeSpecialIds.has(claim.themeSpecialId),
					),
				};
			},
		);
		const previewMight = system.might === "variable" ? "origin" : system.might;
		const transitionMight = system.might === "variable" ? "grey" : previewMight;
		const darkTheme = document.body.classList.contains("theme-dark");
		const iconSrc = (might) => {
			const variant =
				darkTheme && might !== "variable" ? "-color-light" : "-color";
			return `${CONFIG.litm.themeicon_src[might]}${variant}_litm_icn.svg`;
		};
		const conceptOptions = system.conceptOptions?.length
			? system.conceptOptions.map((option, index) => ({
					...option,
					text:
						index === 0 && !option.text ? system.concept || "" : option.text,
				}))
			: [
					{
						id: foundry.utils.randomID(),
						text: system.concept || "",
					},
				];
		return {
			...context,
			document: this.item,
			system: {
				...system,
				conceptOptions,
				specials,
				descriptionEnriched: await TextEditor.enrichHTML(
					system.description || "",
				),
				powerQuestions: prepareQuestions(system.powerQuestions, "power"),
				weaknessQuestions: prepareQuestions(
					system.weaknessQuestions,
					"weakness",
				),
			},
			canEdit,
			readOnly: !canEdit,
			themeView,
			canAnswer: themeView,
			mightOptions: ["origin", "adventure", "greatness", "variable"],
			standardMightOptions: ["origin", "adventure", "greatness"],
			mightDropdownOptions: [
				"origin",
				"adventure",
				"greatness",
				"variable",
			].map((might) => ({
				key: might,
				label: game.i18n.localize(`Litm.theme-content.might-${might}`),
				icon: iconSrc(might),
			})),
			currentMightLabel: game.i18n.localize(
				`Litm.theme-content.might-${system.might}`,
			),
			currentMightIcon: iconSrc(system.might),
			iconMight: system.might,
			previewMight,
			transitionSrc: `systems/litm-rn/assets/media/transition-left-${transitionMight}-dark.webp`,
			hasCustomBackground: Boolean(system.background),
			backgroundArtStyle: this.#backgroundArtStyle(system),
			defaultDescription: game.i18n.localize(
				"Litm.theme-content.default-description",
			),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.classList.toggle("litm--content-readonly", context.readOnly);
		this.element.classList.toggle(
			"litm--content-theme-view",
			context.themeView,
		);
		if (!context.themeView) return;
		this.element
			.querySelectorAll("[data-themebook-answer]")
			.forEach((input) => {
				input.addEventListener("blur", (event) => {
					const target = event.currentTarget;
					this.answerSaveQueue = this.answerSaveQueue.then(() =>
						this.#saveAnswer(target),
					);
				});
				input.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					event.currentTarget.blur();
				});
			});
		this.element
			.querySelectorAll("[data-themebook-add-tag]")
			.forEach((button) => {
				button.addEventListener("click", (event) =>
					this.#addAnswerAsTag(event.currentTarget),
				);
			});
		this.element
			.querySelectorAll("[data-themebook-clear-answer]")
			.forEach((button) => {
				button.addEventListener("click", (event) =>
					this.#clearAnswer(event.currentTarget),
				);
			});
		this.element
			.querySelectorAll("[data-themebook-add-special]")
			.forEach((button) => {
				button.addEventListener("click", (event) =>
					this.#addSpecial(event.currentTarget),
				);
			});
	}

	/** @override */
	async _processSubmitData(event, form, formData) {
		if (this.forceObserver || (!game.user.isGM && !this.item.isOwner)) return;
		return super._processSubmitData(event, form, formData);
	}

	/** @override */
	async _onContentAction(event) {
		if (this.forceObserver || (!game.user.isGM && !this.item.isOwner)) return;
		event.preventDefault();
		const button = event.currentTarget;
		const action = button.dataset.contentAction;
		const path = button.dataset.path;
		const id = button.dataset.id;

		if (action === "add-prompt") {
			const entry = {
				id: foundry.utils.randomID(),
				text: "",
			};
			await this._appendEntry(path, entry, {
				focusSelector: `[data-array-path="${path}"][data-entry-id="${entry.id}"]`,
			});
		} else if (action === "remove-entry") {
			await this._removeEntry(path, id, { confirm: path === "specials" });
		} else if (action === "add-concept-option") {
			const entry = {
				id: foundry.utils.randomID(),
				text: "",
			};
			await this._appendEntry("conceptOptions", entry, {
				focusSelector: `[data-array-path="conceptOptions"][data-entry-id="${entry.id}"]`,
			});
		} else if (action === "remove-concept-option") {
			await this._removeEntry("conceptOptions", id, { confirm: false });
		} else if (action === "add-special") {
			await this._appendEditingSpecial({
				id: foundry.utils.randomID(),
				name: game.i18n.localize("Litm.ui.name-special"),
				description: game.i18n.localize("Litm.ui.name-special-description"),
			});
		} else if (action === "toggle-special-edit") {
			await this._toggleSpecialEdit(button);
		}
	}

	#backgroundArtStyle(system) {
		if (!system.background) return "";
		const position = `center ${system.backgroundAnchorY || "center"}`;
		return `background-image:url("${system.background}");background-position:${position};`;
	}

	async #saveAnswer(input) {
		const value = input.value.trim();
		const theme = this.#contextThemeData();
		theme.themebookAnswers ??= [];
		const existing = input.dataset.answerId
			? theme.themebookAnswers.find(
					(answer) => answer.id === input.dataset.answerId,
				)
			: null;
		if (existing) {
			if (!value) {
				theme.themebookAnswers = theme.themebookAnswers.filter(
					(answer) => answer.id !== existing.id,
				);
			} else {
				existing.answer = value;
			}
		} else if (value) {
			theme.themebookAnswers.push(this.#newAnswer(input, value));
		} else return;
		await this.#updateContextTheme(theme, ["themebookAnswers"]);
	}

	async #addAnswerAsTag(button) {
		const row = button.closest("[data-themebook-question]");
		const input = row?.querySelector("[data-themebook-answer]");
		const value = input?.value.trim();
		if (!value) {
			input?.focus();
			return;
		}
		if (button.disabled) return;
		await this.answerSaveQueue;
		const theme = this.#contextThemeData();
		const kind = button.dataset.kind;
		const tag = {
			id: foundry.utils.randomID(),
			name: value,
			type:
				kind === "weakness"
					? "weaknessTag"
					: this.contextFellowship
						? "powerCrispy"
						: "powerTag",
			isScratched: false,
		};
		const path = kind === "weakness" ? "weaknessTags" : "powerTags";
		theme[path] ??= [];
		theme[path].push(tag);
		theme.themebookAnswers ??= [];
		let answer = input.dataset.answerId
			? theme.themebookAnswers.find(
					(entry) => entry.id === input.dataset.answerId,
				)
			: null;
		answer ??= theme.themebookAnswers.find(
			(entry) =>
				entry.sourceUuid === this.item.uuid &&
				entry.questionId === input.dataset.questionId &&
				entry.answer === value &&
				!entry.tagId,
		);
		if (!answer) {
			answer = this.#newAnswer(input, value);
			theme.themebookAnswers.push(answer);
		}
		answer.answer = value;
		answer.tagId = tag.id;
		answer.role = kind;
		await this.#updateContextTheme(theme, [path, "themebookAnswers"]);
		if (this.contextActor) {
			await ThemeAdvancement.syncThemeEffects(
				this.contextActor,
				theme.id,
				theme,
			);
		}
	}

	async #clearAnswer(button) {
		const answerId = button.dataset.answerId;
		if (!answerId) return;
		await this.answerSaveQueue;
		const theme = this.#contextThemeData();
		theme.themebookAnswers = (theme.themebookAnswers ?? []).filter(
			(answer) => answer.id !== answerId,
		);
		await this.#updateContextTheme(theme, ["themebookAnswers"]);
	}

	async #addSpecial(button) {
		const specialId = button.dataset.specialId;
		const sourceSpecial = this.item.system.specials.find(
			(special) => special.id === specialId,
		);
		if (!sourceSpecial || button.disabled) return;
		const theme = this.#contextThemeData();
		const existingClaim = (theme.claimedSpecials ?? []).find(
			(claim) =>
				claim.sourceUuid === this.item.uuid && claim.specialId === specialId,
		);
		if (existingClaim?.retired) return;
		const activeIds = new Set(
			(theme.specials ?? []).map((special) => special.id),
		);
		if (
			existingClaim?.themeSpecialId &&
			activeIds.has(existingClaim.themeSpecialId)
		)
			return;
		const themeSpecialId = foundry.utils.randomID();
		theme.specials ??= [];
		theme.specials.push({
			id: themeSpecialId,
			name: sourceSpecial.name,
			description: sourceSpecial.description,
		});
		theme.claimedSpecials ??= [];
		if (existingClaim) {
			existingClaim.themeSpecialId = themeSpecialId;
			existingClaim.name = sourceSpecial.name;
		} else {
			theme.claimedSpecials.push({
				sourceUuid: this.item.uuid,
				specialId,
				name: sourceSpecial.name,
				themeSpecialId,
				retired: false,
				claimedAt: Date.now(),
			});
		}
		await this.#updateContextTheme(theme, ["specials", "claimedSpecials"]);
	}

	#contextThemeData() {
		if (this.contextActor) {
			return foundry.utils.deepClone(
				this.contextActor.toObject().system.themes?.[this.themeIndex] ?? {},
			);
		}
		return foundry.utils.deepClone(
			this.contextFellowship?.toObject().system ?? {},
		);
	}

	async #updateContextTheme(theme, fellowshipFields = []) {
		if (this.contextActor) {
			const themes = foundry.utils.deepClone(
				this.contextActor.toObject().system.themes ?? [],
			);
			themes[this.themeIndex] = theme;
			await this.contextActor.update({ "system.themes": themes });
			Hooks.callAll("litmActorDataUpdated", this.contextActor.uuid);
			return;
		}
		if (!this.contextFellowship) return;
		const updates = Object.fromEntries(
			fellowshipFields.map((field) => [
				`system.${field}`,
				foundry.utils.deepClone(theme[field] ?? []),
			]),
		);
		if (game.user.isGM || this.contextFellowship.isOwner) {
			await this.contextFellowship.update(updates);
			return;
		}
		Sockets.dispatch("fellowshipThemebookMutation", {
			fellowshipUuid: this.contextFellowship.uuid,
			updates,
		});
	}

	#newAnswer(input, value) {
		return {
			id: foundry.utils.randomID(),
			sourceUuid: this.item.uuid,
			questionId: input.dataset.questionId,
			kind: input.dataset.kind,
			question: "",
			answer: value,
			tagId: "",
			role: "",
			createdAt: Date.now(),
		};
	}
}
