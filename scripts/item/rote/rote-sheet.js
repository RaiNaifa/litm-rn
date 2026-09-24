import { confirmDelete, localize as t } from "../../utils.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

const EFFECT_GROUPS = [
	{ label: null, types: ["simpleQuick"] },
	{
		label: "against-opponent",
		types: ["attack", "disrupt", "influence", "weaken"],
	},
	{
		label: "for-ally",
		types: ["bestow", "create", "enhance", "restore"],
	},
	{ label: "on-process", types: ["advance", "setBack"] },
	{ label: "other-effects", types: ["discover", "extraFeat"] },
];
const EFFECT_TYPES = new Set(EFFECT_GROUPS.flatMap((group) => group.types));
const normalizeRoteName = (name) =>
	name.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ");

/** Sheet for authoring a Rote item. */
export class RoteSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	#contextMenu = null;
	#pendingEditor = null;
	#scrollTop = 0;
	#nameResizeObserver = null;
	#textareaResizeObserver = null;

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--rote"],
		tag: "form",
		position: { width: 420, height: 600 },
		window: { resizable: true, title: (app) => app.document.name },
		form: { submitOnChange: true },
		actions: {
			editImage: RoteSheet.#onEditImage,
			deleteLinkedRote: RoteSheet.#onDeleteLinkedRote,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/item/rote.html",
			scrollable: [".litm--rote-sheet"],
		},
	};

	/** Show deletion only for a Rote attached to an actor's tag. */
	_getHeaderControls() {
		const controls = super._getHeaderControls();
		if (
			this.item.parent?.documentName !== "Actor" ||
			!this.item.getFlag("litm-rn", "roteLink")?.tagId ||
			(!game.user.isGM && !this.item.isOwner)
		)
			return controls;
		return [
			...controls,
			{
				action: "deleteLinkedRote",
				icon: "fa-solid fa-trash",
				label: "Litm.rote.delete-linked",
				ownership: "OWNER",
			},
		];
	}

	static async #onDeleteLinkedRote() {
		if (
			this.item.parent?.documentName !== "Actor" ||
			!this.item.getFlag("litm-rn", "roteLink")?.tagId ||
			(!game.user.isGM && !this.item.isOwner)
		)
			return;
		const confirmed = await DialogV2.confirm({
			window: {
				title: t("Litm.rote.delete-linked"),
				icon: "fa-solid fa-trash",
			},
			content: game.i18n.format("Litm.rote.delete-linked-confirm", {
				name: Handlebars.escapeExpression(this.item.name),
			}),
			rejectClose: false,
		});
		if (!confirmed) return;
		await this.item.delete();
		if (this.rendered) await this.close();
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const system = this.item.system.toObject();
		const enrich = (html) =>
			TextEditor.enrichHTML(html || "", {
				secrets: this.item.isOwner,
				relativeTo: this.item,
			});
		return {
			...context,
			canEdit: game.user.isGM || this.item.isOwner,
			isLinked: Boolean(
				this.item.isEmbedded && this.item.getFlag("litm-rn", "roteLink")?.tagId,
			),
			document: this.item,
			roteName: normalizeRoteName(this.item.name),
			system,
			descriptionHTML: await enrich(system.description),
			effects: await Promise.all(
				system.effects.map(async (effect) => ({
					...effect,
					typeLabel: t(`Litm.rote.types.${effect.type}`),
					descriptionHTML: await enrich(effect.description),
				})),
			),
			consequences: await Promise.all(
				system.consequences.map(async (value, index) => ({
					index,
					value,
					html: await enrich(value),
				})),
			),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#closeContextMenu();
		this.#nameResizeObserver?.disconnect();
		this.#textareaResizeObserver?.disconnect();
		const form = this.element;
		const nameField = form.querySelector(".litm--rote-name");
		nameField?.addEventListener("keydown", (event) => {
			if (event.key === "Enter") event.preventDefault();
		});
		nameField?.addEventListener("input", (event) => {
			if (event.isComposing) return;
			const normalized = normalizeRoteName(nameField.value);
			if (normalized === nameField.value) return;
			const caret = normalizeRoteName(
				nameField.value.slice(0, nameField.selectionStart),
			).length;
			nameField.value = normalized;
			nameField.setSelectionRange(caret, caret);
		});
		const scroller = form.querySelector(".litm--rote-sheet");
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
		let resizeTextarea = null;
		for (const field of form.querySelectorAll("[data-rote-autosize]")) {
			if (
				field.classList.contains("litm--rote-textarea") &&
				globalThis.CSS?.supports?.("field-sizing", "content")
			) {
				field.style.removeProperty("height");
				continue;
			}
			const resize = () => {
				field.style.height = "auto";
				field.style.height = `${field.scrollHeight}px`;
			};
			resize();
			field.addEventListener("input", resize);
			if (field.classList.contains("litm--rote-textarea")) {
				resizeTextarea = resize;
				form.ownerDocument.fonts?.ready.then(() => {
					if (field.isConnected) resize();
				});
			}
		}
		if (resizeTextarea && scroller) {
			let previousWidth = scroller.clientWidth;
			this.#textareaResizeObserver = new ResizeObserver(() => {
				if (scroller.clientWidth === previousWidth) return;
				previousWidth = scroller.clientWidth;
				resizeTextarea();
			});
			this.#textareaResizeObserver.observe(scroller);
		}
		for (const editor of form.querySelectorAll("[data-rote-power-input]")) {
			const input = editor.parentElement.querySelector('input[type="hidden"]');
			if (!input) continue;
			const sync = () => {
				input.value = editor.innerText.replace(/\r\n?/g, "\n");
			};
			sync();
			editor.addEventListener("input", sync);
			editor.addEventListener("blur", () => this.submit().catch(console.error));
		}
		if (nameField) {
			let lastWidth = 0;
			this.#nameResizeObserver = new ResizeObserver(([entry]) => {
				const width = entry.contentRect.width;
				if (width === lastWidth) return;
				lastWidth = width;
				nameField.style.height = "auto";
				nameField.style.height = `${nameField.scrollHeight}px`;
			});
			this.#nameResizeObserver.observe(nameField.parentElement);
		}
		for (const button of form.querySelectorAll("[data-rote-action]")) {
			button.addEventListener("pointerdown", (event) => event.preventDefault());
			button.addEventListener("click", (event) => this.#onAction(event));
		}
		for (const row of form.querySelectorAll("[data-rote-row]")) {
			row.addEventListener("contextmenu", (event) => this.#openRowMenu(event));
		}
		if (this.#pendingEditor) {
			const { kind, id } = this.#pendingEditor;
			this.#pendingEditor = null;
			queueMicrotask(() => this.#editRow(kind, id));
		}
	}

	/** @override Restore complete array entries before Foundry validates the form. */
	_processFormData(event, form, formData) {
		const data = super._processFormData(event, form, formData);
		if (typeof data.name === "string") {
			data.name = normalizeRoteName(data.name).trim();
		}
		if (!data.system) data.system = {};
		const system = data.system;
		if (
			this.item.isEmbedded &&
			this.item.getFlag("litm-rn", "roteLink")?.tagId
		) {
			system.isActive = Boolean(
				form.querySelector('[name="system.isActive"]')?.checked,
			);
		}
		if (system?.effects !== undefined) {
			const effects = foundry.utils.deepClone(
				this.item.toObject().system.effects ?? [],
			);
			for (const [index, submittedEffect] of Object.entries(system.effects)) {
				if (effects[index] && submittedEffect?.description !== undefined) {
					effects[index].description = submittedEffect.description;
				}
			}
			system.effects = effects;
		}
		if (system?.consequences !== undefined) {
			const consequences = [...(this.item.system.consequences ?? [])];
			for (const [index, value] of Object.entries(system.consequences)) {
				if (Number(index) < consequences.length) consequences[index] = value;
			}
			system.consequences = consequences;
		}
		return data;
	}

	/** @override */
	async _processSubmitData(event, form, submitData, options) {
		if (!game.user.isGM && !this.item.isOwner) return;
		return super._processSubmitData(event, form, submitData, options);
	}

	/** @override */
	async close(options) {
		this.#closeContextMenu();
		return super.close(options);
	}

	/** Select the item's image with Foundry's file picker. */
	static #onEditImage(_event, target) {
		if (!game.user.isGM && !this.document.isOwner) return;
		new FilePicker({
			type: "image",
			current: this.document.img,
			callback: (path) => this.document.update({ img: path }),
		}).render();
	}

	async #onAction(event) {
		if (!game.user.isGM && !this.item.isOwner) return;
		event.preventDefault();
		const action = event.currentTarget.dataset.roteAction;
		if (action === "add-effect") {
			const type = await this.#chooseEffectType();
			if (!type) return;
			await this.#commitActiveEditor();
			const id = foundry.utils.randomID();
			this.#pendingEditor = { kind: "effect", id };
			try {
				await this.item.update({
					"system.effects": [
						...foundry.utils.deepClone(
							this.item.toObject().system.effects ?? [],
						),
						{ id, type, description: "" },
					],
				});
			} catch (error) {
				this.#pendingEditor = null;
				throw error;
			}
		} else if (action === "add-consequence") {
			await this.#commitActiveEditor();
			const index = this.item.system.consequences.length;
			this.#pendingEditor = { kind: "consequence", id: String(index) };
			try {
				await this.item.update({
					"system.consequences": [...this.item.system.consequences, ""],
				});
			} catch (error) {
				this.#pendingEditor = null;
				throw error;
			}
		}
	}

	async #chooseEffectType(current = "") {
		const options = EFFECT_GROUPS.map((group) => {
			const entries = group.types
				.map((type) => {
					const label = foundry.utils.escapeHTML(t(`Litm.rote.types.${type}`));
					return `<option value="${type}" ${type === current ? "selected" : ""}>${label}</option>`;
				})
				.join("");
			return group.label
				? `<optgroup label="${foundry.utils.escapeHTML(t(`Litm.rote.${group.label}`))}">${entries}</optgroup>`
				: entries;
		}).join("");
		const result = await DialogV2.wait({
			classes: ["litm", "litm--rote-type-dialog"],
			window: {
				title: t(
					current ? "Litm.rote.change-effect-type" : "Litm.rote.add-effect",
				),
			},
			content: `<div class="litm--rote-type-field"><select class="litm--rote-type-select" name="roteEffectType" aria-label="${foundry.utils.escapeHTML(t("Litm.rote.change-effect-type"))}">${options}</select></div>`,
			buttons: [
				{ action: "cancel", label: t("Litm.ui.cancel"), callback: () => null },
				{
					action: "choose",
					label: t(current ? "Litm.ui.edit" : "Litm.rote.choose-type"),
					default: true,
					callback: (_event, _button, dialog) =>
						dialog.element.querySelector('[name="roteEffectType"]')?.value,
				},
			],
			rejectClose: false,
		});
		return EFFECT_TYPES.has(result) ? result : null;
	}

	async #commitActiveEditor() {
		for (const save of this.element.querySelectorAll(
			'prose-mirror.active button[data-action="save"]',
		)) {
			save.click();
		}
		await new Promise((resolve) => queueMicrotask(resolve));
		await this.submit();
	}

	#editRow(kind, id) {
		const root = this.element;
		let activated = false;
		const activateAndFocus = () => {
			const row = [...root.querySelectorAll("[data-rote-row]")].find(
				(entry) => entry.dataset.roteRow === kind && entry.dataset.id === id,
			);
			const editor = row?.querySelector("prose-mirror");
			if (!editor) return false;
			if (!activated) {
				if (!editor.open && !editor.classList.contains("active")) {
					const toggle = editor.querySelector("button.toggle");
					if (!toggle) return false;
					toggle.click();
				}
				activated = true;
			}
			const content = editor.querySelector(
				'.editor-content[contenteditable="true"]',
			);
			if (!content) return false;
			content.focus();
			return true;
		};
		if (activateAndFocus()) return;
		const observer = new MutationObserver(() => {
			if (activateAndFocus()) observer.disconnect();
		});
		observer.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		setTimeout(() => observer.disconnect(), 3000);
	}

	#openRowMenu(event) {
		if (!game.user.isGM && !this.item.isOwner) return;
		event.preventDefault();
		event.stopPropagation();
		this.#closeContextMenu();
		const row = event.currentTarget;
		const kind = row.dataset.roteRow;
		const id = row.dataset.id;
		const doc = row.ownerDocument;
		const menu = doc.createElement("div");
		menu.className = "litm--rote-context-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${Math.max(0, Math.min(event.clientX, doc.defaultView.innerWidth - 230))}px`;
		menu.style.top = `${Math.min(event.clientY, doc.defaultView.innerHeight - 140)}px`;
		const option = (label, icon, callback, separator = false) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle("litm--rote-context-menu-separator", separator);
			const glyph = doc.createElement("i");
			glyph.className = icon;
			const text = doc.createElement("span");
			text.textContent = label;
			button.append(glyph, text);
			button.addEventListener("click", () => {
				this.#closeContextMenu();
				callback();
			});
			menu.append(button);
		};
		option(
			t(
				kind === "effect"
					? "Litm.rote.edit-effect"
					: "Litm.rote.edit-consequence",
			),
			"fa-solid fa-pen",
			() => this.#editRow(kind, id),
		);
		if (kind === "effect") {
			option(t("Litm.rote.change-effect-type"), "fa-solid fa-list", () =>
				this.#changeEffectType(id),
			);
		}
		option(
			t(
				kind === "effect"
					? "Litm.rote.remove-effect"
					: "Litm.rote.remove-consequence",
			),
			"fa-solid fa-trash",
			() => this.#removeRow(kind, id),
			true,
		);
		doc.body.append(menu);
		this.#contextMenu = menu;
		queueMicrotask(() =>
			doc.addEventListener("pointerdown", this.#closeOnOutside),
		);
	}

	#closeOnOutside = (event) => {
		if (!this.#contextMenu?.contains(event.target)) this.#closeContextMenu();
	};

	#closeContextMenu() {
		if (!this.#contextMenu) return;
		this.#contextMenu.ownerDocument.removeEventListener(
			"pointerdown",
			this.#closeOnOutside,
		);
		this.#contextMenu.remove();
		this.#contextMenu = null;
	}

	async #changeEffectType(id) {
		const effect = this.item.system.effects.find((entry) => entry.id === id);
		if (!effect) return;
		const type = await this.#chooseEffectType(effect.type);
		if (!type || type === effect.type) return;
		await this.#commitActiveEditor();
		const effects = foundry.utils.deepClone(
			this.item.toObject().system.effects ?? [],
		);
		const freshEffect = effects.find((entry) => entry.id === id);
		if (!freshEffect) return;
		freshEffect.type = type;
		await this.item.update({ "system.effects": effects });
	}

	async #removeRow(kind, id) {
		const subject =
			kind === "effect" ? "Litm.rote.effect" : "Litm.rote.consequence";
		if (!(await confirmDelete(subject))) return;
		await this.#commitActiveEditor();
		if (kind === "effect") {
			await this.item.update({
				"system.effects": this.item
					.toObject()
					.system.effects.filter((entry) => entry.id !== id),
			});
		} else {
			const consequences = [...this.item.system.consequences];
			consequences.splice(Number(id), 1);
			await this.item.update({ "system.consequences": consequences });
		}
	}
}
