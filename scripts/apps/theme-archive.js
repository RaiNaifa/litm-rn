const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } =
	foundry.applications.api;
const { fromUuidSync } = foundry.utils;

/** Read and maintain archived snapshots of a Hero's themes. */
export class ThemeArchiveApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "litm-theme-archive",
		classes: ["litm", "litm--theme-archive"],
		position: { width: 720, height: 650 },
		window: { resizable: true },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/theme-archive.html" },
	};

	constructor(actorUuid, options = {}) {
		super(options);
		this.actor = fromUuidSync(actorUuid);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		return {
			...context,
			actor: this.actor,
			archive: [...(this.actor.system.themeArchive ?? [])]
				.reverse()
				.map((entry) => ({
					...entry,
					date: new Date(entry.archivedAt).toLocaleString(),
				})),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("[data-delete-archive]").forEach((button) => {
			button.addEventListener("click", (event) =>
				this.#delete(event.currentTarget.dataset.deleteArchive),
			);
		});
	}

	async #delete(id) {
		const confirmed = await DialogV2.confirm({
			window: {
				title: game.i18n.localize("Litm.archive.delete-title"),
				icon: "fa-solid fa-trash",
			},
			content: `<p>${game.i18n.localize("Litm.archive.delete-confirm")}</p>`,
			rejectClose: false,
		});
		if (!confirmed) return;
		const archive = foundry.utils
			.duplicate(this.actor.toObject().system.themeArchive ?? [])
			.filter((entry) => entry.id !== id);
		await this.actor.update({ "system.themeArchive": archive });
		this.render();
	}
}
