import { formatLitmDropText } from "../prosemirror/litm-drop-plugin.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } =
	foundry.applications.api;
const FilePicker = foundry.applications.apps.FilePicker.implementation;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const SYSTEM_PAGES = [
	{
		id: "litm-reference-quick-rules",
		role: "quickRules",
		key: "quick-rules",
		template:
			"systems/litm-rn/templates/apps/reference-defaults/quick-rules.html",
	},
	{
		id: "litm-reference-spending-power",
		role: "spendingPower",
		key: "spending-power",
		template:
			"systems/litm-rn/templates/apps/reference-defaults/spending-power.html",
	},
];

const REQUIRED_ROLES = SYSTEM_PAGES.map((page) => page.role);
const REFERENCE_DRAG_TYPE = "LitmReference";

const DEFAULT_APPEARANCE = {
	mainBackground: "systems/litm-rn/assets/media/paper.webp",
	mainBackgroundColor: "#d1b27b",
	mainBackgroundBlend: "normal",
	mainBackgroundSize: "cover",
	mainBackgroundPosition: "center",
	textColor: "#2c231e",
	headingColor: "#8b4140",
	tabsBackground: "systems/litm-rn/assets/media/paper.webp",
	tabsBackgroundColor: "#c89265",
	tabsBackgroundBlend: "multiply",
	tabsBackgroundSize: "cover",
	tabsBackgroundPosition: "center",
	tabBackground: "",
	tabBackgroundColor: "#51443c",
	tabTextColor: "#eadfce",
	activeTabBackground: "",
	activeTabBackgroundColor: "#7f3031",
	activeTabTextColor: "#f4dfb0",
	fontFamily: "GentiumBookPlus",
	fontSize: 16,
	headingFontFamily: "TorukSC",
	headingFontSize: 28,
	tabFontFamily: "GentiumBookPlus",
	tabFontSize: 16,
	controlsTone: "dark",
};

const PAGE_APPEARANCE_DEFAULTS = {
	mainBackgroundMode: "inherit",
	mainBackground: "",
	mainBackgroundColor: "",
	mainBackgroundBlend: "",
	mainBackgroundSize: "",
	mainBackgroundPosition: "",
	textColor: "",
	headingColor: "",
	fontFamily: "",
	fontSize: "",
	headingFontFamily: "",
	headingFontSize: "",
	controlsTone: "",
};

const APPEARANCE_COLOR_DEFAULTS = Object.fromEntries(
	Object.entries(DEFAULT_APPEARANCE).filter(([key]) => key.endsWith("Color")),
);

const APPEARANCE_ENUMS = {
	mainBackgroundBlend: ["normal", "multiply", "overlay", "soft-light"],
	mainBackgroundSize: ["cover", "contain", "auto"],
	mainBackgroundPosition: ["center", "top", "bottom", "left", "right"],
	tabsBackgroundBlend: ["normal", "multiply", "overlay", "soft-light"],
	tabsBackgroundSize: ["cover", "contain", "auto"],
	tabsBackgroundPosition: ["center", "top", "bottom", "left", "right"],
	controlsTone: ["auto", "light", "dark"],
};

const clamp = (value, minimum, maximum) =>
	Math.min(maximum, Math.max(minimum, value));

