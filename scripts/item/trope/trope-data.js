import { localize as t } from "../../utils.js";

class TropeThemeKitReferenceData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			uuid: new fields.StringField({ required: true, blank: false }),
			name: new fields.StringField({ initial: "", blank: true }),
			themebookUuid: new fields.StringField({ initial: "", blank: true }),
			themebookName: new fields.StringField({ initial: "", blank: true }),
			might: new fields.StringField({ initial: "origin", blank: true }),
		};
	}
}

class TropeThemeKitSlotData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				initial: () => foundry.utils.randomID(),
			}),
			mode: new fields.StringField({
				initial: "single",
				choices: ["single", "choice"],
			}),
			options: new fields.ArrayField(
				new fields.EmbeddedDataField(TropeThemeKitReferenceData),
				{ initial: () => [] },
			),
		};
	}
}

class TropeBackpackTagData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				initial: () => foundry.utils.randomID(),
			}),
			name: new fields.StringField({
				initial: () => t("Litm.trope.default-backpack-tag"),
				blank: true,
			}),
		};
	}
}

/** Data model for reusable Trope sidebar items. */
export class TropeData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			description: new fields.HTMLField({ initial: "" }),
			art: new fields.FilePathField({
				categories: ["IMAGE"],
				initial: "",
				blank: true,
			}),
			artSide: new fields.StringField({
				initial: "right",
				choices: ["left", "right"],
			}),
			artAlign: new fields.StringField({
				initial: "top",
				choices: ["top", "center", "bottom"],
			}),
			themeKitSlots: new fields.ArrayField(
				new fields.EmbeddedDataField(TropeThemeKitSlotData),
				{
					initial: () =>
						Array.from({ length: 4 }, () => ({
							id: foundry.utils.randomID(),
							mode: "single",
							options: [],
						})),
				},
			),
			backpackTags: new fields.ArrayField(
				new fields.EmbeddedDataField(TropeBackpackTagData),
				{
					initial: () => [
						{
							id: foundry.utils.randomID(),
							name: t("Litm.trope.default-backpack-tag"),
						},
					],
				},
			),
			backpackChoices: new fields.NumberField({
				initial: 1,
				integer: true,
				min: 0,
			}),
		};
	}
}
