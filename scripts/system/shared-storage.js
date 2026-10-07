const SYSTEM_ID = "litm-rn";
const STORE_FLAG = "sharedData";
const SCENE_FLAG = "concurrentData";
const COLLECTION = "__litmCollection";
const MAP_COLLECTION = "__litmMapCollection";
const storySnapshots = new WeakMap();
const MEMBERSHIP_ARRAYS = new Set([
	"actors",
	"helpingTags",
	"storyThemeIds",
	"hiddenActors",
	"tokenTagVisibility",
	"fellowshipActorOrder",
	"visitedPhases",
	"thirdRequestedBy",
	"statusIds",
]);

const copy = (value) => structuredClone(value);
const own = (object, key) => Object.hasOwn(object ?? {}, key);

function requireMigratedStore(ready) {
	if (game.ready && !ready && !game.litm?.worldDataMigrationRunning)
		throw new Error(
			"Legend in the Mist: shared data migration must finish before editing.",
		);
}

/** Encode a stable record identity as a safe Foundry update-path component. */
export function sharedRecordKey(identity) {
	return `k${Array.from(String(identity), (char) =>
		char.codePointAt(0).toString(16).padStart(6, "0"),
	).join("")}`;
}

function identityFor(value, index, path) {
	if (value && typeof value === "object") {
		return (
			value.id ?? value._id ?? value.actorId ?? value.ref ?? `slot:${index}`
		);
	}
	return MEMBERSHIP_ARRAYS.has(path.split(".").at(-1))
		? `${typeof value}:${String(value)}`
		: `slot:${index}`;
}

/** Convert array-shaped shared data into independently addressable records. */
export function encodeShared(value, path = "") {
	if (Array.isArray(value)) {
		const entries = {};
		value.forEach((entry, index) => {
			const key = sharedRecordKey(identityFor(entry, index, path));
			if (own(entries, key))
				throw new Error(`Duplicate shared record at ${path}`);
			entries[key] = {
				order: index,
				value: encodeShared(entry, path),
				deleted: false,
			};
		});
		return { [COLLECTION]: true, entries };
	}
	if (value && typeof value === "object") {
		if (path.split(".").at(-1) === "active") {
			return {
				[MAP_COLLECTION]: true,
				entries: Object.fromEntries(
					Object.entries(value).map(([key, entry], index) => [
						sharedRecordKey(`${key}:${entry.id ?? "legacy"}`),
						{
							key,
							order: index,
							value: encodeShared(entry, `${path}.${key}`),
							deleted: false,
						},
					]),
				),
			};
		}
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				encodeShared(entry, path ? `${path}.${key}` : key),
			]),
		);
	}
	return value;
}

/** Decode stored keyed records into the existing array-shaped read API. */
export function decodeShared(value) {
	if (value?.[MAP_COLLECTION]) {
		return Object.fromEntries(
			Object.values(value.entries ?? {})
				.filter((entry) => !entry.deleted)
				.map((entry) => [entry.key, decodeShared(entry.value)]),
		);
	}
	if (value?.[COLLECTION]) {
		return Object.entries(value.entries ?? {})
			.filter(([, entry]) => !entry.deleted)
			.sort(
				([aKey, a], [bKey, b]) => a.order - b.order || aKey.localeCompare(bKey),
			)
			.map(([, entry]) => decodeShared(entry.value));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, decodeShared(entry)]),
		);
	}
	return value;
}