/** World-backed, localized rules reference with Journal import and export. */
export class ReferenceHandbook extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-reference-handbook",
		classes: ["litm", "litm--reference-handbook"],
		tag: "form",
		position: { width: 880, height: 700 },
		window: { title: "Litm.reference.title", resizable: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/reference-handbook.html",
		},
	};

	static instances = new Set();
	static viewerInstance = null;
	static appearancePreview = null;
	static pageAppearancePreview = null;
	static chatDropRoots = new WeakSet();

	#activeRole = "quickRules";
	#activeId = "";
	#editing = false;
	#manageMode = false;
	#tabsScrollLeft = 0;
	#activePageKey = "quickRules";

	/** Create the single shared handbook window. */
	constructor(options = {}) {
		const { manageMode = false, ...applicationOptions } = options;
		super(applicationOptions);
		this.#manageMode = manageMode && game.user.isGM;
		ReferenceHandbook.instances.add(this);
	}

	/** Register entry points which open the handbook. */
	static registerHooks() {
		CONFIG.TextEditor.enrichers.push({
			pattern: /@Reference\[([^\]]+)](?:\{([^}]+)})?/gi,
			enricher: (match) => {
				const link = document.createElement("a");
				link.classList.add("content-link", "litm--reference-link");
				link.dataset.litmReferenceTarget = match[1];
				link.innerHTML = '<i class="fas fa-clipboard-question"></i> ';
				link.append(
					document.createTextNode(
						match[2] || game.i18n.localize("Litm.reference.title"),
					),
				);
				return link;
			},
		});

		Hooks.on("getSceneControlButtons", (controls) => {
			const notes = Array.isArray(controls)
				? controls.find((control) => control.name === "notes")
				: controls instanceof Map
					? controls.get("notes")
					: controls.notes;
			if (!notes) return;
			const tool = {
				name: "litmReference",
				title: "Litm.reference.title",
				icon: "fas fa-clipboard-question",
				button: true,
				onChange: () => ReferenceHandbook.open(),
			};
			if (Array.isArray(notes.tools)) notes.tools.push(tool);
			else if (notes.tools instanceof Map)
				notes.tools.set("litmReference", tool);
			else notes.tools.litmReference = tool;
		});

		document.addEventListener(
			"click",
			(event) => {
				const link = event.target.closest?.(
					"[data-litm-reference-role], [data-litm-reference-target]",
				);
				if (!link) return;
				event.preventDefault();
				event.stopPropagation();
				ReferenceHandbook.open(
					link.dataset.litmReferenceRole || link.dataset.litmReferenceTarget,
				);
			},
			{ capture: true },
		);

		Hooks.on("hotbarDrop", (_hotbar, data, slot) => {
			if (data?.type !== REFERENCE_DRAG_TYPE) return;
			ReferenceHandbook.createHotbarMacro(data, slot).catch(console.error);
			return false;
		});

		Hooks.on("renderChatInput", (_app, elements) => {
			for (const root of Object.values(elements || {})) {
				if (
					!(root instanceof HTMLElement) ||
					ReferenceHandbook.chatDropRoots.has(root)
				)
					continue;
				ReferenceHandbook.chatDropRoots.add(root);
				root.addEventListener("drop", (event) =>
					ReferenceHandbook.handleChatDrop(event),
				);
			}
		});
	}

	/** Create enrichable markup which opens one handbook page. */
	static createLink(target, name = "") {
		const safeTarget = String(target || "quickRules").replaceAll("]", "");
		const safeName = String(name).replaceAll("}", "");
		return `@Reference[${safeTarget}]${safeName ? `{${safeName}}` : ""}`;
	}

	/** Insert supported dragged system data into the v13/v14 chat input. */
	static handleChatDrop(event) {
		const raw = event.dataTransfer?.getData("text/plain");
		if (!raw) return;
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}
		const text = formatLitmDropText(data);
		if (!text) return;
		const root = event.currentTarget;
		const input =
			event.target.closest?.("textarea, input, [contenteditable='true']") ??
			root.querySelector("textarea, input, [contenteditable='true']");
		if (!input) return;
		event.preventDefault();
		event.stopPropagation();
		input.focus();
		if (
			input instanceof HTMLInputElement ||
			input instanceof HTMLTextAreaElement
		) {
			const start = input.selectionStart ?? input.value.length;
			const end = input.selectionEnd ?? input.value.length;
			input.setRangeText(text, start, end, "end");
		} else {
			const selection = window.getSelection();
			const range = selection?.rangeCount
				? selection.getRangeAt(0)
				: document.createRange();
			if (!input.contains(range.commonAncestorContainer))
				range.selectNodeContents(input);
			range.collapse(false);
			range.insertNode(document.createTextNode(text));
			range.collapse(false);
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
		input.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: text,
			}),
		);
	}

	/** Create and assign a macro which opens one handbook page. */
	static async createHotbarMacro(data, slot) {
		const command = `game.litm.reference.open(${JSON.stringify(data.target)});`;
		const MacroDocument = getDocumentClass("Macro");
		const macro = await MacroDocument.create({
			name: data.name || game.i18n.localize("Litm.reference.title"),
			type: "script",
			img: "icons/svg/book.svg",
			command,
			flags: { "litm-rn": { referenceTarget: data.target } },
		});
		if (macro) await game.user.assignHotbarMacro(macro, slot);
	}

	/** Open the shared handbook on a required role or page id. */
	static open(target = "quickRules") {
		const app = ReferenceHandbook.viewerInstance ?? new ReferenceHandbook();
		ReferenceHandbook.viewerInstance = app;
		if (REQUIRED_ROLES.includes(target)) {
			app.#activeRole = target;
			app.#activeId = "";
		} else if (target) {
			app.#activeId = target;
			app.#activeRole = "";
		}
		app.render({ force: true });
		return app;
	}

	/** Toggle the shared viewer without affecting the GM settings window. */
	static toggle(target = "quickRules") {
		const app = ReferenceHandbook.viewerInstance;
		if (app?.rendered) {
			app.close().catch(console.error);
			return null;
		}
		return ReferenceHandbook.open(target);
	}

	/** Clear the shared application reference when its window closes. */
	async close(options) {
		ReferenceHandbook.instances.delete(this);
		if (ReferenceHandbook.viewerInstance === this)
			ReferenceHandbook.viewerInstance = null;
		return super.close(options);
	}

	/** Re-render every open handbook after its world setting changes. */
	static refreshOpen() {
		for (const app of ReferenceHandbook.instances) {
			if (app.rendered) app.render();
		}
	}

	/** Return the normalized world store without mutating the setting. */
	static getStore() {
		const raw = foundry.utils.deepClone(
			game.settings.get("litm-rn", "referenceHandbook") || {},
		);
		const rawAppearance = raw.appearance || {};
		const appearance = {
			...DEFAULT_APPEARANCE,
			...rawAppearance,
		};
		for (const [key, fallback] of Object.entries(APPEARANCE_COLOR_DEFAULTS)) {
			if (!/^#[0-9a-f]{6}$/i.test(appearance[key] || ""))
				appearance[key] = fallback;
		}
		for (const [key, allowed] of Object.entries(APPEARANCE_ENUMS)) {
			if (!allowed.includes(appearance[key]))
				appearance[key] = DEFAULT_APPEARANCE[key];
		}
		appearance.fontSize = clamp(
			Number(appearance.fontSize) || DEFAULT_APPEARANCE.fontSize,
			10,
			36,
		);
		appearance.headingFontSize = clamp(
			Number(appearance.headingFontSize) || DEFAULT_APPEARANCE.headingFontSize,
			14,
			56,
		);
		appearance.tabFontSize = clamp(
			Number(appearance.tabFontSize) || DEFAULT_APPEARANCE.tabFontSize,
			10,
			28,
		);
		return {
			version: 8,
			order: Array.isArray(raw.order) ? raw.order : [],
			pages: Array.isArray(raw.pages) ? raw.pages : [],
			overrides:
				raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {},
			appearance,
			pageAppearance:
				raw.pageAppearance && typeof raw.pageAppearance === "object"
					? raw.pageAppearance
					: {},
		};
	}

	/** Resolve system and user pages for the current client language. */
	static async getPages() {
		const store = ReferenceHandbook.getStore();
		const language = game.i18n.lang;
		const systemPages = await Promise.all(
			SYSTEM_PAGES.map(async (definition) => {
				const override =
					store.overrides[definition.role]?.[language] ??
					store.overrides[definition.role]?.all ??
					{};
				const defaultContent = definition.template
					? await foundry.applications.handlebars.renderTemplate(
							definition.template,
						)
					: `<p>${game.i18n.localize(`Litm.reference.${definition.key}.placeholder`)}</p>`;
				return {
					...definition,
					source: "system",
					name:
						override.name ||
						game.i18n.localize(`Litm.reference.${definition.key}.title`),
					content: override.content || defaultContent,
					overridden: Boolean(override.name || override.content),
				};
			}),
		);
		const userPages = store.pages
			.filter((page) => game.user.isGM || !page.gmOnly)
			.map((page) => ({
				...page,
				source: "user",
				role: page.role || "",
				name: page.name || game.i18n.localize("Litm.reference.untitled"),
				content: page.content || "",
				gmOnly: page.gmOnly === true,
			}));
		const pages = [...systemPages, ...userPages];
		const knownIds = new Set(pages.map((page) => page.id));
		const order = [
			...store.order.filter((id) => knownIds.has(id)),
			...pages.map((page) => page.id).filter((id) => !store.order.includes(id)),
		];
		return pages.sort((left, right) => {
			const leftIndex = order.indexOf(left.id);
			const rightIndex = order.indexOf(right.id);
			return (
				(leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
				(rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
			);
		});
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const pages = await ReferenceHandbook.getPages();
		const active =
			pages.find((page) => page.id === this.#activeId) ??
			pages.find((page) => page.role === this.#activeRole) ??
			pages[0];
		if (!active) return { ...context, pages: [], canManage: this.#manageMode };
		this.#activeId = active.id;
		this.#activeRole = active.role || "";
		this.#activePageKey = active.role || active.id;
		const enrichedContent = await TextEditor.enrichHTML(active.content, {
			async: true,
		});
		return {
			...context,
			pages: pages.map((page) => ({
				...page,
				active: page.id === active.id,
				dragTarget: page.source === "system" ? page.role : page.id,
			})),
			active: {
				...active,
				enrichedContent,
				isUser: active.source === "user",
				hideTitle: ["quickRules", "spendingPower"].includes(active.role),
			},
			canManage: this.#manageMode,
			editing: this.#manageMode && this.#editing,
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#applyAppearance();
		this.#decorateSpendingHeadings();
		const tabs = this.element.querySelector(".litm--reference-tabs");
		if (tabs) {
			tabs.scrollLeft = this.#tabsScrollLeft;
			tabs.addEventListener(
				"scroll",
				() => {
					this.#tabsScrollLeft = tabs.scrollLeft;
				},
				{ passive: true },
			);
		}
		this.element.querySelectorAll("[data-reference-page]").forEach((button) => {
			button.addEventListener("click", (event) => {
				this.#tabsScrollLeft = tabs?.scrollLeft ?? this.#tabsScrollLeft;
				this.#activeId = event.currentTarget.dataset.referencePage;
				this.#activeRole = "";
				this.#editing = false;
				this.render();
			});
			button.addEventListener("dragstart", (event) => {
				const data = {
					type: REFERENCE_DRAG_TYPE,
					target: event.currentTarget.dataset.referenceTarget,
					name: event.currentTarget.dataset.referenceName,
				};
				event.dataTransfer.effectAllowed = "copy";
				event.dataTransfer.setData("text/plain", JSON.stringify(data));
			});
		});
		this.element
			.querySelectorAll("[data-reference-action]")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#handleAction(event));
			});
	}

	#decorateSpendingHeadings() {
		for (const heading of this.element.querySelectorAll(
			".litm-reference-spending h2, .litm-reference-effect-group h3",
		)) {
			const text = heading.textContent.trim();
			const splitAt = text.lastIndexOf(" ");
			const tail = document.createElement("span");
			tail.classList.add("litm-reference-heading-tail");
			tail.textContent = splitAt < 0 ? text : text.slice(splitAt + 1);
			heading.replaceChildren(
				document.createTextNode(
					splitAt < 0 ? "" : `${text.slice(0, splitAt)} `,
				),
				tail,
			);
		}
	}

	async #handleAction(event) {
		event.preventDefault();
		const action = event.currentTarget.dataset.referenceAction;
		if (!this.#manageMode) return;
		switch (action) {
			case "edit":
				this.#editing = true;
				this.render();
				break;
			case "cancel":
				this.#editing = false;
				this.render();
				break;
			case "save":
				await this.#saveActivePage();
				break;
			case "reset":
				await this.#resetActivePage();
				break;
			case "add":
				await this.#addPage();
				break;
			case "delete":
				await this.#deleteActivePage();
				break;
			case "up":
			case "down":
				await this.#moveActivePage(action === "up" ? -1 : 1);
				break;
			case "export":
				await this.#exportJournal();
				break;
			case "appearance":
				await this.#editAppearance();
				break;
			case "pageAppearance":
				await this.#editPageAppearance();
				break;
			case "import":
				await this.#importJournal();
				break;
		}
	}

	#applyAppearance() {
		const shell = this.element.querySelector(".litm--reference-shell");
		if (!shell) return;
		const store = ReferenceHandbook.getStore();
		const globalAppearance =
			ReferenceHandbook.appearancePreview ??
			ReferenceHandbook.getStore().appearance;
		const pageKey = this.#activePageKey;
		const storedPageAppearance = store.pageAppearance[pageKey] || {};
		const preview =
			ReferenceHandbook.pageAppearancePreview?.key === pageKey
				? ReferenceHandbook.pageAppearancePreview.appearance
				: null;
		const pageAppearance =
			preview ??
			(ReferenceHandbook.appearancePreview ? {} : storedPageAppearance);
		const appearance = {
			...globalAppearance,
			...Object.fromEntries(
				Object.entries(pageAppearance).filter(
					([, value]) => value !== "" && value != null && value !== "inherit",
				),
			),
		};
		if (pageAppearance.mainBackgroundMode === "none")
			appearance.mainBackground = "";
		else if (pageAppearance.mainBackgroundMode === "image") {
			appearance.mainBackground = pageAppearance.mainBackground || "";
		}
		const values = {
			"--litm-reference-main-background": this.#cssImage(
				appearance.mainBackground,
			),
			"--litm-reference-main-background-color": appearance.mainBackgroundColor,
			"--litm-reference-text-color": appearance.textColor,
			"--litm-reference-tabs-background": this.#cssImage(
				appearance.tabsBackground,
			),
			"--litm-reference-tabs-background-color": appearance.tabsBackgroundColor,
			"--litm-reference-tabs-background-blend": appearance.tabsBackgroundBlend,
			"--litm-reference-tabs-background-size": appearance.tabsBackgroundSize,
			"--litm-reference-tabs-background-position":
				appearance.tabsBackgroundPosition,
			"--litm-reference-tab-background": this.#cssImage(
				appearance.tabBackground,
			),
			"--litm-reference-tab-background-color": appearance.tabBackgroundColor,
			"--litm-reference-tab-color": appearance.tabTextColor,
			"--litm-reference-active-tab-background": this.#cssImage(
				appearance.activeTabBackground,
			),
			"--litm-reference-active-tab-background-color":
				appearance.activeTabBackgroundColor,
			"--litm-reference-active-tab-color": appearance.activeTabTextColor,
		};
		for (const [property, value] of Object.entries(values)) {
			if (value) shell.style.setProperty(property, value);
			else shell.style.removeProperty(property);
		}
		for (const property of [
			"--litm-reference-tabs-background",
			"--litm-reference-tabs-background-color",
			"--litm-reference-tabs-background-blend",
			"--litm-reference-tabs-background-size",
			"--litm-reference-tabs-background-position",
		]) {
			const value = shell.style.getPropertyValue(property);
			if (value) this.element.style.setProperty(property, value);
			else this.element.style.removeProperty(property);
		}
		const page = shell.querySelector(".litm--reference-page");
		const content = shell.querySelector(".litm--reference-content");
		const tabs = shell.querySelector(".litm--reference-tabs");
		if (page) {
			page.classList.toggle(
				"litm--reference-page--system-paper",
				appearance.mainBackground === DEFAULT_APPEARANCE.mainBackground,
			);
			page.style.backgroundColor = appearance.mainBackgroundColor || "";
			page.style.backgroundImage = this.#cssImage(appearance.mainBackground);
			page.style.backgroundBlendMode =
				appearance.mainBackgroundBlend || "normal";
			page.style.backgroundSize = appearance.mainBackgroundSize || "cover";
			page.style.backgroundPosition =
				appearance.mainBackgroundPosition || "center";
			const tone =
				appearance.controlsTone === "light" ||
				appearance.controlsTone === "dark"
					? appearance.controlsTone
					: this.#colorTone(appearance.mainBackgroundColor);
			page.dataset.controlsTone = tone;
		}
		if (content) {
			content.style.color = appearance.textColor || "";
			content.style.fontFamily = appearance.fontFamily || "";
			content.style.fontSize = `${Number(appearance.fontSize) || 16}px`;
			content.style.setProperty(
				"--litm-reference-heading-color",
				appearance.headingColor || "inherit",
			);
			content.style.setProperty(
				"--litm-reference-heading-font",
				appearance.headingFontFamily || "inherit",
			);
			const headingSize = Number(appearance.headingFontSize) || 28;
			[1, 0.82, 0.7, 0.62, 0.56, 0.5].forEach((scale, index) => {
				content.style.setProperty(
					`--litm-reference-h${index + 1}-size`,
					`${headingSize * scale}px`,
				);
			});
		}
		if (tabs) tabs.style.backgroundColor = appearance.tabsBackgroundColor || "";
		for (const tab of shell.querySelectorAll(".litm--reference-tab")) {
			const active = tab.classList.contains("active");
			tab.style.backgroundColor = active
				? appearance.activeTabBackgroundColor || ""
				: appearance.tabBackgroundColor || "";
			tab.style.backgroundImage = this.#cssImage(
				active ? appearance.activeTabBackground : appearance.tabBackground,
			);
			tab.style.color = active
				? appearance.activeTabTextColor || ""
				: appearance.tabTextColor || "";
			tab.style.fontFamily = appearance.tabFontFamily || "";
			tab.style.fontSize = `${Number(appearance.tabFontSize) || 14}px`;
		}
	}

	#cssImage(path) {
		if (!path) return "none";
		let source = String(path).trim();
		if (!/^(?:https?:|data:|blob:)/i.test(source)) {
			source = `/${source.replace(/^\/+/, "")}`;
			const prefix = String(globalThis.ROUTE_PREFIX || "").replace(
				/^\/+|\/+$/g,
				"",
			);
			if (prefix && !source.startsWith(`/${prefix}/`))
				source = `/${prefix}${source}`;
		}
		return `url("${source.replaceAll('"', '\\"')}")`;
	}

	#colorTone(color) {
		const match = /^#([0-9a-f]{6})$/i.exec(color || "");
		if (!match) return "light";
		const channels = [1, 3, 5]
			.map(
				(index) =>
					Number.parseInt(match[1].slice(index - 1, index + 1), 16) / 255,
			)
			.map((value) =>
				value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
			);
		const luminance =
			0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
		return luminance > 0.42 ? "dark" : "light";
	}

	async #editAppearance() {
		new ReferenceAppearanceSettings().render({ force: true });
	}

	async #editPageAppearance() {
		const page = (await ReferenceHandbook.getPages()).find(
			(entry) => entry.id === this.#activeId,
		);
		if (!page) return;
		const key = page.source === "system" ? page.role : page.id;
		new ReferencePageAppearanceSettings({
			pageKey: key,
			pageName: page.name,
		}).render({ force: true });
	}

	async #saveActivePage() {
		const page = (await ReferenceHandbook.getPages()).find(
			(entry) => entry.id === this.#activeId,
		);
		if (!page) return;
		const formData = new foundry.applications.ux.FormDataExtended(this.element)
			.object;
		const name = String(formData.referenceName || "").trim();
		const content = String(formData.referenceContent || "");
		const store = ReferenceHandbook.getStore();
		if (page.source === "system") {
			store.overrides[page.role] ??= {};
			store.overrides[page.role][game.i18n.lang] = { name, content };
		} else {
			const index = store.pages.findIndex((entry) => entry.id === page.id);
			if (index >= 0)
				store.pages[index] = {
					...store.pages[index],
					name,
					content,
					gmOnly: Boolean(formData.referenceGmOnly),
				};
		}
		await game.settings.set("litm-rn", "referenceHandbook", store);
		this.#editing = false;
		this.render();
	}

	async #resetActivePage() {
		const page = (await ReferenceHandbook.getPages()).find(
			(entry) => entry.id === this.#activeId,
		);
		if (page?.source !== "system") return;
		const confirmed = await DialogV2.confirm({
			window: { title: game.i18n.localize("Litm.reference.reset") },
			content: `<p>${game.i18n.localize("Litm.reference.reset-confirm")}</p>`,
			rejectClose: false,
		});
		if (!confirmed) return;
		const store = ReferenceHandbook.getStore();
		delete store.overrides[page.role]?.[game.i18n.lang];
		await game.settings.set("litm-rn", "referenceHandbook", store);
		this.#editing = false;
		this.render();
	}

	async #addPage() {
		const store = ReferenceHandbook.getStore();
		if (!store.order.length) store.order = SYSTEM_PAGES.map((page) => page.id);
		const id = foundry.utils.randomID();
		store.pages.push({
			id,
			role: "",
			name: game.i18n.localize("Litm.reference.new-page"),
			content: `<p>${game.i18n.localize("Litm.reference.new-page-placeholder")}</p>`,
			gmOnly: false,
		});
		store.order.push(id);
		await game.settings.set("litm-rn", "referenceHandbook", store);
		this.#activeId = id;
		this.#editing = true;
		this.render();
	}

	async #deleteActivePage() {
		const page = (await ReferenceHandbook.getPages()).find(
			(entry) => entry.id === this.#activeId,
		);
		if (!page || page.source === "system" || page.role) return;
		const confirmed = await DialogV2.confirm({
			window: {
				title: game.i18n.localize("Litm.reference.delete"),
				icon: "fa-solid fa-trash",
			},
			content: `<p>${game.i18n.format("Litm.reference.delete-confirm", { name: page.name })}</p>`,
			rejectClose: false,
		});
		if (!confirmed) return;
		const store = ReferenceHandbook.getStore();
		store.pages = store.pages.filter((entry) => entry.id !== page.id);
		store.order = store.order.filter((id) => id !== page.id);
		delete store.pageAppearance[page.id];
		await game.settings.set("litm-rn", "referenceHandbook", store);
		this.#activeId = "";
		this.#activeRole = "quickRules";
		this.#editing = false;
		this.render();
	}

	async #moveActivePage(offset) {
		const pages = await ReferenceHandbook.getPages();
		const index = pages.findIndex((page) => page.id === this.#activeId);
		const target = index + offset;
		if (index < 0 || target < 0 || target >= pages.length) return;
		const order = pages.map((page) => page.id);
		[order[index], order[target]] = [order[target], order[index]];
		const store = ReferenceHandbook.getStore();
		store.order = order;
		await game.settings.set("litm-rn", "referenceHandbook", store);
		this.render();
	}

	async #exportJournal() {
		const pages = await ReferenceHandbook.getPages();
		const store = ReferenceHandbook.getStore();
		const journal = await CONFIG.JournalEntry.documentClass.create({
			name: game.i18n.localize("Litm.reference.export-name"),
			pages: pages.map((page, index) => ({
				name: page.name,
				type: "text",
				sort: index * 100000,
				text: {
					content: page.content,
					format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
				},
				flags: {
					"litm-rn": {
						referencePage: {
							version: 1,
							role: page.role || "",
							gmOnly: page.gmOnly === true,
							appearance:
								store.pageAppearance[
									page.source === "system" ? page.role : page.id
								] || {},
						},
					},
				},
			})),
			flags: {
				"litm-rn": {
					referenceHandbook: { version: 1, appearance: store.appearance },
				},
			},
		});
		ui.notifications.info(game.i18n.localize("Litm.reference.exported"));
		journal.sheet.render(true);
	}

	async #importJournal() {
		const journals = game.journal.contents;
		if (!journals.length) {
			ui.notifications.warn(game.i18n.localize("Litm.reference.no-journals"));
			return;
		}
		const journalOptions = journals
			.map(
				(journal) =>
					`<option value="${foundry.utils.escapeHTML(journal.id)}">${foundry.utils.escapeHTML(journal.name)}</option>`,
			)
			.join("");
		const journalId = await DialogV2.wait({
			window: { title: game.i18n.localize("Litm.reference.import") },
			content: `<label class="litm--reference-dialog-field"><span>${game.i18n.localize("Litm.reference.choose-journal")}</span><select name="journalId">${journalOptions}</select></label>`,
			buttons: [
				{
					action: "cancel",
					label: game.i18n.localize("Litm.ui.cancel"),
					callback: () => null,
				},
				{
					action: "choose",
					label: game.i18n.localize("Litm.reference.continue"),
					default: true,
					callback: (_event, _button, dialog) =>
						dialog.element.querySelector('[name="journalId"]')?.value,
				},
			],
			rejectClose: false,
		});
		const journal = game.journal.get(journalId);
		if (!journal) return;
		const pages = journal.pages.contents.filter((page) => page.type === "text");
		if (!pages.length) {
			ui.notifications.warn(game.i18n.localize("Litm.reference.no-text-pages"));
			return;
		}
		await this.#configureImport(
			pages,
			journal.getFlag("litm-rn", "referenceHandbook")?.appearance,
		);
	}

	async #configureImport(journalPages, importedAppearance = null) {
		const detected = Object.fromEntries(
			journalPages.map((page) => [
				page.getFlag("litm-rn", "referencePage")?.role || "",
				page.id,
			]),
		);
		const roleRows = SYSTEM_PAGES.map((definition) => {
			const detectedId = detected[definition.role] || "";
			const options = `<option value="">${game.i18n.localize("Litm.reference.keep-current")}</option>${journalPages
				.map(
					(page) =>
						`<option value="${foundry.utils.escapeHTML(page.id)}"${page.id === detectedId ? " selected" : ""}>${foundry.utils.escapeHTML(page.name)}</option>`,
				)
				.join("")}`;
			return `<label class="litm--reference-dialog-field"><span>${game.i18n.localize(`Litm.reference.${definition.key}.title`)}</span><select name="role-${definition.role}">${options}</select></label>`;
		}).join("");
		const result = await DialogV2.wait({
			window: { title: game.i18n.localize("Litm.reference.import-mapping") },
			content: `<div class="litm--reference-import"><label class="litm--reference-dialog-field"><span>${game.i18n.localize("Litm.reference.import-mode")}</span><select name="mode"><option value="append">${game.i18n.localize("Litm.reference.import-append")}</option><option value="replace">${game.i18n.localize("Litm.reference.import-replace")}</option></select></label><p>${game.i18n.localize("Litm.reference.import-role-hint")}</p>${roleRows}</div>`,
			buttons: [
				{
					action: "cancel",
					label: game.i18n.localize("Litm.ui.cancel"),
					callback: () => null,
				},
				{
					action: "import",
					label: game.i18n.localize("Litm.reference.import"),
					default: true,
					callback: (_event, _button, dialog) => {
						const data = {
							mode: dialog.element.querySelector('[name="mode"]')?.value,
							roles: {},
						};
						for (const role of REQUIRED_ROLES)
							data.roles[role] =
								dialog.element.querySelector(`[name="role-${role}"]`)?.value ||
								"";
						return data;
					},
				},
			],
			rejectClose: false,
		});
		if (!result) return;
		const assignedPageIds = Object.values(result.roles).filter(Boolean);
		if (new Set(assignedPageIds).size !== assignedPageIds.length) {
			ui.notifications.error(
				game.i18n.localize("Litm.reference.import-role-error"),
			);
			return this.#configureImport(journalPages, importedAppearance);
		}
		if (result.mode === "replace") {
			const missing = REQUIRED_ROLES.filter((role) => !result.roles[role]);
			if (missing.length) {
				ui.notifications.error(
					game.i18n.localize("Litm.reference.import-role-error"),
				);
				return this.#configureImport(journalPages, importedAppearance);
			}
		}
		const store =
			result.mode === "replace"
				? {
						version: 1,
						order: [],
						pages: [],
						overrides: {},
						pageAppearance: {},
					}
				: ReferenceHandbook.getStore();
		if (result.mode === "replace") {
			store.appearance = {
				...DEFAULT_APPEARANCE,
				...(importedAppearance || {}),
			};
		}
		if (!store.order.length) store.order = SYSTEM_PAGES.map((page) => page.id);
		const selectedRoles = new Map(
			Object.entries(result.roles)
				.filter(([, id]) => id)
				.map(([role, id]) => [id, role]),
		);
		const importedOrder = [];
		for (const source of journalPages) {
			const role = selectedRoles.get(source.id) || "";
			const content = source.text?.content || "";
			const sourceAppearance =
				source.getFlag("litm-rn", "referencePage")?.appearance || {};
			if (role) {
				store.overrides[role] ??= {};
				store.overrides[role][game.i18n.lang] = { name: source.name, content };
				if (Object.keys(sourceAppearance).length)
					store.pageAppearance[role] = sourceAppearance;
				importedOrder.push(SYSTEM_PAGES.find((page) => page.role === role).id);
				continue;
			}
			const id = foundry.utils.randomID();
			store.pages.push({
				id,
				role: "",
				name: source.name,
				content,
				gmOnly: source.getFlag("litm-rn", "referencePage")?.gmOnly === true,
			});
			if (Object.keys(sourceAppearance).length)
				store.pageAppearance[id] = sourceAppearance;
			importedOrder.push(id);
		}
		store.order =
			result.mode === "replace"
				? [
						...importedOrder,
						...SYSTEM_PAGES.map((page) => page.id).filter(
							(id) => !importedOrder.includes(id),
						),
					]
				: [
						...store.order,
						...importedOrder.filter((id) => !store.order.includes(id)),
					];
		await game.settings.set("litm-rn", "referenceHandbook", store);
		this.#activeId = "";
		this.#activeRole = "quickRules";
		this.render();
		ui.notifications.info(game.i18n.localize("Litm.reference.imported"));
	}
}

