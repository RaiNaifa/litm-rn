import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const clone = (value) => structuredClone(value);
class Field {
	_cast(value) {
		return value;
	}
	initialize(value) {
		return value;
	}
}
class SchemaField extends Field {
	constructor(fields) {
		super();
		this.fields = fields;
	}
}
class TypedObjectField extends Field {}
globalThis.foundry = {
	data: {
		fields: {
			TypedObjectField,
			SchemaField,
			StringField: Field,
			NumberField: Field,
			BooleanField: Field,
		},
	},
	utils: {
		deepClone: clone,
		randomID: (() => {
			let id = 0;
			return () => `generated-${++id}`;
		})(),
		escapeHTML: (value) => String(value),
	},
};
const { KeyedCollectionField, decodeCollectionData, collectionKey } =
	await import("../scripts/data/keyed-collections.js");
const { migrateDocumentSource } = await import(
	"../scripts/system/keyed-documents.js"
);
const { applyUpdate } = await import("../scripts/system/shared-storage.js");
const tagField = new SchemaField({ id: new Field(), name: new Field() });
const themeField = new SchemaField({
	id: new Field(),
	name: new Field(),
	powerTags: new KeyedCollectionField(tagField),
});
const characterSchema = new SchemaField({
	themes: new KeyedCollectionField(themeField),
	backpackTags: new KeyedCollectionField(tagField),
	relationships: new KeyedCollectionField(tagField),
});
const storySchema = new SchemaField({
	powerTags: new KeyedCollectionField(tagField),
});
const fellowshipSchema = new SchemaField({
	powerTags: new KeyedCollectionField(tagField),
	members: new KeyedCollectionField(
		new SchemaField({ actorId: new Field(), name: new Field() }),
	),
});

function collection(values = []) {
	values.contents = values;
	values.get = (id) => values.find((entry) => entry.id === id);
	values.has = (id) => Boolean(values.get(id));
	return values;
}

const events = [];
class FakeDocument {
	constructor(id, type, system = {}, documentName = "Actor", flags = {}) {
		this.id = id;
		this.name = id;
		this.uuid = `${documentName}.${id}`;
		this.type = type;
		this.documentName = documentName;
		this._source = {
			_id: id,
			type,
			system: clone(system),
			flags: clone(flags),
		};
		this.items = collection();
		this.effects = collection();
		this.writes = [];
		this.inheritedFlags = null;
	}
	get schema() {
		return CONFIG[this.documentName].dataModels[this.type]?.schema;
	}
	get system() {
		return decodeCollectionData(this.schema, clone(this._source.system));
	}
	get flags() {
		return {
			"litm-rn": { ...this.inheritedFlags, ...this._source.flags?.["litm-rn"] },
		};
	}
	toObject() {
		return { ...clone(this._source), system: this.system };
	}
	async update(updates, options = {}) {
		if (this.fail) throw new Error("document write failed");
		events.push(`write:${this.id}`);
		this.writes.push({ updates: clone(updates), options: clone(options) });
		for (const [path, value] of Object.entries(updates))
			applyUpdate(this._source, path, value);
		if (this.isToken && this.token?.delta) {
			this.token.delta._source.flags = clone(this._source.flags);
		} else if (this.parent?.isToken && this.parent.token?.delta) {
			this.parent.token.delta._source.items ??= [];
			const deltaItems = this.parent.token.delta._source.items;
			const source = deltaItems.find((item) => item._id === this.id);
			if (source) source.flags = clone(this._source.flags);
			else deltaItems.push({ _id: this.id, flags: clone(this._source.flags) });
		}
	}
	async createEmbeddedDocuments(_type, data) {
		for (const source of data)
			this.effects.push({ ...clone(source), id: source._id });
	}
	async deleteEmbeddedDocuments(_type, ids) {
		this.effects = collection(
			this.effects.filter((effect) => !ids.includes(effect.id)),
		);
	}
	async updateEmbeddedDocuments(_type, updates) {
		for (const update of updates) {
			const effect = this.effects.get(update._id);
			for (const [path, value] of Object.entries(update))
				if (path !== "_id") applyUpdate(effect, path, value);
		}
	}
}

