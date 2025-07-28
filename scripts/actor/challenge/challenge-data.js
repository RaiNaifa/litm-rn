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
			special: new fields.HTMLField(),
			limits: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField(),
					value: new fields.NumberField(),
				}),
			),
			tags: new fields.StringField({
				initial: `[${t("Litm.other.tag").toLowerCase()}] [${t("Litm.other.status").toLowerCase()}-2] [@a o/a/g ${t("Litm.other.might").toLowerCase()}]`,
			}),
		};
	}

	get challenges() {
		return CONFIG.litm.challenge_types;
	}
}
