import { localize as t } from "../../utils.js";

export class HeroData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			contents: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.RelationshipData),
				{
					initial: [],
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
							isBurnt: false,
					}))
				}
			),
			backside: new fields.BooleanField({
				required: true,
				initial: true,
			}),
			promise: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
				max: 5,
			}),
		};
	}
}
