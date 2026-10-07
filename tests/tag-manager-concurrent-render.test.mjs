import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

// Browser checks are optional for plain Node installations; use the bundled runtime's
// NODE_PATH and LITM_TEST_BROWSER_EXECUTABLE to run them without project dependencies.
let chromium;
try {
	({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
	/* Browser test dependencies are supplied by the workspace runtime. */
}

const source = (
	await readFile(
		new URL("../scripts/apps/tag-manager.js", import.meta.url),
		"utf8",
	)
)
	.replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "")
	.replace(
		"export class TagManager",
		"globalThis.TagManager = class TagManager",
	);

test(
	"TagManager remote renders retain active editors, cursor positions, and all other updates",
	{ skip: !chromium },
	async () => {
		const browser = await chromium.launch({
			headless: true,
			...(process.env.LITM_TEST_BROWSER_EXECUTABLE
				? { executablePath: process.env.LITM_TEST_BROWSER_EXECUTABLE }
				: {}),
		});
		try {
			const page = await browser.newPage();
			await page.evaluate(() => {
				class Application {
					_onRender() {}
					async render() {
						return this;
					}
					_replaceHTML(result) {
						this.parts.main.replaceWith(result.main);
						this.parts.main = result.main;
					}
				}
				globalThis.foundry = {
					applications: {
						ux: { TextEditor: { implementation: {} } },
						sidebar: { AbstractSidebarTab: Application },
						api: { HandlebarsApplicationMixin: (Base) => Base },
					},
					utils: {},
				};
				globalThis.ui = {};
				globalThis.game = { litm: {}, user: {}, socket: { on() {} } };
				globalThis.Hooks = { on: () => 1 };
				globalThis.SharedStorage = { getActiveProfileId: () => "profile-one" };
				globalThis.canvas = { scene: { id: "scene-one" } };
			});
			await page.addScriptTag({ content: source });
			const results = await page.evaluate(async () => {
				const row = (type, id, ref, name, editable = false) => {
					const scope =
						ref === "story"
							? "profile-one"
							: ref === "scene"
								? "scene-one"
								: ref;
					const item = `<div class="litm--tm-tag-item litm--tm-tag-${type}" data-tag-id="${id}" data-ref="${ref}" data-source-id="${scope}"><div class="litm--tm-tag-name" contenteditable="${editable}" data-id="${id}" data-ref="${ref}">${name}</div></div>`;
					return type === "limit"
						? `<div class="litm--tm-limit-wrapper" data-limit-id="${id}" data-ref="${ref}" data-source-id="${scope}">${item}</div>`
						: item;
				};
				const tree = (html, ref) => {
					const template = document.createElement("template");
					const list = `<div class="litm--tm-tag-list">${html}</div>`;
					const body = ref.startsWith("Actor")
						? `<div class="litm--tm-actor" data-ref="${ref}"><div class="litm--tm-actor-head">Actor</div>${list}</div>`
						: list;
					template.innerHTML = `<div class="litm--tm-content"><div class="litm--tm-column" data-column="tags"><section class="litm--tm-section" data-section="${ref}"><div class="litm--tm-section-body">${body}</div></section></div></div>`;
					return template.content.firstElementChild;
				};
				const checks = [];
				for (const type of ["tag", "status", "might", "limit"]) {
					for (const ref of ["story", "scene", "Actor.test"]) {
						document.body.replaceChildren();
						const manager = new TagManager();
						manager.element = document.body;
						manager.parts = {
							main: tree(
								row(type, "editing", ref, "Initial", true) +
									row("tag", "other", ref, "Other"),
								ref,
							),
						};
						document.body.append(manager.parts.main);
						await manager["edit-tag"](null, null, { ref, id: "editing" });
						const editor = manager.parts.main.querySelector(
							'[data-id="editing"]',
						);
						editor.textContent = "Unsaved typing";
						editor.focus();
						const selection = window.getSelection();
						selection.collapse(editor.firstChild, 6);
						let blurs = 0;
						editor.addEventListener("blur", () => blurs++);
						const next = tree(
							row("status", "new", ref, "Added") +
								row(type, "editing", ref, "Initial", true) +
								row("tag", "other", ref, "Renamed"),
							ref,
						);
						manager._replaceHTML({ main: next }, document.body, {});
						checks.push({
							type,
							ref,
							connected: editor.isConnected,
							sameNode:
								editor ===
								manager.parts.main.querySelector('[data-id="editing"]'),
							focused: document.activeElement === editor,
							text: editor.textContent,
							cursor: selection.anchorOffset,
							blurs,
							added: !!manager.parts.main.querySelector('[data-tag-id="new"]'),
							renamed:
								manager.parts.main.querySelector('[data-id="other"]')
									.textContent,
						});
						// Removal of another row and changes to ordering also leave the editor connected.
						manager._replaceHTML(
							{
								main: tree(
									row(type, "editing", ref, "Initial", true) +
										row("status", "new", ref, "Added"),
									ref,
								),
							},
							document.body,
							{},
						);
						checks.at(-1).retainedAfterReorder =
							editor.isConnected &&
							document.activeElement === editor &&
							blurs === 0;
						// Copied IDs in another profile or scene must never retain the old editor.
						if (ref !== "Actor.test") {
							const switched = tree(
								row(type, "editing", ref, "Copied", true),
								ref,
							);
							for (const node of switched.querySelectorAll("[data-source-id]"))
								node.dataset.sourceId = "different-source";
							manager._replaceHTML({ main: switched }, document.body, {});
							checks.at(-1).sourceChanged =
								!editor.isConnected &&
								manager.parts.main.querySelector('[data-id="editing"]')
									.contentEditable === "false";
						}
						// The edited record itself can be removed remotely without retaining a phantom row.
						manager._replaceHTML(
							{ main: tree(row("status", "new", ref, "Added"), ref) },
							document.body,
							{},
						);
						checks.at(-1).deleted = !editor.isConnected;
					}
				}
				return checks;
			});
			for (const result of results) {
				assert.equal(
					result.connected,
					true,
					`${result.ref} ${result.type} editor disconnected`,
				);
				assert.equal(result.sameNode, true);
				assert.equal(result.focused, true);
				assert.equal(result.text, "Unsaved typing");
				assert.equal(result.cursor, 6);
				assert.equal(result.blurs, 0);
				assert.equal(result.added, true);
				assert.equal(result.renamed, "Renamed");
				assert.equal(result.retainedAfterReorder, true);
				assert.equal(result.deleted, true);
				if (result.ref !== "Actor.test")
					assert.equal(result.sourceChanged, true);
			}
			const saves = await page.evaluate(async () => {
				document.body.replaceChildren();
				const manager = new TagManager();
				manager.element = document.body;
				const markup = (editing) => {
					const node = document.createElement("div");
					node.innerHTML = `<div data-tag-id="tag" data-ref="story" data-source-id="profile-one"><div class="litm--tm-tag-name" contenteditable="${editing}" data-id="tag" data-ref="story">Tag</div></div>`;
					return node;
				};
				manager.parts = { main: markup(false) };
				document.body.append(manager.parts.main);
				let count = 0;
				manager["save-edit-tag"] = () => {
					count++;
				};
				for (let cycle = 0; cycle < 3; cycle++) {
					await manager["edit-tag"](null, null, { ref: "story", id: "tag" });
					manager._replaceHTML({ main: markup(true) }, document.body, {});
					manager._onRender({}, {});
					await new Promise(requestAnimationFrame);
					const editor = manager.parts.main.querySelector(".litm--tm-tag-name");
					editor.blur();
					editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
					manager._replaceHTML({ main: markup(false) }, document.body, {});
				}
				return count;
			});
			assert.equal(
				saves,
				3,
				"reopening a retained editor must not duplicate blur handlers",
			);
		} finally {
			await browser.close();
		}
	},
);
