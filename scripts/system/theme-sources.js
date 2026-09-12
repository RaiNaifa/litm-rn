const SETTING_KEY = "themeSources";

/** Resolve Themebooks and Theme Kits from the GM-approved world and compendium sources. */
export class ThemeSources {
	/** Return the persisted source configuration. */
	static getConfig() {
		return (
			game.settings.get("litm-rn", SETTING_KEY) || {
				includeWorld: true,
				packs: [],
			}
		);
	}

	/**
	 * Return approved items of a specific theme-content type.
	 * @param {"themebook"|"themekit"|"trope"} type Item type to resolve.
	 * @returns {Promise<Item[]>} Resolved world and compendium documents.
	 */
	static async getItems(type) {
		if (!["themebook", "themekit", "trope"].includes(type)) return [];
		const config = this.getConfig();
		const items = config.includeWorld
			? game.items.filter((item) => item.type === type)
			: [];

		for (const collection of config.packs ?? []) {
			const pack = game.packs.get(collection);
			if (!pack || pack.documentName !== "Item") continue;
			try {
				const documents = await pack.getDocuments({ type });
				items.push(...documents.filter((item) => item.type === type));
			} catch (error) {
				console.warn(`LITM | Unable to load theme source ${collection}`, error);
			}
		}
		return items;
	}

	/**
	 * Return approved Themebook documents for character Themes or Fellowships.
	 * @param {object} [options] Selection audience.
	 * @param {boolean} [options.fellowship=false] Return Fellowship-only Themebooks.
	 * @returns {Promise<Item[]>} Matching Themebook documents.
	 */
	static async getThemebooks({ fellowship = false } = {}) {
		const themebooks = await this.getItems("themebook");
		return themebooks.filter(
			(item) => Boolean(item.system.isFellowship) === fellowship,
		);
	}

	/** Return all approved Trope documents. */
	static getTropes() {
		return this.getItems("trope");
	}

	/**
	 * Return approved Theme Kit documents, optionally for one Themebook.
	 * @param {string|null} themebookUuid Themebook UUID to filter by.
	 * @returns {Promise<Item[]>} Matching Theme Kit documents.
	 */
	static async getThemeKits(themebookUuid = null) {
		const kits = await this.getItems("themekit");
		if (!themebookUuid) return kits;
		return kits.filter((item) => item.system.themebookUuid === themebookUuid);
	}

	/**
	 * Reconcile legacy string Themebook names for every character in the world.
	 * Unique matches become UUID links; ambiguous and missing names remain custom.
	 */
	static async migrateCharacterThemes() {
		if (!game.user.isGM) return;
		const themebooks = await this.getThemebooks();
		const byName = new Map();
		for (const item of themebooks) {
			const key = item.name.trim().toLocaleLowerCase();
			if (!byName.has(key)) byName.set(key, []);
			byName.get(key).push(item);
		}
		for (const actor of game.actors.filter(
			(entry) => entry.type === "character",
		)) {
			const themes = foundry.utils.deepClone(
				actor.toObject().system.themes ?? [],
			);
			let changed = false;
			for (const theme of themes) {
				if (!theme.themebook?.trim() || theme.themebookUuid) continue;
				const matches =
					byName.get(theme.themebook.trim().toLocaleLowerCase()) ?? [];
				const uuid = matches.length === 1 ? matches[0].uuid : "";
				const custom = matches.length !== 1;
				if (theme.themebookUuid !== uuid || theme.themebookCustom !== custom) {
					theme.themebookUuid = uuid;
					theme.themebookCustom = custom;
					changed = true;
				}
			}
			if (changed) {
				await actor.update({ "system.themes": themes }, { validate: false });
				Hooks.callAll("litmActorDataUpdated", actor.uuid);
			}
		}
	}
}