/** Settings-only handbook window with editing and import/export controls enabled. */
export class ReferenceHandbookSettings extends ReferenceHandbook {
	static DEFAULT_OPTIONS = {
		id: "litm-reference-handbook-settings",
	};

	constructor(options = {}) {
		super({ ...options, manageMode: true });
	}
}

/** Settings window for the non-document visual shell around handbook HTML pages. */
export class ReferenceAppearanceSettings extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-reference-appearance",
		classes: ["litm--reference-appearance"],
		tag: "form",
		position: { width: 560, height: "auto" },
		window: { title: "Litm.reference.appearance", resizable: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/reference-appearance.html",
		},
	};

	#activeTab = "main";
	#appearance = null;

	/** Create an appearance editor initialized from the world setting. */
	constructor(options = {}) {
		super(options);
		this.#appearance = foundry.utils.deepClone(
			ReferenceHandbook.getStore().appearance,
		);
		this.#preview();
	}

	/** Discard unsaved appearance changes when the editor closes. */
	async close(options) {
		ReferenceHandbook.appearancePreview = null;
		ReferenceHandbook.refreshOpen();
		return super.close(options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const colorPickers = Object.fromEntries(
			Object.entries(APPEARANCE_COLOR_DEFAULTS).map(([key, fallback]) => [
				key,
				/^#[0-9a-f]{6}$/i.test(this.#appearance[key] || "")
					? this.#appearance[key]
					: fallback,
			]),
		);
		return {
			...context,
			appearance: this.#appearance,
			colorPickers,
			mainActive: this.#activeTab === "main",
			tabActive: this.#activeTab === "tab",
			activeTabActive: this.#activeTab === "activeTab",
			contentFonts: ReferenceAppearanceSettings.#getFonts(
				this.#appearance.fontFamily,
			),
			headingFonts: ReferenceAppearanceSettings.#getFonts(
				this.#appearance.headingFontFamily,
			),
			tabFonts: ReferenceAppearanceSettings.#getFonts(
				this.#appearance.tabFontFamily,
			),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[data-appearance-tab]").forEach((button) => {
			button.addEventListener("click", (event) => {
				this.#readForm();
				this.#activeTab = event.currentTarget.dataset.appearanceTab;
				this.render();
			});
		});
		this.element
			.querySelectorAll("[data-appearance-image]")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#chooseImage(event));
			});
		this.element.querySelectorAll("[data-clear-image]").forEach((button) => {
			button.addEventListener("click", (event) => {
				this.#readForm();
				this.#appearance[event.currentTarget.dataset.clearImage] = "";
				this.#preview();
				this.render();
			});
		});
		this.element.querySelectorAll("[name]").forEach((input) => {
			const update = () => {
				this.#readForm();
				this.#preview();
			};
			input.addEventListener("input", update);
			input.addEventListener("change", update);
		});
		this.element.querySelectorAll("[data-size-target]").forEach((input) => {
			input.addEventListener("input", (event) => {
				const name = event.currentTarget.dataset.sizeTarget;
				const number = this.element.querySelector(`[name="${name}"]`);
				if (number) number.value = event.currentTarget.value;
				this.#appearance[name] = Number(event.currentTarget.value);
				this.#preview();
			});
		});
		this.element.querySelectorAll("[data-size-number]").forEach((input) => {
			input.addEventListener("input", (event) => {
				const range = this.element.querySelector(
					`[data-size-target="${event.currentTarget.dataset.sizeNumber}"]`,
				);
				if (range) range.value = event.currentTarget.value;
			});
		});
		this.element.querySelectorAll("[data-color-text]").forEach((input) => {
			input.addEventListener("input", (event) =>
				this.#syncColor(event, "text"),
			);
		});
		this.element.querySelectorAll("[data-color-picker]").forEach((input) => {
			input.addEventListener("input", (event) =>
				this.#syncColor(event, "picker"),
			);
		});
		this.element
			.querySelector('[data-appearance-action="save"]')
			?.addEventListener("click", () => this.#save());
		this.element
			.querySelector('[data-appearance-action="reset"]')
			?.addEventListener("click", () => {
				this.#appearance = foundry.utils.deepClone(DEFAULT_APPEARANCE);
				this.#preview();
				this.render();
			});
	}

	#readForm() {
		for (const input of this.element.querySelectorAll("[name]")) {
			if (input.name in this.#appearance)
				this.#appearance[input.name] = input.value.trim();
		}
	}

	#syncColor(event, source) {
		const input = event.currentTarget;
		const name =
			source === "text" ? input.dataset.colorText : input.dataset.colorPicker;
		const other = this.element.querySelector(
			source === "text"
				? `[data-color-picker="${name}"]`
				: `[data-color-text="${name}"]`,
		);
		this.#appearance[name] = input.value;
		if (other && (source === "picker" || /^#[0-9a-f]{6}$/i.test(input.value)))
			other.value = input.value;
		this.#preview();
	}

	#chooseImage(event) {
		this.#readForm();
		const name = event.currentTarget.dataset.appearanceImage;
		new FilePicker({
			type: "image",
			current: this.#appearance[name] || "",
			callback: (path) => {
				this.#appearance[name] = path;
				this.#preview();
				this.render();
			},
		}).render();
	}

	async #save() {
		this.#readForm();
		if (!this.element.reportValidity()) return;
		const store = ReferenceHandbook.getStore();
		store.appearance = { ...DEFAULT_APPEARANCE, ...this.#appearance };
		await game.settings.set("litm-rn", "referenceHandbook", store);
		await this.close();
	}

	#preview() {
		ReferenceHandbook.appearancePreview = {
			...DEFAULT_APPEARANCE,
			...foundry.utils.deepClone(this.#appearance),
		};
		ReferenceHandbook.refreshOpen();
	}

	static #getFonts(selected) {
		let available = [];
		try {
			const fontConfig = foundry.applications.settings.menus.FontConfig;
			available = fontConfig.getAvailableFonts?.() ?? [];
		} catch (_error) {
			available = [];
		}
		let names;
		if (available instanceof Map) names = [...available.keys()];
		else if (available instanceof Set) names = [...available];
		else if (Array.isArray(available))
			names = available.map((font) => font.family || font.name || font);
		else names = Object.keys(available);
		if (selected && !names.includes(selected)) names.push(selected);
		return names
			.filter(Boolean)
			.sort((left, right) => left.localeCompare(right))
			.map((name) => ({
				name,
				selected: name === selected,
			}));
	}
}

