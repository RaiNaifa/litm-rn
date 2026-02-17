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
			name: new fields.StringField({
				required: true,
				nullable: false,
			}),
			isScratched: new fields.BooleanField({
				required: false,
			}),
			type: new fields.StringField({
				required: true,
				choices: ["weaknessTag", "powerTag", "backpack", "hero", "themeTag", "fulfillment"],
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
			name: new fields.StringField({
				required: true,
				nullable: false,
			}),
			fellowName: new fields.StringField({
				required: true,
				nullable: false,
			}),
			isActive: new fields.BooleanField({
				required: true,
				initial: false,
			}),
			isScratched: new fields.BooleanField({
				required: true,
				initial: false,
			}),
			type: new fields.StringField({
				required: true,
				choices: ["weaknessTag", "powerTag", "backpack", "hero", "themeTag"],
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
			isActive: new fields.BooleanField({
				required: true,
				initial: false,
			}),
		};
	}
}
