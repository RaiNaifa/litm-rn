import { TropeArtSettings } from "../../apps/trope-art-settings.js";
import { ThemeSources } from "../../system/theme-sources.js";
import { confirmUnlink } from "../../utils.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const { fromUuid } = foundry.utils;

/** AppV2 Item sheet for authoring and viewing Tropes. */
export class TropeSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	#pickerSlotId = null;
	#pickerMode = "single";
	#pickerSelection = new Set();
	#previewMode = false;
	#scrollTop = 0;
	#selectionMode = false;
	#themeKitSelection = new Map();
	#backpackSelection = new Set();
	#onConfirmSelection = null;

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--trope"],
		tag: "form",
		position: { width: 720, height: "auto" },
		window: {
			resizable: true,
			title: (app) => app.document.name,
		},
		form: { submitOnChange: true },
		actions: {
			configureArt: TropeSheet.#configureArt,
			togglePreview: TropeSheet.#togglePreview,
		},
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/item/trope.html" },
	};

	constructor(options = {}) {
		super(options);
		this.#selectionMode = options.selectionMode === true;
		this.selectionMode = this.#selectionMode;
		this.#onConfirmSelection = options.onConfirmSelection;
		if (this.#selectionMode) {
			for (const slot of this.item.system.themeKitSlots ?? []) {
				if (slot.mode === "single" && slot.options.length === 1) {
					this.#themeKitSelection.set(slot.id, slot.options[0].uuid);
				}
			}
		}
	}

	/** Allow local selection controls without granting permission to edit the Trope Item. */
	get isEditable() {
		if (this.selectionMode) return true;
		return super.isEditable;
	}

	/** @override */
	_getHeaderControls() {
		const controls = super._getHeaderControls();
		if (this.#selectionMode) return controls;
		if (!this.isEditable) return controls;
		const previewControl = {
			action: "togglePreview",
			icon: "fa-solid fa-repeat",
			label: "Litm.trope.toggle-view",
			ownership: "OWNER",
		};
		if (this.#previewMode) return [...controls, previewControl];
		return [
			...controls,
			{
				action: "configureArt",
				icon: "fa-solid fa-image",
				label: "Litm.trope.art-settings",
				ownership: "OWNER",
			},
			previewControl,
		];
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const system = this.item.system.toObject();
		const editable =
			this.isEditable && !this.#previewMode && !this.#selectionMode;
		const sourceSlots = Array.from(
			{ length: 4 },
			(_, index) =>
				system.themeKitSlots[index] ?? {
					id: `trope-slot-${index}`,
					mode: "single",
					options: [],
				},
		);
		const resolvedSlots = await Promise.all(
			sourceSlots.map((slot) => this.#prepareSlot(slot)),
		);
		const displayedSlots =
			editable || this.#selectionMode
				? resolvedSlots
				: [
						...resolvedSlots.filter((slot) => !slot.isEmpty && !slot.isChoice),
						...resolvedSlots.filter((slot) => !slot.isEmpty && slot.isChoice),
					];
		for (const slot of displayedSlots) {
			for (const option of slot.options) {
				option.selected = this.#themeKitSelection.get(slot.id) === option.uuid;
			}
		}
		const selectedThemeKitUuids = new Set(
			sourceSlots.flatMap((slot) =>
				(slot.options ?? []).map((option) => option.uuid),
			),
		);
		const themeKits = editable
			? await this.#prepareThemeKits(selectedThemeKitUuids)
			: [];
		return {
			...context,
			document: this.item,
			editable,
			selectionMode: this.#selectionMode,
			selectionComplete: this.#isSelectionComplete(sourceSlots),
			hasArt: Boolean(system.art),
			artOnLeft: system.artSide === "left",
			artAlign: system.artAlign || "top",
			system: {
				...system,
				descriptionEnriched: await TextEditor.enrichHTML(
					system.description || "",
				),
				themeKitSlots: displayedSlots,
				backpackTags: await Promise.all(
					(system.backpackTags ?? []).map(async (tag) => ({
						...tag,
						selected: this.#backpackSelection.has(tag.id),
						enrichedName: await TextEditor.enrichHTML(`{${tag.name || ""}}`, {
							inline: true,
						}),
					})),
				),
			},
			picker: this.#pickerSlotId
				? {
						slotId: this.#pickerSlotId,
						mode: this.#pickerMode,
						multiple: this.#pickerMode === "choice",
						themeKits: themeKits.map((kit) => ({
							...kit,
							selected: this.#pickerSelection.has(kit.uuid),
						})),
					}
				: null,
		};
	}

	static #configureArt() {
		new TropeArtSettings(this.item).render({ force: true });
	}

	static #togglePreview() {
		this.#previewMode = !this.#previewMode;
		this.render();
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		const scroll = this.element.querySelector(".litm--trope-scroll");
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
		this.element.querySelectorAll("[data-trope-action]").forEach((element) => {
			element.addEventListener("click", (event) => this.#onAction(event));
		});
		this.#syncSelectionState();
		this.element
			.querySelectorAll("a[data-trope-action='open-kit']")
			.forEach((link) => {
				link.addEventListener("keydown", (event) => {
					if (!["Enter", " "].includes(event.key)) return;
					event.preventDefault();
					event.currentTarget.click();
				});
			});
		this.element
			.querySelector("[data-trope-search]")
			?.addEventListener("input", (event) => this.#filterPicker(event));
		this.element.querySelectorAll("[data-array-field]").forEach((input) => {
			const resize = () => {
				input.size = Math.max(16, Math.min(48, input.value.length + 1));
			};
			input.addEventListener("input", resize);
			input.addEventListener("change", (event) =>
				this.#updateBackpackTag(event),
			);
			input.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				event.currentTarget.blur();
			});
			resize();
		});
	}

	async #prepareSlot(slot) {
		const options = await Promise.all(
			(slot.options ?? []).map(async (reference) => {
				const document = await fromUuid(reference.uuid);
				const themebookName =
					document?.system.themebookName || reference.themebookName || "";
				const might =
					document?.system.mightOverride || reference.might || "origin";
				return {
					...reference,
					name: document?.name || reference.name,
					themebookName,
					might,
					missing: !document,
					mightIcon: this.#mightIcon(might),
				};
			}),
		);
		return {
			...slot,
			options,
			isChoice: slot.mode === "choice",
			isEmpty: options.length === 0,
		};
	}

	async #prepareThemeKits(excludedUuids = new Set()) {
		const kits = await ThemeSources.getThemeKits();
		const mightOrder = new Map([
			["origin", 0],
			["adventure", 1],
			["greatness", 2],
		]);
		const collator = new Intl.Collator(game.i18n.lang, { sensitivity: "base" });
		return kits
			.filter((item) => !excludedUuids.has(item.uuid))
			.map((item) => ({
				uuid: item.uuid,
				name: item.name,
				themebookUuid: item.system.themebookUuid || "",
				themebookName: item.system.themebookName || "",
				might: item.system.mightOverride || "origin",
				mightIcon: this.#mightIcon(item.system.mightOverride || "origin"),
				search:
					`${item.name} ${item.system.themebookName || ""}`.toLocaleLowerCase(),
			}))
			.sort(
				(a, b) =>
					(mightOrder.get(a.might) ?? 3) - (mightOrder.get(b.might) ?? 3) ||
					collator.compare(a.name, b.name),
			);
	}

	#mightIcon(might) {
		const darkTheme = document.body.classList.contains("theme-dark");
		const variant = darkTheme ? "-color-light" : "-color";
		return `${CONFIG.litm.themeicon_src[might] ?? CONFIG.litm.themeicon_src.origin}${variant}_litm_icn.svg`;
	}

	async #onAction(event) {
		event.preventDefault();
		const button = event.currentTarget;
		const action = button.dataset.tropeAction;
		if (action === "select-theme-kit") {
			this.#themeKitSelection.set(button.dataset.slotId, button.dataset.uuid);
			this.#syncSelectionState();
		} else if (action === "select-backpack-tag") {
			const id = button.dataset.id;
			if (this.#backpackSelection.has(id)) this.#backpackSelection.delete(id);
			else if (this.#backpackSelection.size < this.item.system.backpackChoices)
				this.#backpackSelection.add(id);
			this.#syncSelectionState();
		} else if (action === "confirm-selection") {
			await this.#confirmSelection();
		} else if (action === "cancel-selection") {
			await this.close();
		} else if (action === "open-picker") {
			const slot = this.item.system.themeKitSlots.find(
				(entry) => entry.id === button.dataset.slotId,
			);
			this.#pickerSlotId = button.dataset.slotId;
			this.#pickerMode = button.dataset.mode;
			this.#pickerSelection = new Set(
				slot?.mode === this.#pickerMode
					? slot.options.map((option) => option.uuid)
					: [],
			);
			this.render();
		} else if (action === "close-picker") {
			this.#pickerSlotId = null;
			this.#pickerSelection.clear();
			this.render();
		} else if (action === "toggle-kit") {
			this.#togglePickerKit(button.dataset.uuid);
		} else if (action === "confirm-picker") {
			await this.#savePicker();
		} else if (action === "remove-slot") {
			if (!(await confirmUnlink("Litm.trope.theme-kit-selection"))) return;
			await this.#updateSlot(button.dataset.slotId, {
				mode: "single",
				options: [],
			});
		} else if (action === "open-kit" || action === "preview-kit") {
			const kit = await fromUuid(button.dataset.uuid);
			if (kit?.testUserPermission(game.user, "LIMITED")) kit.sheet.render(true);
			else
				ui.notifications.warn(
					game.i18n.localize("Litm.trope.permission-error"),
				);
		} else if (action === "add-backpack-tag") {
			const tags = foundry.utils.deepClone(
				this.item.toObject().system.backpackTags ?? [],
			);
			tags.push({
				id: foundry.utils.randomID(),
				name: game.i18n.localize("Litm.trope.default-backpack-tag"),
			});
			await this.item.update({ "system.backpackTags": tags });
		} else if (action === "remove-backpack-tag") {
			const tags = foundry.utils.deepClone(
				this.item.toObject().system.backpackTags ?? [],
			);
			await this.item.update({
				"system.backpackTags": tags.filter(
					(tag) => tag.id !== button.dataset.id,
				),
			});
		}
	}

	#isSelectionComplete(slots = this.item.system.themeKitSlots ?? []) {
		const populated = slots.filter((slot) => slot.options?.length);
		return (
			populated.length === 4 &&
			populated.every((slot) => this.#themeKitSelection.has(slot.id)) &&
			this.#backpackSelection.size === this.item.system.backpackChoices
		);
	}

	#syncSelectionState() {
		if (!this.#selectionMode || !this.element) return;
		for (const input of this.element.querySelectorAll(
			"[data-theme-kit-choice]",
		)) {
			const selected =
				this.#themeKitSelection.get(input.dataset.slotId) ===
				input.dataset.uuid;
			input.setAttribute("aria-checked", String(selected));
			input
				.closest(".litm--trope-kit")
				?.classList.toggle("is-selected", selected);
		}
		for (const input of this.element.querySelectorAll(
			"[data-backpack-choice]",
		)) {
			const selected = this.#backpackSelection.has(input.dataset.id);
			input.setAttribute("aria-checked", String(selected));
			input
				.closest(".litm--trope-backpack-choice")
				?.classList.toggle("is-selected", selected);
		}
		const confirm = this.element.querySelector(
			"[data-trope-action='confirm-selection']",
		);
		if (confirm) confirm.disabled = !this.#isSelectionComplete();
	}

	async #confirmSelection() {
		if (!this.#isSelectionComplete()) {
			ui.notifications.warn(
				game.i18n.localize("Litm.trope-selection.incomplete"),
			);
			return;
		}
		const slots = (this.item.system.themeKitSlots ?? []).map((slot) => {
			const uuid = this.#themeKitSelection.get(slot.id);
			const option = slot.options.find((entry) => entry.uuid === uuid);
			return option
				? foundry.utils.deepClone(option.toObject?.() ?? option)
				: null;
		});
		const backpackTags = (this.item.system.backpackTags ?? [])
			.filter((tag) => this.#backpackSelection.has(tag.id))
			.map((tag) => ({
				id: foundry.utils.randomID(),
				name: tag.name,
				type: "backpack",
				isScratched: false,
			}));
		const backpackDraftTags = (this.item.system.backpackTags ?? [])
			.filter((tag) => !this.#backpackSelection.has(tag.id))
			.map((tag) => ({ id: foundry.utils.randomID(), name: tag.name }));
		const accepted = await this.#onConfirmSelection?.({
			tropeUuid: this.item.uuid,
			tropeName: this.item.name,
			slots,
			backpackTags,
			backpackDraftTags,
		});
		if (accepted === false) return;
		await this.close();
	}

	#togglePickerKit(uuid) {
		if (this.#pickerMode === "single") {
			this.#pickerSelection = new Set([uuid]);
		} else if (this.#pickerSelection.has(uuid)) {
			this.#pickerSelection.delete(uuid);
		} else {
			this.#pickerSelection.add(uuid);
		}
		this.element
			.querySelectorAll("[data-trope-action='toggle-kit']")
			.forEach((button) => {
				const selected = this.#pickerSelection.has(button.dataset.uuid);
				button
					.closest("[data-picker-row]")
					?.classList.toggle("is-selected", selected);
				button.setAttribute("aria-checked", String(selected));
				const input = button.querySelector("input");
				if (input) input.checked = selected;
			});
	}

	async #savePicker() {
		if (!this.#pickerSelection.size) {
			ui.notifications.warn(
				game.i18n.localize("Litm.trope.select-at-least-one"),
			);
			return;
		}
		const kits = await ThemeSources.getThemeKits();
		const byUuid = new Map(kits.map((item) => [item.uuid, item]));
		const options = [...this.#pickerSelection].flatMap((uuid) => {
			const item = byUuid.get(uuid);
			if (!item) return [];
			return [
				{
					uuid: item.uuid,
					name: item.name,
					themebookUuid: item.system.themebookUuid || "",
					themebookName: item.system.themebookName || "",
					might: item.system.mightOverride || "origin",
				},
			];
		});
		await this.#updateSlot(this.#pickerSlotId, {
			mode: this.#pickerMode,
			options,
		});
		this.#pickerSlotId = null;
		this.#pickerSelection.clear();
	}

	async #updateSlot(id, changes) {
		const slots = foundry.utils.deepClone(
			this.item.toObject().system.themeKitSlots ?? [],
		);
		while (slots.length < 4) {
			slots.push({
				id: `trope-slot-${slots.length}`,
				mode: "single",
				options: [],
			});
		}
		const slot = slots.find((entry) => entry.id === id);
		if (!slot) return;
		Object.assign(slot, changes);
		await this.item.update({ "system.themeKitSlots": slots });
	}

	async #updateBackpackTag(event) {
		const input = event.currentTarget;
		const tags = foundry.utils.deepClone(
			this.item.toObject().system.backpackTags ?? [],
		);
		const tag = tags.find((entry) => entry.id === input.dataset.id);
		if (!tag) return;
		tag[input.dataset.arrayField] = input.value;
		await this.item.update({ "system.backpackTags": tags });
	}

	#filterPicker(event) {
		const query = event.currentTarget.value.trim().toLocaleLowerCase();
		for (const row of this.element.querySelectorAll("[data-picker-row]")) {
			row.hidden = !row.dataset.search.includes(query);
		}
	}
}
