import { localize as t } from "../../utils.js";

const MIGHT_TYPES = ["origin", "adventure", "greatness", "variable"];

class ThemebookPromptData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				initial: () => foundry.utils.randomID(),
			}),
			text: new fields.StringField({ initial: "", blank: true }),
		};
	}
}

class ThemebookConceptData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				initial: () => foundry.utils.randomID(),
			}),
			text: new fields.StringField({ initial: "", blank: true }),
		};
	}
}

/** Data model for reusable Themebook sidebar items. */
export class ThemebookData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			isFellowship: new fields.BooleanField({ initial: false }),
			might: new fields.StringField({
				initial: "origin",
				choices: MIGHT_TYPES,
			}),
			suggestedMight: new fields.StringField({
				initial: "",
				blank: true,
				choices: ["", "origin", "adventure", "greatness"],
			}),
			concept: new fields.StringField({ initial: "", blank: true }),
			conceptOptions: new fields.ArrayField(
				new fields.EmbeddedDataField(ThemebookConceptData),
				{
					initial: () => [
						{
							id: foundry.utils.randomID(),
							text: "",
						},
					],
				},
			),
			description: new fields.HTMLField({
				initial: () => t("Litm.theme-content.default-description"),
			}),
			background: new fields.FilePathField({
				categories: ["IMAGE"],
				initial: "",
				blank: true,
			}),
			backgroundPosition: new fields.StringField({ initial: "center" }),
			backgroundSize: new fields.StringField({ initial: "cover" }),
			backgroundFit: new fields.StringField({
				initial: "cover",
				choices: ["cover", "stretch"],
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
			overlayOpacity: new fields.NumberField({
				initial: 0.35,
				min: 0,
				max: 1,
			}),
			introductionQuestions: new fields.ArrayField(
				new fields.EmbeddedDataField(ThemebookPromptData),
				{ initial: () => [] },
			),
			powerQuestions: new fields.ArrayField(
				new fields.EmbeddedDataField(ThemebookPromptData),
				{ initial: () => [] },
			),
			weaknessQuestions: new fields.ArrayField(
				new fields.EmbeddedDataField(ThemebookPromptData),
				{ initial: () => [] },
			),
			questIdeas: new fields.ArrayField(
				new fields.EmbeddedDataField(ThemebookPromptData),
				{ initial: () => [] },
			),
			specials: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.SpecialData),
				{ initial: () => [] },
			),
		};
	}
}

export { MIGHT_TYPES };
