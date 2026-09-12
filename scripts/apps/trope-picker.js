import { ThemeSources } from "../system/theme-sources.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid } = foundry.utils;

/** Searchable picker for choosing a Trope from enabled world and compendium sources. */
export class TropePicker extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "litm-trope-picker",
		classes: ["litm", "litm--trope-picker-app"],
		position: { width: 620, height: 620 },
		window: { title: "Litm.trope-picker.title", resizable: true },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/trope-picker.html" },
	};

	constructor(options = {}) {
		super(options);
		this.onSelect = options.onSelect;
		this.selectedUuid = options.selectedUuid || "";
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const collator = new Intl.Collator(game.i18n.lang, { sensitivity: "base" });
		const tropes = (await ThemeSources.getTropes())
			.filter((item) => item.testUserPermission(game.user, "LIMITED"))
			.map((item) => ({
				uuid: item.uuid,
				name: item.name,
				img: item.img,
				folder:
					item.folder?.name || game.i18n.localize("Litm.trope-picker.other"),
				search: `${item.name} ${item.folder?.name || ""}`.toLocaleLowerCase(),
				selected: item.uuid === this.selectedUuid,
			}));
		const byFolder = new Map();
		for (const trope of tropes) {
			if (!byFolder.has(trope.folder)) byFolder.set(trope.folder, []);
			byFolder.get(trope.folder).push(trope);
		}
		return {
			...context,
			groups: [...byFolder.entries()]
				.map(([name, items]) => ({
					name,
					items: items.sort((a, b) => collator.compare(a.name, b.name)),
				}))
				.sort((a, b) => collator.compare(a.name, b.name)),
			hasSelection: Boolean(this.selectedUuid),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[data-picker-action]").forEach((element) => {
			element.addEventListener("click", (event) => this.#onAction(event));
		});
		this.element
			.querySelector("[data-trope-filter]")
			?.addEventListener("input", (event) =>
				this.#filter(event.currentTarget.value),
			);
	}

	async #onAction(event) {
		event.preventDefault();
		const button = event.currentTarget;
		if (button.dataset.pickerAction === "cancel") return this.close();
		if (button.dataset.pickerAction === "preview") {
			const trope = await fromUuid(button.dataset.uuid);
			if (trope) trope.sheet.render({ force: true });
			return;
		}
		if (button.dataset.pickerAction === "select") {
			this.selectedUuid = button.dataset.uuid;
			this.render();
			return;
		}
		if (button.dataset.pickerAction === "confirm" && this.selectedUuid) {
			const trope = await fromUuid(this.selectedUuid);
			if (!trope) return;
			await this.close();
			this.onSelect?.(trope);
		}
	}

	#filter(value) {
		const query = value.trim().toLocaleLowerCase();
		for (const row of this.element.querySelectorAll("[data-trope-row]")) {
			row.hidden = !row.dataset.search.includes(query);
		}
		for (const group of this.element.querySelectorAll("[data-trope-group]")) {
			group.hidden = !group.querySelector("[data-trope-row]:not([hidden])");
		}
	}
}
