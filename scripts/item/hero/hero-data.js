import { localize as t } from "../../utils.js";

export class HeroData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			contents: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.RelationshipData),
				{
					initial: () =>
						Array(1)
							.fill()
							.map(() => ({
								id: foundry.utils.randomID(),
								name: t("Litm.tags.relationship"),
								fellowName: t("Litm.ui.fellow-name"),
								type: "hero",
								isActive: true,
								isScratched: false,
							})),
				}
			),
			fulfillment: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{
					initial: CONFIG.litm.fulfillment.map((item) => ({
							id: foundry.utils.randomID(),
							name: item,
							type: "fulfillment",
							isActive: false,
							isScratched: false,
					}))
				}
			),
			promise: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
				max: 5,
			}),
		};
	}
}
