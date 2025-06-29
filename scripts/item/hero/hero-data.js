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
					initial: [
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.journeys-end"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.reforged"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.quintessence"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.quintessence"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.quintessence"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.magic"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.words-eternal"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
						{
							id: foundry.utils.randomID(),
							name: t("Litm.fulfillment.lost-truths"),
							type: "fulfillment",
							isActive: false,
							isBurnt: false,
						},
					],
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
