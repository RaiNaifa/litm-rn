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
					name: new fields.StringField({
						initial: () => t("Litm.ui.new-special"),
					}),
					description: new fields.StringField({
						initial: () => t("Litm.ui.new-special-description"),
					}),
				}),
			),
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

	/** @override */
	static migrateData(source) {
		if ("special" in source && !("specials" in source)) {
			const specialHtml = source.special;
			if (specialHtml && specialHtml.trim()) {
				source.specials = [
					{
						name: t("Litm.ui.new-special"),
						description: specialHtml.trim(),
					},
				];
			} else {
				source.specials = [];
			}
		}
		delete source.special;

		return super.migrateData(source);
	}

	get challenges() {
		return CONFIG.litm.challenge_types;
	}
}
