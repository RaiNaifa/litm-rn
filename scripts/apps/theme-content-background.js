const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid } = foundry.utils;
const FilePicker = foundry.applications.apps.FilePicker.implementation;
const CONTENT_ART_WIDTH = 320;
const JOURNEY_ART_WIDTH = 800;
const JOURNEY_DEFAULT_BACKGROUND =
	"systems/litm-rn/assets/media/litm-journey.webp";

function numberOrDefault(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

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
	backgroundShadeEnabled: false,
	backgroundShadeHeight: 45,
	backgroundShadeStrength: 55,
	backgroundFadeEnabled: false,
	backgroundFadeHeight: 20,
});

/**
 * Keep a background image positioned inside a fixed, masked surface.
 * @param {HTMLElement} element Background surface.
 * @param {object} settings Stored background settings.
 * @param {object} [options={}] Positioning options.
 * @param {number} [options.referenceWidth=0] Unscaled surface width used by stored offsets.
 * @param {Function|null} [options.onPosition=null] Receives the painted image bounds after positioning.
 * @returns {{apply: Function, disconnect: Function} | null} Position controller.
 */
export function positionThemeContentArt(
	element,
	settings,
	{
		referenceWidth = 0,
		onPosition = null,
	} = {},
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
		const rotation = Number(settings.backgroundRotation) || 0;
		let baseWidth = width;
		let baseHeight = height;
		if (settings.backgroundFit === "native") {
			baseWidth = image.naturalWidth;
			baseHeight = image.naturalHeight;
		} else if (settings.backgroundFit !== "stretch") {
			const radians = (rotation * Math.PI) / 180;
			const rotatedNaturalWidth =
				Math.abs(image.naturalWidth * Math.cos(radians)) +
				Math.abs(image.naturalHeight * Math.sin(radians));
			const rotatedNaturalHeight =
				Math.abs(image.naturalWidth * Math.sin(radians)) +
				Math.abs(image.naturalHeight * Math.cos(radians));
			const coverScale = Math.max(
				width / rotatedNaturalWidth,
				height / rotatedNaturalHeight,
			);
			baseWidth = image.naturalWidth * coverScale;
			baseHeight = image.naturalHeight * coverScale;
		}
		const offsetScale =
			settings.backgroundFit === "native"
				? 1
				: referenceWidth > 0
					? width / referenceWidth
					: 1;
		const flipX = settings.backgroundFlipX ? -1 : 1;
		const flipY = settings.backgroundFlipY ? -1 : 1;
		const paintedWidth = baseWidth * scale;
		const paintedHeight = baseHeight * scale;
		const radians = (rotation * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const rotatedWidth =
			Math.abs(paintedWidth * cos) + Math.abs(paintedHeight * sin);
		const rotatedHeight =
			Math.abs(paintedWidth * sin) + Math.abs(paintedHeight * cos);
		const anchoredStart = (surfaceSize, imageSize, anchor) => {
			if (["left", "top"].includes(anchor)) return 0;
			if (["right", "bottom"].includes(anchor)) {
				return surfaceSize - imageSize;
			}
			return (surfaceSize - imageSize) / 2;
		};
		const desiredLeft =
			anchoredStart(
				width,
				rotatedWidth,
				settings.backgroundAnchorX || "center",
			) +
			(Number(settings.backgroundOffsetX) || 0) * offsetScale;
		const desiredTop =
			anchoredStart(
				height,
				rotatedHeight,
				settings.backgroundAnchorY || "center",
			) +
			(Number(settings.backgroundOffsetY) || 0) * offsetScale;
		const elementLeft = desiredLeft + (rotatedWidth - paintedWidth) / 2;
		const elementTop = desiredTop + (rotatedHeight - paintedHeight) / 2;
		const gradientX = Math.sin(radians) / flipY;
		const gradientY = Math.cos(radians) / flipY;
		const gradientAngle =
			(Math.atan2(gradientX, -gradientY) * 180) / Math.PI;
		const shadeHeight = Math.max(
			0,
			Math.min(100, Number(settings.backgroundShadeHeight) || 0),
		);
		const shadeStrength = Math.max(
			0,
			Math.min(100, Number(settings.backgroundShadeStrength) || 0),
		);
		const shadeStartY = height * (1 - shadeHeight / 100);
		const shadeTransitionHeight = (height * shadeHeight * 0.45) / 100;
		const shadeStop = (screenY) =>
			`${((screenY - desiredTop) / rotatedHeight) * 100}%`;
		const fadeHeight = Math.max(
			0,
			Math.min(100, Number(settings.backgroundFadeHeight) || 0),
		);
		const maskSource = foundry.utils.getRoute
			? foundry.utils.getRoute(settings.background)
			: settings.background.startsWith("/")
				? settings.background
				: `/${settings.background}`;
		element.style.inset = "auto";
		element.style.left = `${elementLeft}px`;
		element.style.top = `${elementTop}px`;
		element.style.width = `${paintedWidth}px`;
		element.style.height = `${paintedHeight}px`;
		element.style.marginLeft = "0";
		element.style.marginTop = "0";
		element.style.backgroundSize = "100% 100%";
		element.style.backgroundPosition = "center";
		element.style.transform = [
			`scaleX(${flipX})`,
			`scaleY(${flipY})`,
			`rotate(${rotation}deg)`,
		].join(" ");
		element.style.setProperty(
			"--litm-art-image",
			`url(${JSON.stringify(maskSource)})`,
		);
		element.style.setProperty(
			"--litm-art-gradient-angle",
			`${gradientAngle}deg`,
		);
		element.style.setProperty(
			"--litm-art-shade-start-stop",
			shadeStop(shadeStartY),
		);
		element.style.setProperty(
			"--litm-art-shade-quarter-stop",
			shadeStop(shadeStartY + shadeTransitionHeight * 0.25),
		);
		element.style.setProperty(
			"--litm-art-shade-half-stop",
			shadeStop(shadeStartY + shadeTransitionHeight * 0.5),
		);
		element.style.setProperty(
			"--litm-art-shade-three-quarter-stop",
			shadeStop(shadeStartY + shadeTransitionHeight * 0.75),
		);
		element.style.setProperty(
			"--litm-art-shade-full-stop",
			shadeStop(shadeStartY + shadeTransitionHeight),
		);
		element.style.setProperty(
			"--litm-art-shade-strength",
			String(shadeStrength / 100),
		);
		element.style.setProperty(
			"--litm-art-shade-strength-quarter",
			String((shadeStrength / 100) * 0.156),
		);
		element.style.setProperty(
			"--litm-art-shade-strength-half",
			String((shadeStrength / 100) * 0.5),
		);
		element.style.setProperty(
			"--litm-art-shade-strength-three-quarter",
			String((shadeStrength / 100) * 0.844),
		);
		element.style.setProperty("--litm-art-fade-height", `${fadeHeight}%`);
		element.classList.toggle(
			"litm--art-shade-enabled",
			Boolean(settings.backgroundShadeEnabled) && shadeHeight > 0,
		);
		element.classList.toggle(
			"litm--art-fade-enabled",
			Boolean(settings.backgroundFadeEnabled) && fadeHeight > 0,
		);
		if (onPosition) {
			onPosition({
				left: desiredLeft,
				right: desiredLeft + rotatedWidth,
				top: desiredTop,
				bottom: desiredTop + rotatedHeight,
			});
		}
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

/** Configure an illustration used by a Themebook, Theme Kit, or Journey. */
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
	#isJourney;
	#drag = null;
	#artObserver = null;

	/**
	 * Create a background configuration application.
	 * @param {Item|Actor} item Document containing the illustration settings.
	 * @param {object} [options={}] Application options.
	 * @param {string} [options.mode] Optional layout mode, such as `journey`.
	 */
	constructor(item, options = {}) {
		const { mode, ...applicationOptions } = options;
		super({
			...applicationOptions,
			id: `litm-theme-content-background-${item.id}`,
		});
		this.#item = item;
		this.#isJourney = mode === "journey" || item.type === "journey";
		this.#settings = {
			background:
				item.system.background ||
				(this.#isJourney ? JOURNEY_DEFAULT_BACKGROUND : ""),
			backgroundScale: Number(item.system.backgroundScale) || 1,
			backgroundOffsetX: Number(item.system.backgroundOffsetX) || 0,
			backgroundOffsetY: Number(item.system.backgroundOffsetY) || 0,
			backgroundRotation: Number(item.system.backgroundRotation) || 0,
			backgroundFlipX: Boolean(item.system.backgroundFlipX),
			backgroundFlipY: Boolean(item.system.backgroundFlipY),
			backgroundFit: item.system.backgroundFit || "cover",
			backgroundAnchorX: item.system.backgroundAnchorX || "center",
			backgroundAnchorY: item.system.backgroundAnchorY || "center",
			backgroundShadeEnabled: Boolean(item.system.backgroundShadeEnabled),
			backgroundShadeHeight:
				numberOrDefault(
					item.system.backgroundShadeHeight,
					DEFAULTS.backgroundShadeHeight,
				),
			backgroundShadeStrength:
				numberOrDefault(
					item.system.backgroundShadeStrength,
					DEFAULTS.backgroundShadeStrength,
				),
			backgroundFadeEnabled: Boolean(item.system.backgroundFadeEnabled),
			backgroundFadeHeight:
				numberOrDefault(
					item.system.backgroundFadeHeight,
					DEFAULTS.backgroundFadeHeight,
				),
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
		const journeySurface = this.#isJourney
			? this.#item.sheet?.element?.querySelector?.(".litm--journey-art-surface")
			: null;
		const previewSheetWidth = this.#isJourney
			? journeySurface?.parentElement?.closest(".window-content")
					?.offsetWidth ||
				journeySurface?.clientWidth ||
				this.#item.sheet?.position?.width ||
				800
			: this.#item.type === "themebook"
				? 920
				: 820;
		const previewSheetHeight = this.#isJourney
			? 420
			: this.#item.type === "themebook"
				? 675
				: 760;
		const previewArtWidth = this.#isJourney
			? JOURNEY_ART_WIDTH
			: CONTENT_ART_WIDTH;
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
			isJourney: this.#isJourney,
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
		const referenceWidth = this.#isJourney
			? JOURNEY_ART_WIDTH
			: CONTENT_ART_WIDTH;
		const previewScale = previewWidth ? previewWidth / referenceWidth : 1;
		const pointerX = (event.clientX - this.#drag.x) / previewScale;
		const pointerY = (event.clientY - this.#drag.y) / previewScale;
		this.#settings.backgroundOffsetX = Math.round(
			this.#drag.offsetX + pointerX,
		);
		this.#settings.backgroundOffsetY = Math.round(
			this.#drag.offsetY + pointerY,
		);
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
		this.#settings.background = this.#isJourney
			? JOURNEY_DEFAULT_BACKGROUND
			: "";
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
			"backgroundShadeHeight",
			"backgroundShadeStrength",
			"backgroundFadeHeight",
		]) {
			this.element
				.querySelectorAll(`[data-background-setting="${key}"]`)
				.forEach((input) => {
					input.value = this.#settings[key];
				});
		}
		for (const key of [
			"backgroundFlipX",
			"backgroundFlipY",
			"backgroundShadeEnabled",
			"backgroundFadeEnabled",
		]) {
			this.element
				.querySelectorAll(`[data-background-toggle="${key}"]`)
				.forEach((button) => {
					button.classList.toggle("active", this.#settings[key]);
					button.setAttribute("aria-pressed", String(this.#settings[key]));
					if (button instanceof HTMLInputElement) {
						button.checked = this.#settings[key];
					}
				});
		}
	}

	#artStyle() {
		const image = this.#settings.background;
		const position = `center ${this.#settings.backgroundAnchorY}`;
		return `background-image:url("${image}");background-position:${position};`;
	}

	async #persist() {
		const update = {
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
		};
		if (this.#isJourney) {
			Object.assign(update, {
				"system.backgroundShadeEnabled":
					this.#settings.backgroundShadeEnabled,
				"system.backgroundShadeHeight": this.#settings.backgroundShadeHeight,
				"system.backgroundShadeStrength":
					this.#settings.backgroundShadeStrength,
				"system.backgroundFadeEnabled": this.#settings.backgroundFadeEnabled,
				"system.backgroundFadeHeight": this.#settings.backgroundFadeHeight,
			});
		}
		await this.#item.update(update);
	}
}
