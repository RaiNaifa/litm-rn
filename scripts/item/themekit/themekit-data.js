import { localize as t } from "../../utils.js";

/** Data model for premade Theme Kit sidebar items. */
export class ThemeKitData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			themebookUuid: new fields.StringField({ initial: "", blank: true }),
			themebookName: new fields.StringField({ initial: "", blank: true }),
			mightOverride: new fields.StringField({
				initial: "origin",
				blank: true,
				choices: ["", "origin", "adventure", "greatness"],
			}),
			description: new fields.HTMLField({ initial: "" }),
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
			themeTag: new fields.EmbeddedDataField(abstract.TagData, {
				initial: () => ({
					id: foundry.utils.randomID(),
					name: t("Litm.ui.name-theme-tag"),
					type: "themeTag",
					isScratched: false,
				}),
			}),
			powerTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{ initial: () => [] },
			),
			weaknessTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{ initial: () => [] },
			),
			quest: new fields.StringField({ initial: "", blank: true }),
			specials: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.SpecialData),
				{ initial: () => [] },
			),
		};
	}
}
