const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid } = foundry.utils;
const FilePicker = foundry.applications.apps.FilePicker.implementation;
const CONTENT_ART_WIDTH = 320;

const DEFAULTS = Object.freeze({
	background: "",
	backgroundScale: 1,
	backgroundOffsetX: 0,
	backgroundOffsetY: 0,
	backgroundRotation: 0,
	backgroundFlipX: false,
	backgroundFlipY: false,
	backgroundFit: "cover",
	backgroundAnchorX: "center",
	backgroundAnchorY: "center",
});

/**
 * Keep a background image positioned inside a fixed, masked surface.
 * @param {HTMLElement} element Background surface.
 * @param {object} settings Stored background settings.
 * @param {object} [options={}] Positioning options.
 * @param {number} [options.referenceWidth=0] Unscaled surface width used by stored offsets.
 * @returns {{apply: Function, disconnect: Function} | null} Position controller.
 */
export function positionThemeContentArt(
	element,
	settings,
	{ referenceWidth = 0 } = {},
) {
	if (!element || !settings.background) return null;
	const surface = element.parentElement;
	if (!surface) return null;
	const image = new Image();
	const apply = () => {
		const width = surface.clientWidth;
		const height = surface.clientHeight;
		if (!width || !height || !image.naturalWidth || !image.naturalHeight)
			return;
		const scale = Number(settings.backgroundScale) || 1;
		let baseWidth = width;
		let baseHeight = height;
		if (settings.backgroundFit !== "stretch") {
			const coverScale = Math.max(
				width / image.naturalWidth,
				height / image.naturalHeight,
			);
			baseWidth = image.naturalWidth * coverScale;
			baseHeight = image.naturalHeight * coverScale;
		}
		const offsetScale = referenceWidth > 0 ? width / referenceWidth : 1;
		const rotation = Number(settings.backgroundRotation) || 0;
		const flipX = settings.backgroundFlipX ? -1 : 1;
		const flipY = settings.backgroundFlipY ? -1 : 1;
		const paintedWidth = baseWidth * scale;
		const paintedHeight = baseHeight * scale;
		const offsetExtent =
			Math.max(
				Math.abs(Number(settings.backgroundOffsetX) || 0),
				Math.abs(Number(settings.backgroundOffsetY) || 0),
			) * offsetScale;
		const paintedSize = Math.max(paintedWidth, paintedHeight);
		const canvasSize =
			Math.max(Math.hypot(width, height), paintedSize) + (offsetExtent + 8) * 2;
		const anchoredStart = (surfaceSize, imageSize, anchor) => {
			const surfaceStart = (canvasSize - surfaceSize) / 2;
			if (["left", "top"].includes(anchor)) return surfaceStart;
			if (["right", "bottom"].includes(anchor)) {
				return surfaceStart + surfaceSize - imageSize;
			}
			return surfaceStart + (surfaceSize - imageSize) / 2;
		};
		const imageX =
			anchoredStart(
				width,
				paintedWidth,
				settings.backgroundAnchorX || "center",
			) +
			(Number(settings.backgroundOffsetX) || 0) * offsetScale;
		const imageY =
			anchoredStart(
				height,
				paintedHeight,
				settings.backgroundAnchorY || "center",
			) +
			(Number(settings.backgroundOffsetY) || 0) * offsetScale;
		element.style.inset = "auto";
		element.style.left = "50%";
		element.style.top = "50%";
		element.style.width = `${canvasSize}px`;
		element.style.height = `${canvasSize}px`;
		element.style.marginLeft = `${-canvasSize / 2}px`;
		element.style.marginTop = `${-canvasSize / 2}px`;
		element.style.backgroundSize = `${paintedWidth}px ${paintedHeight}px`;
		element.style.backgroundPosition = `${imageX}px ${imageY}px`;
		element.style.transform = [
			`scaleX(${flipX})`,
			`scaleY(${flipY})`,
			`rotate(${rotation}deg)`,
		].join(" ");
	};
	image.addEventListener("load", apply, { once: true });
	image.src = settings.background;
	const observer = new ResizeObserver(apply);
	observer.observe(surface);
	return {
		apply,
		disconnect: () => observer.disconnect(),
	};
}

