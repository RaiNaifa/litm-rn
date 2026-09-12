import { ReferenceHandbook } from "../apps/reference-handbook.js";
import { StoryProfileSettings } from "../apps/story-profile-settings.js";
import { error, info } from "../logger.js";
import { getLegacyDefaultItemIconReplacement } from "./item-icons.js";
import { LegacyItemMigration } from "./legacy-item-migration.js";
import { ThemeAdvancement } from "./theme-advancement.js";
import { ThemeSources } from "./theme-sources.js";

const SYSTEM_ID = "litm-rn";
const SCHEMA_VERSION_SETTING = "dataSchemaVersion";
export const CURRENT_DATA_SCHEMA_VERSION = 2;
const LEGACY_CHARACTER_ITEM_TYPES = new Set(["hero", "backpack", "theme"]);

/** Run persistent world-data migrations from publicly released system formats. */
export class WorldMigrations {
	static #running = null;

	/** Register the migration runner for the active GM. */
	static register() {
		Hooks.once("ready", () => {
			if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
			WorldMigrations.run().catch((cause) => {
				error("World data migration failed.", cause);
				ui.notifications.error(
					"Legend in the Mist: world migration failed. No schema version was advanced; see the console for details.",
				);
			});
		});
	}

	/**
	 * Apply every pending migration in order.
	 * @returns {Promise<void>}
	 */
	static async run() {
		if (WorldMigrations.#running) return WorldMigrations.#running;
		WorldMigrations.#running = WorldMigrations.#runPending();
		try {
			await WorldMigrations.#running;
		} finally {
			WorldMigrations.#running = null;
		}
	}

	static async #runPending() {
		let version =
			Number(game.settings.get(SYSTEM_ID, SCHEMA_VERSION_SETTING)) || 0;
		if (version >= CURRENT_DATA_SCHEMA_VERSION) return;

		info(
			`Migrating world data schema ${version} → ${CURRENT_DATA_SCHEMA_VERSION}...`,
		);
		if (version < 1) {
			const summary = await WorldMigrations.#migratePublishedData();
			await game.settings.set(SYSTEM_ID, SCHEMA_VERSION_SETTING, 1);
			version = 1;
			info(
				`World data schema 1 complete: ${summary.characters} character(s), ${summary.challenges} challenge(s), ${summary.effects} effect(s), ${summary.fellowships} fellowship(s).`,
			);
		}

		if (version < 2) {
			const items = await WorldMigrations.#migrateDefaultItemIcons();
			await game.settings.set(SYSTEM_ID, SCHEMA_VERSION_SETTING, 2);
			version = 2;
			info(
				`World data schema 2 complete: ${items} default item icon(s) updated.`,
			);
		}

		if (version === CURRENT_DATA_SCHEMA_VERSION) {
			ui.notifications.info(
				"Legend in the Mist: world data migration completed.",
			);
		}
	}

	static async #migratePublishedData() {
		const summary = {
			characters: 0,
			challenges: 0,
			effects: 0,
			fellowships: 0,
		};
		await WorldMigrations.#normalizeStoryActorReferences();

		for (const actor of game.actors.filter(
			(entry) => entry.type === "character",
		)) {
			const result = await WorldMigrations.#migrateCharacter(actor);
			if (result.changed) summary.characters += 1;
			summary.effects += result.effects;
		}

		for (const actor of game.actors.filter(
			(entry) => entry.type === "challenge",
		)) {
			const result = await WorldMigrations.#migrateChallenge(actor);
			if (result.changed) summary.challenges += 1;
			summary.effects += result.effects;
		}

