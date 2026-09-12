import { localize as t } from "../utils.js";

function createTag(data, type) {
	if (type === "heroTag")
		return {
			...(data || { name: "", fellowName: "", isScratched: false }),
			type,
			id: foundry.utils.randomID(),
		};
	if (type === "crispy")
		return {
			...(data || { name: "" }),
			type,
			id: foundry.utils.randomID(),
		};
	return {
		...(data || { name: "", isScratched: false }),
		type,
		id: foundry.utils.randomID(),
	};
}

function createStatus(data) {
	if (typeof data === "string")
		return {
			name: data,
			type: "ActiveEffect",
			flags: {
				["litm-rn"]: {
					type: "tag",
					values: Array(6).fill(null),
					value: "",
					isScratched: false,
				},
			},
		};

	const values =
		data.level?.map((level, i) => (level ? (i + 1).toString() : null)) ||
		Array(6).fill(null);
	const value = values.findLast((level) => level) || "";
	const type = value ? "status" : "tag";

	return {
		name: data.name || t("Litm.other.unnamed"),
		type: "ActiveEffect",
		flags: {
			["litm-rn"]: {
				type,
				values,
				value,
				isScratched: false,
			},
		},
	};
}

export async function importCharacter(data) {
	if (data.compatibility && !["litm-rn", "empty"].includes(data.compatibility))
		return ui.notifications.warn("Litm.ui.warn-incompatible-data", {
			localize: true,
		});

	const themeData = Object.entries(data)
		.filter(
			([key, theme]) =>
				key.startsWith("theme") &&
				typeof theme === "object" &&
				!Array.isArray(theme) &&
				!theme.isEmpty,
		)
		.map(([_, theme]) => ({
			id: foundry.utils.randomID(),
			type: "theme",
			name:
				theme.content.themeTag?.name ||
				t("Litm.other.unnamed", "TYPES.Item.theme"),
			themebook: theme.content.themebook || "",
			level: theme.content.level?.toLowerCase() || "",
			themeTag: createTag(theme.content.themeTag, "themeTag"),
			powerTags: Array(5)
				.fill()
				.map((_, i) => createTag(theme.content.powerTags?.[i], "powerTag")),
			weaknessTags: [
				createTag(
					{ name: theme.content.weaknessTags?.[0] || "" },
					"weaknessTag",
				),
			],
			draftTags: theme.content.draftTags || [],
			specials: theme.content.specials || [],
			improve: theme.content.improve || 0,
			abandon: theme.content.abandon || 0,
			milestone: theme.content.milestone || 0,
			motivation: theme.content.bio?.title?.replace(/['"“”‟]/gm, "") || "",
			note: theme.content.bio?.body || "",
		}));

	const heroTags = [
		...(data.hero || []).map((item) => ({
			...createTag(item, "heroTag"),
			type: "heroTag",
		})),
		...(data.backpack || []).map((item) => ({
			...createTag(item, "backpackTag"),
			type: "backpackTag",
		})),
	];

	const statuses = data.statuses.map((status) => createStatus(status));
	const tags = Object.values(data.miscCard?.content || {})
		.flat()
		.map((tag) => createStatus(tag));

	// Create ActiveEffects for theme/backpack/hero tags (matching Stage 2 format)
	const effectData = [];
	for (const theme of themeData) {
		if (theme.themeTag?.id) {
			effectData.push({
				name: theme.themeTag.name || "",
				disabled: false,
				transfer: false,
				flags: {
					"litm-rn": {
						type: "tag",
						ownerType: "theme",
						ownerId: theme.id,
						isScratched: theme.themeTag.isScratched ?? false,
					},
				},
			});
		}
		for (const tag of theme.powerTags || []) {
			effectData.push({
				name: tag.name || "",
				disabled: false,
				transfer: false,
				flags: {
					"litm-rn": {
						type: "tag",
						ownerType: "theme",
						ownerId: theme.id,
						isScratched: tag.isScratched ?? false,
						isCrispy: tag.isCrispy ?? false,
					},
				},
			});
		}
		for (const tag of theme.weaknessTags || []) {
			effectData.push({
				name: tag.name || "",
				disabled: false,
				transfer: false,
				flags: {
					"litm-rn": {
						type: "tag",
						ownerType: "theme",
						ownerId: theme.id,
						isScratched: tag.isScratched ?? false,
						isHindering: true,
					},
				},
			});
		}
	}
	for (const tag of heroTags) {
		effectData.push({
			name: tag.name || "",
			disabled: false,
			transfer: false,
			flags: {
				"litm-rn": {
					type: "tag",
					ownerType: "backpack",
					ownerId: "backpack",
					isScratched: tag.isScratched ?? false,
					isCrispy: tag.isCrispy ?? false,
				},
			},
		});
	}

	const actorData = {
		name: data.name,
		type: "character",
		system: {
			note: "",
			promise: 0,
			fulfillment: [],
			relationships: [],
			bio: "",
			backpackTags: heroTags,
			themes: themeData,
		},
		effects: [...effectData, ...tags, ...statuses],
	};

	const created = await CONFIG.Actor.documentClass.create(actorData);
	if (created) {
		const formatted = game.i18n.format("Litm.ui.info-imported-character", {
			name: created.name,
		});
		ui.notifications.info(formatted);
		created.sheet.render({ force: true });
	}
}
