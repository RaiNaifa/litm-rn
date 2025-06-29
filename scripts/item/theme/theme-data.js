import { localize as t, titleCase } from "../../utils.js";

export class ThemeData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			themebook: new fields.StringField({
				trim: true,
				initial: t("Litm.other.themebook"),
			}),
			level: new fields.StringField({
				trim: true,
				initial: () => Object.keys(CONFIG.litm.theme_levels)[0],
				validate: (level) =>
					Object.keys(CONFIG.litm.theme_levels).includes(level),
			}),
			isActive: new fields.BooleanField({
				initial: true,
			}),
			isBurnt: new fields.BooleanField(),
			powerTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{
					initial: () =>
						Array(2)
							.fill()
							.map((_, i) => ({
								id: foundry.utils.randomID(),
								name: t("Litm.ui.name-power"),
								type: "powerTag",
								isActive: true,
								isBurnt: false,
							})),
				},
			),
			weaknessTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{
					initial: () =>
						Array(1)
							.fill()
							.map(() => ({
								id: foundry.utils.randomID(),
								name: t("Litm.ui.name-weakness"),
								isActive: true,
								isBurnt: false,
								type: "weaknessTag",
							})),
				},
			),
			specials: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.SpecialData),
				{
					initial: () =>
						Array(1)
							.fill()
							.map(() => ({
								id: foundry.utils.randomID(),
								name: t("Litm.ui.name-special"),
								description: t("Litm.ui.name-special-description"),
								isActive: false,
							})),
				}
			),
			improve: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
				max: 3,
			}),
			abandon: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
				max: 3,
			}),
			milestone: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
				max: 3,
			}),
			motivation: new fields.StringField({
				initial: t("Litm.ui.name-motivation"),
			}),
			note: new fields.HTMLField({
				initial: t("Litm.ui.name-note"),
			}),
			backside: new fields.BooleanField({
				required: true,
				initial: false,
			}),
		};
	}

	get themeTag() {
		const item = {
			id: this.parent._id,
			name: titleCase(this.parent.name),
			isActive: this.isActive,
			isBurnt: this.isBurnt,
			type: "themeTag",
		};
		return game.litm.data.TagData.fromSource(item);
	}

	get activatedPowerTags() {
		const powerTags = this.powerTags;
		const themeTag = this.themeTag;
		return [...powerTags, themeTag].filter((tag) => tag.isActive);
	}

	get availablePowerTags() {
		return this.activatedPowerTags.filter((tag) => !tag.isBurnt);
	}

	get powerTagRatio() {
		return this.availablePowerTags.length / this.activatedPowerTags.length;
	}

	get weakness() {
		return this.weaknessTags;
	}

	get allTags() {
		return [...this.weaknessTags, ...this.powerTags, this.themeTag];
	}

	get levels() {
		return Object.keys(CONFIG.litm.theme_levels).reduce((acc, level) => {
			acc[level] = t(level, "TYPES.Item.theme");
			return acc;
		}, {});
	}

	get themebooks() {
		return CONFIG.litm.theme_levels[this.level];
	}
}
