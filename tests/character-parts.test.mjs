import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

let chromium;
try {
	({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {}
const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const stripImports = (source) => source.replace(/^import[\s\S]*?;\r?\n/gm, "");

test(
	"character card updates preserve editors, skip hidden leaves and use Foundry parts",
	{ skip: !chromium },
	async () => {
		const browser = await chromium.launch({
			headless: true,
			executablePath: process.env.LITM_TEST_BROWSER_EXECUTABLE,
		});
		try {
			const templates = {};
			for (const dir of [
				"templates/actor/character-parts",
				"templates/partials",
			])
				for (const file of await readdir(new URL(dir, root)))
					if (file.endsWith(".html"))
						templates[`systems/litm-rn/${dir}/${file}`] = await read(
							`${dir}/${file}`,
						);
			templates["systems/litm-rn/templates/actor/character.html"] = await read(
				"templates/actor/character.html",
			);
			for (const version of [13, 14]) {
				const page = await browser.newPage();
				await page.addStyleTag({
					content: await read("styles/actor/character.css"),
				});
				await page.addScriptTag({
					path: `D:/FoundryVTT/Foundry Virtual Tabletop ${version}/resources/app/node_modules/handlebars/dist/handlebars.js`,
				});
				await page.evaluate((templates) => {
					globalThis.templates = templates;
					for (const [path, source] of Object.entries(templates))
						Handlebars.registerPartial(path, source);
					for (const [name, callback] of Object.entries({
						localize: (key) => key,
						eq: (a, b) => a === b,
						ifThen: (v, a, b) => (v ? a : b),
						includes: (list, id, key) =>
							list?.some((v) => (key ? v[key] === id : v === id)),
						and: (...args) => args.slice(0, -1).every(Boolean),
						or: (...args) => args.slice(0, -1).some(Boolean),
						concat: (...args) => args.slice(0, -1).join(""),
						checked: (v) => (v ? "checked" : ""),
						add: (a, b) => a + b,
					}))
						Handlebars.registerHelper(name, callback);
					Handlebars.registerHelper("helperMissing", function (...args) {
						const options = args.at(-1);
						return options.fn ? options.fn(this) : "";
					});
					globalThis.hooks = new Map();
					globalThis.Hooks = {
						on: (event, fn) => {
							if (!hooks.has(event)) hooks.set(event, []);
							hooks.get(event).push(fn);
							return fn;
						},
						off() {},
					};
					globalThis.enrichments = 0;
					globalThis.renderedParts = [];
					globalThis.getOwningDocument = (el) => el.ownerDocument;
					globalThis.AvatarPositionApp = { getPosition: () => ({}) };
					globalThis.cloneCollection = (v) => structuredClone(v);
					globalThis.getActiveRoteTagIdsForActor = () => [];
					globalThis.getFellowshipActors = () => [];
					globalThis.getAssignedUser = () => null;
					globalThis.getAvailableFellowships = () => [];
					globalThis.SharedStorage = {
						readStoryConfig: () => ({ helpingTags: [] }),
					};
					globalThis.t = (key) => key;
					globalThis.ui = {
						notifications: {
							warn: (message) => {
								throw new Error(message);
							},
						},
					};
					globalThis.game = {
						user: { isGM: true },
						actors: [],
						i18n: { localize: t },
						tooltip: { deactivate() {}, activate() {} },
						litm: {
							LitmRollDialog: { create: () => ({ refreshTags() {} }) },
							getSelectedTagIds: () => new Set(),
							rollSelection: new Map(),
						},
					};
					globalThis.CONFIG = {
						litm: {
							theme_levels: { origin: [] },
							theme_src: {},
							themeicon_src: {},
							fulfillment: [],
						},
					};
					const flatten = (object, prefix = "", out = {}) => {
						for (const [key, value] of Object.entries(object)) {
							const path = prefix ? `${prefix}.${key}` : key;
							if (value && typeof value === "object" && !Array.isArray(value))
								flatten(value, path, out);
							else out[path] = value;
						}
						return out;
					};
					class Base {
						constructor(actor) {
							this.actor = this.document = actor;
							this.element = document.createElement("form");
							document.body.append(this.element);
							this.id = "character";
							this.isEditable = true;
							this.rendered = false;
						}
						_configureRenderOptions() {}
						_preRender() {}
						_onRender() {}
						_onClose() {}
						async _prepareContext() {
							return {
								system: this.actor.system,
								data: { _id: this.actor.id },
							};
						}
						async render(options = {}) {
							options.isFirstRender = !this.rendered;
							this._configureRenderOptions(options);
							const context = await this._prepareContext(options);
							await this._preRender(context, options);
							const result = await this._renderHTML(context, options);
							renderedParts.push(Object.keys(result));
							this._replaceHTML(result, this.element, options);
							this.rendered = true;
							this._onRender(context, options);
							return this;
						}
					}
					globalThis.foundry = {
						utils: {
							deepClone: (value) => structuredClone(value),
							flattenObject: flatten,
							fromUuidSync: () => null,
							randomID: () => "random",
						},
						applications: {
							api: {},
							sheets: { ActorSheetV2: Base },
							apps: { FilePicker: { implementation: {} } },
							ux: {
								TextEditor: {
									implementation: {
										enrichHTML: async (text) => {
											enrichments++;
											return text;
										},
									},
								},
							},
							handlebars: {
								loadTemplates: async () => {},
								renderTemplate: async (path, context) =>
									Handlebars.compile(templates[path])(context),
							},
						},
					};
				}, templates);
				const hbm = await readFile(
					`D:/FoundryVTT/Foundry Virtual Tabletop ${version}/resources/app/client/applications/api/handlebars-application.mjs`,
					"utf8",
				);
				await page.addScriptTag({
					content: hbm.replace(
						"export default function HandlebarsApplicationMixin",
						"globalThis.HandlebarsApplicationMixin = function HandlebarsApplicationMixin",
					),
				});
				await page.evaluate(() => {
					foundry.applications.api.HandlebarsApplicationMixin =
						HandlebarsApplicationMixin;
				});
				await page.addScriptTag({
					content: (await read("scripts/apps/background-render.js")).replace(
						"export function requestBackgroundRender",
						"globalThis.requestBackgroundRender = function requestBackgroundRender",
					),
				});
				await page.addScriptTag({
					content: (await read("scripts/mixins/live-dom.js")).replace(
						"export function reconcileLiveDOM",
						"globalThis.reconcileLiveDOM = function reconcileLiveDOM",
					),
				});
				await page.addScriptTag({
					content: stripImports(
						await read("scripts/actor/character/character-sheet.js"),
					)
						.replace(
							"export class CharacterSheet",
							"globalThis.CharacterSheet = class CharacterSheet",
						)
						.replace(
							"static DEFAULT_OPTIONS",
							"setEditorForTest(id) { this.#editingEffectId = id; } static DEFAULT_OPTIONS",
						),
				});
				const result = await page.evaluate(async () => {
					const themes = [
						{ id: "one", name: "First", level: "origin", isEmpty: true },
						{ id: "two", name: "Second", level: "origin", isEmpty: true },
					];
					const actor = {
						id: "hero",
						_id: "hero",
						name: "Hero",
						items: [],
						system: {
							themes,
							backpack: { contents: [] },
							relationships: [],
							quintessences: [],
							noticedTags: [],
							storyTags: [
								{ id: "a", name: "A", type: "tag" },
								{ id: "b", name: "B", type: "tag" },
							],
							statuses: [],
						},
						_source: {
							system: { themes: { r1: { id: "one" }, r2: { id: "two" } } },
						},
					};
					const sheet = new CharacterSheet(actor);
					await sheet.render({ force: true });
					sheet.element.classList.add("litm", "litm--character");
					sheet.element.style.cssText = "position: relative; width: 625px";
					const fellowshipCard = sheet.element.querySelector(
						'[data-application-part="fellowship"]',
					);
					const fellowshipPosition = () => {
						const style = getComputedStyle(fellowshipCard);
						return [style.top, style.right, style.left];
					};
					const emptyFellowshipPosition = fellowshipPosition();
					fellowshipCard.classList.remove("litm--character-fellowship-empty");
					const filledFellowshipPosition = fellowshipPosition();
					const identity = sheet.element.querySelector(
						'[data-application-part="identity"]',
					);
					const name = sheet.element.querySelector('[name="name"]');
					name.focus();
					name.value = "Unsaved hero";
					const initialEnrichments = enrichments;
					const initialRenders = renderedParts.length;
					await sheet.render(false, {
						renderContext: "updateActiveEffect",
						renderData: { name: "Changed" },
					});
					const hiddenSkipped = renderedParts.length === initialRenders;
					// Enable the leaves through the actual button action.
					sheet.element
						.querySelector('[data-click="toggle-tracking-cards"]')
						.click();
					await new Promise((resolve) => setTimeout(resolve, 80));
					// Set editor state while exercising the production render and listener lifecycle.
					sheet.setEditorForTest("a");
					const leaf = sheet.element.querySelector(
						'.litm--story-tag[data-id="a"]',
					);
					const editor = leaf.querySelector(".litm--story-label-name");
					editor.contentEditable = "true";
					editor.textContent = "Unsaved leaf";
					editor.focus();
					window.getSelection().collapse(editor.firstChild, 4);
					let blurs = 0;
					editor.addEventListener("blur", () => blurs++);
					actor.system.storyTags.push({ id: "c", name: "C", type: "tag" });
					actor.system.storyTags[1].name = "Remote B";
					const before = enrichments;
					await sheet.render(false, {
						renderContext: "createActiveEffect",
						renderData: {},
					});
					const leafStable =
						editor.isConnected &&
						document.activeElement === editor &&
						editor.textContent === "Unsaved leaf" &&
						window.getSelection().anchorOffset === 4 &&
						blurs === 0;
					const sibling = sheet.element.querySelector(
						'.litm--story-tag[data-id="b"] .litm--story-label-name',
					).textContent;
					const noUnrelatedPreparation = enrichments === before;
					const second = sheet.element.querySelector(
						'[data-application-part="theme-two"]',
					);
					themes[0].name = "New theme";
					await sheet.render(false, {
						renderContext: "updateActor",
						renderData: {
							system: { themes: { r1: { value: { name: "New theme" } } } },
						},
					});
					const onlyTheme =
						renderedParts.at(-1).join() === "theme-one" &&
						second ===
							sheet.element.querySelector(
								'[data-application-part="theme-two"]',
							);
					await sheet.refreshRegions(["fellowship"]);
					const onlyFellowship = renderedParts.at(-1).join() === "fellowship";
					const cardUpdates = [];
					for (const [field, part] of [
						["heroTitle", "hero"],
						["note", "notes"],
						["backpackTags", "backpack"],
						["shortDescription", "identity"],
					]) {
						actor.system[field] = field === "backpackTags" ? [] : "Updated";
						await sheet.render(false, {
							renderContext: "updateActor",
							renderData: { system: { [field]: actor.system[field] } },
						});
						cardUpdates.push(renderedParts.at(-1).join() === part);
					}
					let saves = 0;
					actor.updateEmbeddedDocuments = async (_type, updates) => {
						saves++;
						actor.system.storyTags.find(
							(tag) => tag.id === updates[0]._id,
						).name = updates[0].name;
					};
					sheet["submit"] = async () => {};
					sheet.actor.sheet = sheet;
					// The preserved editor has passed through several listener rebindings.
					game.litm.LitmRollDialog.create = () => ({});
					editor.blur();
					await new Promise((resolve) => setTimeout(resolve, 50));
					const editorClosed =
						sheet.element.querySelector(
							'.litm--story-tag[data-id="a"] .litm--story-label-name',
						).contentEditable === "false";
					return {
						emptyFellowshipPosition,
						filledFellowshipPosition,
						hiddenSkipped,
						leafStable,
						sibling,
						noUnrelatedPreparation,
						onlyTheme,
						onlyFellowship,
						cardUpdates,
						saves,
						editorClosed,
						identityStable:
							identity ===
							sheet.element.querySelector('[data-application-part="identity"]'),
						parts: renderedParts,
						initialEnrichments,
					};
				});
				assert.equal(result.hiddenSkipped, true, `v${version}`);
				assert.deepEqual(result.emptyFellowshipPosition, [
					"0px",
					"-40px",
					"385px",
				]);
				assert.deepEqual(
					result.filledFellowshipPosition,
					result.emptyFellowshipPosition,
				);
				assert.equal(result.leafStable, true, JSON.stringify(result));
				assert.equal(result.sibling, "Remote B");
				assert.equal(result.noUnrelatedPreparation, true);
				assert.equal(result.onlyTheme, true, JSON.stringify(result));
				assert.equal(result.onlyFellowship, true);
				assert.deepEqual(result.cardUpdates, [true, true, true, true]);
				assert.equal(result.saves, 1);
				assert.equal(result.editorClosed, true);
				assert.equal(result.identityStable, true);
				await page.close();
			}
		} finally {
			await browser.close();
		}
	},
);