function diff(before, next, path, updates) {
	if (JSON.stringify(before) === JSON.stringify(next)) return;
	if (
		(before?.[COLLECTION] && next?.[COLLECTION]) ||
		(before?.[MAP_COLLECTION] && next?.[MAP_COLLECTION])
	) {
		const oldEntries = before.entries ?? {};
		const newEntries = next.entries ?? {};
		for (const key of new Set([
			...Object.keys(oldEntries),
			...Object.keys(newEntries),
		])) {
			const entryPath = `${path}.entries.${key}`;
			if (!own(newEntries, key)) updates[`${entryPath}.deleted`] = true;
			else if (!own(oldEntries, key))
				updates[entryPath] = copy(newEntries[key]);
			else diff(oldEntries[key], newEntries[key], entryPath, updates);
		}
		return;
	}
	if (
		before &&
		next &&
		typeof before === "object" &&
		typeof next === "object"
	) {
		for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
			if (key.includes(".") || key.startsWith("-="))
				throw new Error(`Unsafe shared key: ${key}`);
			if (!own(next, key)) updates[`${path}.-=${key}`] = null;
			else if (!own(before, key)) updates[`${path}.${key}`] = copy(next[key]);
			else diff(before[key], next[key], `${path}.${key}`, updates);
		}
		return;
	}
	updates[path] = copy(next);
}

/** Build leaf updates from the exact snapshot taken before the user's mutation. */
export function buildSharedUpdates(before, next, path) {
	const updates = {};
	diff(encodeShared(before), encodeShared(next), path, updates);
	return updates;
}

function preserveAppendOrder(document, updates) {
	const lastOrders = new Map();
	for (const [path, value] of Object.entries(updates)) {
		if (!/\.entries\.[^.]+$/.test(path) || !own(value, "order")) continue;
		const parentPath = path.slice(0, path.lastIndexOf("."));
		// Explicit insertion or reordering already carries the required sibling ranks.
		if (
			Object.keys(updates).some(
				(key) => key.startsWith(`${parentPath}.`) && key.endsWith(".order"),
			)
		)
			continue;
		if (!lastOrders.has(parentPath)) {
			const entries = parentPath
				.split(".")
				.reduce((parent, key) => parent?.[key], document);
			lastOrders.set(
				parentPath,
				Math.max(
					-1,
					...Object.values(entries ?? {}).map((entry) => entry.order ?? 0),
				),
			);
		}
		const order = lastOrders.get(parentPath) + 1;
		value.order = order;
		lastOrders.set(parentPath, order);
	}
	return updates;
}

/** Server-backed storage for independently editable shared records. */
export class SharedStorage {
	/** Return the migrated shared-data document, if available. */
	static get document() {
		const id = game.settings.get(SYSTEM_ID, "sharedDataDocument");
		return (
			game.journal?.get(id) ??
			game.journal?.find(
				(entry) => entry.flags?.[SYSTEM_ID]?.[STORE_FLAG]?.version === 1,
			) ??
			null
		);
	}

	/** Whether shared data has completed its storage migration. */
	static isMigrated() {
		return Boolean(
			this.document?.flags?.[SYSTEM_ID]?.[STORE_FLAG]?.version === 1,
		);
	}

	/** Read a shared setting through the existing data shape. */
	static readSetting(key) {
		if (key === "storytags") return this.readStoryConfig();
		const stored = this.document?.flags?.[SYSTEM_ID]?.[STORE_FLAG]?.[key];
		return stored === undefined
			? copy(game.settings.get(SYSTEM_ID, key) ?? {})
			: decodeShared(stored);
	}

	/** Save only fields changed relative to the caller's pre-mutation snapshot. */
	static async updateSetting(key, next, before = this.readSetting(key)) {
		requireMigratedStore(this.isMigrated());
		if (key === "storytags") return this.updateStoryConfig(next, before);
		const document = this.document;
		if (!document) {
			const current = encodeShared(this.readSetting(key));
			const updates = buildSharedUpdates(before, next, "value");
			const merged = { value: current };
			for (const [path, value] of Object.entries(updates))
				applyUpdate(merged, path, value);
			return game.settings.set(SYSTEM_ID, key, decodeShared(merged.value));
		}
		const updates = buildSharedUpdates(
			before,
			next,
			`flags.${SYSTEM_ID}.${STORE_FLAG}.${key}`,
		);
		if (Object.keys(updates).length)
			await document.update(preserveAppendOrder(document, updates));
	}

