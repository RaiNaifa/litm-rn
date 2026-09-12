const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

/** Configure the optional illustration displayed beside a Trope. */
export class TropeArtSettings extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--trope-art-settings"],
		position: { width: 480, height: "auto" },
		window: {
			resizable: false,
			title: "Litm.trope.art-settings",
		},
		actions: {
			chooseArt: TropeArtSettings.#chooseArt,
			removeArt: TropeArtSettings.#removeArt,
			save: TropeArtSettings.#save,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/trope-art-settings.html",
		},
	};

	#item;
	#art;
	#artSide;
	#artAlign;

	/**
	 * Create an illustration settings window.
	 * @param {Item} item Trope Item to configure.
	 * @param {object} [options={}] Application options.
	 */
	constructor(item, options = {}) {
		super({ ...options, id: `litm-trope-art-settings-${item.id}` });
		this.#item = item;
		this.#art = item.system.art || "";
		this.#artSide = item.system.artSide || "right";
		this.#artAlign = item.system.artAlign || "top";
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		return {
			...context,
			name: this.#item.name,
			art: this.#art,
			hasArt: Boolean(this.#art),
			artSide: this.#artSide,
			artAlign: this.#artAlign,
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.querySelectorAll("input[name='artSide']").forEach((input) => {
			input.addEventListener("change", (event) => {
				this.#artSide = event.currentTarget.value;
			});
		});
		this.element.querySelectorAll("input[name='artAlign']").forEach((input) => {
			input.addEventListener("change", (event) => {
				this.#artAlign = event.currentTarget.value;
			});
		});
	}

	static #chooseArt() {
		new FilePicker({
			type: "image",
			current: this.#art,
			callback: (path) => {
				this.#art = path;
				this.render();
			},
		}).render();
	}

	static #removeArt() {
		this.#art = "";
		this.render();
	}

	static async #save() {
		await this.#item.update({
			"system.art": this.#art,
			"system.artSide": this.#artSide,
			"system.artAlign": this.#artAlign,
		});
		await this.close();
	}
}
