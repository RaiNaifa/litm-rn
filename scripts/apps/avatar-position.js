const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

const DEFAULT_BACK_IMAGE = "systems/litm-rn/assets/media/mist-back.webp";
const DEFAULT_FRONT_IMAGE = "systems/litm-rn/assets/media/mist-front.webp";
const LEGACY_DEFAULT_IMAGES = new Map([
	["systems/litm-rn/assets/media/mist-back.png", DEFAULT_BACK_IMAGE],
	["systems/litm-rn/assets/media/mist-front.png", DEFAULT_FRONT_IMAGE],
]);
const DEFAULT_POSITION = Object.freeze({
	scale: 1,
	offsetX: 0,
	offsetY: 0,
	backImage: DEFAULT_BACK_IMAGE,
	backHeight: 300,
	backScale: 1,
	backOffsetX: 0,
	backOffsetY: 0,
	backOpacity: 1,
	frontImage: DEFAULT_FRONT_IMAGE,
	frontHeight: 300,
	frontScale: 1,
	frontOffsetX: 0,
	frontOffsetY: 0,
	frontOpacity: 1,
});

/** Configure the scale and position of a character portrait. */
export class AvatarPositionApp extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--avatar-position"],
		position: { width: 820, height: 650 },
		window: { title: "Litm.ui.avatar-position", resizable: true },
		actions: {
			chooseLayerImage: AvatarPositionApp.#onChooseLayerImage,
			resetLayerImage: AvatarPositionApp.#onResetLayerImage,
			autoLayerHeight: AvatarPositionApp.#onAutoLayerHeight,
			selectLayer: AvatarPositionApp.#onSelectLayer,
			reset: AvatarPositionApp.#onReset,
			save: AvatarPositionApp.#onSave,
			saveAndClose: AvatarPositionApp.#onSaveAndClose,
		},
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/avatar-position.html" },
	};

	#actor;
	#position;
	#activeLayer = "avatar";
	#drag = null;

	/**
	 * Create an avatar position application.
	 * @param {Actor} actor Character actor whose portrait is being configured.
	 * @param {object} [options={}] Application options.
	 */
	constructor(actor, options = {}) {
		super({ ...options, id: `litm-avatar-position-${actor.id}` });
		this.#actor = actor;
		this.#position = AvatarPositionApp.getPosition(actor);
	}

	/**
	 * Return normalized portrait settings for an actor.
	 * @param {Actor} actor Actor containing the saved settings.
	 * @returns {object} Normalized avatar and layer settings.
	 */
	static getPosition(actor) {
		const saved = actor.getFlag("litm-rn", "avatarPosition") || {};
		return {
			scale: this.#clamp(saved.scale, 0.25, 3, DEFAULT_POSITION.scale),
			offsetX: this.#clamp(saved.offsetX, -500, 500, DEFAULT_POSITION.offsetX),
			offsetY: this.#clamp(saved.offsetY, -500, 500, DEFAULT_POSITION.offsetY),
			backImage: this.#imagePath(saved.backImage, DEFAULT_BACK_IMAGE),
			backHeight: this.#height(saved.backHeight, DEFAULT_POSITION.backHeight),
			backScale: this.#clamp(
				saved.backScale,
				0.25,
				3,
				DEFAULT_POSITION.backScale,
			),
			backOffsetX: this.#clamp(
				saved.backOffsetX,
				-500,
				500,
				DEFAULT_POSITION.backOffsetX,
			),
			backOffsetY: this.#clamp(
				saved.backOffsetY,
				-500,
				500,
				DEFAULT_POSITION.backOffsetY,
			),
			backOpacity: this.#clamp(
				saved.backOpacity,
				0,
				1,
				DEFAULT_POSITION.backOpacity,
			),
			frontImage: this.#imagePath(saved.frontImage, DEFAULT_FRONT_IMAGE),
			frontHeight: this.#height(
				saved.frontHeight,
				DEFAULT_POSITION.frontHeight,
			),
			frontScale: this.#clamp(
				saved.frontScale,
				0.25,
				3,
				DEFAULT_POSITION.frontScale,
			),
			frontOffsetX: this.#clamp(
				saved.frontOffsetX,
				-500,
				500,
				DEFAULT_POSITION.frontOffsetX,
			),
			frontOffsetY: this.#clamp(
				saved.frontOffsetY,
				-500,
				500,
				DEFAULT_POSITION.frontOffsetY,
			),
			frontOpacity: this.#clamp(
				saved.frontOpacity,
				0,
				1,
				DEFAULT_POSITION.frontOpacity,
			),
		};
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		return {
			...context,
			img: this.#actor.img,
			name: this.#actor.name,
			position: { ...this.#position },
			activeLayer: this.#activeLayer,
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		const preview = this.element.querySelector(
			".litm--avatar-position-preview",
		);
		preview?.addEventListener("pointerdown", (event) =>
			this.#onPointerDown(event),
		);
		preview?.addEventListener("pointermove", (event) =>
			this.#onPointerMove(event),
		);
		preview?.addEventListener("pointerup", (event) => this.#onPointerUp(event));
		preview?.addEventListener("pointercancel", (event) =>
			this.#onPointerUp(event),
		);
		preview?.addEventListener("wheel", (event) => this.#onWheel(event), {
			passive: false,
		});
		preview?.querySelectorAll("img").forEach((image) => {
			image.addEventListener("dragstart", (event) => event.preventDefault());
		});
		this.element.querySelectorAll("[data-avatar-setting]").forEach((input) => {
			input.addEventListener("input", (event) => this.#onInput(event));
		});
		this.element.querySelectorAll("[data-layer-height]").forEach((input) => {
			input.addEventListener("input", (event) =>
				this.#onLayerHeightInput(event),
			);
		});
		this.element.querySelectorAll("[data-layer-setting]").forEach((input) => {
			input.addEventListener("input", (event) =>
				this.#onLayerSettingInput(event),
			);
		});
		this.#applyPreview();
	}

	#onPointerDown(event) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		this.#drag = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			layer: this.#activeLayer,
			offsetX: this.#getLayerValue(this.#activeLayer, "offsetX"),
			offsetY: this.#getLayerValue(this.#activeLayer, "offsetY"),
		};
	}

	#onPointerMove(event) {
		if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
		this.#setLayerValue(
			this.#drag.layer,
			"offsetX",
			Math.round(this.#drag.offsetX + event.clientX - this.#drag.x),
		);
		this.#setLayerValue(
			this.#drag.layer,
			"offsetY",
			Math.round(this.#drag.offsetY + event.clientY - this.#drag.y),
		);
		this.#applyPreview();
	}

	#onPointerUp(event) {
		if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
		this.#drag = null;
	}

	#onWheel(event) {
		event.preventDefault();
		const direction = event.deltaY < 0 ? 1 : -1;
		const scale = this.#getLayerValue(this.#activeLayer, "scale");
		this.#setLayerValue(
			this.#activeLayer,
			"scale",
			AvatarPositionApp.#clamp(
				Math.round((scale + direction * 0.05) * 100) / 100,
				0.25,
				3,
				1,
			),
		);
		this.#applyPreview();
	}

	#onInput(event) {
		const setting = event.currentTarget.dataset.avatarSetting;
		const value = Number(event.currentTarget.value);
		if (!Number.isFinite(value)) return;
		if (setting === "scale")
			this.#position.scale = AvatarPositionApp.#clamp(value, 0.25, 3, 1);
		else if (setting === "offsetX")
			this.#position.offsetX = AvatarPositionApp.#clamp(value, -500, 500, 0);
		else if (setting === "offsetY")
			this.#position.offsetY = AvatarPositionApp.#clamp(value, -500, 500, 0);
		this.#applyPreview({ updateInputs: false });
	}

	#onLayerHeightInput(event) {
		const layer = event.currentTarget.dataset.layerHeight;
		if (!["back", "front"].includes(layer)) return;
		this.#position[`${layer}Height`] = AvatarPositionApp.#clamp(
			event.currentTarget.value,
			20,
			370,
			DEFAULT_POSITION[`${layer}Height`],
		);
		this.#applyPreview({ updateInputs: false });
	}

	#onLayerSettingInput(event) {
		const [layer, setting] =
			event.currentTarget.dataset.layerSetting.split(".");
		if (!["back", "front"].includes(layer)) return;
		const limits =
			setting === "scale"
				? [0.25, 3, 1]
				: setting === "opacity"
					? [0, 1, 1]
					: [-500, 500, 0];
		this.#setLayerValue(
			layer,
			setting,
			AvatarPositionApp.#clamp(event.currentTarget.value, ...limits),
		);
		this.#applyPreview({ updateInputs: false });
	}

	#applyPreview({ updateInputs = true } = {}) {
		const image = this.element.querySelector(
			".litm--avatar-position-preview .litm--avatar-image",
		);
		if (image) {
			image.style.setProperty("--litm-avatar-scale", this.#position.scale);
			image.style.setProperty(
				"--litm-avatar-offset-x",
				`${this.#position.offsetX}px`,
			);
			image.style.setProperty(
				"--litm-avatar-offset-y",
				`${this.#position.offsetY}px`,
			);
		}
		for (const layer of ["back", "front"]) {
			const layerImage = this.element.querySelector(
				`.litm--avatar-layer--${layer}`,
			);
			const height = this.#position[`${layer}Height`];
			if (layerImage) {
				layerImage.src = this.#position[`${layer}Image`];
				layerImage.style.height = `${height}px`;
				layerImage.style.setProperty(
					"--litm-layer-scale",
					this.#position[`${layer}Scale`],
				);
				layerImage.style.setProperty(
					"--litm-layer-offset-x",
					`${this.#position[`${layer}OffsetX`]}px`,
				);
				layerImage.style.setProperty(
					"--litm-layer-offset-y",
					`${this.#position[`${layer}OffsetY`]}px`,
				);
				layerImage.style.setProperty(
					"--litm-layer-opacity",
					this.#position[`${layer}Opacity`],
				);
			}
			const pathInput = this.element.querySelector(
				`[data-layer-path="${layer}"]`,
			);
			if (pathInput) pathInput.value = this.#position[`${layer}Image`];
			const heightInput = this.element.querySelector(
				`[data-layer-height="${layer}"]`,
			);
			if (heightInput && updateInputs) heightInput.value = height;
			for (const setting of ["scale", "offsetX", "offsetY", "opacity"]) {
				const input = this.element.querySelector(
					`[data-layer-setting="${layer}.${setting}"]`,
				);
				if (input && updateInputs)
					input.value =
						this.#position[
							`${layer}${setting[0].toUpperCase()}${setting.slice(1)}`
						];
			}
		}
		this.element
			.querySelectorAll("[data-action='selectLayer']")
			.forEach((button) => {
				button.classList.toggle(
					"active",
					button.dataset.layer === this.#activeLayer,
				);
			});
		if (!updateInputs) return;
		for (const setting of ["scale", "offsetX", "offsetY"]) {
			const input = this.element.querySelector(
				`[data-avatar-setting="${setting}"]`,
			);
			if (input) input.value = this.#position[setting];
		}
	}

	static #onChooseLayerImage(_event, target) {
		const layer = target.dataset.layer;
		if (!["back", "front"].includes(layer)) return;
		new FilePicker({
			type: "image",
			current: this.#position[`${layer}Image`],
			callback: (path) => {
				this.#position[`${layer}Image`] = path;
				this.#applyPreview();
			},
		}).render();
	}

	static #onResetLayerImage(_event, target) {
		const layer = target.dataset.layer;
		if (layer === "back") this.#position.backImage = DEFAULT_BACK_IMAGE;
		else if (layer === "front") this.#position.frontImage = DEFAULT_FRONT_IMAGE;
		else return;
		this.#applyPreview();
	}

	static #onAutoLayerHeight(_event, target) {
		const layer = target.dataset.layer;
		if (!["back", "front"].includes(layer)) return;
		const image = this.element.querySelector(`.litm--avatar-layer--${layer}`);
		const fallback = DEFAULT_POSITION[`${layer}Height`];
		const naturalHeight = image?.naturalHeight;
		const naturalWidth = image?.naturalWidth;
		this.#position[`${layer}Height`] =
			naturalWidth && naturalHeight
				? AvatarPositionApp.#clamp(
						Math.round((240 * naturalHeight) / naturalWidth),
						20,
						370,
						fallback,
					)
				: fallback;
		this.#applyPreview();
	}

	static #onSelectLayer(_event, target) {
		const layer = target.dataset.layer;
		if (!["avatar", "back", "front"].includes(layer)) return;
		this.#activeLayer = layer;
		this.#applyPreview();
	}

	static #onReset() {
		this.#position = { ...DEFAULT_POSITION };
		this.#applyPreview();
	}

	static async #onSave() {
		await this.#actor.setFlag("litm-rn", "avatarPosition", {
			...this.#position,
		});
	}

	static async #onSaveAndClose() {
		await this.#actor.setFlag("litm-rn", "avatarPosition", {
			...this.#position,
		});
		await this.close();
	}

	static #imagePath(value, fallback) {
		const path = typeof value === "string" ? value.trim() : "";
		return LEGACY_DEFAULT_IMAGES.get(path) ?? (path || fallback);
	}

	static #height(value, fallback) {
		if (value === null || value === undefined || value === "") return fallback;
		return this.#clamp(value, 20, 370, fallback);
	}

	#getLayerValue(layer, setting) {
		if (layer === "avatar") return this.#position[setting];
		return this.#position[
			`${layer}${setting[0].toUpperCase()}${setting.slice(1)}`
		];
	}

	#setLayerValue(layer, setting, value) {
		if (layer === "avatar") this.#position[setting] = value;
		else
			this.#position[`${layer}${setting[0].toUpperCase()}${setting.slice(1)}`] =
				value;
	}

	static #clamp(value, min, max, fallback) {
		const number = Number(value);
		if (!Number.isFinite(number)) return fallback;
		return Math.min(max, Math.max(min, number));
	}
}