function world(
	version,
	{ actors = [], items = [], scenes = [], packs = [] } = {},
) {
	events.length = 0;
	const settings = new Map([
		["dataSchemaVersion", version],
		["storytags", { tags: [], actors: [], helpingTags: [] }],
		["storyProfiles", { version: 1, activeId: "", profiles: [] }],
		["referenceHandbook", {}],
	]);
	globalThis.game = {
		user: { id: "gm", isGM: true },
		actors: collection(actors),
		items: collection(items),
		scenes: collection(scenes),
		packs,
		i18n: { localize: (key) => key },
		settings: {
			get: (_scope, key) => clone(settings.get(key)),
			async set(_scope, key, value) {
				events.push(`setting:${key}:${value}`);
				settings.set(key, clone(value));
			},
		},
	};
	globalThis.CONFIG = {
		Actor: { dataModels: { character: { schema: characterSchema } } },
		Item: {
			dataModels: {
				story: { schema: storySchema },
				fellowship: { schema: fellowshipSchema },
			},
			documentClass: {
				async updateDocuments(updates) {
					for (const update of updates)
						await game.items.get(update._id).update(update);
				},
			},
		},
	};
	globalThis.ui = { notifications: { info() {} }, items: { render() {} } };
	return settings;
}

// Exercise the production runner and source serializer while replacing unrelated
// application/bootstrap services that require a running Foundry browser.
globalThis.__migrationServices = {
	ReferenceHandbook: {
		getStore: () => game.settings.get("litm-rn", "referenceHandbook"),
	},
	StoryProfileSettings: {
		async migrate() {
			events.push("legacy-profiles");
		},
	},
	error() {},
	info() {},
	getLegacyDefaultItemIconReplacement: () => null,
	migrateDocumentSource,
	LegacyItemMigration: {
		async archiveAndRemoveItems() {
			events.push("legacy-archive");
		},
	},
	SharedStorage: {
		async migrate() {
			events.push("shared-storage");
		},
	},
	ThemeAdvancement: {
		normalizeImproveTracks() {},
		promiseProgress: () => ({ promise: 0, availableFulfillments: 1 }),
	},
	ThemeSources: {
		async migrateCharacterThemes() {
			events.push("legacy-theme-sources");
		},
	},
};
const migrationSource = await readFile(
	new URL("../scripts/system/migrations.js", import.meta.url),
	"utf8",
);
const source = migrationSource.replace(/^import[\s\S]*?;\r?\n/gm, "");
const bindings = `const { ${Object.keys(__migrationServices).join(", ")} } = globalThis.__migrationServices;\n`;
const { WorldMigrations } = await import(
	`data:text/javascript;base64,${Buffer.from(bindings + source).toString("base64")}`
);

test("schema 0 and 1 worlds run earlier migrations before the keyed storage checkpoint", async () => {
	for (const version of [0, 1]) {
		const actor = new FakeDocument("hero", "character", {
			themes: [],
			backpackTags: [],
			promise: 0,
		});
		const settings = world(version, { actors: [actor] });
		await WorldMigrations.run();
		assert.equal(settings.get("dataSchemaVersion"), 3);
		assert.ok(
			events.indexOf("shared-storage") <
				events.indexOf("setting:dataSchemaVersion:3"),
		);
		if (version === 0) {
			assert.ok(
				events.indexOf("legacy-profiles") < events.indexOf("shared-storage"),
			);
			assert.ok(
				events.indexOf("setting:dataSchemaVersion:1") <
					events.indexOf("setting:dataSchemaVersion:2"),
			);
		} else assert.ok(!events.includes("legacy-profiles"));
		assert.ok(
			events.indexOf("setting:dataSchemaVersion:2") <
				events.indexOf("shared-storage"),
		);
		const count = actor.writes.length;
		await WorldMigrations.run();
		assert.equal(actor.writes.length, count);
	}
});

test("schema 2 migration persists world and embedded collections with public backups", async () => {
	const actor = new FakeDocument("hero", "character", {
		themes: [
			{
				id: "theme",
				name: "Theme",
				powerTags: [{ id: "power", name: "Strong" }],
			},
		],
		backpackTags: [],
	});
	const embedded = new FakeDocument(
		"story",
		"story",
		{ powerTags: [{ id: "story-tag", name: "Story" }] },
		"Item",
	);
	embedded.parent = actor;
	actor.items.push(embedded);
	const fellowship = new FakeDocument(
		"group",
		"fellowship",
		{ powerTags: [{ id: "fellow-tag", name: "Together" }], members: [] },
		"Item",
	);
	const settings = world(2, { actors: [actor], items: [fellowship] });
	const before = actor.toObject().system;
	await WorldMigrations.run();
	assert.equal(settings.get("dataSchemaVersion"), 3);
	assert.equal(Array.isArray(actor._source.system.themes), false);
	assert.equal(
		actor._source.system.themes[collectionKey("theme")].value.powerTags[
			collectionKey("power")
		].value.name,
		"Strong",
	);
	assert.deepEqual(actor.flags["litm-rn"].keyedCollectionsBackup, before);
	assert.equal(
		embedded._source.system.powerTags[collectionKey("story-tag")].value.name,
		"Story",
	);
	assert.equal(
		fellowship._source.system.powerTags[collectionKey("fellow-tag")].value.name,
		"Together",
	);
	assert.ok(actor.writes[0].options.litmCollectionMigration);
	assert.ok(
		events.indexOf("write:group") <
			events.indexOf("setting:dataSchemaVersion:3"),
	);
});

