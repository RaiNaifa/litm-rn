import { localize as t } from "../utils.js";

export class LitmRoll extends Roll {
	static CHAT_TEMPLATE = "systems/litm-rn/templates/chat/message.html";
	static TOOLTIP_TEMPLATE = "systems/litm-rn/templates/chat/message-tooltip.html";

	get litm() {
		return this.options;
	}

	get actor() {
		return game.actors.get(this.litm.actorId);
	}

	get speaker() {
		return { alias: this.actor.name };
	}

	get flavor() {
		switch (this.litm.type) {
			case "mitigate":
				return t("Litm.ui.roll-mitigate", "Litm.other.outcome");
			case "tracked":
				return t("Litm.ui.roll-tracked", "Litm.other.outcome");
			default:
				return t("Litm.ui.roll-quick", "Litm.other.outcome");
		}
	}

	get effect() {
		if (this.litm.type !== "mitigate") return null;
		return {
			action: "Litm.effects.mitigate.action",
			description: "Litm.effects.mitigate.description",
			cost: "Litm.effects.mitigate.cost",
		};
	}

	get power() {
		const { label: outcome } = this.outcome;

		// Quick outcomes don't need to track power
		if (this.litm.type === "quick") return null;
		if (outcome === "failure") return 0;

		// Minimum of 1 power
		let totalPower = Math.max(this.litm.totalPower, 1);

		// If it's not a strong success, return the total power
		if (outcome === "consequence") return totalPower;

		// Mitigate outcomes add 1 power on a strong success
		if (this.litm.type === "mitigate") totalPower += 1;
		return totalPower;
	}

	get outcome() {
		const { resolver } = CONFIG.litm.roll;

		if (typeof resolver === "function") return resolver(this);

		if (this.dice[0].total === 2)
			return { label: "failure", description: "Litm.ui.roll-failure" };

		if (this.total > 9 || this.dice[0].total === 12)
			return { label: "success", description: "Litm.ui.roll-success" };

		if (this.total > 6)
			return { label: "consequence", description: "Litm.ui.roll-consequence" };

		return { label: "failure", description: "Litm.ui.roll-failure" };
	}

	get modifier() {
		return this.options.modifier || 0;
	}

	async render({
		template = this.constructor.CHAT_TEMPLATE,
		isPrivate = false,
	} = {}) {
		if (!this._evaluated) await this.evaluate({ async: true });
		
		const chatData = {
			actor: this.actor,
			formula: isPrivate ? "???" : this._formula.replace(/\s\+0/, ""),
			flavor: isPrivate ? null : this.flavor,
			outcome: isPrivate ? "???" : this.outcome,
			power: isPrivate ? "???" : this.power,
			result: isPrivate ? "???" : this.result,
			title: this.litm.title,
			tooltip: isPrivate ? "" : await this.getTooltip(),
			total: isPrivate ? "" : Math.round(this.total * 100) / 100,
			type: this.litm.type,
			effect: this.effect,
			modifier: isPrivate ? "???" : this.modifier,
			user: game.user.id,
			isOwner: game.user.isGM || this.actor.isOwner,
		};

		// burnedTags here needs for the old ChatMessages
		// DO NOT DELETE
		if ("burnedTags" in this.litm) {
			chatData.hasBurnedTags = !this.litm.isBurnt && this.litm.burnedTags.length > 0;
			chatData.hasCrispyTags = this.litm.isActive && this.litm.crispyTags.length > 0;
			chatData.hasWeaknessTags = (!this.litm.gainedImp &&
				this.litm.weaknessTags.filter((t) => t.type === "weaknessTag").length >
					0) || (this.litm.isActive && this.litm.state === "negative" && this.litm.heroWeaknessTags.length > 0);
		} else {
			chatData.hasBurntTags = !this.litm.isScratched && this.litm.burntTags.length > 0; // ???
			chatData.hasCrispyTags = this.litm.crispyTags.length > 0;
			chatData.hasWeaknessTags = (!this.litm.gainedImp &&
				this.litm.weaknessTags.filter((t) => t.type === "weaknessTag").length >
					0) || (this.litm.state === "negative" && this.litm.heroWeaknessTags.length > 0);
		}

		return foundry.applications.handlebars.renderTemplate(template, chatData);
	}

	async getTooltip() {
		const parts = this.dice.map((d) => d.getTooltipData());
		const data = this.getTooltipData();
		return foundry.applications.handlebars.renderTemplate(LitmRoll.TOOLTIP_TEMPLATE, { data, parts });
	}

	getTooltipData() {
		const { label: outcome } = this.outcome;
		return {
			mitigate: this.litm.type === "mitigate" && outcome === "success",
			burntTags: this.litm.burntTags,
			scratchedTags: this.litm.scratchedTags,
			powerTags: this.litm.powerTags,
			weaknessTags: this.litm.weaknessTags,
			crispyTags: this.litm.crispyTags,
			heroWeaknessTags: this.litm.heroWeaknessTags,
			positiveStatuses: this.litm.positiveStatuses,
			negativeStatuses: this.litm.negativeStatuses,
			modifier: this.modifier,
		};
	}
}
