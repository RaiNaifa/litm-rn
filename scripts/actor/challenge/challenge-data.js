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
					statusIds: new fields.ArrayField(
						new fields.StringField(),
						{ initial: () => [] },
					),
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

		// Migrate old limits without new fields
		if (Array.isArray(source.limits)) {
			source.limits = source.limits.map(l => ({
				name: l.name ?? "",
				value: l.value != null ? Math.min(Number(l.value) || 0, 6) : null,
				consequence: l.consequence ?? "",
				isPrivate: l.isPrivate ?? false,
				statusIds: l.statusIds ?? [],
			}));
		}

		return super.migrateData(source);
	}

	get challenges() {
		return CONFIG.litm.challenge_types;
	}
}
