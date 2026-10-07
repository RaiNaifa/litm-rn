import assert from "node:assert/strict";
import { test } from "node:test";
import {
	SharedStorage,
	applyUpdate,
	buildSharedUpdates,
	decodeShared,
	encodeShared,
	sharedRecordKey,
} from "../scripts/system/shared-storage.js";

const clone = (value) => structuredClone(value);

function applyPatch(target, patch) {
	for (const [path, value] of Object.entries(patch))
		applyUpdate(target, path, value);
}

function concurrent(before, operations, reverse = false) {
	const server = { data: encodeShared(before) };
	const patches = operations.map((next) =>
		buildSharedUpdates(before, next, "data"),
	);
	for (const patch of reverse ? patches.toReversed() : patches)
		applyPatch(server, patch);
	return decodeShared(server.data);
}

function fakeWorld({ story, profiles, camp, sceneTags = [] } = {}) {
	const settings = new Map([
		["sharedDataDocument", ""],
		["storytags", clone(story ?? { tags: [], actors: [], helpingTags: [] })],
		[
			"storyProfiles",
			clone(profiles ?? { version: 1, activeId: "", profiles: [] }),
		],
		["campSessions", clone(camp ?? { version: 1, active: {} })],
	]);
	const journal = [];
	journal.get = (id) => journal.find((document) => document.id === id);
	const documentWrites = [];
	const sceneWrites = [];
	const scene = {
		id: "scene",
		flags: { "litm-rn": { scenetags: { tags: clone(sceneTags), actors: [] } } },
		getFlag: (scope, key) => scene.flags[scope]?.[key],
		async update(updates) {
			sceneWrites.push(clone(updates));
			applyPatch(scene, updates);
		},
	};
	globalThis.game = {
		user: { id: "gm", isGM: true },
		journal,
		scenes: [scene],
		i18n: { localize: (key) => key },
		settings: {
			get: (_scope, key) => clone(settings.get(key)),
			async set(_scope, key, value) {
				settings.set(key, clone(value));
			},
		},
	};
	globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
	globalThis.CONFIG = {
		JournalEntry: {
			documentClass: {
				async create(data) {
					const document = {
						id: `document-${journal.length}`,
						...clone(data),
						async update(updates) {
							documentWrites.push(clone(updates));
							applyPatch(document, updates);
						},
					};
					journal.push(document);
					return document;
				},
			},
		},
	};
	return { settings, journal, scene, documentWrites, sceneWrites };
}

test("concurrent additions and renames of distinct tags survive in either server order", () => {
	const before = {
		tags: [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		],
	};
	const first = { tags: [...before.tags, { id: "c", name: "C" }] };
	const second = {
		tags: [
			{ id: "a", name: "A" },
			{ id: "b", name: "B edited" },
		],
	};
	const third = { tags: [...before.tags, { id: "d", name: "D" }] };
	for (const reverse of [false, true]) {
		const result = concurrent(before, [first, second, third], reverse);
		assert.deepEqual(
			new Set(result.tags.map((tag) => tag.id)),
			new Set(["a", "b", "c", "d"]),
		);
		assert.equal(result.tags.find((tag) => tag.id === "b").name, "B edited");
	}
});

test("deleting one tag preserves a simultaneous rename and addition elsewhere", () => {
	const before = {
		tags: [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		],
	};
	const remove = { tags: [before.tags[1]] };
	const edit = {
		tags: [
			before.tags[0],
			{ id: "b", name: "B edited" },
			{ id: "c", name: "C" },
		],
	};
	for (const reverse of [false, true]) {
		const result = concurrent(before, [remove, edit], reverse);
		assert.deepEqual(
			new Set(result.tags.map((tag) => tag.id)),
			new Set(["b", "c"]),
		);
		assert.equal(result.tags.find((tag) => tag.id === "b").name, "B edited");
	}
});

test("a deleted tag stays deleted when an earlier rename arrives afterwards", () => {
	const before = { tags: [{ id: "a", name: "A" }] };
	const result = concurrent(before, [
		{ tags: [] },
		{ tags: [{ id: "a", name: "Late" }] },
	]);
	assert.deepEqual(result.tags, []);
});