	/** Read the active Story profile directly, without a mirrored setting snapshot. */
	static getActiveProfileId() {
		const store = this.document?.flags?.[SYSTEM_ID]?.[STORE_FLAG];
		return store?.version === 1 ? store.storyProfiles.activeId : null;
	}

	/** Read a specific profile, or the currently active one. */
	static readStoryConfig(profileId = null) {
		const store = this.document?.flags?.[SYSTEM_ID]?.[STORE_FLAG];
		if (store?.version !== 1)
			return copy(
				game.settings.get(SYSTEM_ID, "storytags") ?? {
					tags: [],
					actors: [],
					helpingTags: [],
				},
			);
		const id = profileId ?? store.storyProfiles.activeId;
		const profile = store.storyProfiles.profiles.entries[sharedRecordKey(id)];
		const result = decodeShared(
			profile && !profile.deleted
				? profile.value.data
				: { tags: [], actors: [], helpingTags: [] },
		);
		storySnapshots.set(result, id);
		return result;
	}

	/** Update independent fields of the active Story profile. */
	static async updateStoryConfig(
		patch,
		before = this.readStoryConfig(),
		{ profileId = null } = {},
	) {
		requireMigratedStore(this.isMigrated());
		if (!this.isMigrated())
			return game.settings.set(SYSTEM_ID, "storytags", { ...before, ...patch });
		const profiles = this.document.flags[SYSTEM_ID][STORE_FLAG].storyProfiles;
		const id = profileId ?? storySnapshots.get(before) ?? profiles.activeId;
		const profile = profiles.profiles.entries[sharedRecordKey(id)];
		if (!profile || profile.deleted)
			throw new Error("Story profile was deleted while editing");
		const path = `flags.${SYSTEM_ID}.${STORE_FLAG}.storyProfiles.profiles.entries.${sharedRecordKey(id)}.value.data`;
		const updates = buildSharedUpdates(before, { ...before, ...patch }, path);
		if (Object.keys(updates).length)
			await this.document.update(preserveAppendOrder(this.document, updates));
	}

	/** Read the scene's shared configuration as arrays. */
	static readSceneConfig(scene = canvas.scene) {
		const stored = scene?.flags?.[SYSTEM_ID]?.[SCENE_FLAG];
		return stored?.version === 1
			? decodeShared(stored.data)
			: copy(
					scene?.getFlag(SYSTEM_ID, "scenetags") ?? { tags: [], actors: [] },
				);
	}

	/** Update only the changed scene records and fields. */
	static async updateSceneConfig(
		scene,
		patch,
		before = this.readSceneConfig(scene),
	) {
		if (!scene) return;
		requireMigratedStore(scene.flags?.[SYSTEM_ID]?.[SCENE_FLAG]?.version === 1);
		if (scene.flags?.[SYSTEM_ID]?.[SCENE_FLAG]?.version !== 1) {
			await scene.update({
				[`flags.${SYSTEM_ID}.${SCENE_FLAG}`]: {
					version: 1,
					data: encodeShared(before),
				},
			});
		}
		const updates = buildSharedUpdates(
			before,
			{ ...before, ...patch },
			`flags.${SYSTEM_ID}.${SCENE_FLAG}.data`,
		);
		if (Object.keys(updates).length)
			await scene.update(preserveAppendOrder(scene, updates));
	}

