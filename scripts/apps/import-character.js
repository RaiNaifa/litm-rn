import { localize as t } from "../utils.js";

function createTag(data, type) {
	if (type === "hero") return {
		...(data || { name: "", fellowName: "", isScratched: false }),
		type,
		id: foundry.utils.randomID(),
	}
	if (type === "crispy") return {
		...(data || { name: "" }),
		type,
		id: foundry.utils.randomID(),
	}
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
			name:
				theme.content.themeTag.name ||
				t("Litm.other.unnamed", "TYPES.Item.theme"),
			type: "theme",
			system: {
				themebook: theme.content.themebook,
				level: theme.content.level?.toLowerCase(),
				// isScratched: theme.content.mainTag.isScratched,
				themeTag: createTag(theme.content.themeTag, "themeTag"),
				powerTags: Array(5)
					.fill()
					.map((_, i) => createTag(theme.content.powerTags[i], "powerTag")),
				weaknessTags: [
					createTag(
						{
							name: theme.content.weaknessTags[0] || "",
						},
						"weaknessTag",
					),
				],
				improve: theme.content.improve,
				abandon: theme.content.abandon,
				milestone: theme.content.milestone,
				motivation: theme.content.bio.title?.replace(/['"“”‟]/gm, "") || "",
				note: theme.content.bio.body,
			},
		}));

	const backpack = {
		name: t("TYPES.Item.backpack"),
		type: "backpack",
		system: {
			contents: data.backpack.map((item) => createTag(item, "backpack")),
		},
	};

	const hero = {
		name: t("TYPES.Item.hero"),
		type: "hero",
		system: {
			contents: data.hero.map((item) => createTag(item, "hero")),
		},
	};

	const statuses = data.statuses.map((status) => createStatus(status));

	const tags = Object.values(data.miscCard?.content || {})
		.flat()
		.map((tag) => createStatus(tag));

	const actorData = {
		name: data.name,
		type: "character",
		system: {
			note: "",
		},
		effects: [...tags, ...statuses],
		items: [...themeData, backpack, hero],
	};
	const created = await Actor.create(actorData);
	if (created) {
		const formatted = game.i18n.format("Litm.ui.info-imported-character", {
			name: created.name,
		});
		ui.notifications.info(formatted);
		created.sheet.render(true);
	}
}
