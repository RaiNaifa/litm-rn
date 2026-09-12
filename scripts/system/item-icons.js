const ICON_BASE = "systems/litm-rn/assets/media/icons/";

/** Default images assigned to newly created item documents. */
export const DEFAULT_ITEM_ICONS = Object.freeze({
	fellowship: `${ICON_BASE}fellowship_icn.svg`,
	story: `${ICON_BASE}stabbed-note.svg`,
	themebook: `${ICON_BASE}book-cover.svg`,
	themekit: `${ICON_BASE}scroll-unfurled.svg`,
	threat: `${ICON_BASE}cracked-skull.svg`,
	trope: `${ICON_BASE}files.svg`,
});

/** Previous defaults eligible for automatic replacement in existing worlds. */
export const LEGACY_DEFAULT_ITEM_ICONS = Object.freeze({
	story: `${ICON_BASE}story-theme_icn.svg`,
	themebook: `${ICON_BASE}unfurled-scroll.svg`,
	themekit: `${ICON_BASE}tied-scroll.svg`,
	trope: "icons/svg/item-bag.svg",
});

/**
 * Return the new default image only when an item still uses its exact legacy default.
 * @param {{type: string, img: string}} item Item-like data to inspect.
 * @returns {string|null} Replacement image path, or null for custom/unmanaged images.
 */
export function getLegacyDefaultItemIconReplacement(item) {
	const previous = LEGACY_DEFAULT_ITEM_ICONS[item.type];
	const replacement = DEFAULT_ITEM_ICONS[item.type];
	return previous && replacement && item.img === previous ? replacement : null;
}
