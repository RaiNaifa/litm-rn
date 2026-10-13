import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { requestBackgroundRender } from "../scripts/apps/background-render.js";

test("roll and manager refreshes preserve window order; explicit opening and approval raise dialogs", async () => {
	globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
	globalThis.ui = {};
	const hookCallbacks = new Map();
	globalThis.Hooks = {
		on: (name, callback) => {
			hookCallbacks.set(name, callback);
			return name;
		},
	};
	globalThis.game = {
		user: { isGM: false },
		litm: {},
		tooltip: { deactivate() {} },
	};
	let front = 10;
	class Base {
		constructor(actorId = "hero") {
			this.actorId = actorId;
			this.rendered = true;
			this.element = null;
			this.camp = null;
			this.z = 1;
			this.calls = [];
		}
		async render(options) {
			this.calls.push(options);
			if (options.force) {
				this.rendered = true;
				this.z = ++front;
			}
			return this;
		}
	}
	const rollSource = await readFile(
		new URL("../scripts/apps/roll-dialog.js", import.meta.url),
		"utf8",
	);
	const render = rollSource.slice(
		rollSource.indexOf("\tasync render("),
		rollSource.indexOf("\n\t/** Open the GM roll dialog"),
	);
	const hooks = rollSource.slice(
		rollSource.indexOf("\t#registerUpdateHooks()"),
		rollSource.indexOf("\n\tasync close("),
	);
	const receive = rollSource.slice(
		rollSource.indexOf("\tstatic receiveRemoteUpdate("),
		rollSource.indexOf("\n\tget title()"),
	);
	const Dialog = new Function(
		"Base",
		"requestBackgroundRender",
		`return class LitmRollDialog extends Base {static #instances=new Set(); ${render} ${hooks} ${receive} receiveUpdate(data){this.received=data;} }`,
	)(Base, requestBackgroundRender);
	const dialog = new Dialog();
	await dialog.render({ force: true });
	const z = dialog.z;
	const promises = [dialog.render(), dialog.render(), dialog.render()];
	await Promise.all(promises);
	assert.equal(dialog.z, z);
	assert.equal(dialog.calls.length, 2);
	hookCallbacks.get("litmStoryTagsUpdated")();
	hookCallbacks.get("litmRollSelectionUpdated")();
	hookCallbacks.get("litmRoteRollUpdated")();
	await dialog.render();
	assert.equal(dialog.calls.length, 3);
	assert.equal(dialog.z, z);
	assert.equal(
		Dialog.receiveRemoteUpdate({ actorId: "hero" }, { foreground: true }),
		1,
	);
	assert.ok(dialog.z > z);
	game.user.isGM = true;
	const gmDialog = new Dialog();
	await gmDialog.render({ force: true });
	game.litm.gmRollDialog = gmDialog;
	const playerDialogCalls = dialog.calls.length;
	assert.equal(
		Dialog.receiveRemoteUpdate({ actorId: "hero" }, { foreground: true }),
		1,
	);
	assert.equal(dialog.calls.length, playerDialogCalls);
	assert.equal(
		Dialog.receiveRemoteUpdate({ actorId: "other" }, { foreground: true }),
		0,
	);
	const managerSource = await readFile(
		new URL("../scripts/apps/tag-manager.js", import.meta.url),
		"utf8",
	);
	const managerRender = managerSource.slice(
		managerSource.indexOf("\tasync render("),
		managerSource.indexOf("\n\t/**\n\t * Reconcile"),
	);
	const Manager = new Function(
		"Base",
		"requestBackgroundRender",
		`return class TagManager extends Base {#_syncing=false; ${managerRender} }`,
	)(Base, requestBackgroundRender);
	const sidebar = new Manager();
	ui.combat = sidebar;
	const popout = new Manager();
	game.litm._tmPopOut = popout;
	await Promise.all([sidebar.render(), popout.render()]);
	assert.equal(sidebar.z, 1);
	assert.equal(popout.z, 1);
	assert.equal(sidebar.calls.length, 1);
	assert.equal(popout.calls.length, 1);
});
