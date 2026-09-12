import { localize as t } from "../../utils.js";
export class ChallengeData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			category: new fields.StringField({
				initial: () => t("Litm.ui.name-category"),
			}),
			rating: new fields.NumberField({
				required: true,
				initial: 1,
				min: 1,
				max: 5,
			}),
			note: new fields.HTMLField(),
			specials: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						required: true,
						nullable: false,
						initial: () => foundry.utils.randomID(),
					}),
					name: new fields.StringField({
						initial: () => t("Litm.ui.new-special"),
					}),
					description: new fields.StringField({
						initial: () => t("Litm.ui.new-special-description"),
					}),
				}),
			),
			secrets: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField({
						initial: () => t("Litm.ui.new-secret"),
					}),
					description: new fields.StringField({
						initial: () => t("Litm.ui.new-secret-description"),
					}),
					isRevealed: new fields.BooleanField({ initial: false }),
				}),
			),
			limits: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField(),
					value: new fields.NumberField({ min: 0, max: 6, nullable: true }),
					consequence: new fields.StringField({ initial: "" }),
					isPrivate: new fields.BooleanField({ initial: false }),
					statusIds: new fields.ArrayField(new fields.StringField(), {
						initial: () => [],
					}),
				}),
			),
		};
	}

	get challenges() {
		return CONFIG.litm.challenge_types;
	}
}
