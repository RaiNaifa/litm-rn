export class HeroData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			contents: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.RelationshipData)
			),
			backside: new fields.BooleanField({
				required: true,
				initial: true,
			}),
		};
	}
}
