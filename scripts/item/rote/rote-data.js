/** Data stored by a Rote item. */
export class RoteData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			isActive: new fields.BooleanField({ initial: true }),
			description: new fields.HTMLField({ initial: "" }),
			practitioners: new fields.StringField({ initial: "", blank: true }),
			powerHelping: new fields.StringField({ initial: "", blank: true }),
			powerHindering: new fields.StringField({ initial: "", blank: true }),
			effects: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						required: true,
						initial: () => foundry.utils.randomID(),
					}),
					type: new fields.StringField({ required: true, initial: "attack" }),
					description: new fields.HTMLField({ initial: "" }),
				}),
				{ initial: () => [] },
			),
			consequences: new fields.ArrayField(
				new fields.HTMLField({ initial: "" }),
				{
					initial: () => [],
				},
			),
		};
	}
}