		summary.fellowships = await WorldMigrations.#migrateFellowshipMembers();
		await StoryProfileSettings.migrate();
		await ThemeSources.migrateCharacterThemes();
		await WorldMigrations.#persistCurrentReferenceHandbook();
		await LegacyItemMigration.archiveAndRemoveItems();
		await WorldMigrations.#removeObsoleteMigrationFlags();
		return summary;
	}

	static async #normalizeStoryActorReferences() {
		const config = foundry.utils.deepClone(
			game.settings.get(SYSTEM_ID, "storytags") || {},
		);
		const actors = config.actors ?? [];
		const normalized = actors.map((ref) => {
			if (!ref || ref.includes(".")) return ref;
			return game.actors.get(ref)?.uuid ?? ref;
		});
		if (normalized.some((ref, index) => ref !== actors[index])) {
			await game.settings.set(SYSTEM_ID, "storytags", {
				...config,
				actors: normalized,
			});
		}
	}

	static async #migrateCharacter(actor) {
		let changed = false;
		let effectsCreated = 0;
		const alreadyMigrated =
			actor.flags?.[SYSTEM_ID]?.migratedToCharacter === true;
		const effectsMigrated = actor.flags?.[SYSTEM_ID]?.effectsMigrated === true;
		const legacyItems = actor.items.filter((item) =>
			LEGACY_CHARACTER_ITEM_TYPES.has(item.type),
		);

		if (!alreadyMigrated) {
			const source = actor._source.system ?? {};
			const updates = {};
			const hero = legacyItems.find((item) => item.type === "hero");
			const backpack = legacyItems.find((item) => item.type === "backpack");
			const themes = legacyItems.filter((item) => item.type === "theme");
			const heroSource = foundry.utils.deepClone(hero?._source.system ?? {});
			const backpackSource = foundry.utils.deepClone(
				backpack?._source.system ?? {},
			);

			if (hero && Number(actor.system.promise ?? 0) === 0) {
				updates["system.promise"] = heroSource.promise ?? 0;
			}
			if (backpack && !(actor.system.backpackTags?.length > 0)) {
				updates["system.backpackTags"] = backpackSource.contents ?? [];
			}
			if (backpack && !(actor.system.quintessences?.length > 0)) {
				updates["system.quintessences"] = backpackSource.specials ?? [];
			}
			if (
				themes.length &&
				!actor.system.themes?.some((theme) => !theme.isEmpty)
			) {
				updates["system.themes"] = themes.map((item) =>
					WorldMigrations.#themeSource(item),
				);
			}

			const relationships = heroSource.contents ?? [];
			if (relationships.length) {
				const lines = relationships.map((relationship) => {
					const fellow = foundry.utils.escapeHTML(
						relationship.fellowName || "",
					);
					const name = foundry.utils.escapeHTML(relationship.name || "");
					const text = `${fellow}: ${name}`;
					return relationship.isScratched ? `<s>${text}</s>` : text;
				});
				const note = source.note?.trim() ?? "";
				updates["system.note"] = note
					? `${lines.join("<br>")}<br><br>${note}`
					: lines.join("<br>");
			}

			updates[`flags.${SYSTEM_ID}.migratedToCharacter`] = true;
			await actor.update(updates, { validate: false, render: false });
			changed = true;
		}

		if (!effectsMigrated) {
			const effectSources = WorldMigrations.#characterEffectSources(actor);
			const existing = new Set(
				actor.effects.map((effect) => {
					const flags = effect.flags?.[SYSTEM_ID] ?? {};
					return `${flags.ownerType ?? ""}|${flags.ownerId ?? ""}|${effect.name}`;
				}),
			);
			const toCreate = effectSources.filter((effect) => {
				const flags = effect.flags[SYSTEM_ID];
				return (
					!actor.effects.has(effect._id) &&
					!existing.has(`${flags.ownerType}|${flags.ownerId}|${effect.name}`)
				);
			});
			if (toCreate.length) {
				await actor.createEmbeddedDocuments("ActiveEffect", toCreate, {
					render: false,
				});
				effectsCreated += toCreate.length;
			}
			await actor.update(
				{ [`flags.${SYSTEM_ID}.effectsMigrated`]: true },
				{ render: false },
			);
			changed = true;
		}

		const namespaceChanges =
			await WorldMigrations.#migrateLegacyEffectNamespace(actor);
		if (namespaceChanges) changed = true;
		effectsCreated += namespaceChanges;
		const reconciled = await WorldMigrations.#reconcileCharacterEffects(actor);
		if (reconciled) changed = true;
		effectsCreated += reconciled;
		const mightIds = actor.effects
			.filter((effect) => effect.flags?.[SYSTEM_ID]?.type === "might")
			.map((effect) => effect.id);
		if (mightIds.length) {
			await actor.deleteEmbeddedDocuments("ActiveEffect", mightIds, {
				render: false,
			});
			changed = true;
		}

		const normalized = await WorldMigrations.#normalizeEffectTypes(actor);
		if (normalized) changed = true;
		const progressionChanged =
			await WorldMigrations.#normalizeCharacterProgress(actor);
		if (progressionChanged) changed = true;
		return { changed, effects: effectsCreated + normalized };
	}

	static async #normalizeCharacterProgress(actor) {
		const updates = {};
		if (Number(actor.system.promise ?? 0) >= 5) {
			const progress = ThemeAdvancement.promiseProgress(actor, 0);
			updates["system.promise"] = progress.promise;
			updates["system.availableFulfillments"] = progress.availableFulfillments;
		}
		const themes = foundry.utils.deepClone(
			actor.toObject().system.themes ?? [],
		);
		const before = JSON.stringify(themes);
		ThemeAdvancement.normalizeImproveTracks(themes);
		if (JSON.stringify(themes) !== before) updates["system.themes"] = themes;
		if (!Object.keys(updates).length) return false;
		await actor.update(updates, { validate: false, render: false });
		return true;
	}

	static #themeSource(item) {
		const source = foundry.utils.deepClone(item._source.system ?? {});
		return {
			id: foundry.utils.randomID(),
			type: "theme",
			name: item.name,
			themebook: source.themebook ?? "",
			level: source.level ?? "origin",
			themeTag: source.themeTag ?? WorldMigrations.#emptyThemeTag(item.name),
			powerTags: source.powerTags ?? [],
			weaknessTags: source.weaknessTags ?? [],
			draftTags: source.draftTags ?? [],
			specials: source.specials ?? [],
			improve: source.improve ?? 0,
			abandon: source.abandon ?? 0,
			milestone: source.milestone ?? 0,
			motivation: source.motivation ?? "",
			note: source.note ?? "",
		};
	}

	static #emptyThemeTag(name) {
		return {
			id: foundry.utils.randomID(),
			name,
			type: "themeTag",
			isScratched: false,
			isPrivate: false,
		};
	}

	static #characterEffectSources(actor) {
		const effects = [];
		const add = (tag, ownerType, ownerId, extra = {}) => {
			if (!tag?.id || !tag.name) return;
			effects.push({
				_id: tag.id,
				name: tag.name,
				disabled: false,
				transfer: false,
				flags: {
					[SYSTEM_ID]: {
						type: "tag",
						values: Array(6).fill(null),
						value: "",
						isScratched: tag.isScratched ?? false,
						isHindering: false,
						isCrispy: tag.isCrispy ?? false,
						isPrivate: tag.isPrivate ?? false,
						ownerType,
						ownerId,
						...extra,
					},
				},
			});
		};

		for (const theme of actor.system.themes ?? []) {
			if (theme.isEmpty) continue;
			add(theme.themeTag, "theme", theme.id);
			for (const tag of theme.powerTags ?? []) add(tag, "theme", theme.id);
			for (const tag of theme.weaknessTags ?? []) {
				add(tag, "theme", theme.id, { isHindering: true });
			}
		}
		for (const tag of actor.system.backpackTags ?? [])
			add(tag, "backpack", "backpack");
		return effects;
	}

	static async #reconcileCharacterEffects(actor) {
		const toDelete = [];
		const toCreate = [];
		const used = new Set();
		for (const desired of WorldMigrations.#characterEffectSources(actor)) {
			if (actor.effects.has(desired._id)) continue;
			const desiredFlags = desired.flags[SYSTEM_ID];
			const existing = actor.effects.find((effect) => {
				if (used.has(effect.id)) return false;
				const flags = effect.flags?.[SYSTEM_ID];
				return (
					flags?.ownerType === desiredFlags.ownerType &&
					flags.ownerId === desiredFlags.ownerId &&
					effect.name === desired.name
				);
			});
			if (existing) {
				used.add(existing.id);
				toDelete.push(existing.id);
				const existingFlags = foundry.utils.deepClone(
					existing.flags[SYSTEM_ID],
				);
				desired.flags[SYSTEM_ID] = {
					...desiredFlags,
					...existingFlags,
					ownerType: desiredFlags.ownerType,
					ownerId: desiredFlags.ownerId,
				};
			}
			toCreate.push(desired);
		}
		if (toDelete.length) {
			await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete, {
				render: false,
			});
		}
		if (toCreate.length) {
			await actor.createEmbeddedDocuments("ActiveEffect", toCreate, {
				render: false,
			});
		}
		return toDelete.length + toCreate.length;
	}

	static async #migrateChallenge(actor) {
		const source = foundry.utils.deepClone(actor._source.system ?? {});
		const updates = {};
		let changed = false;

		const specials = Array.isArray(source.specials)
			? foundry.utils.deepClone(source.specials)
			: [];
		if (Object.hasOwn(source, "special")) {
			const description = String(source.special ?? "").trim();
			if (
				description &&
				!specials.some((special) => special.description === description)
			) {
				specials.unshift({
					id: foundry.utils.randomID(),
					name: game.i18n.localize("Litm.ui.new-special"),
					description,
				});
			}
			updates["system.-=special"] = null;
			changed = true;
		}
		for (const special of specials) special.id ||= foundry.utils.randomID();
		if (Array.isArray(source.specials) || Object.hasOwn(source, "special")) {
			updates["system.specials"] = specials.map((special) => ({
				...special,
			}));
			changed = true;
		}

		if (Array.isArray(source.limits)) {
			const limits = source.limits.map((limit) => ({
				name: limit.name ?? "",
				value:
					limit.value != null ? Math.min(Number(limit.value) || 0, 6) : null,
				consequence: limit.consequence ?? "",
				isPrivate: limit.isPrivate ?? false,
				statusIds: Array.isArray(limit.statusIds) ? limit.statusIds : [],
			}));
			updates["system.limits"] = limits;
			changed = true;
		}

		const legacyTags =
			typeof source.tags === "string" ? source.tags.trim() : "";
		if (legacyTags) {
			const escaped = foundry.utils.escapeHTML(legacyTags);
			updates["system.note"] =
				`${source.note || ""}<div class="litm--challenge-legacy-tags">${escaped}</div>`;
			updates["system.-=tags"] = null;
			changed = true;
		} else if (Object.hasOwn(source, "tags")) {
			updates["system.-=tags"] = null;
			changed = true;
		}

		if (changed)
			await actor.update(updates, { validate: false, render: false });
		const namespaceChanges =
			await WorldMigrations.#migrateLegacyEffectNamespace(actor);
		const normalized = await WorldMigrations.#normalizeEffectTypes(actor);
		return {
			changed: changed || namespaceChanges > 0 || normalized > 0,
			effects: namespaceChanges + normalized,
		};
	}

	static async #migrateLegacyEffectNamespace(actor) {
		const updates = [];
		const deletions = [];
		const replacements = new Map();
		const current = new Map(
			actor.effects
				.filter((effect) => effect.flags?.[SYSTEM_ID]?.type)
				.map((effect) => [
					`${effect.flags[SYSTEM_ID].type}|${effect.name}`,
					effect,
				]),
		);
		for (const effect of actor.effects) {
			const legacy = effect.flags?.litm;
			if (!legacy) continue;
			const existing = effect.flags?.[SYSTEM_ID];
			const inferredType =
				legacy.type ??
				(Array.isArray(legacy.values) || legacy.value !== undefined
					? "status"
					: "tag");
			const key = `${inferredType}|${effect.name}`;
			if (!existing?.type && current.has(key)) {
				deletions.push(effect.id);
				replacements.set(effect.id, current.get(key).id);
				continue;
			}
			const flags = existing?.type
				? existing
				: {
						type: inferredType,
						values: legacy.values ?? Array(6).fill(null),
						value: legacy.value ?? "",
						isScratched: legacy.isScratched ?? false,
						isHindering: legacy.isHindering ?? false,
						isCrispy: legacy.isCrispy ?? false,
						isPrivate: legacy.isPrivate ?? false,
					};
			updates.push({
				_id: effect.id,
				[`flags.${SYSTEM_ID}`]: flags,
				"flags.-=litm": null,
			});
			current.set(`${flags.type}|${effect.name}`, effect);
		}
		if (updates.length) {
			await actor.updateEmbeddedDocuments("ActiveEffect", updates, {
				render: false,
			});
		}
		if (deletions.length) {
			await actor.deleteEmbeddedDocuments("ActiveEffect", deletions, {
				render: false,
			});
		}
		if (actor.type === "challenge" && replacements.size) {
			const limits = foundry.utils.deepClone(
				actor.toObject().system.limits ?? [],
			);
			let changed = false;
			for (const limit of limits) {
				const statusIds = (limit.statusIds ?? []).map(
					(id) => replacements.get(id) ?? id,
				);
				if (JSON.stringify(statusIds) === JSON.stringify(limit.statusIds ?? []))
					continue;
				limit.statusIds = [...new Set(statusIds)];
				changed = true;
			}
			if (changed)
				await actor.update(
					{ "system.limits": limits },
					{ validate: false, render: false },
				);
		}
		return updates.length + deletions.length;
	}

	static async #normalizeEffectTypes(actor) {
		const updates = [];
		for (const effect of actor.effects) {
			const flags = effect.flags?.[SYSTEM_ID];
			if (!flags || flags.type) continue;
			const isStatus = Array.isArray(flags.values) || flags.value !== undefined;
			updates.push({
				_id: effect.id,
				[`flags.${SYSTEM_ID}.type`]: isStatus ? "status" : "tag",
			});
		}
		if (updates.length) {
			await actor.updateEmbeddedDocuments("ActiveEffect", updates, {
				render: false,
			});
		}
		return updates.length;
	}

	static async #migrateFellowshipMembers() {
		const updates = [];
		for (const item of game.items.filter(
			(entry) => entry.type === "fellowship",
		)) {
			if (item.system.members?.length) continue;
			const members = game.actors
				.filter(
					(actor) =>
						actor.type === "character" && actor.system.fellowshipId === item.id,
				)
				.map((actor) => ({ actorId: actor.id, name: actor.name }));
			if (members.length)
				updates.push({ _id: item.id, "system.members": members });
		}
		if (updates.length)
			await CONFIG.Item.documentClass.updateDocuments(updates, {
				render: false,
			});
		return updates.length;
	}

	static async #migrateDefaultItemIcons() {
		const makeUpdate = (item) => {
			const replacement = getLegacyDefaultItemIconReplacement(item);
			if (!replacement) return null;
			return { _id: item.id, img: replacement };
		};

		const worldUpdates = game.items.contents.map(makeUpdate).filter(Boolean);
		if (worldUpdates.length) {
			await CONFIG.Item.documentClass.updateDocuments(worldUpdates, {
				render: false,
			});
		}

		let embeddedUpdates = 0;
		for (const actor of game.actors.contents) {
			const updates = actor.items.contents.map(makeUpdate).filter(Boolean);
			if (!updates.length) continue;
			await actor.updateEmbeddedDocuments("Item", updates, { render: false });
			embeddedUpdates += updates.length;
		}

		if (worldUpdates.length || embeddedUpdates) ui.items?.render();
		return worldUpdates.length + embeddedUpdates;
	}

	static async #persistCurrentReferenceHandbook() {
		const current = ReferenceHandbook.getStore();
		const stored = game.settings.get(SYSTEM_ID, "referenceHandbook") || {};
		if (JSON.stringify(current) !== JSON.stringify(stored)) {
			await game.settings.set(SYSTEM_ID, "referenceHandbook", current);
		}
	}

	static async #removeObsoleteMigrationFlags() {
		for (const actor of game.actors.filter(
			(entry) => entry.type === "character",
		)) {
			const flags = actor.flags?.[SYSTEM_ID] ?? {};
			const updates = {};
			for (const key of [
				"migratedToCharacter",
				"effectsMigrated",
				"heroMigratedToRoot",
			]) {
				if (Object.hasOwn(flags, key))
					updates[`flags.${SYSTEM_ID}.-=${key}`] = null;
			}
			if (Object.keys(updates).length)
				await actor.update(updates, { render: false });
		}
		const storyItems = [
			...game.items.filter((item) => item.type === "story"),
			...game.actors.contents.flatMap((actor) =>
				actor.items.filter((item) => item.type === "story"),
			),
		];
		for (const item of storyItems) {
			if (item.flags?.[SYSTEM_ID]?.storyThemeCardMigrated === undefined)
				continue;
			await item.update(
				{ [`flags.${SYSTEM_ID}.-=storyThemeCardMigrated`]: null },
				{ render: false },
			);
		}
	}
}
