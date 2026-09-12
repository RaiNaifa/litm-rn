import {
	getFellowshipActors,
	getOwningDocument,
	getOwningWindow,
	isFellowshipMember,
} from "../utils.js";
const { fromUuidSync } = foundry.utils;

/**
 * RollTargetPopup — floating popup to pick a character for tag roll selection.
 *
 * Shows only characters from the active fellowship (selected in Tag Manager).
 * Usage:
 *   RollTargetPopup.show(event, { tagId, tagName, ref })
 *     .then(result => { if (result) game.litm.addTagToRoll(...) })
 */
export class RollTargetPopup {
	/** @type {HTMLElement|null} */
	static #popup = null;
	static #resolve = null;
	static #state = "positive";

	/**
	 * Show the popup near the event target.
	 * @param {PointerEvent} event
	 * @param {{ tagId: string, tagName: string, ref: string }} options
	 * @returns {Promise<{ action: 'add'|'remove', actorId: string, state: string }|null>}
	 */
	static show(event, { tagId, tagName, ref } = {}) {
		this.hide();
		const doc = getOwningDocument(event);
		const win = getOwningWindow(event);

		const characters = this.#getTargetActors();
		if (characters.length === 0) {
			ui.notifications.warn(
				game.i18n.localize("Litm.ui.no-characters-for-roll"),
			);
			return Promise.resolve(null);
		}

		// Check if the SOURCE actor (whose tag is being clicked) is in the tag manager
		// in either Story Tags or Scene Tags.
		const storyConfig = game.settings.get("litm-rn", "storytags") || {
			actors: [],
		};
		const storyActorRefs = new Set(storyConfig.actors || []);
		const sceneConfig = canvas.scene?.getFlag("litm-rn", "scenetags") || {
			actors: [],
		};
		const sceneActorRefs = new Set(
			(sceneConfig.actors || []).map((a) => a.ref),
		);
		const fellowshipId =
			game.settings.get("litm-rn", "selectedFellowship") || null;
		const sourceActor = fromUuidSync(ref);
		const isFellowshipActor =
			!!fellowshipId && isFellowshipMember(fellowshipId, sourceActor?.id);
		const sourceInManager =
			ref === "story" ||
			ref === "scene" ||
			ref === "fellowship" ||
			ref?.startsWith("story-theme-") ||
			storyActorRefs.has(ref) ||
			sceneActorRefs.has(ref) ||
			isFellowshipActor;

		// Create popup element
		const popup = doc.createElement("div");
		popup.className = "litm--roll-target-popup";
		popup.dataset.tagId = tagId;
		popup.dataset.ref = ref;
		popup.setAttribute("tabindex", "-1");

		// Warning if source actor is not in the tag manager
		if (!sourceInManager) {
			const actorName = sourceActor?.name || ref;
			const warning = doc.createElement("div");
			warning.className = "litm--roll-target-warning";
			warning.textContent = game.i18n.format("Litm.ui.not-in-tag-manager", {
				actor: actorName,
			});
			popup.appendChild(warning);
		}

		// State toggle with icon
		const toggleRow = doc.createElement("div");
		toggleRow.className = "litm--roll-target-toggle";
		const toggleBtn = doc.createElement("button");
		toggleBtn.type = "button";
		toggleBtn.className = "litm--roll-target-state-btn";
		const toggleIcon = doc.createElement("img");
		toggleIcon.src =
			"systems/litm-rn/assets/media/icons/weakness-marker-litm_inactive.svg";
		toggleIcon.alt = "";
		toggleIcon.className = "litm--roll-target-state-icon";
		const toggleLabel = doc.createElement("span");
		toggleLabel.textContent = game.i18n.localize("Litm.ui.helping");
		toggleBtn.appendChild(toggleIcon);
		toggleBtn.appendChild(toggleLabel);
		toggleBtn.dataset.state = "positive";
		toggleBtn.addEventListener("click", () => {
			this.#state = this.#state === "positive" ? "negative" : "positive";
			toggleIcon.src = `systems/litm-rn/assets/media/icons/weakness-marker-litm_${this.#state === "positive" ? "inactive" : "active"}.svg`;
			toggleLabel.textContent = game.i18n.localize(
				this.#state === "positive" ? "Litm.ui.helping" : "Litm.ui.hindering",
			);
			toggleBtn.dataset.state = this.#state;
		});
		toggleRow.appendChild(toggleBtn);
		popup.appendChild(toggleRow);

		// Label
		const label = doc.createElement("div");
		label.className = "litm--roll-target-label";
		label.textContent = game.i18n.format("Litm.ui.select-roll-target", {
			tag: tagName || "",
		});
		popup.appendChild(label);

		// Portraits row
		const portraits = doc.createElement("div");
		portraits.className = "litm--roll-target-portraits";
		for (const actor of characters) {
			const isSelected =
				game.litm?.isTagSelectedForActor?.(actor.id, ref, tagId) ?? false;
			const btn = doc.createElement("button");
			btn.type = "button";
			btn.className = `litm--roll-target-actor${isSelected ? " selected" : ""}`;
			btn.dataset.actorId = actor.id;
			btn.dataset.tooltip = actor.name;
			const img = doc.createElement("img");
			img.src = actor.img;
			img.alt = actor.name;
			img.loading = "eager";
			btn.appendChild(img);
			btn.addEventListener("click", () => {
				if (this.#resolve) {
					if (isSelected) {
						this.#resolve({
							action: "remove",
							actorId: actor.id,
							state: this.#state,
						});
					} else {
						this.#resolve({
							action: "add",
							actorId: actor.id,
							state: this.#state,
						});
					}
					this.#resolve = null;
				}
				this.hide();
			});
			portraits.appendChild(btn);
		}
		popup.appendChild(portraits);

		// Close on click outside
		const closeHandler = (e) => {
			if (!popup.contains(e.target)) {
				this.hide();
				doc.removeEventListener("mousedown", closeHandler);
				popup.removeEventListener("blur", blurHandler);
			}
		};
		// Close on focus loss — listen on popup's own blur event instead of
		// document focusin, to avoid closing when focus moves to a sibling
		// element (e.g. tag name with contenteditable) during the same click.
		const blurHandler = () => {
			// Use rAF so document.activeElement has settled after the focus change
			win.requestAnimationFrame(() => {
				if (!popup.contains(doc.activeElement)) {
					this.hide();
					doc.removeEventListener("mousedown", closeHandler);
					popup.removeEventListener("blur", blurHandler);
				}
			});
		};
		win.requestAnimationFrame(() => {
			doc.addEventListener("mousedown", closeHandler);
			popup.addEventListener("blur", blurHandler);
			popup.focus();
		});

		doc.body.appendChild(popup);

		// Position near event
		const rect = event.target?.getBoundingClientRect?.();
		if (rect) {
			let top = rect.bottom + 4;
			let left = rect.left;
			const popupRect = popup.getBoundingClientRect();
			if (left + popupRect.width > win.innerWidth) {
				left = win.innerWidth - popupRect.width - 8;
			}
			if (top + popupRect.height > win.innerHeight) {
				top = rect.top - popupRect.height - 4;
			}
			top = Math.max(4, top);
			left = Math.max(4, left);
			// If popup still overflows viewport after clamping, enable scroll
			if (top + popupRect.height > win.innerHeight) {
				popup.style.overflowY = "auto";
				popup.style.maxHeight = `${win.innerHeight - top - 4}px`;
			}
			popup.style.top = `${top}px`;
			popup.style.left = `${left}px`;
		} else {
			popup.style.top = "50%";
			popup.style.left = "50%";
			popup.style.transform = "translate(-50%, -50%)";
		}

		this.#popup = popup;

		return new Promise((resolve) => {
			this.#resolve = resolve;
		});
	}

	/**
	 * Get characters that can receive tag roll selections:
	 * Only characters in the active fellowship (selected in Tag Manager).
	 */
	static #getTargetActors() {
		const fellowshipId =
			game.settings.get("litm-rn", "selectedFellowship") || null;
		if (!fellowshipId) return [];

		return getFellowshipActors(fellowshipId).filter(
			(actor) => actor.type === "character",
		);
	}

	/** Close the popup without selecting */
	static hide() {
		if (this.#popup) {
			this.#popup.remove();
			this.#popup = null;
		}
		if (this.#resolve) {
			this.#resolve(null);
			this.#resolve = null;
		}
		this.#state = "positive";
	}
}
