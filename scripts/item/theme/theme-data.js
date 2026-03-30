

import { localize as t } from "../../utils.js";

export class ThemeData extends foundry.abstract.DataModel {
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
      themeTag: new fields.EmbeddedDataField(abstract.TagData, {
        required: true,
        nullable: false,
        initial: () => ({
          id: foundry.utils.randomID(),
          name: t("Litm.ui.name-theme-tag"),
          type: "themeTag",
          isScratched: false,
        })
      }),
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
                isScratched: false,
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
                type: "weaknessTag",
                isScratched: false,
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
		};
  }

  get activatedPowerTags() {
    return [...this.powerTags, this.themeTag];
  }

  get availablePowerTags() {
    return this.activatedPowerTags.filter((tag) => !tag.isScratched);
  }

  get weakness() {
    return this.weaknessTags;
  }

  get allTags() {
    return [...this.weaknessTags, ...this.powerTags, this.themeTag];
  }

  get levels() {
    return Object.keys(CONFIG.litm.theme_levels).reduce((acc, level) => {
      acc[level] = t(`Litm.levels.${level}`);
      return acc;
    }, {});
  }

  get themebooks() {
    return CONFIG.litm.theme_levels[this.level];
  }
}
