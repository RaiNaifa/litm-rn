import { error, warn } from "../../logger.js";

export class CharacterData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			note: new fields.HTMLField(),
			fellowshipId: new fields.StringField({
				required: false,
				nullable: true,
				initial: null,
			}),
		};
	}

	static getTrackableAttributes() {
		return {
			bar: ["limit"],
			value: [],
		};
	}

	get backpack() {
		const backpack = this.parent.items.find((item) => item.type === "backpack");
		if (!backpack) return [];
		return backpack.system;
	}

	get fellowship() {
		if (!this.fellowshipId) return null;
		return game.items.get(this.fellowshipId) ?? null;
	}

	get hero() {
		const hero = this.parent.items.find((item) => item.type === "hero");
		if (!hero) return [];
		return hero.system;
	}

	get embeddedTags() {
		const hero = this.hero.contents || [];
		const backpack = this.backpack.contents || [];
		const themeTags = this.parent.items
			.filter((item) => item.type === "theme")
			.flatMap((item) => item.system.allTags);
		const storyThemeTags = this.parent.items
			.filter((item) => item.type === "story")
			.flatMap((item) => item.system.allTags);
		return [...hero, ...backpack, ...themeTags, ...storyThemeTags];
	}

	get allTags() {
		const embeddedTags = this.embeddedTags;
		const fellowshipTags = this.fellowship?.system?.allTags ?? [];
		return [...embeddedTags, ...fellowshipTags];
	}

	get powerTags() {
		return this.allTags.filter(
			(tag) =>
				tag.type === "powerCrispy" ||
				tag.type === "powerTag" ||
				tag.type === "themeCrispy" ||
				tag.type === "themeTag" ||
				tag.type === "backpack"
		);
	}

	get weaknessTags() {
		const themeWeakness =  this.parent.items
			.filter((item) => item.type === "theme")
			.flatMap((item) => item.system.weakness);
		const storyThemeWeakness =  this.parent.items
			.filter((item) => item.type === "theme")
			.flatMap((item) => item.system.weakness);
		const fellowshipWeakness = this.fellowship?.system?.weakness ?? [];
		return [...themeWeakness, ...storyThemeWeakness, ...fellowshipWeakness];
	}

	get availablePowerTags() {
		const backpack = this.backpack.contents.filter(
			(tag) => !tag.isScratched,
		);
		const themeTags = this.parent.items
			.filter((item) => item.type === "theme")
			.flatMap((item) => item.system.availablePowerTags);
		const fellowshipTags = this.fellowship?.system?.availablePowerTags ?? [];
		return [...backpack, ...themeTags, ...fellowshipTags];
	}

	get statuses() {
		return this.parent.appliedEffects
			.filter((item) => {
				const flags = item.flags["litm-rn"];
				if (!flags) return false;
				if (flags.type === "status") return true;
				if (flags.type === "might") return false; // just in case
				if (flags.type === "tag") return flags.values?.some((v) => !!v) ?? false;
				// Legacy: no type set
				return flags.values?.some((v) => !!v) ?? false;
			})
			.map((item) => {
				return {
					...item.flags["litm-rn"],
					type: "status",
					value: item.flags["litm-rn"].values?.findLast((v) => !!v) || 0,
					id: item._id,
					name: item.name,
				};
			});
	}

	get availableRelationships() {
		return this.hero.contents.filter(
			(tag) => !tag.isScratched,
		);
	}

	get storyTags() {
		return this.parent.appliedEffects
			.filter((item) => {
				const flags = item.flags["litm-rn"];
				if (!flags) return false;
				if (flags.type === "status") return false;
				if (flags.type === "might") return false; // just in case
				if (flags.type === "tag") return !(flags.values?.some((v) => !!v));
				if (flags.type) return false;
				// Legacy: no type set
				return flags.values?.every((v) => !v) ?? true;
			})
			.map((item) => {
				return {
					...item.flags["litm-rn"],
					type: "tag",
					id: item._id,
					name: item.name,
				};
			});
	}

	get limit() {
		return {
			label: "Litm.other.limit",
			value:
				6 - (this.statuses.sort((a, b) => b.value - a.value)[0]?.value || 0),
			max: 6,
		};
	}

	async prepareDerivedData() {
		// Make sure only four themes are present
		const themes = this.parent.items.filter((item) => item.type === "theme");
		if (themes.length > 4) {
			warn(
				`Too many themes found for ${this.parent.name}, attempting to resolve...`,
			);
			const toDelete = themes.slice(4);
			await this.parent.deleteEmbeddedDocuments(
				"Item",
				toDelete.map((item) => item._id),
			);
		}

		// Make sure only one backpack is present
		const backpacks = this.parent.items.contents.filter(
			(item) => item.type === "backpack",
		);
		if (backpacks.length > 1) {
			warn(
				`Too many backpacks found for ${this.parent.name}, attempting to resolve...`,
			);
			const toDelete = backpacks.slice(1);
			await this.parent.deleteEmbeddedDocuments(
				"Item",
				toDelete.map((item) => item._id),
			);
		}

		// Make sure only one hero is present
		const heroes = this.parent.items.filter(
			(item) => item.type === "hero",
		);
		if (heroes.length > 1) {
			warn(
				`Too many heroes found for ${this.parent.name}, attempting to resolve...`,
			);
			const toDelete = heroes.slice(1);
			await this.parent.deleteEmbeddedDocuments(
				"Item",
				toDelete.map((item) => item._id),
			);
		}

		// Validate unique data ids
		// Get duplicates
		const duplicates = this.embeddedTags
			.map((tag) => tag.id)
			.filter((id, index, arr) => arr.indexOf(id) !== index);
		if (!duplicates.length) return;
		warn("Duplicate tag IDs found, attempting to resolve...");
		error(`Duplicate tag IDs found for: ${this.parent._id}`, duplicates);

		// try to fix duplicates
		const tags = this.embeddedTags;
		for (const tag of tags) {
			if (duplicates.includes(tag.id)) {
				tag.id = foundry.utils.randomID();
			}
		}
	}
}
