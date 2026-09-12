import { info } from "../logger.js";

const LEGACY_ITEM_TYPES = new Set(["backpack", "hero", "theme"]);
const ARCHIVE_FLAG = "legacyItemArchive";
const ARCHIVE_NAME = "Legend in the Mist - Legacy Item Archive";

/**
 * Archives obsolete world and embedded character items before removing them.
 *
 * The legacy types must remain declared in system.json for the release which
 * runs this migration: Foundry validates world documents before the ready hook.
 */
export class LegacyItemMigration {
	/**
	 * Archive every obsolete item as a journal page and then delete only
	 * the items whose archive pages are confirmed to exist.
	 *
	 * This operation is idempotent. A retry reuses pages identified by the
	 * original Item id instead of creating duplicates.
	 *
	 * @returns {Promise<void>}
	 */
	static async archiveAndRemoveItems() {
		const worldItems =
			game.items?.filter((item) => LEGACY_ITEM_TYPES.has(item.type)) ?? [];
		const embeddedItems =
			game.actors
				?.filter((actor) => actor.type === "character")
				.flatMap((actor) =>
					actor.items.filter((item) => LEGACY_ITEM_TYPES.has(item.type)),
				) ?? [];
		const legacyItems = [...worldItems, ...embeddedItems];
		if (legacyItems.length === 0) return;

		const journal = await LegacyItemMigration.#getOrCreateArchive();
		const archivedIds = new Set(
			journal.pages
				.filter((page) => page.getFlag("litm-rn", ARCHIVE_FLAG))
				.map((page) => {
					const archive = page.getFlag("litm-rn", ARCHIVE_FLAG);
					return archive.itemUuid ?? `Item.${archive.itemId}`;
				}),
		);
		const itemsToArchive = legacyItems.filter(
			(item) => !archivedIds.has(item.uuid),
		);

		if (itemsToArchive.length > 0) {
			const pages = itemsToArchive.map((item) =>
				LegacyItemMigration.#makeArchivePage(item),
			);
			const created = await journal.createEmbeddedDocuments(
				"JournalEntryPage",
				pages,
			);
			for (const page of created) {
				const archiveData = page.getFlag("litm-rn", ARCHIVE_FLAG);
				if (archiveData?.itemUuid) archivedIds.add(archiveData.itemUuid);
			}
		}

		const worldItemIds = worldItems
			.filter((item) => archivedIds.has(item.uuid))
			.map((item) => item.id);
		const embeddedByActor = new Map();
		for (const item of embeddedItems.filter((entry) =>
			archivedIds.has(entry.uuid),
		)) {
			if (!embeddedByActor.has(item.parent.id))
				embeddedByActor.set(item.parent.id, []);
			embeddedByActor.get(item.parent.id).push(item.id);
		}
		const confirmedCount =
			worldItemIds.length +
			[...embeddedByActor.values()].reduce(
				(count, ids) => count + ids.length,
				0,
			);
		if (confirmedCount !== legacyItems.length) {
			throw new Error("Not every legacy item has a confirmed archive page.");
		}

		if (worldItemIds.length)
			await CONFIG.Item.documentClass.deleteDocuments(worldItemIds);
		for (const [actorId, itemIds] of embeddedByActor) {
			await game.actors
				.get(actorId)
				.deleteEmbeddedDocuments("Item", itemIds, { render: false });
		}
		info(
			`Archived and removed ${confirmedCount} legacy item(s) in "${ARCHIVE_NAME}".`,
		);
		ui.notifications.info(
			`Legend in the Mist: archived ${confirmedCount} legacy item(s) in "${ARCHIVE_NAME}".`,
		);
	}

	/**
	 * Find or create the journal used by this migration.
	 *
	 * @returns {Promise<JournalEntry>}
	 */
	static async #getOrCreateArchive() {
		const existing = game.journal?.find(
			(entry) => entry.getFlag("litm-rn", ARCHIVE_FLAG)?.isArchive === true,
		);
		if (existing) return existing;

		return CONFIG.JournalEntry.documentClass.create({
			name: ARCHIVE_NAME,
			flags: {
				"litm-rn": {
					[ARCHIVE_FLAG]: {
						isArchive: true,
					},
				},
			},
		});
	}

	/**
	 * Convert an Item to the same JSON payload used by Foundry's document
	 * export, wrapped in a journal text page.
	 *
	 * @param {Item} item Item being archived.
	 * @returns {object} JournalEntryPage creation data.
	 */
	static #makeArchivePage(item) {
		const exportData = item.toCompendium(null, {
			keepId: true,
			keepFolders: true,
			clearSort: false,
			clearOwnership: false,
		});
		const json = JSON.stringify(exportData, null, 2);

		return {
			name: item.name,
			type: "text",
			text: {
				content: `<pre><code>${LegacyItemMigration.#escapeHtml(json)}</code></pre>`,
				format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
			},
			flags: {
				"litm-rn": {
					[ARCHIVE_FLAG]: {
						itemId: item.id,
						itemUuid: item.uuid,
						itemType: item.type,
						parentActorId:
							item.parent?.documentName === "Actor" ? item.parent.id : null,
					},
				},
			},
		};
	}

	/**
	 * Escape JSON for safe inclusion in a journal HTML code block.
	 *
	 * @param {string} value Unescaped JSON.
	 * @returns {string} HTML-safe JSON.
	 */
	static #escapeHtml(value) {
		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;");
	}
}
