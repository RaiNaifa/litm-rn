import assert from "node:assert/strict";
import { test } from "node:test";
import { getActiveRoteTagIdsForActor } from "../scripts/item/rote/rote-links.js";

test("active Rote tags include the character and embedded Story Themes", () => {
	let flagReads = 0;
	const rote = (ownerUuid, tagId, isActive = true) => ({
		type: "rote",
		system: { isActive },
		getFlag(scope, key) {
			assert.equal(scope, "litm-rn");
			assert.equal(key, "roteLink");
			flagReads += 1;
			return { ownerUuid, tagId };
		},
	});
	const actor = {
		uuid: "Actor.hero",
		items: [
			{ type: "story", uuid: "Actor.hero.Item.story" },
			{ type: "threat", uuid: "Actor.hero.Item.threat" },
			rote("Actor.hero", "character-tag"),
			rote("Actor.hero.Item.story", "story-tag"),
			rote("Actor.other", "foreign-tag"),
			rote("Actor.hero", "inactive-tag", false),
		],
	};

	assert.deepEqual([...getActiveRoteTagIdsForActor(actor)].sort(), [
		"character-tag",
		"story-tag",
	]);
	assert.equal(flagReads, 3);
});