/** Configure the masked illustration used by a Themebook or Theme Kit. */
export class ThemeContentBackgroundApp extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--theme-content-background"],
		position: { width: 900, height: 620 },
		window: {
			title: "Litm.theme-content.background-settings",
			resizable: true,
		},
		actions: {
			chooseImage: ThemeContentBackgroundApp.#chooseImage,
			resetImage: ThemeContentBackgroundApp.#resetImage,
			resetPosition: ThemeContentBackgroundApp.#resetPosition,
			save: ThemeContentBackgroundApp.#save,
			saveAndClose: ThemeContentBackgroundApp.#saveAndClose,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/theme-content-background.html",
		},
	};

	#item;
	#settings;
	#drag = null;
	#artObserver = null;

	/**
	 * Create a background configuration application.
	 * @param {Item} item Themebook or Theme Kit item.
	 * @param {object} [options={}] Application options.
	 */
	constructor(item, options = {}) {
		super({ ...options, id: `litm-theme-content-background-${item.id}` });
		this.#item = item;
		this.#settings = {
			background: item.system.background || "",
			backgroundScale: Number(item.system.backgroundScale) || 1,
			backgroundOffsetX: Number(item.system.backgroundOffsetX) || 0,
			backgroundOffsetY: Number(item.system.backgroundOffsetY) || 0,
			backgroundRotation: Number(item.system.backgroundRotation) || 0,
			backgroundFlipX: Boolean(item.system.backgroundFlipX),
			backgroundFlipY: Boolean(item.system.backgroundFlipY),
			backgroundFit: item.system.backgroundFit || "cover",
			backgroundAnchorX: item.system.backgroundAnchorX || "center",
			backgroundAnchorY: item.system.backgroundAnchorY || "center",
		};
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		let rawMight = this.#item.system.might || this.#item.system.mightOverride;
		if (!rawMight && this.#item.system.themebookUuid) {
			const themebook = await fromUuid(this.#item.system.themebookUuid);
			rawMight = themebook?.system.might;
		}
		rawMight ||= "origin";
		const might = ["origin", "adventure", "greatness"].includes(rawMight)
			? rawMight
			: this.#item.system.suggestedMight || "origin";
		const transitionMight = rawMight === "variable" ? "grey" : might;
		const previewSheetWidth = this.#item.type === "themebook" ? 920 : 820;
		const previewSheetHeight = this.#item.type === "themebook" ? 675 : 760;
		const previewArtWidth = CONTENT_ART_WIDTH;
		return {
			...context,
			name: this.#item.name,
			settings: { ...this.#settings },
			hasImage: Boolean(this.#settings.background),
			transitionSrc: `systems/litm-rn/assets/media/transition-left-${transitionMight}-dark.webp`,
			artStyle: this.#artStyle(),
			previewSheetWidth,
			previewSheetHeight,
			previewArtWidth,
			previewArtPercent: (previewArtWidth / previewSheetWidth) * 100,
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.#artObserver?.disconnect();
		this.#artObserver = positionThemeContentArt(
			this.element.querySelector(".litm--background-preview-art"),
			this.#settings,
			{ referenceWidth: context.previewArtWidth },
		);
		const preview = this.element.querySelector(".litm--background-preview");
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
		this.element
			.querySelectorAll("[data-background-setting]")
			.forEach((input) => {
				input.addEventListener("input", (event) => this.#updateSetting(event));
			});
		this.element
			.querySelectorAll("[data-background-toggle]")
			.forEach((button) => {
				button.addEventListener("click", (event) => {
					const key = event.currentTarget.dataset.backgroundToggle;
					this.#settings[key] = !this.#settings[key];
					this.#applyPreview();
				});
			});
		this.element
			.querySelector("[data-background-fit]")
			?.addEventListener("change", (event) => {
				this.#settings.backgroundFit = event.currentTarget.value;
				this.#applyPreview();
			});
		this.element
			.querySelectorAll("[data-background-anchor]")
			.forEach((select) => {
				select.addEventListener("change", (event) => {
					this.#settings[event.currentTarget.dataset.backgroundAnchor] =
						event.currentTarget.value;
					this.#applyPreview();
				});
			});
	}

	#onPointerDown(event) {
		if (event.button !== 0 || !this.#settings.background) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		this.#drag = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			offsetX: this.#settings.backgroundOffsetX,
			offsetY: this.#settings.backgroundOffsetY,
		};
	}

	#onPointerMove(event) {
		if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
		const previewArt = this.element.querySelector(
			".litm--background-preview-art",
		);
		const previewWidth = previewArt?.parentElement?.clientWidth;
		const previewScale = previewWidth ? previewWidth / CONTENT_ART_WIDTH : 1;
		const pointerX = (event.clientX - this.#drag.x) / previewScale;
		const pointerY = (event.clientY - this.#drag.y) / previewScale;
		const reflectedX = this.#settings.backgroundFlipX ? -pointerX : pointerX;
		const reflectedY = this.#settings.backgroundFlipY ? -pointerY : pointerY;
		const radians =
			(-(Number(this.#settings.backgroundRotation) || 0) * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const imageX = reflectedX * cos - reflectedY * sin;
		const imageY = reflectedX * sin + reflectedY * cos;
		this.#settings.backgroundOffsetX = Math.round(this.#drag.offsetX + imageX);
		this.#settings.backgroundOffsetY = Math.round(this.#drag.offsetY + imageY);
		this.#settings.backgroundOffsetX = Math.max(
			-1000,
			Math.min(1000, this.#settings.backgroundOffsetX),
		);
		this.#settings.backgroundOffsetY = Math.max(
			-1000,
			Math.min(1000, this.#settings.backgroundOffsetY),
		);
		this.#applyPreview();
	}

	#onPointerUp(event) {
		if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
		this.#drag = null;
	}

	#onWheel(event) {
		if (!this.#settings.background) return;
		event.preventDefault();
		const direction = event.deltaY < 0 ? 1 : -1;
		this.#settings.backgroundScale = Math.min(
			3,
			Math.max(
				0.25,
				Math.round((this.#settings.backgroundScale + direction * 0.05) * 100) /
					100,
			),
		);
		this.#applyPreview();
	}

	static #chooseImage() {
		new FilePicker({
			type: "image",
			current: this.#settings.background,
			callback: (path) => {
				this.#settings.background = path;
				this.render();
			},
		}).render();
	}

	static #resetImage() {
		this.#settings.background = "";
		this.render();
	}

	static #resetPosition() {
		Object.assign(this.#settings, {
			backgroundScale: DEFAULTS.backgroundScale,
			backgroundOffsetX: DEFAULTS.backgroundOffsetX,
			backgroundOffsetY: DEFAULTS.backgroundOffsetY,
			backgroundRotation: DEFAULTS.backgroundRotation,
			backgroundFlipX: DEFAULTS.backgroundFlipX,
			backgroundFlipY: DEFAULTS.backgroundFlipY,
			backgroundAnchorX: DEFAULTS.backgroundAnchorX,
			backgroundAnchorY: DEFAULTS.backgroundAnchorY,
		});
		this.render();
	}

	static async #save() {
		await this.#persist();
	}

	static async #saveAndClose() {
		await this.#persist();
		await this.close();
	}

	#updateSetting(event) {
		const input = event.currentTarget;
		const key = input.dataset.backgroundSetting;
		this.#settings[key] = Number(input.value);
		this.element
			.querySelectorAll(`[data-background-setting="${key}"]`)
			.forEach((control) => {
				if (control !== input) control.value = input.value;
			});
		this.#applyPreview({ updateInputs: false });
	}

	#applyPreview({ updateInputs = true } = {}) {
		const art = this.element.querySelector(".litm--background-preview-art");
		if (art) this.#artObserver?.apply();
		if (!updateInputs) return;
		for (const key of [
			"backgroundScale",
			"backgroundOffsetX",
			"backgroundOffsetY",
			"backgroundRotation",
		]) {
			this.element
				.querySelectorAll(`[data-background-setting="${key}"]`)
				.forEach((input) => {
					input.value = this.#settings[key];
				});
		}
		for (const key of ["backgroundFlipX", "backgroundFlipY"]) {
			this.element
				.querySelectorAll(`[data-background-toggle="${key}"]`)
				.forEach((button) => {
					button.classList.toggle("active", this.#settings[key]);
					button.setAttribute("aria-pressed", String(this.#settings[key]));
				});
		}
	}

	#artStyle() {
		const image = this.#settings.background;
		const position = `center ${this.#settings.backgroundAnchorY}`;
		return `background-image:url("${image}");background-position:${position};`;
	}

	async #persist() {
		await this.#item.update({
			"system.background": this.#settings.background,
			"system.backgroundScale": this.#settings.backgroundScale,
			"system.backgroundOffsetX": this.#settings.backgroundOffsetX,
			"system.backgroundOffsetY": this.#settings.backgroundOffsetY,
			"system.backgroundRotation": this.#settings.backgroundRotation,
			"system.backgroundFlipX": this.#settings.backgroundFlipX,
			"system.backgroundFlipY": this.#settings.backgroundFlipY,
			"system.backgroundFit": this.#settings.backgroundFit,
			"system.backgroundAnchorX": this.#settings.backgroundAnchorX,
			"system.backgroundAnchorY": this.#settings.backgroundAnchorY,
		});
	}
}
