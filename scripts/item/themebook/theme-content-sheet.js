import {
	ThemeContentBackgroundApp,
	positionThemeContentArt,
} from "../../apps/theme-content-background.js";
import { confirmDelete, getOwningDocument } from "../../utils.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** Shared AppV2 behavior for Themebook and Theme Kit editors. */
export class ThemeContentSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	#artObserver = null;
	#editingSpecials = new Set();
	#scrollTop = 0;
	#pendingFocus = null;
	#openDropdown = null;
	#closeDropdownOnOutsideClick = (event) => {
		if (this.#openDropdown?.contains(event.target)) return;
		this.#closeOpenDropdown();
	};
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--theme-content"],
		tag: "form",
		position: { width: 820, height: 760 },
		window: {
			resizable: true,
			title: (app) => app.document.name,
		},
		form: { submitOnChange: true },
		actions: {
			configureBackground: ThemeContentSheet.#configureBackground,
		},
	};

	get system() {
		return this.item.system;
	}

	/** @override */
	_getHeaderControls() {
		return [
			...super._getHeaderControls(),
			{
				action: "configureBackground",
				icon: "fas fa-image",
				label: "Litm.theme-content.background-settings",
				ownership: "OWNER",
			},
		];
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		const system = this.item.system;
		this.element.style.setProperty(
			"--content-transition-src",
			`url("${context.transitionSrc}")`,
		);
		this.element.style.setProperty(
			"--content-custom-art-src",
			system.background ? `url("${system.background}")` : "none",
		);
		this.element.style.setProperty(
			"--content-custom-art-size",
			system.backgroundFit === "stretch" ? "100% 100%" : "cover",
		);
		this.element.style.setProperty(
			"--content-custom-art-position",
			`${system.backgroundAnchorX || "center"} ${system.backgroundAnchorY || "center"}`,
		);
		this.element.style.setProperty(
			"--content-custom-art-scale",
			Number(system.backgroundScale) || 1,
		);
		this.element.style.setProperty(
			"--content-custom-art-x",
			`${Number(system.backgroundOffsetX) || 0}px`,
		);
		this.element.style.setProperty(
			"--content-custom-art-y",
			`${Number(system.backgroundOffsetY) || 0}px`,
		);
		this.element.classList.toggle(
			"litm--has-custom-art",
			Boolean(system.background),
		);
		this.#artObserver?.disconnect();
		this.#artObserver = positionThemeContentArt(
			this.element.querySelector(".litm--content-custom-art"),
			system,
		);
		const scroll = this.element.querySelector(".litm--content-scroll");
		if (scroll) {
			scroll.scrollTop = this.#scrollTop;
			scroll.addEventListener(
				"scroll",
				() => {
					this.#scrollTop = scroll.scrollTop;
				},
				{ passive: true },
			);
		}
		if (this.#pendingFocus) {
			const selector = this.#pendingFocus;
			this.#pendingFocus = null;
			requestAnimationFrame(() => {
				const target = this.element.querySelector(selector);
				target?.focus();
				if (target?.select) target.select();
				else if (target?.isContentEditable) {
					const doc = getOwningDocument(target);
					const selection = doc.defaultView.getSelection();
					const range = doc.createRange();
					range.selectNodeContents(target);
					selection.removeAllRanges();
					selection.addRange(range);
				}
			});
		}
		this.element.querySelectorAll("[data-content-action]").forEach((button) => {
			button.addEventListener("click", (event) => this._onContentAction(event));
		});
		this.element
			.querySelectorAll("[data-click='open-levels']")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#openLevels(event));
			});
		this.element
			.querySelectorAll("[data-click='select-level']")
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#selectLevel(event));
			});
		this.element
			.querySelectorAll("[data-array-path][data-entry-id][data-entry-field]")
			.forEach((input) => {
				input.addEventListener("blur", (event) =>
					this.#updateArrayEntry(event),
				);
				input.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
				});
			});
		this.element
			.querySelectorAll("[data-sort-path][draggable='true']")
			.forEach((row) => {
				row.addEventListener("dragstart", (event) => this.#startSort(event));
				row.addEventListener("dragover", (event) => event.preventDefault());
				row.addEventListener("drop", (event) => this.#dropSort(event));
			});
	}

	/**
	 * Handle a content-specific action.
	 * @param {PointerEvent} event Click event.
	 */
	_onContentAction(_event) {}

	/**
	 * Append a plain entry to an array field.
	 * @param {string} path System-relative array path.
	 * @param {object} entry Entry to append.
	 * @param {object} [options={}] Append options.
	 * @param {string | null} [options.focusSelector=null] Element to focus after rerender.
	 */
	async _appendEntry(path, entry, { focusSelector = null } = {}) {
		this.#pendingFocus = focusSelector;
		const source = this.item.toObject().system;
		const entries = foundry.utils.deepClone(
			foundry.utils.getProperty(source, path) ?? [],
		);
		entries.push(entry);
		await this.#updateArrayPath(source, path, entries);
	}

	/**
	 * Append a special already opened for editing and focus its name.
	 * @param {object} special Special source data.
	 */
	async _appendEditingSpecial(special) {
		this.#editingSpecials.add(special.id);
		await this._appendEntry("specials", special, {
			focusSelector: `[data-special-id="${special.id}"] [data-special-name]`,
		});
	}

	/**
	 * Remove an entry from an array field after confirmation.
	 * @param {string} path System-relative array path.
	 * @param {string} id Stable entry ID.
	 * @param {object} [options={}] Removal options.
	 * @param {boolean} [options.confirm=true] Whether to request confirmation.
	 */
	async _removeEntry(path, id, { confirm = true } = {}) {
		if (confirm && !(await confirmDelete("Litm.theme-content.entry"))) return;
		const source = this.item.toObject().system;
		const entries = foundry.utils.deepClone(
			foundry.utils.getProperty(source, path) ?? [],
		);
		await this.#updateArrayPath(
			source,
			path,
			entries.filter((entry) => entry.id !== id),
		);
	}

	/**
	 * Update one field on an array entry.
	 * @param {string} path System-relative array path.
	 * @param {string} id Stable entry ID.
	 * @param {string} field Entry field.
	 * @param {unknown} value New value.
	 */
	async _updateEntry(path, id, field, value) {
		const source = this.item.toObject().system;
		const entries = foundry.utils.deepClone(
			foundry.utils.getProperty(source, path) ?? [],
		);
		const entry = entries.find((candidate) => candidate.id === id);
		if (!entry) return;
		entry[field] = value;
		await this.#updateArrayPath(source, path, entries);
	}

	/**
	 * Add document changes required by a might selection.
	 * @param {string} field Submitted document field.
	 * @param {string} value Selected might.
	 * @returns {Promise<object>} Additional update data.
	 */
	async _prepareMightUpdate(_field, _value) {
		return {};
	}

	/**
	 * Prepare special entries for Fellowship-style display and editing.
	 * @param {object[]} specials Special source data.
	 * @returns {Promise<object[]>} Prepared entries.
	 */
	async _prepareSpecialEntries(specials) {
		return Promise.all(
			specials.map(async (special) => ({
				...special,
				isEditing: this.#editingSpecials.has(special.id),
				enrichedDescription: await TextEditor.enrichHTML(
					special.description || "",
				),
			})),
		);
	}

	/**
	 * Toggle and persist Fellowship-style special editing.
	 * @param {HTMLElement} button Action button.
	 */
	async _toggleSpecialEdit(button) {
		const id = button.dataset.id;
		if (!this.#editingSpecials.has(id)) {
			this.#editingSpecials.add(id);
			this.render();
			return;
		}
		const row = button.closest("[data-special-id]");
		const source = this.item.toObject().system;
		const specials = foundry.utils.deepClone(source.specials ?? []);
		const special = specials.find((entry) => entry.id === id);
		if (special && row) {
			special.name =
				row.querySelector("[data-special-name]")?.textContent.trim() || "";
			special.description =
				row.querySelector("[data-special-description]")?.textContent.trim() ||
				"";
			const nextSpecials =
				special.name || special.description
					? specials
					: specials.filter((entry) => entry.id !== id);
			await this.item.update({ "system.specials": nextSpecials });
		}
		this.#editingSpecials.delete(id);
		this.render();
	}

	static #configureBackground() {
		new ThemeContentBackgroundApp(this.item).render({ force: true });
	}

	#openLevels(event) {
		event.preventDefault();
		event.stopPropagation();
		const dropdown = event.currentTarget.closest(".litm--image-dropdown");
		if (!dropdown) return;
		const shouldOpen = !dropdown.classList.contains("open");
		this.#closeOpenDropdown();
		if (!shouldOpen) return;
		dropdown.classList.add("open");
		this.#openDropdown = dropdown;
		dropdown.ownerDocument.addEventListener(
			"pointerdown",
			this.#closeDropdownOnOutsideClick,
		);
	}

	async #selectLevel(event) {
		event.preventDefault();
		const dropdown = event.currentTarget.closest(".litm--image-dropdown");
		const input = dropdown?.querySelector("input[type='hidden']");
		if (!input) return;
		this.#closeOpenDropdown();
		const value = event.currentTarget.dataset.value;
		await this.item.update({
			[input.name]: value,
			...(await this._prepareMightUpdate(input.name, value)),
		});
	}

	#closeOpenDropdown() {
		const doc = this.#openDropdown?.ownerDocument;
		this.#openDropdown?.classList.remove("open");
		this.#openDropdown = null;
		doc?.removeEventListener("pointerdown", this.#closeDropdownOnOutsideClick);
	}

	async #updateArrayEntry(event) {
		const input = event.currentTarget;
		if (!input.value.trim()) {
			const source = this.item.toObject().system;
			const entries =
				foundry.utils.getProperty(source, input.dataset.arrayPath) ?? [];
			const isOnlyConcept =
				input.dataset.arrayPath === "conceptOptions" && entries.length === 1;
			if (!isOnlyConcept) {
				await this._removeEntry(
					input.dataset.arrayPath,
					input.dataset.entryId,
					{
						confirm: false,
					},
				);
				return;
			}
		}
		await this._updateEntry(
			input.dataset.arrayPath,
			input.dataset.entryId,
			input.dataset.entryField,
			input.value,
		);
	}

	#startSort(event) {
		const row = event.currentTarget;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(
			"text/plain",
			JSON.stringify({
				path: row.dataset.sortPath,
				id: row.dataset.sortId,
			}),
		);
	}

	async #dropSort(event) {
		event.preventDefault();
		const target = event.currentTarget;
		let source;
		try {
			source = JSON.parse(event.dataTransfer.getData("text/plain"));
		} catch {
			return;
		}
		if (
			source.path !== target.dataset.sortPath ||
			source.id === target.dataset.sortId
		)
			return;
		const system = this.item.toObject().system;
		const entries = foundry.utils.deepClone(
			foundry.utils.getProperty(system, source.path) ?? [],
		);
		const from = entries.findIndex((entry) => entry.id === source.id);
		const to = entries.findIndex((entry) => entry.id === target.dataset.sortId);
		if (from < 0 || to < 0) return;
		const [entry] = entries.splice(from, 1);
		entries.splice(to, 0, entry);
		await this.#updateArrayPath(system, source.path, entries);
	}

	async #updateArrayPath(system, path, entries) {
		const [root] = path.split(".");
		if (path === root) {
			await this.item.update({ [`system.${root}`]: entries });
			return;
		}
		const rootValue = foundry.utils.deepClone(system[root]);
		const relativePath = path.slice(root.length + 1);
		foundry.utils.setProperty(rootValue, relativePath, entries);
		await this.item.update({ [`system.${root}`]: rootValue });
	}
}
