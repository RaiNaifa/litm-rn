import { registerDataInputSync } from "../../mixins/sheet-utils.js";
import { localize as t } from "../../utils.js";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class ThreatSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	#contextMenu = null;
	#pendingConsequenceIndex = null;
	#scrollTop = 0;
	#focusName = false;

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--threat"],
		tag: "form",
		position: { width: 450, height: 275 },
		window: {
			resizable: true,
			title: () => t("TYPES.Item.threat"),
		},
		form: { submitOnChange: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/item/threat.html",
			scrollable: [".litm--threat-sheet"],
		},
	};

	get effects() {
		return this.item.effects;
	}
	get system() {
		return this.item.system;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.system = this.document.system;
		context.title = this.item.name;

		const raw = context.system?.consequences || [];
		context.consequences = raw;

		context.consequencesHTML = await Promise.all(
			raw.map((c) =>
				TextEditor.enrichHTML(c, {
					secrets: this.document.isOwner,
					relativeTo: this.document,
				}),
			),
		);

		return context;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#closeContextMenu();
		const form = this.element;
		const scroller = form.querySelector(".litm--threat-sheet");
		if (scroller) {
			scroller.scrollTop = this.#scrollTop;
			scroller.addEventListener(
				"scroll",
				() => {
					this.#scrollTop = scroller.scrollTop;
				},
				{ passive: true },
			);
		}

		// Обработчики для contenteditable data-input
		registerDataInputSync(form, this);
		form
			.querySelectorAll("[data-input='threat'], [data-input='threat-desc']")
			.forEach((el) => {
				el.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					event.currentTarget.blur();
				});
			});

		form.querySelectorAll("[data-click='add-consequence']").forEach((el) => {
			el.addEventListener("pointerdown", (event) => event.preventDefault());
			el.addEventListener("click", () => this.#addConsequence());
		});
		form.querySelectorAll("[data-context-consequence]").forEach((el) => {
			el.addEventListener("contextmenu", (event) =>
				this.#openConsequenceMenu(event),
			);
		});

		if (this.#focusName) {
			this.#focusName = false;
			queueMicrotask(() =>
				this.#focusEditable(form.querySelector("[data-input='threat']")),
			);
		}
		if (this.#pendingConsequenceIndex !== null) {
			const index = this.#pendingConsequenceIndex;
			queueMicrotask(() => {
				const row = form.querySelector(
					`[data-context-consequence][data-id="${index}"]`,
				);
				if (!row) return;
				this.#pendingConsequenceIndex = null;
				const scrollTop = scroller?.scrollTop ?? this.#scrollTop;
				row?.querySelector("prose-mirror button.toggle")?.click();
				queueMicrotask(() => {
					this.#focusEditable(
						row.querySelector('.editor-content[contenteditable="true"]'),
					);
					requestAnimationFrame(() => {
						if (!scroller) return;
						scroller.scrollTop = scrollTop;
						this.#scrollTop = scrollTop;
					});
				});
			});
		}
	}

	async #addConsequence() {
		await this.#commitActiveEditor();
		const arr = this.document.system.consequences || [];
		this.#pendingConsequenceIndex = arr.length;
		await this.item.update({
			"system.consequences": [...arr, t("Litm.ui.name-consequence")],
		});
	}

	async #commitActiveEditor() {
		const save = this.element?.querySelector(
			'.litm--consequence-editor.active button[data-action="save"]',
		);
		if (save) {
			save.click();
			await new Promise((resolve) => queueMicrotask(resolve));
		}
		await this.submit();
	}

	#focusEditable(element) {
		if (!element) return;
		element.focus({ preventScroll: true });
		const doc = element.ownerDocument;
		const range = doc.createRange();
		range.selectNodeContents(element);
		const selection = doc.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	}

	/** Focus the threat name after the next render. */
	focusNameOnRender() {
		this.#focusName = true;
	}

	#openConsequenceMenu(event) {
		event.preventDefault();
		event.stopPropagation();
		this.#closeContextMenu();

		const row = event.currentTarget;
		const doc = row.ownerDocument;
		const menu = doc.createElement("div");
		menu.className = "litm--challenge-context-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;

		const addOption = (label, icon, callback, separator = false) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle(
				"litm--challenge-context-menu-separator",
				separator,
			);
			button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
			button.addEventListener("click", async () => {
				this.#closeContextMenu();
				await callback();
			});
			menu.append(button);
		};

		addOption(t("Litm.ui.edit"), "fa-solid fa-pen", () => {
			row.querySelector("prose-mirror button.toggle")?.click();
		});
		addOption(
			t("Litm.ui.remove"),
			"fa-solid fa-trash",
			() => this.#removeConsequence(row.dataset.id),
			true,
		);

		doc.body.append(menu);
		this.#contextMenu = menu;
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			const win = doc.defaultView;
			if (rect.right > win.innerWidth)
				menu.style.left = `${Math.max(8, win.innerWidth - rect.width - 8)}px`;
			if (rect.bottom > win.innerHeight)
				menu.style.top = `${Math.max(8, win.innerHeight - rect.height - 8)}px`;
		});
		setTimeout(
			() => doc.addEventListener("pointerdown", this.#onContextMenuOutside),
			0,
		);
	}

	#onContextMenuOutside = (event) => {
		if (!this.#contextMenu?.contains(event.target)) this.#closeContextMenu();
	};

	#closeContextMenu() {
		this.#contextMenu?.ownerDocument.removeEventListener(
			"pointerdown",
			this.#onContextMenuOutside,
		);
		this.#contextMenu?.remove();
		this.#contextMenu = null;
	}

	async #removeConsequence(id) {
		const consequences = foundry.utils.deepClone(
			this.document.system.consequences || [],
		);
		consequences.splice(Number(id), 1);
		await this.item.update({ "system.consequences": consequences });
	}

	/** @override */
	_onClose(options) {
		this.#closeContextMenu();
		return super._onClose(options);
	}
}