	/** Migrate world settings and every scene without deleting legacy source data. */
	static async migrate() {
		let document = this.document;
		if (!document) {
			const story = copy(
				game.settings.get(SYSTEM_ID, "storytags") ?? {
					tags: [],
					actors: [],
					helpingTags: [],
				},
			);
			const profiles = copy(
				game.settings.get(SYSTEM_ID, "storyProfiles") ?? {},
			);
			if (!profiles.profiles?.length) {
				profiles.profiles = [
					{
						id: "main",
						name: game.i18n.localize("Litm.settings.main-story-profile"),
						data: story,
					},
				];
				profiles.activeId = "main";
			}
			const active =
				profiles.profiles.find((entry) => entry.id === profiles.activeId) ??
				profiles.profiles[0];
			profiles.activeId = active.id;
			active.data = story;
			const camp = copy(
				game.settings.get(SYSTEM_ID, "campSessions") ?? {
					version: 1,
					active: {},
				},
			);
			document = await CONFIG.JournalEntry.documentClass.create({
				name: "Legend in the Mist — Shared Data",
				ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
				flags: {
					[SYSTEM_ID]: {
						[STORE_FLAG]: {
							version: 1,
							storyProfiles: encodeShared(profiles),
							campSessions: encodeShared(camp),
						},
						sharedDataBackup: {
							storytags: story,
							storyProfiles: copy(
								game.settings.get(SYSTEM_ID, "storyProfiles") ?? {},
							),
							campSessions: camp,
						},
					},
				},
			});
		}
		if (!document) throw new Error("Shared data document was not created");
		await game.settings.set(SYSTEM_ID, "sharedDataDocument", document.id);
		for (const scene of game.scenes) {
			if (scene.flags?.[SYSTEM_ID]?.[SCENE_FLAG]?.version === 1) continue;
			const legacy = copy(
				scene.getFlag(SYSTEM_ID, "scenetags") ?? { tags: [], actors: [] },
			);
			await scene.update(
				{
					[`flags.${SYSTEM_ID}.${SCENE_FLAG}`]: {
						version: 1,
						data: encodeShared(legacy),
					},
				},
				{ render: false },
			);
		}
	}

	/** Register notifications and initialize new scenes in the migrated format. */
	static register() {
		Hooks.on("updateSetting", (setting) => {
			if (
				![
					`${SYSTEM_ID}.sharedDataDocument`,
					`${SYSTEM_ID}.dataSchemaVersion`,
				].includes(setting.key)
			)
				return;
			Hooks.callAll("litmStoryTagsUpdated", { storage: true });
			game.litm?.CampDialog?.refreshAll?.();
		});
		Hooks.on("updateJournalEntry", (document, changes) => {
			if (document.id !== this.document?.id) return;
			const shared = changes.flags?.[SYSTEM_ID]?.[STORE_FLAG];
			const paths = Object.keys(changes);
			if (
				shared?.storyProfiles ||
				paths.some((path) => path.includes(`${STORE_FLAG}.storyProfiles`))
			)
				Hooks.callAll("litmStoryTagsUpdated", { storage: true });
			if (
				shared?.campSessions ||
				paths.some((path) => path.includes(`${STORE_FLAG}.campSessions`))
			)
				game.litm?.CampDialog?.refreshAll?.();
		});
		Hooks.on("preCreateScene", (scene, data) => {
			if (data.flags?.[SYSTEM_ID]?.[SCENE_FLAG]) return;
			scene.updateSource({
				[`flags.${SYSTEM_ID}.${SCENE_FLAG}`]: {
					version: 1,
					data: encodeShared(
						data.flags?.[SYSTEM_ID]?.scenetags ?? { tags: [], actors: [] },
					),
				},
			});
		});
		Hooks.on("updateScene", (scene, changes) => {
			if (!scene.isView) return;
			if (
				changes.flags?.[SYSTEM_ID]?.[SCENE_FLAG] ||
				Object.keys(changes).some((path) => path.includes(SCENE_FLAG))
			)
				Hooks.callAll("litmStoryTagsUpdated", {
					storage: true,
					sceneId: scene.id,
				});
		});
		Hooks.on("renderJournalDirectory", (_app, element) => {
			const id = this.document?.id;
			if (id && element instanceof HTMLElement)
				element.querySelector(`[data-entry-id="${id}"]`)?.remove();
		});
	}
}

/** Apply a Foundry-style update to a plain object (also used by migration tests). */
export function applyUpdate(object, path, value) {
	const parts = path.split(".");
	const key = parts.pop();
	let parent = object;
	for (const part of parts) parent = parent[part] ??= {};
	if (key.startsWith("-=")) delete parent[key.slice(2)];
	else parent[key] = copy(value);
}
