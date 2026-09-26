import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.foundry = {
	applications: { api: { DialogV2: class {} } },
	dice: { Roll: class {} },
	utils: { fromUuidSync: () => null },
};
globalThis.Hooks = { callAll: () => {} };

const scratched = [];
const deleted = [];
const actor = {
	id: "actor",
	uuid: "Actor.actor",
	effects: new Map(),
	items: [],
	system: { themes: [], backpackTags: [] },
	sheet: {
		async toggleScratchTag(tag, options) {
			scratched.push({ id: tag.id, type: tag.type, options });
		},
	},
};
globalThis.game = {
	user: { id: "gm", isGM: true },
	actors: { get: (id) => (id === actor.id ? actor : null) },
	settings: { get: () => ({ tags: [] }) },
	litm: {
		getAcceptedSharedTag: () => null,
		removeTagFromAllRolls: () => {},
		gmRemoveTagFromAllRolls: () => {},
	},
};

const { LitmRoll } = await import("../scripts/apps/roll.js");

test("burning a theme tag scratches its source instead of deleting the mirrored effect", async () => {
	actor.system.themes = [
		{
			themeTag: { id: "theme-tag" },
			powerTags: [{ id: "power-tag" }],
		},
	];
	actor.effects.set("power-tag", {
		flags: { "litm-rn": { ownerType: "theme" } },
		delete: async () => deleted.push("power-tag"),
	});
	const report = await LitmRoll.postRollProcessing({
		litm: {
			actorId: actor.id,
			rollId: "burn-theme-power",
			burntTags: [{ id: "power-tag", type: "tag", _ref: actor.uuid }],
		},
	});
	assert.deepEqual(report, { processed: 1, failed: 0 });
	assert.deepEqual(scratched, [
		{
			id: "power-tag",
			type: "powerTag",
			options: { scratched: true },
		},
	]);
	assert.deepEqual(deleted, []);
});

test("burning a generic ActiveEffect still removes it", async () => {
	actor.effects.set("temporary-tag", {
		flags: { "litm-rn": { type: "tag" } },
		delete: async () => deleted.push("temporary-tag"),
	});
	const report = await LitmRoll.postRollProcessing({
		litm: {
			actorId: actor.id,
			rollId: "burn-generic-tag",
			burntTags: [{ id: "temporary-tag", type: "tag", _ref: actor.uuid }],
		},
	});
	assert.deepEqual(report, { processed: 1, failed: 0 });
	assert.deepEqual(deleted, ["temporary-tag"]);
});

test("burning an embedded Story Theme tag scratches the item source", async () => {
	actor.items = [
		{
			type: "story",
			system: {
				themeTag: { id: "story-title" },
				powerTags: [{ id: "story-power" }],
			},
		},
	];
	actor.effects.set("story-title", {
		flags: { "litm-rn": { ownerType: "story" } },
		delete: async () => deleted.push("story-title"),
	});
	const report = await LitmRoll.postRollProcessing({
		litm: {
			actorId: actor.id,
			rollId: "burn-story-title",
			burntTags: [{ id: "story-title", type: "tag", _ref: actor.uuid }],
		},
	});
	assert.deepEqual(report, { processed: 1, failed: 0 });
	assert.deepEqual(scratched.at(-1), {
		id: "story-title",
		type: "themeTag",
		options: { scratched: true },
	});
	assert.deepEqual(deleted, ["temporary-tag"]);
});
