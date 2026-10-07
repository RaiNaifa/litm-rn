const snapshots = new WeakMap();
const recordSnapshots = new WeakMap();
const fields = foundry.data.fields;

/** Encode an arbitrary record ID as a safe dotted document-update segment. */
export function collectionKey(id) {
	return `r${Array.from(String(id), (char) => char.codePointAt(0).toString(16)).join("_")}`;
}

function clone(value) {
	return cloneCollection(value);
}

/** Clone DataModels and nested collections without discarding their edit snapshots. */
export function cloneCollection(value) {
	if (value?.toObject instanceof Function)
		return cloneCollection(value.toObject());
	if (Array.isArray(value)) return value.map(cloneCollection);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [key, cloneCollection(child)]),
	);
}

function identity(value) {
	if (!value || typeof value !== "object") return null;
	return value.id || value.actorId || value.themeSpecialId || null;
}

function entriesInOrder(value) {
	return Object.entries(value ?? {})
		.filter(([, entry]) => !entry.deleted)
		.sort(
			([leftKey, left], [rightKey, right]) =>
				Number(left.order ?? 0) - Number(right.order ?? 0) ||
				leftKey.localeCompare(rightKey),
		);
}

/** Return the immutable source snapshot associated with a collection editor. */
export function collectionSnapshot(value) {
	return snapshots.get(value) ?? null;
}

function rememberRecords(array, snapshot) {
	for (let index = 0; index < array.length; index++) {
		const value = array[index];
		if (value && typeof value === "object") {
			recordSnapshots.set(value, { snapshot, id: snapshot.ids[index] });
		}
	}
}

/**
 * Keep the editor's original collection alongside copies and filtered arrays.
 * Foundry's deepClone uses Array.map, so normal system cloning preserves it.
 */
export function trackCollection(array, source, ids) {
	const snapshot = { source, ids: [...ids] };
	snapshots.set(array, snapshot);
	rememberRecords(array, snapshot);
	const track = (result, resultIds) =>
		trackCollection(result, source, resultIds);
	Object.defineProperties(array, {
		map: {
			configurable: true,
			value(callback, thisArg) {
				return track(
					Array.prototype.map.call(this, callback, thisArg),
					snapshots.get(this).ids,
				);
			},
		},
		filter: {
			configurable: true,
			value(callback, thisArg) {
				const result = [];
				const resultIds = [];
				const current = snapshots.get(this);
				for (let index = 0; index < this.length; index++) {
					if (callback.call(thisArg, this[index], index, this)) {
						result.push(this[index]);
						resultIds.push(current.ids[index]);
					}
				}
				return track(result, resultIds);
			},
		},
		slice: {
			configurable: true,
			value(start, end) {
				return track(
					Array.prototype.slice.call(this, start, end),
					snapshots.get(this).ids.slice(start, end),
				);
			},
		},
		concat: {
			configurable: true,
			value(...values) {
				const result = Array.prototype.concat.call(this, ...values);
				const resultIds = [...snapshots.get(this).ids];
				for (const value of values) {
					for (const record of Array.isArray(value) ? value : [value]) {
						resultIds.push(
							recordSnapshots.get(record)?.id ??
								identity(record) ??
								foundry.utils.randomID(),
						);
					}
				}
				return track(result, resultIds);
			},
		},
		push: {
			configurable: true,
			value(...values) {
				snapshots
					.get(this)
					.ids.push(
						...values.map(
							(value) => identity(value) ?? foundry.utils.randomID(),
						),
					);
				return Array.prototype.push.apply(this, values);
			},
		},
		unshift: {
			configurable: true,
			value(...values) {
				snapshots
					.get(this)
					.ids.unshift(
						...values.map(
							(value) => identity(value) ?? foundry.utils.randomID(),
						),
					);
				return Array.prototype.unshift.apply(this, values);
			},
		},
		pop: {
			configurable: true,
			value() {
				snapshots.get(this).ids.pop();
				return Array.prototype.pop.call(this);
			},
		},
		shift: {
			configurable: true,
			value() {
				snapshots.get(this).ids.shift();
				return Array.prototype.shift.call(this);
			},
		},
		splice: {
			configurable: true,
			value(...args) {
				const nextArgs = [...args];
				for (let index = 2; index < nextArgs.length; index++) {
					nextArgs[index] =
						identity(nextArgs[index]) ?? foundry.utils.randomID();
				}
				const removedIds = Array.prototype.splice.apply(
					snapshots.get(this).ids,
					nextArgs,
				);
				return track(Array.prototype.splice.apply(this, args), removedIds);
			},
		},
		reverse: {
			configurable: true,
			value() {
				snapshots.get(this).ids.reverse();
				return Array.prototype.reverse.call(this);
			},
		},
		sort: {
			configurable: true,
			value(compare) {
				const current = snapshots.get(this);
				const pairs = Array.from(this, (value, index) => ({
					value,
					id: current.ids[index],
				}));
				pairs.sort((left, right) =>
					compare
						? compare(left.value, right.value)
						: String(left.value).localeCompare(String(right.value)),
				);
				for (let index = 0; index < pairs.length; index++) {
					this[index] = pairs[index].value;
					current.ids[index] = pairs[index].id;
				}
				return this;
			},
		},
	});
	return array;
}

