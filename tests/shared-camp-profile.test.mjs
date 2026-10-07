import assert from "node:assert/strict";
import { test } from "node:test";

class TestApplication {
	async _prepareContext() {
		return {};
	}
	_onRender() {}
	render() {}
}

const clone = (value) => structuredClone(value);
const handlers = new Map();
const settings = new Map();
const writes = [];
let confirmation = async () => true;
globalThis.foundry = {
	data: { fields: { TypedObjectField: class {} } },
	applications: {
		api: {
			ApplicationV2: TestApplication,
			DialogV2: { confirm: (...args) => confirmation(...args) },
			HandlebarsApplicationMixin: (base) => base,
		},
		ux: { TextEditor: { implementation: {} } },
	},
	utils: {
		deepClone: clone,
		randomID: () => "generated-id",
		fromUuid: async () => null,
		fromUuidSync: () => null,
		getProperty: (object, path) =>
			path.split(".").reduce((value, key) => value?.[key], object),
		setProperty: (object, path, value) => {
			const keys = path.split(".");
			const last = keys.pop();
			let target = object;
			for (const key of keys) target = target[key] ??= {};
			target[last] = value;
		},
	},
};
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
const gm = { id: "gm", isGM: true };
const player = {
	id: "player",
	isGM: false,
	character: { id: "hero-a", system: { fellowshipId: "group-a" } },
};
const users = [gm, player];
users.get = (id) => users.find((user) => user.id === id);
users.activeGM = gm;
globalThis.game = {
	ready: true,
	user: gm,
	users,
	i18n: { localize: (key) => key, format: (key) => key },
	actors: new Map(),
	settings: {
		get() {
			throw new Error("Migrated runtime must read shared storage");
		},
		set() {
			throw new Error("Migrated runtime must write shared storage");
		},
	},
	socket: { emit() {}, on() {} },
};

const { SharedStorage } = await import("../scripts/system/shared-storage.js");
SharedStorage.isMigrated = () => true;
SharedStorage.readSetting = (key) => clone(settings.get(key));
SharedStorage.updateSetting = async (key, next, before) => {
	writes.push({ key, next: clone(next), before: clone(before) });
};
const { Sockets } = await import("../scripts/system/sockets.js");
Sockets.on = (event, callback) => handlers.set(event, callback);
Sockets.dispatch = () => {};
const { CampDialog } = await import("../scripts/apps/camp-dialog.js");
const { StoryProfileSettings } = await import(
	"../scripts/apps/story-profile-settings.js"
);

function profileApp(action, id = "other", name = "Renamed") {
	const listeners = new Map();
	const button = {
		dataset: { profileId: id },
		addEventListener: (_event, callback) => listeners.set(action, callback),
	};
	const app = new StoryProfileSettings();
	app.element = {
		querySelector: (selector) =>
			selector === '[data-action="create-profile"]' ? null : { value: name },
		querySelectorAll: (selector) =>
			selector === `[data-action="${action}"]` ? [button] : [],
	};
	app._onRender({}, {});
	return {
		app,
		run: () =>
			listeners.get(action)({ preventDefault() {}, currentTarget: button }),
	};
}

function profiles() {
	return {
		version: 1,
		activeId: "main",
		profiles: [
			{
				id: "main",
				name: "Main",
				data: { tags: [{ id: "one", name: "One" }] },
			},
			{
				id: "other",
				name: "Other",
				data: { tags: [{ id: "two", name: "Two" }] },
			},
		],
	};
}

test("activating a migrated Story profile changes only its active pointer", async () => {
	settings.set("storyProfiles", profiles());
	writes.length = 0;
	await profileApp("activate-profile").run();
	assert.equal(writes.length, 1);
	assert.equal(writes[0].key, "storyProfiles");
	assert.equal(writes[0].next.activeId, "other");
	assert.deepEqual(writes[0].next.profiles, writes[0].before.profiles);
	await StoryProfileSettings.syncActiveProfile({ tags: [] });
	assert.equal(writes.length, 1);
});

test("renaming a Story profile keeps its contents outside the mutation", async () => {
	settings.set("storyProfiles", profiles());
	writes.length = 0;
	await profileApp("rename-profile").run();
	assert.equal(writes[0].next.profiles[1].name, "Renamed");
	assert.deepEqual(
		writes[0].next.profiles[1].data,
		writes[0].before.profiles[1].data,
	);
	assert.deepEqual(writes[0].next.profiles[0], writes[0].before.profiles[0]);
	const app = new StoryProfileSettings();
	assert.equal((await app._prepareContext({})).profiles[0].active, true);
});

test("a profile activated during delete confirmation cannot be deleted", async () => {
	settings.set("storyProfiles", profiles());
	writes.length = 0;
	confirmation = async () => {
		settings.get("storyProfiles").activeId = "other";
		return true;
	};
	await profileApp("delete-profile").run();
	assert.equal(writes.length, 0);
	confirmation = async () => true;
});

test("Camp save keeps the pre-operation baseline across an awaited actor update", async () => {
	const session = {
		id: "session-a",
		fellowshipId: "group-a",
		state: "active",
		phase: "activity",
		phaseIndex: 1,
		duration: "camp",
		heroes: {
			"hero-a": {
				activities: [{ type: "reflect", themeId: "theme", submitted: false }],
			},
			"hero-b": { quality: { relationshipName: "Before" } },
		},
	};
	settings.set("campSessions", {
		version: 1,
		active: { "group-a": session, "group-b": { id: "session-b" } },
	});
	game.actors.set("hero-a", {
		system: { themes: [{ id: "theme", name: "Theme", improve: 0 }] },
		async update() {
			// Another client edits an unrelated hero while reflection is saving.
			settings.get("campSessions").active["group-a"].heroes[
				"hero-b"
			].quality.relationshipName = "Remote";
		},
	});
	writes.length = 0;
	CampDialog.register();
	handlers.get("campMutation")({
		data: {
			fellowshipId: "group-a",
			mutation: { type: "submitActivity", actorId: "hero-a", index: 0 },
		},
		senderId: "player",
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(writes.length, 1);
	const { before, next } = writes[0];
	assert.deepEqual(Object.keys(next.active), ["group-a"]);
	assert.deepEqual(Object.keys(before.active), ["group-a"]);
	assert.equal(
		before.active["group-a"].heroes["hero-a"].activities[0].submitted,
		false,
	);
	assert.equal(
		next.active["group-a"].heroes["hero-a"].activities[0].submitted,
		true,
	);
	assert.deepEqual(
		next.active["group-a"].heroes["hero-b"],
		before.active["group-a"].heroes["hero-b"],
	);
	assert.equal(
		settings.get("campSessions").active["group-a"].heroes["hero-b"].quality
			.relationshipName,
		"Remote",
	);
});
