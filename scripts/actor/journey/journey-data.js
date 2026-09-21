import { localize as t } from "../../utils.js";

/** Data model for Journey actors. */
export class JourneyData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			category: new fields.StringField({
				initial: () => t("Litm.journeys.landscape"),
			}),
			note: new fields.HTMLField({
				initial: () => t("Litm.ui.journey-default-description"),
			}),
			consequences: new fields.ArrayField(
				new fields.StringField({ required: true, nullable: false }),
				{ initial: () => [t("Litm.ui.name-consequence")] },
			),
			background: new fields.FilePathField({
				categories: ["IMAGE"],
				initial: "systems/litm-rn/assets/media/transition-left-grey-dark.webp",
			}),
			backgroundFit: new fields.StringField({
				initial: "cover",
				choices: ["cover", "stretch", "native"],
			}),
			backgroundAnchorX: new fields.StringField({
				initial: "center",
				choices: ["left", "center", "right"],
			}),
			backgroundAnchorY: new fields.StringField({
				initial: "center",
				choices: ["top", "center", "bottom"],
			}),
			backgroundScale: new fields.NumberField({
				initial: 1,
				min: 0.25,
				max: 3,
			}),
			backgroundOffsetX: new fields.NumberField({
				initial: 0,
				min: -1000,
				max: 1000,
			}),
			backgroundOffsetY: new fields.NumberField({
				initial: 0,
				min: -1000,
				max: 1000,
			}),
			backgroundRotation: new fields.NumberField({
				initial: 0,
				min: -180,
				max: 180,
			}),
			backgroundFlipX: new fields.BooleanField({ initial: false }),
			backgroundFlipY: new fields.BooleanField({ initial: false }),
			backgroundShadeEnabled: new fields.BooleanField({ initial: false }),
			backgroundShadeHeight: new fields.NumberField({
				initial: 45,
				min: 0,
				max: 100,
			}),
			backgroundShadeStrength: new fields.NumberField({
				initial: 55,
				min: 0,
				max: 100,
			}),
			backgroundFadeEnabled: new fields.BooleanField({ initial: false }),
			backgroundFadeHeight: new fields.NumberField({
				initial: 20,
				min: 0,
				max: 100,
			}),
		};
	}

	/** Suggested Journey profile types. */
	get journeys() {
		return CONFIG.litm.journey_types;
	}
}
