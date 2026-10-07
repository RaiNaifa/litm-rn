import {
	KeyedCollectionField,
	collectionKey,
	decodeCollectionData,
	inferCollectionSnapshot,
	nestedSchema,
	trackCollection,
} from "../data/keyed-collections.js";

function plain(value) {
	return value?.toObject instanceof Function ? value.toObject() : value;
}

function equal(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function serialize(field, rawValue) {
	const value = plain(rawValue);
	if (field instanceof KeyedCollectionField) {
		const result = field._cast(value);
		for (const entry of Object.values(result)) {
			entry.value = serialize(field.collectionElement, entry.value);
		}
		return result;
	}
	const schema = nestedSchema(field);
	if (!schema || !value || typeof value !== "object")
		return foundry.utils.deepClone(value);
	const result = {};
	for (const [name, child] of Object.entries(value)) {
		result[name] = schema.fields[name]
			? serialize(schema.fields[name], child)
			: foundry.utils.deepClone(child);
	}
	return result;
}

function diffValue(field, before, rawNext, path, updates) {
	const next = plain(rawNext);
	if (field instanceof KeyedCollectionField && Array.isArray(next)) {
		if (!inferCollectionSnapshot(next)) {
			const used = new Set();
			const ids = next.map((value) => {
				const match = Object.entries(before ?? {}).find(
					([key, entry]) =>
						!used.has(key) && !entry.deleted && equal(entry.value, value),
				);
				if (match) used.add(match[0]);
				return (
					value?.id ??
					value?.actorId ??
					match?.[1].id ??
					foundry.utils.randomID()
				);
			});
			trackCollection(next, before ?? {}, ids);
		}
		diffCollection(field, next, path, updates, before);
		return;
	}
	const schema = nestedSchema(field);
	if (schema && before && next && typeof next === "object") {
		for (const [name, value] of Object.entries(next)) {
			const child = schema.fields[name];
			if (child)
				diffValue(child, before[name], value, `${path}.${name}`, updates);
			else if (!equal(before[name], value))
				updates[`${path}.${name}`] = foundry.utils.deepClone(value);
		}
		return;
	}
	const serialized = serialize(field, next);
	if (!equal(before, serialized)) updates[path] = serialized;
}

function diffCollection(field, next, path, updates, current = {}) {
	const snapshot = inferCollectionSnapshot(next);
	if (!snapshot && Object.keys(current ?? {}).length) {
		throw new Error(
			`LITM | Collection update ${path} has no original snapshot. Use a collection snapshot before editing.`,
		);
	}
	const before = snapshot?.source ?? {};
	const keyed = field._cast(next);
	const originalOrder = Object.values(before)
		.filter((entry) => !entry.deleted)
		.sort((left, right) => left.order - right.order)
		.map((entry) => entry.id);
	const remainingOrder = Object.values(keyed)
		.map((entry) => entry.id)
		.filter((id) => originalOrder.includes(id));
	const nextOrder = Object.values(keyed).map((entry) => entry.id);
	const reordered =
		!equal(
			remainingOrder,
			originalOrder.filter((id) => remainingOrder.includes(id)),
		) ||
		nextOrder.some(
			(id, index) =>
				!originalOrder.includes(id) &&
				nextOrder
					.slice(index + 1)
					.some((nextId) => originalOrder.includes(nextId)),
		);
	let lastOrder = Math.max(
		-1,
		...Object.values(before).map((entry) => Number(entry.order ?? 0)),
	);
	for (const [key, entry] of Object.entries(keyed)) {
		const previous = before[key];
		if (!previous || previous.deleted) {
			if (!reordered) entry.order = ++lastOrder;
			entry.value = serialize(field.collectionElement, entry.value);
			updates[`${path}.${key}`] = entry;
			continue;
		}
		if (reordered && entry.order !== previous.order)
			updates[`${path}.${key}.order`] = entry.order;
		diffValue(
			field.collectionElement,
			previous.value,
			entry.value,
			`${path}.${key}.value`,
			updates,
		);
	}
	for (const key of Object.keys(before)) {
		if (!(key in keyed) && !before[key].deleted)
			updates[`${path}.${key}.deleted`] = true;
	}
}

function rewriteNode(field, value, path, updates, current) {
	if (field instanceof KeyedCollectionField && Array.isArray(value)) {
		diffCollection(field, value, path, updates, current);
		return;
	}
	if (
		field instanceof KeyedCollectionField &&
		value &&
		typeof value === "object" &&
		Object.keys(value).every((key) => /^\d+$/.test(key))
	) {
		const entries = Object.entries(current ?? {})
			.filter(([, entry]) => !entry.deleted)
			.sort(([, left], [, right]) => left.order - right.order);
		for (const [index, record] of Object.entries(value)) {
			const entry = entries[Number(index)];
			if (!entry)
				throw new Error(
					`LITM | Missing collection record for ${path}.${index}`,
				);
			diffValue(
				field.collectionElement,
				entry[1].value,
				record,
				`${path}.${entry[0]}.value`,
				updates,
			);
		}
		return;
	}
	const schema = nestedSchema(field);
	if (schema && value && typeof value === "object" && !Array.isArray(value)) {
		for (const [name, child] of Object.entries(value)) {
			const childField = schema.fields[name];
			if (childField)
				rewriteNode(
					childField,
					child,
					`${path}.${name}`,
					updates,
					current?.[name],
				);
			else updates[`${path}.${name}`] = child;
		}
		return;
	}
	updates[path] = value;
}

/** Resolve a public collection index to its persistent record address. */
export function resolveKeyedPath(document, path) {
	const parts = path.split(".");
	if (parts.shift() !== "system") return null;
	let field = document.system.constructor.schema;
	let current = document._source.system;
	const resolved = ["system"];
	let collection = false;
	for (let index = 0; index < parts.length; index++) {
		let name = parts[index];
		if (field instanceof KeyedCollectionField) {
			collection = true;
			if (/^\d+$/.test(name)) {
				const ordered = Object.entries(current ?? {})
					.filter(([, entry]) => !entry.deleted)
					.sort(([, left], [, right]) => left.order - right.order);
				const entry = ordered[Number(name)];
				if (!entry)
					throw new Error(`LITM | Missing collection record for ${path}`);
				name = entry[0];
				resolved.push(name, "value");
				current = entry[1].value;
				field = field.collectionElement;
				continue;
			}
			// Already-addressed source updates pass through unchanged.
			return { field: null, path, current: null, collection };
		}
		const schema = nestedSchema(field);
		field = schema?.fields[name];
		current = current?.[name];
		resolved.push(name);
		if (!field)
			return {
				field: null,
				path: resolved.concat(parts.slice(index + 1)).join("."),
				current,
				collection,
			};
	}
	return { field, path: resolved.join("."), current, collection };
}

/** Translate legacy collection edits into updates to only changed IDs and fields. */
export function prepareKeyedDocumentUpdate(document, changes, options = {}) {
	if (options.litmCollectionMigration || !document.system?.constructor?.schema)
		return changes;
	const updates = {};
	for (const [path, value] of Object.entries(changes)) {
		const resolved = resolveKeyedPath(document, path);
		if (!resolved?.field) updates[resolved?.path ?? path] = value;
		else
			rewriteNode(
				resolved.field,
				value,
				resolved.path,
				updates,
				resolved.current,
			);
	}
	return updates;
}

function KeyedDocumentMixin(Base) {
	return class extends Base {
		/** Persist keyed storage immediately for new documents and legacy imports. */
		async _preCreate(data, options, user) {
			const allowed = await super._preCreate(data, options, user);
			if (allowed === false) return false;
			const source = migrateDocumentSource(
				this._source,
				this.constructor.documentName,
			);
			this.updateSource({
				system: source.system,
				"flags.litm-rn.keyedCollectionsVersion": 1,
			});
			if (source.items) {
				this.updateSource({
					items: source.items.map((item) => ({
						...item,
						flags: {
							...item.flags,
							"litm-rn": {
								...item.flags?.["litm-rn"],
								keyedCollectionsVersion: 1,
							},
						},
					})),
				});
			}
		}

		/** Return the established public array-shaped system-data API. */
		toObject(source = true) {
			const result = super.toObject(source);
			if (result.system && this.system?.constructor?.schema) {
				result.system = decodeCollectionData(
					this.system.constructor.schema,
					result.system,
				);
			}
			return result;
		}

		/** Translate collection operations before Foundry cleans their payloads. */
		update(changes = {}, options = {}) {
			const updates = prepareKeyedDocumentUpdate(this, changes, options);
			ensureCollectionMigration(this, updates, options);
			return super.update(updates, options);
		}

		/** Handle embedded and bulk updates through the same collection adapter. */
		static updateDocuments(changes = [], options = {}) {
			const translated = changes.map((change) => {
				const document =
					options.parent?.getEmbeddedDocument(this.documentName, change._id) ??
					(options.pack
						? game.packs.get(options.pack)?.get(change._id)
						: game.collections.get(this.documentName)?.get(change._id));
				if (!document) return change;
				const updates = prepareKeyedDocumentUpdate(document, change, options);
				ensureCollectionMigration(document, updates, options);
				return updates;
			});
			return super.updateDocuments(translated, options);
		}
	};
}

function ensureCollectionMigration(document, changes, options) {
	if (
		options.litmCollectionMigration ||
		game.litm?.worldDataMigrationRunning ||
		document.flags?.["litm-rn"]?.keyedCollectionsVersion === 1
	)
		return;
	if (
		!Object.keys(changes).some(
			(path) => resolveKeyedPath(document, path)?.collection,
		)
	)
		return;
	throw new Error(
		`LITM | ${document.uuid ?? document.id} uses legacy collections. Import it into the world before editing its collections.`,
	);
}

/** Register native document subclasses that persist independent collection records. */
export function registerKeyedDocuments() {
	CONFIG.Actor.documentClass = KeyedDocumentMixin(CONFIG.Actor.documentClass);
	CONFIG.Item.documentClass = KeyedDocumentMixin(CONFIG.Item.documentClass);
	Hooks.on("preCreateToken", (token, data) => {
		if (data.actorLink || !data.delta) return;
		const source = migrateTokenSource(data);
		token.updateSource({ delta: source.delta });
	});
	Hooks.on("preCreateScene", (scene, data) => {
		if (data.tokens?.length)
			scene.updateSource({ tokens: data.tokens.map(migrateTokenSource) });
	});
}

/** Convert legacy synthetic-actor data when importing or creating tokens. */
export function migrateTokenSource(source) {
	const result = foundry.utils.deepClone(source);
	if (result.actorLink || !result.delta) return result;
	const type = result.delta.type ?? game.actors?.get(result.actorId)?.type;
	if (!type) return result;
	const delta = migrateDocumentSource({ ...result.delta, type }, "Actor");
	delete delta.type;
	if (source.delta.type) delta.type = source.delta.type;
	delta.flags ??= {};
	delta.flags["litm-rn"] = {
		...delta.flags["litm-rn"],
		keyedCollectionsVersion: 1,
	};
	if (delta.items)
		delta.items = delta.items.map((item) => ({
			...item,
			flags: {
				...item.flags,
				"litm-rn": { ...item.flags?.["litm-rn"], keyedCollectionsVersion: 1 },
			},
		}));
	result.delta = delta;
	return result;
}

/** Convert a legacy document source, including embedded Item sources, idempotently. */
export function migrateDocumentSource(source, documentName = "Actor") {
	const result = foundry.utils.deepClone(source);
	const model = CONFIG[documentName]?.dataModels?.[result.type];
	if (model && result.system)
		result.system = serialize(model.schema, result.system);
	if (documentName === "Actor" && result.items) {
		result.items = result.items.map((item) =>
			migrateDocumentSource(item, "Item"),
		);
	}
	return result;
}
