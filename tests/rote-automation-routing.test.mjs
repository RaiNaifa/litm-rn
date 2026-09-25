import assert from "node:assert/strict";
import { test } from "node:test";

const player = { id: "player", isGM: false, active: true };
const gm = { id: "gm", isGM: true, active: true };
const users = [player, gm];
users.get = (id) => users.find((user) => user.id === id);
users.activeGM = gm;

const runs = [];
const actor = { id: "actor", uuid: "Actor.actor", type: "character" };
const rote = {
	id: "rote",
	name: "Test Rote",
	type: "rote",
	parent: actor,
	uuid: "Actor.actor.Item.rote",
	getFlag: (_scope, key) => {
		if (key === "roteLink") return { tagId: "tag" };
		if (key === "automation")
			return {
				script: "globalThis.__roteRuns.push(game.user.id)",
				macros: ["Macro.test"],
			};
		return null;
	},
};
const sourceMacro = {
	documentName: "Macro",
	name: "Hidden world Macro",
	type: "script",
	command: "globalThis.__roteRuns.push('macro:' + game.user.id)",
	canUserExecute: () => false,
	execute: () => runs.push("source:" + game.user.id),
};
const message = {
	id: "message",
	author: player.id,
	getFlag: (_scope, key) =>
		key === "roteAutomation"
			? {
					rollId: "roll",
					actorId: actor.id,
					roteUuid: rote.uuid,
					tagId: "tag",
					ref: actor.uuid,
				}
			: null,
};

globalThis.__roteRuns = runs;
globalThis.game = {
	user: gm,
	users,
	actors: { get: (id) => (id === actor.id ? actor : null) },
	messages: { get: (id) => (id === message.id ? message : null) },
};
globalThis.fromUuid = async (uuid) =>
	uuid === rote.uuid ? rote : uuid === "Macro.test" ? sourceMacro : null;
globalThis.fromUuidSync = (uuid) => (uuid === rote.uuid ? rote : null);
globalThis.canvas = {
	tokens: {
		controlled: [{ id: "player-token" }],
		get: () => null,
	},
};
globalThis.ChatMessage = { getSpeaker: () => ({ actor: actor.id }) };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 } };
globalThis.CONFIG = {
	Macro: {
		documentClass: class {
			constructor(data) {
				this.data = data;
			}
			canUserExecute() {
				return this.data.ownership.default === 1;
			}
			async execute() {
				await new Function(this.data.command)();
			}
		},
	},
};
globalThis.getDocumentClass = () => CONFIG.Macro.documentClass;

const data = {
	actorId: actor.id,
	roteUuid: rote.uuid,
	roteRef: actor.uuid,
	roteTagId: "tag",
	rollId: "roll",
	initiatorId: player.id,
	messageId: message.id,
};

test("the GM prepares inaccessible code without executing it", async () => {
	const { prepareRoteAutomation } = await import(
		"../scripts/item/rote/rote-automation.js?prepare"
	);
	const { payload, failed } = await prepareRoteAutomation(data);
	assert.equal(failed, 0);
	assert.deepEqual(runs, []);
	assert.equal(payload.script, "globalThis.__roteRuns.push(game.user.id)");
	assert.deepEqual(payload.macros, [
		{
			uuid: "Macro.test",
			name: sourceMacro.name,
			type: sourceMacro.type,
			command: sourceMacro.command,
		},
	]);
	globalThis.__rotePayload = payload;
});

test("the initiating player runs script then Macro locally without source Macro permission", async () => {
	game.user = player;
	const { executeRoteAutomation } = await import(
		"../scripts/item/rote/rote-automation.js?execute"
	);
	const result = await executeRoteAutomation(globalThis.__rotePayload);
	assert.deepEqual(result, { failed: 0 });
	assert.deepEqual(runs, ["player", "macro:player"]);
	assert.equal(sourceMacro.canUserExecute(player), false);
});

test("another client cannot execute the prepared package", async () => {
	game.user = gm;
	const { executeRoteAutomation } = await import(
		"../scripts/item/rote/rote-automation.js?wrong-client"
	);
	await executeRoteAutomation(globalThis.__rotePayload);
	assert.deepEqual(runs, ["player", "macro:player"]);
});

test("a permitted source Macro runs as its original document", async () => {
	game.user = player;
	sourceMacro.canUserExecute = () => true;
	const { executeRoteAutomation } = await import(
		"../scripts/item/rote/rote-automation.js?permitted"
	);
	await executeRoteAutomation({
		...globalThis.__rotePayload,
		script: "",
	});
	assert.equal(runs.at(-1), "source:player");
	sourceMacro.canUserExecute = () => false;
});

test("a relayed script reads the initiator's real canvas selection", async () => {
	game.user = player;
	const { executeRoteAutomation } = await import(
		"../scripts/item/rote/rote-automation.js?canvas"
	);
	await executeRoteAutomation({
		...globalThis.__rotePayload,
		script: "globalThis.__roteRuns.push(canvas.tokens.controlled[0].id)",
		macros: [],
	});
	assert.equal(runs.at(-1), "player-token");
});

test("only the active GM's update of the initiating player's roll can deliver code", async () => {
	const { getApprovedRoteExecution } = await import(
		"../scripts/item/rote/rote-automation.js?approval"
	);
	const payload = globalThis.__rotePayload;
	const changes = { flags: { "litm-rn": { roteExecution: payload } } };
	const pending = { messageId: message.id, roteUuid: rote.uuid };
	assert.equal(
		getApprovedRoteExecution(message, changes, gm.id, gm.id, player.id, pending),
		payload,
	);
	assert.equal(
		getApprovedRoteExecution(message, changes, player.id, gm.id, player.id, pending),
		null,
	);
	assert.equal(
		getApprovedRoteExecution(
			message,
			changes,
			gm.id,
			gm.id,
			"other-player",
			pending,
		),
		null,
	);
	assert.equal(
		getApprovedRoteExecution(message, changes, gm.id, gm.id, player.id, null),
		null,
	);
	assert.equal(
		getApprovedRoteExecution(
			message,
			{ flags: { "litm-rn": { tagShare: { status: "accepted" } } } },
			gm.id,
			gm.id,
			player.id,
			pending,
		),
		null,
	);
});