test("fixed status slots merge independently while preserving tag metadata", () => {
	const before = {
		tags: [
			{
				id: "a",
				name: "A",
				isPrivate: true,
				values: [false, false, false, false, false, false],
			},
		],
	};
	const first = clone(before);
	const second = clone(before);
	first.tags[0].values[1] = 2;
	second.tags[0].values[4] = 5;
	second.tags[0].name = "Changed";
	const result = concurrent(before, [first, second]);
	assert.deepEqual(result.tags[0].values, [false, 2, false, false, 5, false]);
	assert.equal(result.tags[0].isPrivate, true);
	assert.equal(result.tags[0].name, "Changed");
});

test("Camp fixed activity slots and separate hero decisions merge independently", () => {
	const before = {
		active: {
			group: {
				heroes: {
					a: { activities: [{ type: "rest" }, { type: "" }, { type: "" }] },
					b: { quality: { type: "relationship", submitted: false } },
				},
			},
		},
	};
	const first = clone(before);
	const second = clone(before);
	first.active.group.heroes.a.activities[1].type = "reflect";
	second.active.group.heroes.a.activities[2].type = "camp-action";
	second.active.group.heroes.b.quality.submitted = true;
	const result = concurrent(before, [first, second]);
	assert.equal(result.active.group.heroes.a.activities[1].type, "reflect");
	assert.equal(result.active.group.heroes.a.activities[2].type, "camp-action");
	assert.equal(result.active.group.heroes.b.quality.submitted, true);
});

test("membership deletions and additions address values rather than old indices", () => {
	const before = {
		actors: ["Actor.a", "Actor.b"],
		thirdRequestedBy: ["hero-a"],
	};
	const first = { actors: ["Actor.b"], thirdRequestedBy: ["hero-a", "hero-b"] };
	const second = {
		actors: ["Actor.a", "Actor.b", "Actor.c"],
		thirdRequestedBy: ["hero-a", "hero-c"],
	};
	const result = concurrent(before, [first, second]);
	assert.deepEqual(new Set(result.actors), new Set(["Actor.b", "Actor.c"]));
	assert.deepEqual(
		new Set(result.thirdRequestedBy),
		new Set(["hero-a", "hero-b", "hero-c"]),
	);
});

test("record keys safely encode UUIDs, unicode names and Foundry deletion syntax", () => {
	for (const id of ["Actor.a.Item.b", "-=name", "тег.☺", "🚀"]) {
		assert.match(sharedRecordKey(id), /^k[0-9a-f]+$/);
	}
});

test("a partial Camp update cannot delete a session belonging to another Fellowship", async () => {
	const camp = {
		version: 1,
		active: { a: { id: "a", phase: "setup" }, b: { id: "b", phase: "setup" } },
	};
	fakeWorld({ camp });
	await SharedStorage.migrate();
	await SharedStorage.updateSetting(
		"campSessions",
		{ version: 1, active: { a: { id: "a", phase: "activity" } } },
		{ version: 1, active: { a: camp.active.a } },
	);
	assert.deepEqual(
		SharedStorage.readSetting("campSessions").active.b,
		camp.active.b,
	);
	assert.equal(
		SharedStorage.readSetting("campSessions").active.a.phase,
		"activity",
	);
});