/** Settings window for one page's inherited visual overrides. */
export class ReferencePageAppearanceSettings extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-reference-page-appearance",
		classes: ["litm--reference-page-appearance"],
		tag: "form",
		position: { width: 560, height: "auto" },
		window: { title: "Litm.reference.page-appearance", resizable: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/reference-page-appearance.html",
		},
	};

	#pageKey;
	#pageName;
	#appearance;

	/** Create a per-page appearance editor. */
	constructor(options = {}) {
		const { pageKey, pageName, ...applicationOptions } = options;
		super(applicationOptions);
		this.#pageKey = pageKey;
		this.#pageName = pageName;
		this.#appearance = {
			...PAGE_APPEARANCE_DEFAULTS,
			...foundry.utils.deepClone(
				ReferenceHandbook.getStore().pageAppearance[pageKey] || {},
			),
		};
		if (
			this.#appearance.mainBackground &&
			!ReferenceHandbook.getStore().pageAppearance[pageKey]?.mainBackgroundMode
		) {
			this.#appearance.mainBackgroundMode = "image";
		}
		this.#preview();
	}

	/** Discard unsaved page appearance changes when the editor closes. */
	async close(options) {
		ReferenceHandbook.pageAppearancePreview = null;
		ReferenceHandbook.refreshOpen();
		return super.close(options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const globalAppearance =
			ReferenceHandbook.appearancePreview ??
			ReferenceHandbook.getStore().appearance;
		return {
			...context,
			pageName: this.#pageName,
			appearance: this.#appearance,
			globalAppearance,
			colorPickers: {
				mainBackgroundColor: /^#[0-9a-f]{6}$/i.test(
					this.#appearance.mainBackgroundColor,
				)
					? this.#appearance.mainBackgroundColor
					: globalAppearance.mainBackgroundColor,
				textColor: /^#[0-9a-f]{6}$/i.test(this.#appearance.textColor)
					? this.#appearance.textColor
					: globalAppearance.textColor,
				headingColor: /^#[0-9a-f]{6}$/i.test(this.#appearance.headingColor)
					? this.#appearance.headingColor
					: globalAppearance.headingColor,
			},
			contentFonts: ReferencePageAppearanceSettings.#getFonts(
				this.#appearance.fontFamily,
			),
			headingFonts: ReferencePageAppearanceSettings.#getFonts(
				this.#appearance.headingFontFamily,
			),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[name]").forEach((input) => {
			const update = () => {
				this.#readForm();
				this.#preview();
			};
			input.addEventListener("input", update);
			input.addEventListener("change", update);
		});
		this.element.querySelectorAll("[data-color-text]").forEach((input) => {
			input.addEventListener("input", (event) =>
				this.#syncColor(event, "text"),
			);
		});
		this.element.querySelectorAll("[data-color-picker]").forEach((input) => {
			input.addEventListener("input", (event) =>
				this.#syncColor(event, "picker"),
			);
		});
		this.element
			.querySelectorAll("[data-appearance-image]")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#chooseImage(event));
			});
		this.element.querySelectorAll("[data-clear-image]").forEach((button) => {
			button.addEventListener("click", (event) => {
				this.#readForm();
				this.#appearance[event.currentTarget.dataset.clearImage] = "";
				this.#appearance.mainBackgroundMode = "none";
				this.#preview();
				this.render();
			});
		});
		this.element
			.querySelector('[data-page-appearance-action="save"]')
			?.addEventListener("click", () => this.#save());
		this.element
			.querySelector('[data-page-appearance-action="reset"]')
			?.addEventListener("click", () => {
				this.#appearance = { ...PAGE_APPEARANCE_DEFAULTS };
				this.#preview();
				this.render();
			});
	}

	#readForm() {
		for (const input of this.element.querySelectorAll("[name]")) {
			if (input.name in this.#appearance)
				this.#appearance[input.name] = input.value.trim();
		}
	}

	#syncColor(event, source) {
		const input = event.currentTarget;
		const name =
			source === "text" ? input.dataset.colorText : input.dataset.colorPicker;
		const other = this.element.querySelector(
			source === "text"
				? `[data-color-picker="${name}"]`
				: `[data-color-text="${name}"]`,
		);
		this.#appearance[name] = input.value;
		if (other && (source === "picker" || /^#[0-9a-f]{6}$/i.test(input.value)))
			other.value = input.value;
		this.#preview();
	}

	#chooseImage(event) {
		this.#readForm();
		const name = event.currentTarget.dataset.appearanceImage;
		new FilePicker({
			type: "image",
			current: this.#appearance[name] || "",
			callback: (path) => {
				this.#appearance[name] = path;
				this.#appearance.mainBackgroundMode = "image";
				this.#preview();
				this.render();
			},
		}).render();
	}

	async #save() {
		this.#readForm();
		if (!this.element.reportValidity()) return;
		const store = ReferenceHandbook.getStore();
		const appearance = Object.fromEntries(
			Object.entries(this.#appearance).filter(
				([key, value]) =>
					value !== "" &&
					value != null &&
					value !== PAGE_APPEARANCE_DEFAULTS[key],
			),
		);
		if (Object.keys(appearance).length)
			store.pageAppearance[this.#pageKey] = appearance;
		else delete store.pageAppearance[this.#pageKey];
		await game.settings.set("litm-rn", "referenceHandbook", store);
		await this.close();
	}

	#preview() {
		ReferenceHandbook.pageAppearancePreview = {
			key: this.#pageKey,
			appearance: foundry.utils.deepClone(this.#appearance),
		};
		ReferenceHandbook.refreshOpen();
	}

	static #getFonts(selected) {
		let available = [];
		try {
			available =
				foundry.applications.settings.menus.FontConfig.getAvailableFonts?.() ??
				[];
		} catch (_error) {
			available = [];
		}
		let names;
		if (available instanceof Map) names = [...available.keys()];
		else if (available instanceof Set) names = [...available];
		else if (Array.isArray(available))
			names = available.map((font) => font.family || font.name || font);
		else names = Object.keys(available);
		if (selected && !names.includes(selected)) names.push(selected);
		return names
			.filter(Boolean)
			.sort((left, right) => left.localeCompare(right))
			.map((name) => ({
				name,
				selected: name === selected,
			}));
	}
}
