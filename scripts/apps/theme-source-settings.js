const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** GM-only source selector for Themebook and Theme Kit content. */
export class ThemeSourceSettings extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-theme-source-settings",
		classes: ["litm", "litm--theme-source-settings"],
		position: { width: 600, height: "auto" },
		window: {
			title: "Litm.settings.theme-sources",
			resizable: true,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/theme-source-settings.html",
		},
	};

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const config = game.settings.get("litm-rn", "themeSources") || {};
		const selected = new Set(config.packs ?? []);
		const packs = game.packs
			.filter((pack) => pack.documentName === "Item")
			.map((pack) => ({
				collection: pack.collection,
				label: pack.metadata.label || pack.collection,
				package: pack.metadata.packageName || pack.metadata.package || "",
				selected: selected.has(pack.collection),
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
		return {
			...context,
			includeWorld: config.includeWorld !== false,
			packs,
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelector('[data-action="save"]')
			?.addEventListener("click", (event) => {
				this.#save(event);
			});
	}

	async #save(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		const includeWorld =
			this.element.querySelector('[name="includeWorld"]')?.checked ?? true;
		const packs = [
			...this.element.querySelectorAll('[name="packs"]:checked'),
		].map((input) => input.value);
		await game.settings.set("litm-rn", "themeSources", { includeWorld, packs });
		ui.notifications.info(
			game.i18n.localize("Litm.settings.theme-sources-saved"),
		);
		await this.close();
	}
}