test("Story and Camp migration is idempotent and preserves edits after first run", async () => {
	const story = {
		tags: [
			{ id: "tag", name: "Fresh", isPrivate: true, values: [false, 2, false] },
		],
		actors: ["Actor.hero"],
		helpingTags: [],
	};
	const profiles = {
		version: 1,
		activeId: "main",
		profiles: [
			{
				id: "main",
				name: "Main",
				data: { tags: [{ id: "tag", name: "Stale" }] },
			},
			{
				id: "other",
				name: "Other",
				data: { tags: [{ id: "other-tag", name: "Other" }] },
			},
		],
	};
	const camp = {
		version: 1,
		active: {
			group: {
				id: "camp",
				campsite: { tags: [{ id: "site", name: "Fire" }] },
				heroes: {
					hero: {
						activities: [{ type: "rest" }, { type: "reflect" }, { type: "" }],
					},
				},
			},
		},
	};
	const world = fakeWorld({
		story,
		profiles,
		camp,
		sceneTags: [{ id: "scene-tag", name: "Rain" }],
	});
	await SharedStorage.migrate();
	assert.deepEqual(SharedStorage.readStoryConfig(), story);
	assert.deepEqual(SharedStorage.readSetting("campSessions"), camp);
	assert.deepEqual(
		SharedStorage.readSetting("storyProfiles").profiles[1],
		profiles.profiles[1],
	);
	const before = SharedStorage.readStoryConfig();
	await SharedStorage.updateStoryConfig(
		{ tags: [{ ...before.tags[0], name: "Edited" }] },
		before,
	);
	await SharedStorage.migrate();
	assert.equal(world.journal.length, 1);
	assert.equal(world.sceneWrites.length, 1);
	assert.equal(SharedStorage.readStoryConfig().tags[0].name, "Edited");
	assert.deepEqual(world.settings.get("storytags"), story);
	assert.deepEqual(world.settings.get("campSessions"), camp);
	assert.deepEqual(
		world.journal[0].flags["litm-rn"].sharedDataBackup.storyProfiles,
		profiles,
	);
});

test("an old world without profiles receives one main profile without losing tags", async () => {
	const story = {
		tags: [{ id: "tag", name: "Story" }],
		actors: [],
		helpingTags: [],
	};
	fakeWorld({ story });
	await SharedStorage.migrate();
	const store = SharedStorage.readSetting("storyProfiles");
	assert.equal(store.activeId, "main");
	assert.equal(store.profiles.length, 1);
	assert.deepEqual(store.profiles[0].data, story);
});

test("append after concurrent deletions retains the persisted ordering", async () => {
	const tags = ["a", "b", "c"].map((id) => ({ id, name: id }));
	const world = fakeWorld({ story: { tags }, sceneTags: tags });
	await SharedStorage.migrate();
	for (const scene of [null, world.scene]) {
		const read = () =>
			scene
				? SharedStorage.readSceneConfig(scene)
				: SharedStorage.readStoryConfig();
		const save = (patch, before) =>
			scene
				? SharedStorage.updateSceneConfig(scene, patch, before)
				: SharedStorage.updateStoryConfig(patch, before);
		const before = read();
		await save({ tags: before.tags.filter((tag) => tag.id !== "a") }, before);
		await save({ tags: before.tags.filter((tag) => tag.id !== "b") }, before);
		const current = read();
		await save({ tags: [...current.tags, { id: "d", name: "d" }] }, current);
		assert.deepEqual(
			read().tags.map((tag) => tag.id),
			["c", "d"],
		);
		const reordered = read();
		await save(
			{ tags: [{ id: "e", name: "e" }, ...reordered.tags] },
			reordered,
		);
		assert.deepEqual(
			read().tags.map((tag) => tag.id),
			["e", "c", "d"],
		);
	}
});

test("a resumed migration reuses an already-created document after settings failure", async () => {
	const world = fakeWorld();
	const set = game.settings.set;
	let fail = true;
	game.settings.set = async (...args) => {
		if (fail) {
			fail = false;
			throw new Error("connection lost");
		}
		return set(...args);
	};
	await assert.rejects(SharedStorage.migrate(), /connection lost/);
	assert.equal(world.journal.length, 1);
	await SharedStorage.migrate();
	assert.equal(world.journal.length, 1);
	assert.equal(world.settings.get("sharedDataDocument"), world.journal[0].id);
});

test("Story edit retains its source profile when the active pointer changes during editing", async () => {
	const story = { tags: [{ id: "a", name: "A" }], actors: [], helpingTags: [] };
	const profiles = {
		version: 1,
		activeId: "main",
		profiles: [
			{ id: "main", name: "Main", data: story },
			{
				id: "other",
				name: "Other",
				data: { tags: [{ id: "b", name: "B" }], actors: [], helpingTags: [] },
			},
		],
	};
	fakeWorld({ story, profiles });
	await SharedStorage.migrate();
	const before = SharedStorage.readStoryConfig();
	const store = SharedStorage.readSetting("storyProfiles");
	await SharedStorage.updateSetting(
		"storyProfiles",
		{ ...store, activeId: "other" },
		store,
	);
	await SharedStorage.updateStoryConfig(
		{ tags: [{ id: "a", name: "A edited" }] },
		before,
	);
	const result = SharedStorage.readSetting("storyProfiles");
	assert.equal(result.profiles[0].data.tags[0].name, "A edited");
	assert.deepEqual(result.profiles[1].data.tags, [{ id: "b", name: "B" }]);
});

