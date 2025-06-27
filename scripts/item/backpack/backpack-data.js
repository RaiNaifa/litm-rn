import { localize as t, titleCase } from "../../utils.js";

export class BackpackData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			contents: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
			),
			specials: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.SpecialData),
				{
					initial: () =>
						Array(2)
							.fill()
							.map(() => ({
								id: foundry.utils.randomID(),
								name: t("Litm.ui.name-special"),
								description: t("Litm.ui.name-special-description"),
								isActive: false,
							})),
				}
			),
			backside: new fields.BooleanField({
				required: true,
				initial: false,
			}),
		};
	}
}
