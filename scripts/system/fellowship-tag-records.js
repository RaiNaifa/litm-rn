/** Restore required fields of Fellowship tags in legacy and keyed sources. */
// TODO(system 14): Remove this helper with the Fellowship repair migration.
export function ensureFellowshipTagRecords(system, randomID, names) {
	const decodeKey = (key) => {
		if (!/^r[\da-f]+(?:_[\da-f]+)*$/i.test(key)) return null;
		return key
			.slice(1)
			.split("_")
			.map((code) => String.fromCodePoint(Number.parseInt(code, 16)))
			.join("");
	};
	const fillTag = (tag, type, fallbackName, id) => {
		tag.id ||= id || randomID();
		if (!tag.name?.trim()) tag.name = fallbackName;
		tag.type ||= type;
		tag.isScratched ??= false;
	};
	const fillCollection = (collection, type, fallbackName) => {
		if (Array.isArray(collection)) {
			for (const tag of collection) if (tag) fillTag(tag, type, fallbackName);
			return;
		}
		for (const [index, [key, record]] of Object.entries(
			collection ?? {},
		).entries()) {
			if (!record || typeof record !== "object") continue;
			record.id ||= decodeKey(key) || record.value?.id || randomID();
			record.order ??= index;
			record.deleted ??= false;
			record.value ??= {};
			fillTag(record.value, type, fallbackName, record.id);
		}
	};
	if (system?.themeTag) fillTag(system.themeTag, "themeCrispy", names.theme);
	fillCollection(system?.powerTags, "powerCrispy", names.power);
	fillCollection(system?.weaknessTags, "weaknessTag", names.weakness);
	for (const record of Object.values(system?.draftTags ?? {})) {
		const draft = record?.value ?? record;
		if (draft && !draft.name?.trim()) draft.name = names.draft;
	}
	return system;
}

/** Restore blank names of shared TagData records in raw actor and item systems. */
// TODO(system 14): Remove this helper with the schema-4 tag repair migration.
export function restoreBlankTagNames(system, names) {
	let restored = 0;
	const defaults = {
		themeTag: names.theme,
		themeCrispy: names.theme,
		powerTag: names.power,
		powerCrispy: names.power,
		weaknessTag: names.weakness,
		weaknessStoryTag: names.weakness,
		backpack: names.backpack,
		hero: names.tag,
		fulfillment: names.tag,
	};
	const visit = (value) => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const entry of value) visit(entry);
			return;
		}
		if (
			Object.hasOwn(value, "id") &&
			defaults[value.type] &&
			(typeof value.name !== "string" || !value.name.trim())
		) {
			value.name = defaults[value.type];
			restored += 1;
		}
		for (const child of Object.values(value)) visit(child);
	};
	visit(system);
	return restored;
}