test("a failed schema 3 document write retains the schema checkpoint and successful backups on retry", async () => {
	const first = new FakeDocument("first", "character", {
		themes: [],
		backpackTags: [{ id: "tag", name: "Original" }],
	});
	const second = new FakeDocument("second", "character", {
		themes: [],
		backpackTags: [],
	});
	second.fail = true;
	const settings = world(2, { actors: [first, second] });
	await assert.rejects(WorldMigrations.run(), /document write failed/);
	assert.equal(settings.get("dataSchemaVersion"), 2);
	const backup = clone(first.flags["litm-rn"].keyedCollectionsBackup);
	first._source.system.backpackTags[collectionKey("tag")].value.name =
		"After migration";
	second.fail = false;
	await WorldMigrations.run();
	assert.equal(settings.get("dataSchemaVersion"), 3);
	assert.equal(first.writes.length, 1);
	assert.deepEqual(first.flags["litm-rn"].keyedCollectionsBackup, backup);
	assert.equal(first.system.backpackTags[0].name, "After migration");
});

test("unlinked synthetic actors and their Items persist despite inherited migration markers", async () => {
	const actor = new FakeDocument(
		"base",
		"character",
		{ themes: [], backpackTags: [] },
		"Actor",
		{ "litm-rn": { keyedCollectionsVersion: 1 } },
	);
	const synthetic = new FakeDocument("token-hero", "character", {
		themes: [],
		backpackTags: [{ id: "variant", name: "Token only" }],
	});
	synthetic.isToken = true;
	synthetic.token = synthetic.parent = { delta: { _source: { flags: {} } } };
	synthetic.inheritedFlags = {
		keyedCollectionsVersion: 1,
		keyedCollectionsBackup: {
			themes: [],
			backpackTags: [{ id: "base", name: "Base actor value" }],
		},
	};
	const embedded = new FakeDocument(
		"variant-story",
		"story",
		{ powerTags: [{ id: "variant-story-tag", name: "Variant" }] },
		"Item",
	);
	embedded.parent = synthetic;
	embedded.inheritedFlags = {
		keyedCollectionsVersion: 1,
		keyedCollectionsBackup: {
			powerTags: [{ id: "base-story", name: "Base story" }],
		},
	};
	synthetic.items.push(embedded);
	const settings = world(2, {
		actors: [actor],
		scenes: [
			{
				tokens: [
					{ actorLink: false, actor: synthetic },
					{ actorLink: true, actor },
				],
			},
		],
	});
	await WorldMigrations.run();
	assert.equal(settings.get("dataSchemaVersion"), 3);
	assert.equal(
		synthetic._source.system.backpackTags[collectionKey("variant")].value.name,
		"Token only",
	);
	assert.equal(
		embedded._source.system.powerTags[collectionKey("variant-story-tag")].value
			.name,
		"Variant",
	);
	assert.deepEqual(
		synthetic._source.flags["litm-rn"].keyedCollectionsBackup.backpackTags,
		[{ id: "variant", name: "Token only" }],
	);
	assert.deepEqual(
		embedded._source.flags["litm-rn"].keyedCollectionsBackup.powerTags,
		[{ id: "variant-story-tag", name: "Variant" }],
	);
	assert.equal(actor.writes.length, 0);
});

test("retrying a partly migrated scene preserves the first synthetic actor backup", async () => {
	const first = new FakeDocument("first-token", "character", {
		themes: [],
		backpackTags: [{ id: "variant", name: "Original token value" }],
	});
	first.isToken = true;
	first.token = first.parent = { delta: { _source: { flags: {} } } };
	const second = new FakeDocument("second-token", "character", {
		themes: [],
		backpackTags: [],
	});
	second.isToken = true;
	second.token = second.parent = { delta: { _source: { flags: {} } } };
	second.fail = true;
	const settings = world(2, {
		scenes: [
			{
				tokens: [
					{ actorLink: false, actor: first },
					{ actorLink: false, actor: second },
				],
			},
		],
	});
	await assert.rejects(WorldMigrations.run(), /document write failed/);
	assert.equal(settings.get("dataSchemaVersion"), 2);
	const backup = clone(first.flags["litm-rn"].keyedCollectionsBackup);
	first._source.system.backpackTags[collectionKey("variant")].value.name =
		"New edit during retry";
	second.fail = false;
	await WorldMigrations.run();
	assert.deepEqual(first.flags["litm-rn"].keyedCollectionsBackup, backup);
	assert.equal(first.system.backpackTags[0].name, "New edit during retry");
	assert.equal(settings.get("dataSchemaVersion"), 3);
});
