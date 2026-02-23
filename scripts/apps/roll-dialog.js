import { Sockets } from "../system/sockets.js";
import { sortTags, dispatch, localize as t } from "../utils.js";

export class LitmRollDialog extends FormApplication {
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/litm-rn/templates/apps/roll-dialog.html",
			classes: ["litm", "litm--roll"],
			width: 686,
			height: "auto",
			resizable: true,
			title: game.i18n.localize("Litm.ui.roll-title"),
		});
	}

	static create({
		actorId,
		characterTags,
		speaker,
		tagState,
		shouldRoll,
		type,
		title,
		id,
	}) {
		return new LitmRollDialog(actorId, characterTags, {
			tagState,
			speaker,
			shouldRoll,
			type,
			title,
			id,
		});
	}

	static roll({ actorId, tags, title, type, speaker, modifier = 0, might = 0 }) {
		// Separate tags
		const {
			burntTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			crispyTags,
			heroWeaknessTags,
		} = LitmRollDialog.#filterTags(tags);

		// Values
		const {
			burntValue,
			powerValue,
			weaknessValue,
			positiveStatusValue,
			negativeStatusValue,
			totalPower,
		} = game.litm.methods.calculatePower({
			burntTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			crispyTags,
			heroWeaknessTags,
			modifier: Number(modifier) || 0,
			might: Number(might) || 0,
		});

		const formula =
			typeof CONFIG.litm.roll.formula === "function"
				? CONFIG.litm.roll.formula({
						burntTags,
						powerTags,
						weaknessTags,
						positiveStatuses,
						negativeStatuses,
						crispyTags,
						heroWeaknessTags,
						burntValue,
						powerValue,
						weaknessValue,
						positiveStatusValue,
						negativeStatusValue,
						totalPower,
						actorId,
						type,
						title,
						modifier,
						might,
					})
				: CONFIG.litm.roll.formula ||
					"2d6 + (@burntValue + @powerValue + @positiveStatusValue - @weaknessValue - @negativeStatusValue + @modifier + @might)";

		// Roll
		const roll = new game.litm.LitmRoll(
			formula,
			{
				burntValue,
				powerValue,
				positiveStatusValue,
				weaknessValue,
				negativeStatusValue,
				modifier: Number(modifier) || 0,
				might: Number(might) || 0,
			},
			{
				actorId,
				title,
				type,
				burntTags,
				powerTags,
				weaknessTags,
				positiveStatuses,
				negativeStatuses,
				crispyTags,
				heroWeaknessTags,
				speaker,
				totalPower,
				modifier,
				might,
			},
		);

		return roll
			.toMessage({
				speaker,
				flavor: title,
			})
			.then((res) => {
				// Reset roll dialog
				res.rolls[0]?.actor?.sheet.resetRollDialog();
				Sockets.dispatch("resetRollDialog", { actorId });
				return res;
			});
	}

	static calculatePower(tags) {
		const burntValue = tags.burntTags.length * 3;

		const powerValue = tags.powerTags.length;

		const weaknessValue = tags.weaknessTags.length;
		
		const positiveStatusValue = tags.positiveStatuses.reduce(
			(a, t) => a + Number.parseInt(t.value),
			0,
		);

		const negativeStatusValue = tags.negativeStatuses.reduce(
			(a, t) => a + Number.parseInt(t.value),
			0,
		);

		const modifier = Number(tags.modifier) || 0;
		const might = Number(tags.might) || 0;

		const totalPower =
			burntValue +
			powerValue +
			positiveStatusValue -
			weaknessValue -
			negativeStatusValue +
			modifier +
			might;

		return {
			burntValue,
			powerValue,
			weaknessValue,
			positiveStatusValue,
			negativeStatusValue,
			totalPower,
			modifier,
			might,
		};
	}

	static #filterTags(tags) {
		const burntTags = tags.filter((t) => t.state === "burned");
		const powerTags = tags.filter(
			(t) => t.type && t.type !== "crispy" && t.type !== "status" && t.state === "positive",
		);
		const weaknessTags = tags.filter(
			(t) => t.type !== "status" && t.state === "negative",
		);
		const crispyTags = tags.filter(
			(t) => t.type === "crispy" || t.type === "hero",
		);
		const heroWeaknessTags = tags.filter(
			(t) => t.type === "hero" && t.state === "negative",
		);
		const positiveStatuses = tags.filter(
			(t) => t.type === "status" && t.state === "positive",
		);
		const negativeStatuses = tags.filter(
			(t) => t.type === "status" && t.state === "negative",
		);

		return {
			burntTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			crispyTags,
			heroWeaknessTags,
		};
	}

	#tagState = [];
	#shouldRoll = () => false;
	#modifier = 0;
	#might = 0;
	#tooltipEl = null;

	constructor(actorId, characterTags = [], options = {}) {
		super({}, options);

		this.#tagState = options.tagState || [];
		this.#shouldRoll = options.shouldRoll || (() => false);
		this.#modifier = options.modifier || 0;
		this.#might = options.might || 0;

		this.actorId = actorId;
		this.characterTags = characterTags;
		this.speaker =
			options.speaker || ChatMessage.getSpeaker({ actor: this.actor });
		this.rollName = options.title || LitmRollDialog.defaultOptions.title;
		this.type = options.type || "tracked";

		this._storyTagsHookId = Hooks.on("litmStoryTagsUpdated", () => {
			this.refreshTags();
			if (this.rendered) this.render();
		});
	}

	async close(options) {
		this.#cleanupTooltip();
		if (this._storyTagsHookId !== undefined) {
			Hooks.off("litmStoryTagsUpdated", this._storyTagsHookId);
			this._storyTagsHookId = undefined;
		}
		return super.close(options);
	}

	get actor() {
		return game.actors.get(this.actorId);
	}

	get statuses() {
		const { selectedTags } = game.litm.storyTags;
		const selectedMap = new Map(selectedTags.map(t => [t.id, t]));

		return [...this.actor.system.statuses].map((tag) => {
			const selected = selectedMap.get(tag.id);

			return ({
			...tag,
			state: this.#tagState.find((t) => t.id === tag.id)?.state
				?? (selected ? (selected.isHindering ? "negative" : "positive") : ""),
			states: ",negative,positive",
		})});
	}

	get storyStatuses() {
		const { selectedTags } = game.litm.storyTags;
		const statuses = selectedTags.filter((tag) => tag.values.some((v) => !!v));

		const personalIds = new Set(this.actor.system.statuses.map(t => t.id));

		return [...statuses]
		.filter(tag => !personalIds.has(tag.id))
		.map((tag) => ({
			...tag,
			state: this.#tagState.find((t) => t.id === tag.id)?.state
				?? (tag.isHindering ? "negative" : "positive"),
			states: ",negative,positive",
		}));
	}

	get tags() {
		const { selectedTags } = game.litm.storyTags;
		const selectedMap = new Map(selectedTags.map(t => [t.id, t]));

		return [
			...this.actor.system.storyTags,
		].map((tag) => {
			const selected = selectedMap.get(tag.id);
			const type = tag.type;
			let states;

			switch (type) {
				case "hero":
				case "crispy":
					states = ",negative,positive";
					break;
				case "powerTag":
					states = ",positive,burned";
					break;
				case "weaknessTag":
					states = ",negative";
					break;
				default:
					states = ",negative,positive,burned";
					break;
			}

			return {
				...tag,
				state: this.#tagState.find((t) => t.id === tag.id)?.state
					?? (selected ? (selected.isHindering ? "negative" : "positive") : ""),
				states,
			};
		});
	}

	get storyTags() {
		const { selectedTags } = game.litm.storyTags;
		const tags = selectedTags.filter((tag) => tag.values.every((v) => !v));

		const personalIds = new Set(this.actor.system.storyTags.map(t => t.id));

		return [...tags]
		.filter(tag => !personalIds.has(tag.id))
		.map((tag) => ({
			...tag,
			state: this.#tagState.find((t) => t.id === tag.id)?.state
				?? (tag.isHindering ? "negative" : "positive"),
			states: ",negative,positive,burned",
		}));
	}

	// TODO: добавить Might и Осторожные/Рискованные броски
	get totalPower() {
		const personalWithState = [...this.tags, ...this.statuses]
			.filter(t => !!t.state);
		const personalIds = new Set(personalWithState.map(t => t.id));
		const storyWithState = [...this.storyTags, ...this.storyStatuses]
			.filter(t => !!t.state && !personalIds.has(t.id));

		const state = [
			...this.characterTags,
			...personalWithState,
			...storyWithState,
		];

		const uniqueTagsMap = new Map();
		state.forEach(t => uniqueTagsMap.set(t.id, t));
		const uniqueTags = Array.from(uniqueTagsMap.values());

		const tags = LitmRollDialog.#filterTags(uniqueTags);
		const { totalPower } = LitmRollDialog.calculatePower({
			...tags,
			modifier: this.#modifier,
			might: this.#might,
		});
		return totalPower;
	}

	getData() {
		const data = super.getData();
		const skipModeration = this.#shouldRoll();
		return {
			...data,
			actorId: this.actorId,
			characterTags: sortTags(this.characterTags),
			rollTypes: {
				quick: "Litm.ui.roll-quick",
				tracked: "Litm.ui.roll-tracked",
				mitigate: "Litm.ui.roll-mitigate",
			},
			skipModeration,
			statuses: sortTags(this.statuses),
			storyStatuses: sortTags(this.storyStatuses),
			tags: sortTags(this.tags),
			storyTags: sortTags(this.storyTags),
			isGM: game.user.isGM,
			title: this.rollName,
			type: this.type,
			totalPower: this.totalPower,
			modifier: this.#modifier,
			might: this.#might,
		};
	}

	refreshTags() {
		const freshMap = new Map();

		if (this.actor?.system?.allTags) {
			for (const t of this.actor.system.allTags) {
				const obj = typeof t.toObject === "function" ? t.toObject() : { ...t };
				freshMap.set(obj.id, obj);
			}
		}

		if (this.actor?.effects) {
			for (const e of this.actor.effects) {
				const flags = e.flags?.["litm-rn"];
				if (!flags?.type) continue;
				freshMap.set(e._id, {
					id: e._id,
					name: e.name,
					values: flags.values,
					isScratched: flags.isScratched,
					isHindering: flags.isHindering || false,
					value: flags.values?.findLast((v) => !!v),
					type: flags.values?.some((v) => !!v) ? "status" : "tag",
				});
			}
		}

		try {
			const config = game.settings.get("litm-rn", "storytags");
			for (const t of config?.selectedTags ?? []) {
				freshMap.set(t.id, { ...t });
			}
		} catch (_) { /* no-op */ }

		this.#tagState = this.#tagState
			.filter((t) => freshMap.has(t.id))
			.map((t) => ({
				...freshMap.get(t.id),
				state: t.state,
				states: t.states,
			}));

		this.characterTags = this.characterTags
			.filter((t) => freshMap.has(t.id))
			.map((t) => {
				const fresh = freshMap.get(t.id);
				return fresh
					? { ...fresh, state: t.state, states: t.states }
					: t;
			});
	}

	activateListeners(html) {
		super.activateListeners(html);

		if (this._storyTagsHookId === undefined) {
			this._storyTagsHookId = Hooks.on("litmStoryTagsUpdated", () => {
				this.refreshTags();
				if (this.rendered) this.render();
			});
		}

		html
			.find("[data-click]")
			.on("click", this.#handleClick.bind(this))
			.on("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ")
					this.#handleClick(event);
			});

		html
			.find("litm-super-checkbox")
			.on("change", this.#handleCheckboxChange.bind(this));

		html
			.find("[data-update='modifier']")
			.on("change", this.#handleModifierChange.bind(this));

		html
			.find('input[name="might"]')
			.on("change", this.#handleMightChange.bind(this));

		this.#cleanupTooltip();
		const wrapper = html.find(".litm--might-name-wrapper");
    const tooltip = html.find(".litm--might-tooltip");

		if (wrapper.length && tooltip.length) {
			this.#tooltipEl = tooltip[0];
			document.body.appendChild(this.#tooltipEl);

			wrapper.on("mouseenter", () => {
				const tooltipEl = this.#tooltipEl;
				if (!tooltipEl) return;

				const rect = wrapper[0].getBoundingClientRect();
				tooltipEl.style.display = "block";

				const tooltipRect = tooltipEl.getBoundingClientRect();
				let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
				let top = rect.top - tooltipRect.height - 8;

				if (left < 4) left = 4;
				if (left + tooltipRect.width > window.innerWidth - 4) {
					left = window.innerWidth - tooltipRect.width - 4;
				}
				if (top < 4) {
					top = rect.bottom + 8;
					tooltipEl.classList.add("litm--might-tooltip-below");
				} else {
					tooltipEl.classList.remove("litm--might-tooltip-below");
				}

				tooltipEl.style.left = `${left}px`;
				tooltipEl.style.top = `${top}px`;
			});

			wrapper.on("mouseleave", () => {
				if (this.#tooltipEl) {
					this.#tooltipEl.style.display = "none";
				}
			});
		}
	}

	addTag(tag, toBurn) {
		switch (tag.type) {
			case "powerTag":
				tag.state = toBurn ? "burned" : "positive";
				tag.states = ",positive,burned";
				break;
			case "weaknessTag":
				tag.state = "negative";
				tag.states = ",negative";
				break;
			case "crispy":
			case "hero":
				tag.state = "positive";
				tag.states = ",negative,positive";
				break;
			default:
				tag.state = tag.isHindering
					? "negative"
					: (toBurn ? "burned" : "positive");
				tag.states = ",negative,positive,burned";
				break;
		}

		this.characterTags.push(tag);
		this.element.find("[data-update='totalPower']").text(this.totalPower);
		this.#dispatchUpdate();
	}

	removeTag(tag) {
		this.characterTags = this.characterTags.filter((t) => t.id !== tag.id);
		this.element.find("[data-update='totalPower']").text(this.totalPower);
		this.#dispatchUpdate();
	}

	getFilteredArrayFromFormData(formData) {
		const personalWithState = [...this.tags, ...this.statuses];
		const storyWithState = [...this.storyTags, ...this.storyStatuses];

		const allTags = [
			...this.characterTags,
			...personalWithState,
			...storyWithState
		];

		const tagsMap = new Map(allTags.map(t => [t.id, t]));

		return Object.entries(formData)
			.filter(([_, v]) => !!v)
			.map(([key]) => tagsMap.get(key))
			.filter(t => !!t);
	}

	async reset() {
		this.characterTags = [];

		const config = game.settings.get("litm-rn", "storytags");
		if (game.user.isGM) {
			await game.settings.set("litm-rn", "storytags", {
				...config, selectedTags: []
				});
		} else {
			dispatch({ app: "story-tags", type: "update", selectedTags: [] });
		}
		game.litm.storyTags.render();
		dispatch({ app: "story-tags", type: "render" });

		this.#tagState = [];
		this.#modifier = 0;
		this.#might = 0;
		this.#shouldRoll = () => game.settings.get("litm-rn", "skip_roll_moderation");
		if (this.actor.sheet.rendered) this.actor.sheet.render(true);
	}

	/**
	 * Receives the form data and performs the roll
	 * @param {Event} _event - The form submission event
	 * @param {Object} formData - The form data
	 */
	async _updateObject(_event, formData) {
		const { actorId, title, type, shouldRoll, modifier, might, ...rest } = formData;
		const tags = this.getFilteredArrayFromFormData(rest);

		const data = {
			actorId,
			type,
			tags,
			title,
			speaker: this.speaker,
			modifier,
			might,
		};

		this.#shouldRoll = () => shouldRoll;
		// User has authority to initiate the roll
		if (this.#shouldRoll()) return LitmRollDialog.roll(data);
		// Else create a moderation request
		return this.#createModerationRequest(data);
	}

	#handleClick(event) {
		const button = event.currentTarget;
		const action = button.dataset.click;

		switch (action) {
			case "add-tag": {
				this.actor.sheet.render(true);
				break;
			}
			case "cancel":
				this.close();
				break;
		}
	}

	#handleCheckboxChange(event) {
		const checkbox = event.currentTarget;
		const { name: id, value } = checkbox;
		const { type } = checkbox.dataset;

		switch (type) {
			case "powerTag":
			case "themeTag":
			case "backpack":
			case "hero":
			case "crispy":
			case "weaknessTag": {
				const tag = this.characterTags.find((t) => t.id === id);
				if (!tag) break;

				tag.state = value;

				switch (tag.type) {
				case "crispy":
				case "hero":
					tag.states = ",negative,positive";
					break;
				case "powerTag":
					tag.states = ",positive,burned";
					break;
				case "weaknessTag":
					tag.states = ",negative";
					break;
				default:
					tag.states = ",negative,positive,burned";
					break;
				}
				break;
			}
			default: {
				const existingTag = this.#tagState.find((t) => t.id === id);
				if (existingTag) existingTag.state = value;
				else {
					const tag = [...this.tags, ...this.statuses, ...this.storyTags, ...this.storyStatuses].find(
						(t) => t.id === id,
					);

					if (tag) {
					const statefulTag = {
						...tag,
						state: value || (tag.isHindering ? "negative" : "positive"),
					};

					// Определяем возможные состояния для UI
					switch (tag.type) {
						case "crispy":
						case "hero":
							statefulTag.states = ",negative,positive";
							break;
						case "powerTag":
							statefulTag.states = ",positive,burned";
							break;
						case "weaknessTag":
							statefulTag.states = ",negative";
							break;
						default:
							statefulTag.states = ",negative,positive,burned";
							break;
					}

						this.#tagState.push(statefulTag);
					}
				}
			}
		}

		this.element.find("[data-update='totalPower']").text(this.totalPower);
		this.#dispatchUpdate();
	}

	#handleModifierChange(event) {
		const input = event.currentTarget;
		this.#modifier = Number(input.value) || 0;
		this.element.find("[data-update='totalPower']").text(this.totalPower);
		this.#dispatchUpdate();
	}

	#handleMightChange(event) {
		const value = parseInt(event.currentTarget.value);
		this.#might = value || 0;
		this.element.find("[data-update='totalPower']").text(this.totalPower);
		this.#dispatchUpdate();
	}

	async #createModerationRequest(data) {
		const id = foundry.utils.randomID();
		const userId = game.user.id;
		const tags = LitmRollDialog.#filterTags(data.tags);
		const { totalPower } = game.litm.methods.calculatePower({
			...tags,
			modifier: data.modifier,
		});
		const recipients = Object.entries(this.actor.ownership)
			.filter((u) => u[1] === 3 && u[0] !== "default")
			.map((u) => u[0]);

		ChatMessage.create({
			content: await foundry.applications.handlebars.renderTemplate(
				"systems/litm-rn/templates/chat/moderation.html",
				{
					title: t("Litm.ui.roll-moderation"),
					id: this.actor.id,
					rollId: id,
					type: data.type,
					name: this.actor.name,
					tooltipData: {
						...tags,
						modifier: data.modifier,
					},
					totalPower,
				},
			),
			whisper: recipients,
			flags: { ["litm-rn"]: { id, userId, data } },
		});
	}

	#dispatchUpdate() {
		Sockets.dispatch("updateRollDialog", {
			actorId: this.actorId,
			characterTags: this.characterTags,
			tagState: this.#tagState,
			modifier: this.#modifier,
			might: this.#might,
		});
	}

	#cleanupTooltip() {
		if (this.#tooltipEl && this.#tooltipEl.parentNode === document.body) {
			document.body.removeChild(this.#tooltipEl);
		}
		this.#tooltipEl = null;
	}

	async receiveUpdate({ characterTags, tagState, actorId, modifier }) {
		if (actorId !== this.actorId) return;

		if (characterTags) this.characterTags = characterTags;
		if (tagState) this.#tagState = tagState;
		if (modifier !== undefined) this.#modifier = modifier;
		if (might !== undefined) this.#might = might;

		if (this.actor.sheet.rendered) this.actor.sheet.render();
		if (this.rendered) this.render();
	}
}
