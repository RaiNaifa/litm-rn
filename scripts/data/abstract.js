export class TagData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				nullable: false,
				validate: (id) => foundry.data.validators.isValidId(id),
				initial: () => foundry.utils.randomID(),
			}),
			ownerId: new fields.StringField({
				required: false,
				nullable: true,
				initial: null,
			}),
			name: new fields.StringField({
				required: true,
				nullable: false,
			}),
			isScratched: new fields.BooleanField({
				required: false,
			}),
			isPrivate: new fields.BooleanField({
				required: false,
				initial: false,
			}),
			type: new fields.StringField({
				required: true,
				choices: [
					"weaknessTag",
					"weaknessStoryTag",
					"powerCrispy",
					"powerTag",
					"backpack",
					"hero",
					"themeCrispy",
					"themeTag",
					"fulfillment",
				],
			}),
		};
	}
}

export class RelationshipData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				nullable: false,
				validate: (id) => foundry.data.validators.isValidId(id),
				initial: () => foundry.utils.randomID(),
			}),
			fellowActorId: new fields.StringField({
				required: true,
				nullable: false,
			}),
			name: new fields.StringField({
				required: true,
				nullable: false,
				initial: () => game.i18n.localize("Litm.tags.relationship"),
			}),
			isScratched: new fields.BooleanField({
				required: true,
				initial: true,
			}),
			isPrivate: new fields.BooleanField({
				required: false,
				initial: false,
			}),
		};
	}
}

export class SpecialData extends foundry.abstract.DataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			id: new fields.StringField({
				required: true,
				nullable: false,
				validate: (id) => foundry.data.validators.isValidId(id),
				initial: () => foundry.utils.randomID(),
			}),
			name: new fields.StringField({
				required: true,
				nullable: false,
			}),
			description: new fields.StringField({
				required: true,
				nullable: false,
			}),
		};
	}
}
