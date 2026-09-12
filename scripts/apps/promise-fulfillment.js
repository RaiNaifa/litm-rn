import { getAssignedUser } from "../utils.js";
import { enhanceAdvancementSelects } from "./advancement-select.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuidSync } = foundry.utils;

/** Temporary workflow for spending accumulated Moments of Fulfillment. */
export class PromiseFulfillmentApp extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-promise-fulfillment",
		classes: ["litm", "litm--theme-advancement", "litm--promise-fulfillment"],
		position: { width: 660, height: 520 },
		window: { resizable: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/promise-fulfillment.html",
		},
	};

	constructor(actorUuid, options = {}) {
		super(options);
		this.actor = fromUuidSync(actorUuid);
		this.scrollPosition = 0;
		this.dismissController = null;
	}

	/** @override */
	async close(options) {
		this.dismissController?.abort();
		this.dismissController = null;
		return super.close(options);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		return {
			...context,
			actor: this.actor,
			available: Number(this.actor.system.availableFulfillments ?? 0),
			options: CONFIG.litm.fulfillment.map((value) => ({
				value,
				label: game.i18n.localize(`Litm.fulfillment.${value}`),
			})),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.dismissController?.abort();
		this.dismissController = new AbortController();
		const { signal } = this.dismissController;
		enhanceAdvancementSelects(this.element, signal);
		document.addEventListener(
			"pointerdown",
			(event) => {
				for (const picker of this.element.querySelectorAll(
					".litm--advancement-select.open",
				)) {
					if (!picker.contains(event.target)) picker.classList.remove("open");
				}
			},
			{ capture: true, signal },
		);
		document.addEventListener(
			"keydown",
			(event) => {
				if (event.key !== "Escape") return;
				this.element
					.querySelectorAll(".litm--advancement-select.open")
					.forEach((picker) => picker.classList.remove("open"));
			},
			{ signal },
		);
		const scroll = this.element.querySelector(".litm--advancement-content");
		if (scroll) {
			scroll.scrollTop = this.scrollPosition;
			scroll.addEventListener(
				"scroll",
				() => {
					this.scrollPosition = scroll.scrollTop;
				},
				{ passive: true },
			);
		}
		this.element
			.querySelector("[data-fulfillment-action='choose']")
			?.addEventListener("click", () => this.#choose());
	}

	async #choose() {
		const available = Number(this.actor.system.availableFulfillments ?? 0);
		const select = this.element.querySelector('[name="fulfillment"]');
		if (!available || !select?.value) return;
		const label = select.selectedOptions[0]?.textContent.trim() ?? select.value;
		const recipients = new Set(
			game.users.filter((user) => user.isGM).map((user) => user.id),
		);
		const assigned = getAssignedUser(this.actor);
		if (assigned) recipients.add(assigned.id);
		await CONFIG.ChatMessage.documentClass.create({
			content: `<p>${game.i18n.format("Litm.promise-fulfillment.chat-choice", {
				actor: this.actor.name,
				choice: label,
			})}</p>`,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: this.actor,
			}),
			whisper: [...recipients],
		});
		await this.actor.update({
			"system.availableFulfillments": Math.max(0, available - 1),
		});
		if (available <= 1) this.close();
		else this.render();
	}
}
