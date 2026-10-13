import assert from "node:assert/strict";
import { test } from "node:test";
import { requestBackgroundRender } from "../scripts/apps/background-render.js";

test("background updates merge parts, retain stacking and do not reopen closed windows", async () => {
	const frames = [];
	globalThis.requestAnimationFrame = (callback) => frames.push(callback);
	const writes = [];
	const app = {
		rendered: true,
		async render(options) {
			writes.push(options);
		},
	};
	const first = requestBackgroundRender(app, { parts: ["hero"] });
	assert.equal(requestBackgroundRender(app, { parts: ["effects"] }), first);
	assert.equal(frames.length, 1);
	await frames.shift()();
	await first;
	assert.deepEqual(writes[0].parts, ["hero", "effects"]);
	assert.equal(writes[0].force, false);
	const closing = requestBackgroundRender(app);
	app.rendered = false;
	await frames.shift()();
	await closing;
	assert.equal(writes.length, 1);
	await requestBackgroundRender(app);
	assert.equal(frames.length, 0);
});

test("updates during an asynchronous render trigger one follow-up, and errors allow retry", async () => {
	const frames = [];
	globalThis.requestAnimationFrame = (callback) => frames.push(callback);
	let release;
	let count = 0;
	const app = {
		rendered: true,
		async render() {
			count++;
			if (count === 1)
				await new Promise((resolve) => {
					release = resolve;
				});
		},
	};
	const first = requestBackgroundRender(app);
	const running = frames.shift()();
	requestBackgroundRender(app);
	requestBackgroundRender(app);
	release();
	await running;
	await first;
	assert.equal(count, 2);
	app.render = async () => {
		throw new Error("render failed");
	};
	const failed = requestBackgroundRender(app);
	const rejection = assert.rejects(failed, /render failed/);
	await frames.shift()();
	await rejection;
	app.render = async () => {
		count++;
	};
	const retry = requestBackgroundRender(app);
	await frames.shift()();
	await retry;
	assert.equal(count, 3);
});
