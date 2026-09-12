import { localize as t } from "../../utils.js";

export class FellowshipThemeData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			themebook: new fields.StringField({
				trim: true,
				initial: t("Litm.other.fellowship"),
			}),
			themebookUuid: new fields.StringField({ initial: "", blank: true }),
			themebookCustom: new fields.BooleanField({ initial: true }),
			themebookAnswers: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({ required: true }),
					sourceUuid: new fields.StringField({ initial: "", blank: true }),
					questionId: new fields.StringField({ initial: "", blank: true }),
					kind: new fields.StringField({
						choices: ["introduction", "power", "weakness"],
					}),
					question: new fields.StringField({ initial: "", blank: true }),
					answer: new fields.StringField({ initial: "", blank: true }),
					tagId: new fields.StringField({ initial: "", blank: true }),
					role: new fields.StringField({
						initial: "",
						blank: true,
						choices: ["", "power", "weakness"],
					}),
					createdAt: new fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
				}),
				{ initial: () => [] },
			),
			members: new fields.ArrayField(
				new fields.SchemaField({
					actorId: new fields.StringField({
						required: true,
						nullable: false,
					}),
					name: new fields.StringField({
						required: true,
						nullable: false,
						initial: () => t("Litm.ui.name-actor"),
					}),
				}),
				{ initial: () => [] },
			),
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
					type: "themeCrispy",
					isScratched: false,
				}),
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
								type: "powerCrispy",
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
			draftTags: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						initial: () => foundry.utils.randomID(),
					}),
					name: new fields.StringField({
						initial: () => t("Litm.ui.name-tag"),
					}),
					isWeakness: new fields.BooleanField({
						initial: false,
					}),
				}),
				{
					initial: () => [],
				},
			),
			specials: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.SpecialData),
				{
					initial: () => [],
				},
			),
			claimedSpecials: new fields.ArrayField(
				new fields.SchemaField({
					sourceUuid: new fields.StringField({ initial: "", blank: true }),
					specialId: new fields.StringField({ initial: "", blank: true }),
					name: new fields.StringField({ initial: "", blank: true }),
					themeSpecialId: new fields.StringField({ initial: "", blank: true }),
					retired: new fields.BooleanField({ initial: false }),
					claimedAt: new fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
				}),
				{ initial: () => [] },
			),
			improve: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
				max: 6,
			}),
			improveTrackLength: new fields.NumberField({
				integer: true,
				min: 1,
				max: 6,
				initial: 3,
			}),
			improvementsPerTrack: new fields.NumberField({
				integer: true,
				min: 1,
				max: 3,
				initial: 1,
			}),
			availableImprovements: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
			}),
			thresholdNotifications: new fields.SchemaField({
				milestone: new fields.BooleanField({ initial: false }),
				abandon: new fields.BooleanField({ initial: false }),
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

	get memberActors() {
		return this.members
			.map((m) => game.actors?.get(m.actorId) ?? null)
			.filter(Boolean);
	}

	hasMember(actorId) {
		return this.members.some((m) => m.actorId === actorId);
	}
}