test("socket snapshots carry their profile identity explicitly across serialization", async () => {
	const story = { tags: [{ id: "a", name: "A" }], actors: [], helpingTags: [] };
	const profiles = {
		version: 1,
		activeId: "main",
		profiles: [
			{ id: "main", name: "Main", data: story },
			{
				id: "other",
				name: "Other",
				data: { tags: [], actors: [], helpingTags: [] },
			},
		],
	};
	fakeWorld({ story, profiles });
	await SharedStorage.migrate();
	const message = clone({
		profileId: SharedStorage.getActiveProfileId(),
		before: SharedStorage.readStoryConfig(),
	});
	const store = SharedStorage.readSetting("storyProfiles");
	await SharedStorage.updateSetting(
		"storyProfiles",
		{ ...store, activeId: "other" },
		store,
	);
	await SharedStorage.updateStoryConfig(
		{ tags: [{ id: "a", name: "A edited" }] },
		message.before,
		{ profileId: message.profileId },
	);
	assert.equal(SharedStorage.readStoryConfig("main").tags[0].name, "A edited");
	assert.deepEqual(SharedStorage.readStoryConfig().tags, []);
});

test("an edit to a deleted profile is rejected rather than routed to its replacement", async () => {
	const story = { tags: [{ id: "a", name: "A" }], actors: [], helpingTags: [] };
	const profiles = {
		version: 1,
		activeId: "main",
		profiles: [
			{ id: "main", name: "Main", data: story },
			{
				id: "other",
				name: "Other",
				data: { tags: [], actors: [], helpingTags: [] },
			},
		],
	};
	fakeWorld({ story, profiles });
	await SharedStorage.migrate();
	const before = SharedStorage.readStoryConfig();
	const store = SharedStorage.readSetting("storyProfiles");
	await SharedStorage.updateSetting(
		"storyProfiles",
		{
			...store,
			activeId: "other",
			profiles: store.profiles.filter((profile) => profile.id !== "main"),
		},
		store,
	);
	await assert.rejects(
		SharedStorage.updateStoryConfig(
			{ tags: [{ id: "a", name: "A edited" }] },
			before,
		),
		/deleted/,
	);
	assert.deepEqual(SharedStorage.readStoryConfig().tags, []);
});

test("cancelling a Camp session wins over a late patch captured before cancellation", async () => {
	const session = {
		id: "camp",
		state: "active",
		heroes: { hero: { preparationReady: false } },
	};
	fakeWorld({ camp: { version: 1, active: { group: session } } });
	await SharedStorage.migrate();
	const before = { version: 1, active: { group: session } };
	await SharedStorage.updateSetting(
		"campSessions",
		{ version: 1, active: {} },
		before,
	);
	const late = clone(before);
	late.active.group.heroes.hero.preparationReady = true;
	await SharedStorage.updateSetting("campSessions", late, before);
	assert.deepEqual(SharedStorage.readSetting("campSessions").active, {});
});

test("an old Camp patch cannot modify a new session for the same Fellowship", async () => {
	const oldSession = {
		id: "old-camp",
		state: "active",
		heroes: { hero: { preparationReady: false } },
	};
	fakeWorld({ camp: { version: 1, active: { group: oldSession } } });
	await SharedStorage.migrate();
	const before = { version: 1, active: { group: oldSession } };
	await SharedStorage.updateSetting(
		"campSessions",
		{ version: 1, active: {} },
		before,
	);
	const newSession = { ...clone(oldSession), id: "new-camp" };
	await SharedStorage.updateSetting(
		"campSessions",
		{ version: 1, active: { group: newSession } },
		{ version: 1, active: {} },
	);
	const late = clone(before);
	late.active.group.heroes.hero.preparationReady = true;
	await SharedStorage.updateSetting("campSessions", late, before);
	assert.deepEqual(
		SharedStorage.readSetting("campSessions").active.group,
		newSession,
	);
});