/** Recover provenance from records retained by an array spread operation. */
export function inferCollectionSnapshot(array) {
	const direct = snapshots.get(array);
	if (direct) return direct;
	const record = array.find(
		(value) => value && typeof value === "object" && recordSnapshots.has(value),
	);
	const original = record ? recordSnapshots.get(record).snapshot : null;
	if (!original) return null;
	return {
		source: original.source,
		ids: array.map(
			(value) =>
				recordSnapshots.get(value)?.id ??
				identity(value) ??
				foundry.utils.randomID(),
		),
	};
}

/** Store records independently while exposing the existing array read API. */
export class KeyedCollectionField extends fields.TypedObjectField {
	constructor(element, options = {}, context = {}) {
		const initial = options.initial;
		super(
			new fields.SchemaField({
				id: new fields.StringField({ required: true }),
				order: new fields.NumberField({ initial: 0 }),
				deleted: new fields.BooleanField({ initial: false }),
				value: element,
			}),
			{ ...options, initial: undefined },
			context,
		);
		this.collectionElement = element;
		this.collectionInitial = initial;
	}

	/** Initialize legacy defaults as keyed records. */
	getInitialValue(data) {
		const initial =
			typeof this.collectionInitial === "function"
				? this.collectionInitial(data)
				: (this.collectionInitial ?? []);
		return this._cast(initial);
	}

	/** Accept legacy array data when loading old worlds and imports. */
	_cast(value) {
		if (!Array.isArray(value)) return super._cast(value);
		const snapshot = inferCollectionSnapshot(value);
		const result = {};
		for (let index = 0; index < value.length; index++) {
			let id =
				identity(value[index]) ??
				snapshot?.ids[index] ??
				foundry.utils.randomID();
			if (result[collectionKey(id)]) id = foundry.utils.randomID();
			const record = clone(value[index]);
			if (nestedSchema(this.collectionElement)?.fields.id && !record.id)
				record.id = id;
			result[collectionKey(id)] = {
				id,
				order: index,
				deleted: false,
				value: record,
			};
		}
		return result;
	}

	/** Prepare real embedded DataModels in an array without changing saved storage. */
	initialize(value, model, options = {}) {
		const entries = entriesInOrder(value);
		const result = entries.map(([, entry]) =>
			this.collectionElement.initialize(entry.value, model, options),
		);
		return trackCollection(
			result,
			foundry.utils.deepClone(value ?? {}),
			entries.map(([, entry]) => entry.id),
		);
	}

	/** Serialize an initialized array back into its keyed source representation. */
	toObject(value) {
		if (!Array.isArray(value)) return super.toObject(value);
		return this._cast(value);
	}
}

/** Return a schema's element field, including EmbeddedDataField model schemas. */
export function nestedSchema(field) {
	return field?.fields
		? field
		: (field?.model?.schema ?? field?.model?.constructor?.schema ?? null);
}

/** Decode keyed source values into compatible arrays with original snapshots. */
export function decodeCollectionData(schema, value) {
	if (!value || typeof value !== "object") return value;
	if (schema instanceof KeyedCollectionField) {
		if (Array.isArray(value)) return value;
		const entries = entriesInOrder(value);
		return trackCollection(
			entries.map(([, entry]) =>
				decodeCollectionData(schema.collectionElement, clone(entry.value)),
			),
			foundry.utils.deepClone(value),
			entries.map(([, entry]) => entry.id),
		);
	}
	const childSchema = nestedSchema(schema);
	if (!childSchema) return value;
	for (const [name, field] of Object.entries(childSchema.fields)) {
		if (value[name] !== undefined)
			value[name] = decodeCollectionData(field, value[name]);
	}
	return value;
}

/** Keep DataModel.toObject consumers compatible with the existing array contract. */
export function KeyedDataModelMixin(Base) {
	return class extends Base {
		/** Return an editable snapshot using the public array collection API. */
		toObject(source = true) {
			return decodeCollectionData(
				this.constructor.schema,
				super.toObject(source),
			);
		}
	};
}
