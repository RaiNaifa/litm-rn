import { error } from "../../logger.js";

export class CharacterData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litm.data;
		return {
			note: new fields.HTMLField(),
			fellowshipId: new fields.StringField({
				required: false,
				nullable: true,
				initial: null,
			}),
			bio: new fields.HTMLField(),
			quintessences: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.SpecialData),
				{ initial: () => [] },
			),
			promise: new fields.NumberField({
				integer: true,
				min: 0,
				max: 5,
				initial: 0,
			}),
			availableFulfillments: new fields.NumberField({
				integer: true,
				min: 0,
				initial: 0,
			}),
			fulfillment: new fields.ArrayField(new fields.StringField(), {
				initial: () => [],
			}),
			relationships: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.RelationshipData),
				{ initial: () => [] },
			),
			backpackTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{ initial: () => [] },
			),
			backpackDraftTags: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						required: true,
						initial: () => foundry.utils.randomID(),
					}),
					name: new fields.StringField({ required: true, initial: "" }),
				}),
				{ initial: () => [] },
			),
			backpackArchive: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{ initial: () => [] },
			),
			noticedTags: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						required: true,
						initial: () => foundry.utils.randomID(),
					}),
					name: new fields.StringField({ required: true, initial: "" }),
					type: new fields.StringField({
						initial: "tag",
						choices: ["tag", "status"],
					}),
				}),
				{ initial: () => [] },
			),
			themeArchive: new fields.ArrayField(new fields.ObjectField(), {
				initial: () => [],
			}),
			themeCreationDraft: new fields.ObjectField({
				required: false,
				nullable: true,
				initial: null,
			}),
			characterOptions: new fields.SchemaField({
				enableBackpackDrafts: new fields.BooleanField({ initial: false }),
				showDraftTags: new fields.BooleanField({ initial: false }),
			}),
			shortDescription: new fields.StringField({ initial: "" }),
			heroTitle: new fields.StringField({ initial: "" }),
			themes: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({ required: true }),
					type: new fields.StringField({ initial: "theme" }),
					isEmpty: new fields.BooleanField({ initial: false }),
					creationMode: new fields.StringField({
						initial: "custom",
						choices: ["custom", "themebook", "themekit"],
					}),
					name: new fields.StringField(),
					themebook: new fields.StringField({ initial: "" }),
					themebookUuid: new fields.StringField({ initial: "", blank: true }),
					themebookCustom: new fields.BooleanField({ initial: true }),
					themekitUuid: new fields.StringField({ initial: "", blank: true }),
					themekitName: new fields.StringField({ initial: "", blank: true }),
					themebookAnswers: new fields.ArrayField(
						new fields.SchemaField({
							id: new fields.StringField({ required: true }),
							sourceUuid: new fields.StringField({ initial: "", blank: true }),
							questionId: new fields.StringField({ initial: "", blank: true }),
							kind: new fields.StringField({
								choices: ["introduction", "power", "weakness"],
							}),
							question: new fields.StringField({ initial: "", blank: true }),
							answer: new fields.StringField({ initial: "", blank: true }),
							tagId: new fields.StringField({ initial: "", blank: true }),
							role: new fields.StringField({
								initial: "",
								blank: true,
								choices: ["", "title", "power", "weakness"],
							}),
							createdAt: new fields.NumberField({
								integer: true,
								min: 0,
								initial: 0,
							}),
						}),
						{ initial: () => [] },
					),
					level: new fields.StringField({ initial: "origin" }),
					themeTag: new fields.EmbeddedDataField(abstract.TagData),
					powerTags: new fields.ArrayField(
						new fields.EmbeddedDataField(abstract.TagData),
						{ initial: () => [] },
					),
					weaknessTags: new fields.ArrayField(
						new fields.EmbeddedDataField(abstract.TagData),
						{ initial: () => [] },
					),
					draftTags: new fields.ArrayField(
						new fields.SchemaField({
							id: new fields.StringField({
								initial: () => foundry.utils.randomID(),
							}),
							name: new fields.StringField({ initial: "" }),
							isWeakness: new fields.BooleanField({ initial: false }),
						}),
						{ initial: () => [] },
					),
					specials: new fields.ArrayField(
						new fields.EmbeddedDataField(abstract.SpecialData),
						{ initial: () => [] },
					),
					improve: new fields.NumberField({
						integer: true,
						min: 0,
						max: 6,
						initial: 0,
					}),
					improveTrackLength: new fields.NumberField({
						integer: true,
						min: 1,
						max: 6,
						initial: 3,
					}),
					improvementsPerTrack: new fields.NumberField({
						integer: true,
						min: 1,
						max: 3,
						initial: 1,
					}),
					abandon: new fields.NumberField({
						integer: true,
						min: 0,
						max: 3,
						initial: 0,
					}),
					milestone: new fields.NumberField({
						integer: true,
						min: 0,
						max: 3,
						initial: 0,
					}),
					availableImprovements: new fields.NumberField({
						integer: true,
						min: 0,
						initial: 0,
					}),
					nascentPowerNeeded: new fields.NumberField({
						integer: true,
						min: 0,
						max: 2,
						initial: 0,
					}),
					claimedSpecials: new fields.ArrayField(
						new fields.SchemaField({
							sourceUuid: new fields.StringField({ initial: "", blank: true }),
							specialId: new fields.StringField({ initial: "", blank: true }),
							name: new fields.StringField({ initial: "", blank: true }),
							themeSpecialId: new fields.StringField({
								initial: "",
								blank: true,
							}),
							retired: new fields.BooleanField({ initial: false }),
							claimedAt: new fields.NumberField({
								integer: true,
								min: 0,
								initial: 0,
							}),
						}),
						{ initial: () => [] },
					),
					thresholdNotifications: new fields.SchemaField({
						milestone: new fields.BooleanField({ initial: false }),
						abandon: new fields.BooleanField({ initial: false }),
					}),
					motivation: new fields.StringField({ initial: "" }),
					note: new fields.HTMLField(),
				}),
				{ initial: () => [] },
			),
		};
	}

	static getTrackableAttributes() {
		return {
			bar: ["limit"],
			value: [],
		};
	}

	get backpack() {
		return {
			contents: this._source.backpackTags ?? [],
			specials: this._source.quintessences ?? [],
		};
	}

	get fellowship() {
		if (!this.fellowshipId) return null;
		return game.items.get(this.fellowshipId) ?? null;
	}

	#schemaThemes() {
		return (this._source.themes ?? []).filter((theme) => !theme.isEmpty);
	}

	get embeddedTags() {
		const heroRels = (this._source.relationships ?? []).map((r) => ({
			...r,
			type: "hero",
		}));
		const heroTags = this._source.backpackTags ?? [];
		const themeEntries = this.#schemaThemes();
		const themeTags = themeEntries.flatMap((t) => [
			...(t.powerTags ?? []),
			...(t.weaknessTags ?? []),
			...(t.themeTag ? [t.themeTag] : []),
		]);
		const storyThemeTags = this.parent.items
			.filter(
				(item) => item.type === "story" && item.system.isArchived !== true,
			)
			.flatMap((item) => item.system.allTags);
		return [...heroRels, ...heroTags, ...themeTags, ...storyThemeTags];
	}

	get allTags() {
		const embeddedTags = this.parent.items
			.filter(
				(item) => item.type === "story" && item.system.isArchived !== true,
			)
			.flatMap((item) => item.system.allTags);

		const effectTags = this.parent.effects
			.filter((e) => e.flags?.["litm-rn"]?.ownerType)
			.map((e) => ({
				id: e.id,
				name: e.name,
				type: "tag",
				ownerType: e.flags["litm-rn"].ownerType,
				ownerId: e.flags["litm-rn"].ownerId,
				isScratched: e.flags["litm-rn"].isScratched ?? false,
				isCrispy: e.flags["litm-rn"].isCrispy ?? false,
				isHindering: e.flags["litm-rn"].isHindering ?? false,
			}));
		const fellowshipTags = this.fellowship?.system?.allTags ?? [];
		return [...embeddedTags, ...effectTags, ...fellowshipTags];
	}

	get powerTags() {
		return this.allTags.filter((tag) => {
			if (tag.isHindering) return false;
			return (
				tag.type === "powerCrispy" ||
				tag.type === "powerTag" ||
				tag.type === "themeCrispy" ||
				tag.type === "themeTag" ||
				tag.type === "backpack" ||
				tag.type === "tag"
			);
		});
	}

	get weaknessTags() {
		const effectWeakness = this.parent.effects
			.filter((e) => {
				const f = e.flags?.["litm-rn"];
				if (!f?.ownerType) return false;
				return !!f.isHindering;
			})
			.map((e) => ({
				id: e.id,
				name: e.name,
				type: "tag",
				isScratched: e.flags["litm-rn"].isScratched ?? false,
				ownerType: e.flags["litm-rn"].ownerType,
				ownerId: e.flags["litm-rn"].ownerId,
				isHindering: true,
			}));

		const storyThemeWeakness = this.parent.items
			.filter(
				(item) => item.type === "story" && item.system.isArchived !== true,
			)
			.flatMap((item) => item.system.weakness);
		const fellowshipWeakness = this.fellowship?.system?.weakness ?? [];
		return [...effectWeakness, ...storyThemeWeakness, ...fellowshipWeakness];
	}

	get availablePowerTags() {
		const effectTags = this.parent.effects
			.filter((e) => {
				const f = e.flags?.["litm-rn"];
				if (!f?.ownerType) return false;
				if (f.isHindering) return false;
				if (f.isScratched) return false;
				return true;
			})
			.map((e) => ({
				id: e.id,
				name: e.name,
				type: "tag",
				ownerType: e.flags["litm-rn"].ownerType,
				ownerId: e.flags["litm-rn"].ownerId,
				isScratched: e.flags["litm-rn"].isScratched ?? false,
				isCrispy: e.flags["litm-rn"].isCrispy ?? false,
			}));
		const fellowshipTags = this.fellowship?.system?.availablePowerTags ?? [];
		return [...effectTags, ...fellowshipTags];
	}

	get availableRelationships() {
		return (this._source.relationships ?? []).filter((tag) => !tag.isScratched);
	}

	get storyTags() {
		return this.parent.appliedEffects
			.filter((item) => {
				const flags = item.flags["litm-rn"];
				if (!flags) return false;
				if (flags.type === "status") return false;
				if (flags.type === "might") return false;
				if (flags.type === "tag") {
					if (flags.ownerType) return false;
					return !flags.values?.some((v) => !!v);
				}
				if (flags.type) return false;
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

	get statuses() {
		return this.parent.appliedEffects
			.filter((item) => {
				const flags = item.flags["litm-rn"];
				if (!flags) return false;
				if (flags.type === "status") return true;
				if (flags.type === "might") return false;
				if (flags.type === "tag")
					return flags.values?.some((v) => !!v) ?? false;
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

	get limit() {
		return {
			label: "Litm.other.limit",
			value:
				6 - (this.statuses.sort((a, b) => b.value - a.value)[0]?.value || 0),
			max: 6,
		};
	}

	async prepareDerivedData() {
		const duplicates = this.embeddedTags
			.map((tag) => tag.id)
			.filter((id, index, arr) => arr.indexOf(id) !== index);
		if (!duplicates.length) return;
		warn("Duplicate tag IDs found, attempting to resolve...");
		error(`Duplicate tag IDs found for: ${this.parent._id}`, duplicates);

		const tags = this.embeddedTags;
		for (const tag of tags) {
			if (duplicates.includes(tag.id)) {
				tag.id = foundry.utils.randomID();
			}
		}
	}
}
