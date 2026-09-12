import { FellowshipAdvancementApp } from "../../apps/fellowship-advancement.js";
import { ThemeAdvancement } from "../../system/theme-advancement.js";
import { ThemeSources } from "../../system/theme-sources.js";
import { getOwningDocument, localize as t } from "../../utils.js";
import { ThemebookSheet } from "../themebook/themebook-sheet.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuid, fromUuidSync } = foundry.utils;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class FellowshipThemeSheet extends HandlebarsApplicationMixin(
	ItemSheetV2,
) {
	#customThemebookEditing = false;

	#handleCloseThemebooks = (event) => {
		const picker = this.element?.querySelector(
			".litm--fc-themebook-picker.open",
		);
		if (!picker || picker.contains(event.target)) return;
		picker.classList.remove("open");
		document.removeEventListener("click", this.#handleCloseThemebooks);
	};

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--fellowship-card"],
		tag: "form",
		position: { width: 1000, height: 600 },
		window: {
			resizable: true,
			title: (app) => app.document.name,
		},
		form: { submitOnChange: true },
		actions: {
			configureProgression: FellowshipThemeSheet.#onConfigureProgression,
		},
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/item/fellowship.html" },
	};

	get system() {
		return this.item.system;
	}

	/** Remove document-level picker listeners when the sheet closes. */
	async close(options) {
		document.removeEventListener("click", this.#handleCloseThemebooks);
		return super.close(options);
	}

	/** Add Fellowship actions to Foundry's standard window-controls menu. */
	_getHeaderControls() {
		return [
			...super._getHeaderControls(),
			{
				action: "configureProgression",
				icon: "fa-solid fa-sliders",
				label: "Litm.advancement.configure-progression",
			},
		];
	}

	static async #onConfigureProgression() {
		const system = this.item.system;
		const makeOptions = (maximum, selected) =>
			Array.from({ length: maximum }, (_, index) => {
				const value = index + 1;
				return `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`;
			}).join("");
		const result = await foundry.applications.api.DialogV2.wait({
			window: {
				title: game.i18n.localize("Litm.advancement.configure-progression"),
			},
			position: { width: 400 },
			classes: ["litm--progression-settings"],
			content: `<div class="standard-form">
				<div class="form-group"><label>${game.i18n.localize("Litm.advancement.experience-points")}</label><div class="form-fields"><select name="trackLength">${makeOptions(6, Number(system.improveTrackLength ?? 3))}</select></div></div>
				<div class="form-group"><label>${game.i18n.localize("Litm.advancement.improvements-per-track")}</label><div class="form-fields"><select name="awardSize">${makeOptions(3, Number(system.improvementsPerTrack ?? 1))}</select></div></div>
			</div>`,
			buttons: [
				{
					action: "cancel",
					label: game.i18n.localize("Litm.ui.cancel"),
					callback: () => null,
				},
				{
					action: "save",
					label: game.i18n.localize("Save"),
					icon: "fa-solid fa-floppy-disk",
					default: true,
					callback: (_event, _button, dialog) => ({
						trackLength: Number(
							dialog.element.querySelector('[name="trackLength"]')?.value,
						),
						awardSize: Number(
							dialog.element.querySelector('[name="awardSize"]')?.value,
						),
					}),
				},
			],
			rejectClose: false,
		});
		if (!result) return;
		const points = Math.max(0, Number(system.improve ?? 0));
		const completedTracks = Math.floor(points / result.trackLength);
		const availableImprovements =
			Number(system.availableImprovements ?? 0) +
			completedTracks * result.awardSize;
		await this.item.update({
			"system.improveTrackLength": result.trackLength,
			"system.improvementsPerTrack": result.awardSize,
			"system.improve": points % result.trackLength,
			"system.availableImprovements": availableImprovements,
		});
		if (completedTracks) {
			await ThemeAdvancement.notifyFellowship(
				this.item,
				"improve",
				availableImprovements,
			);
		}
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.system = this.document.system.toObject();
		context.system.improveTrackLength = Number(
			this.document.system.improveTrackLength ?? 3,
		);
		context.system.improvementsPerTrack = Number(
			this.document.system.improvementsPerTrack ?? 1,
		);
		context.document = this.document;
		context.title = this.item.name;
		context.isGM = game.user.isGM;
		context.campActive =
			game.litm?.CampDialog?.isActive?.(this.item.id) ?? false;

		const system = this.document.system;

		context.system.noteRaw = context.system.note;
		context.system.note = await TextEditor.enrichHTML(
			context.system.note || "",
		);
		context.system.levels = system.levels;

		const draftTags = system.draftTags || [];
		context.hasWeaknessDrafts = draftTags.some((d) => d.isWeakness);

		context.system.specials = await Promise.all(
			system.specials.map(async (special) => ({
				...special.toObject(),
				isEditing: this.#editingSpecials.has(special.id),
				enrichedDescription: await TextEditor.enrichHTML(
					special.description || "",
				),
			})),
		);

		const level = system.level || "origin";
		const fallbackSrc = ["origin", "adventure", "greatness"].includes(level)
			? level
			: "origin";
		context.transitionSrc = `systems/litm-rn/assets/media/transition-left-${fallbackSrc}-dark.webp`;
		context.currentLevelLabel = game.i18n.localize(
			`Litm.levels.${fallbackSrc}`,
		);
		context.themeiconsrc =
			CONFIG.litm.themeicon_src[system.level] ||
			`systems/litm-rn/assets/media/icons/${fallbackSrc}`;

		const themebooks = (await ThemeSources.getThemebooks({ fellowship: true }))
			.map((item) => {
				const might = item.system.might || "variable";
				const iconBase = CONFIG.litm.themeicon_src[might];
				return {
					uuid: item.uuid,
					name: item.name,
					might,
					icon:
						might === "variable"
							? "systems/litm-rn/assets/media/icons/variable-color_litm_icn.svg"
							: `${iconBase}-color-light_litm_icn.svg`,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		context.themebooks = themebooks;
		context.themebookGroups = ["origin", "adventure", "greatness", "variable"]
			.map((might) => ({
				label: game.i18n.localize(`Litm.theme-content.might-${might}`),
				items: themebooks.filter((item) => item.might === might),
			}))
			.filter((group) => group.items.length);
		context.linkedThemebook = system.themebookUuid
			? await fromUuid(system.themebookUuid)
			: null;
		context.customThemebookEditing =
			this.#customThemebookEditing ||
			(!system.themebookUuid && system.themebookCustom !== false);

		context.system.members = (context.system.members ?? []).map((m) => {
			const actor = game.actors?.get(m.actorId);
			return { ...m, img: actor?.img ?? CONST.DEFAULT_TOKEN };
		});

		return context;
	}

	async _processSubmitData(event, form, formData) {
		await super._processSubmitData(event, form, formData);
		const sys = this.item.system;
		if (sys.themeTag?.name && this.item.name !== sys.themeTag.name) {
			await this.item.update({ name: sys.themeTag.name });
		}
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const form = this.element;

		form
			.querySelectorAll("[data-click]")
			.forEach((el) => el.addEventListener("click", this.#onClick.bind(this)));
		form
			.querySelectorAll("[data-context]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#onContext.bind(this)),
			);
		form
			.querySelector("[data-themebook-search]")
			?.addEventListener("input", (event) =>
				this.#filterThemebooks(event.currentTarget.value),
			);
		if (this.#customThemebookEditing) {
			requestAnimationFrame(() => {
				const input = this.element?.querySelector(".litm--fc-themebook-custom");
				input?.focus();
				input?.select();
			});
		}
		form
			.querySelectorAll("[data-drag-special]")
			.forEach((el) =>
				el.addEventListener("dragstart", this.#onSpecialDragStart.bind(this)),
			);

		form.querySelectorAll("[data-input]").forEach((el) => {
			el.addEventListener("input", (event) => {
				const t = event.currentTarget;
				const input = t.parentElement.querySelector(`input#${t.dataset.input}`);
				if (input) input.value = t.textContent || t.value;
				t.classList.toggle("empty", !t.innerText.trim());
			});
			el.addEventListener("blur", (event) => {
				this.#focusTarget = event.relatedTarget?.dataset?.input || null;
				const t = event.currentTarget;
				const targetId = t.dataset.input;
				const input = t.parentElement.querySelector(`input#${targetId}`);
				if (input) input.dispatchEvent(new Event("change", { bubbles: true }));
			});
			el.classList.toggle("empty", !el.innerText.trim());
		});

		if (this.#focusTarget) {
			const next = this.element.querySelector(
				`[data-input="${this.#focusTarget}"]`,
			);
			if (next) {
				const doc = getOwningDocument(next);
				const sel = doc.defaultView.getSelection();
				const range = doc.createRange();
				range.selectNodeContents(next);
				sel.removeAllRanges();
				sel.addRange(range);
				next.focus();
			}
			this.#focusTarget = null;
		}

		if (this.#dropReady) return;
		this.#dropReady = true;
		this.element.addEventListener("dragover", (e) => e.preventDefault());
	}

	async _onDrop(dragEvent) {
		const data = game.litm.specials.readSpecialDragData(dragEvent);
		if (data) return this.#onDropSpecial(dragEvent, data);
		return super._onDrop(dragEvent);
	}

	#dropReady = false;
	#focusTarget = null;
	#editingSpecials = new Set();

	#onClick(event) {
		const btn = event.currentTarget;
		const action = btn.dataset.click;
		const id = btn.dataset.id;
		switch (action) {
			case "open-fellowship-advancement":
				event.stopPropagation();
				new FellowshipAdvancementApp(this.item.uuid).render({ force: true });
				break;
			case "add-power-tag":
				this.#addTag("powerCrispy");
				break;
			case "add-weakness-tag":
				this.#addTag("weaknessTag");
				break;
			case "add-special":
				this.#addSpecial();
				break;
			case "add-draft-tag":
				this.#addDraftTag();
				break;
			case "promote-draft":
				this.#promoteDraft(id);
				break;
			case "toggle-draft-weakness":
				this.#toggleDraftWeakness(id);
				break;
			case "increase":
				this.#increase(btn.dataset.id);
				break;
			case "open-levels":
				this.#openLevels(event);
				break;
			case "select-level":
				this.#selectLevel(event);
				break;
			case "remove-power-tag":
				this.#removeTag(btn, "powerCrispy");
				break;
			case "remove-weakness-tag":
				this.#removeTag(btn, "weaknessTag");
				break;
			case "remove-draft-tag":
				this.#removeDraftTag(id);
				break;
			case "toggle-edit-special":
				this.#toggleEditSpecial(id);
				break;
			case "remove-special-tag":
				this.#removeSpecial(btn);
				break;
			case "send-special-to-chat":
				this.#sendSpecialToChat(btn.dataset.specialId);
				break;
			case "add-fellowship-member":
				this.#addFellowshipMember();
				break;
			case "remove-fellowship-member":
				this.#removeFellowshipMember(id);
				break;
			case "open-member-actor":
				this.#openMemberActor(id);
				break;
			case "select-themebook":
				this.#selectThemebook(btn.dataset.uuid);
				break;
			case "toggle-themebooks":
				this.#toggleThemebooks(event);
				break;
			case "select-custom-themebook":
				this.#selectCustomThemebook();
				break;
			case "open-themebook":
				this.#openThemebook(btn.dataset.uuid);
				break;
			case "open-camp":
				if (game.user.isGM) game.litm?.CampDialog?.launch?.(this.item.id);
				break;
		}
	}

	#onContext(event) {
		const btn = event.currentTarget;
		switch (btn.dataset.context) {
			case "decrease":
				this.#decrease(btn.dataset.id);
				break;
		}
	}

	#handleCloseLevels = (event) => {
		if (!this.element) {
			event.currentTarget?.removeEventListener(
				"click",
				this.#handleCloseLevels,
			);
			return;
		}
		const dropdown = this.element.querySelector(".litm--image-dropdown.open");
		if (!dropdown) return;
		const icon = dropdown.querySelector(".selected-image i.fas");
		if (dropdown.contains(event.target)) return;
		dropdown.classList.remove("open");
		icon?.classList.toggle("fa-angle-down", true);
		icon?.classList.toggle("fa-angle-up", false);
		event.currentTarget?.removeEventListener("click", this.#handleCloseLevels);
	};

	#openLevels(event) {
		const dropdown = event.currentTarget.closest(".litm--image-dropdown");
		if (!dropdown) return;
		const icon = dropdown.querySelector(".selected-image i.fas");
		dropdown.classList.toggle("open");
		icon?.classList.toggle("fa-angle-down");
		icon?.classList.toggle("fa-angle-up");
		if (dropdown.classList.contains("open")) {
			dropdown.ownerDocument.addEventListener("click", this.#handleCloseLevels);
		} else {
			dropdown.ownerDocument.removeEventListener(
				"click",
				this.#handleCloseLevels,
			);
		}
	}

	async #selectLevel(event) {
		const option = event.currentTarget;
		const value = option.dataset.value;
		const dropdown = option.closest(".litm--image-dropdown");
		if (!dropdown) return;
		const input = dropdown.querySelector("input[type=hidden]");
		if (input) input.value = value;
		await this.item.update({ "system.level": value });
		this.render();
	}

	async #addTag(type) {
		const item = {
			name: t("Litm.ui.name-tag"),
			isScratched: false,
			type: type,
			id: foundry.utils.randomID(),
		};

		let tags = null;
		if (type === "powerCrispy") {
			tags = this.system.powerTags;
			tags.push(item);
			await this.item.update({ "system.powerTags": tags });
		} else {
			tags = this.system[`${type}s`];
			tags.push(item);
			await this.item.update({ [`system.${type}s`]: tags });
		}
	}

	async #removeTag(button, type) {
		const id = button.dataset.id;
		let tags = null;
		if (type === "powerCrispy") {
			tags = this.system.powerTags.filter((t) => t.id !== id);
			await this.item.update({ "system.powerTags": tags });
		} else {
			tags = this.system[`${type}s`].filter((t) => t.id !== id);
			await this.item.update({ [`system.${type}s`]: tags });
		}
	}

	async #addSpecial() {
		const item = {
			name: t("Litm.ui.name-special"),
			description: t("Litm.ui.name-special-description"),
			id: foundry.utils.randomID(),
		};

		const specials = this.system.specials;
		specials.push(item);

		await this.item.update({ "system.specials": specials });
	}

	async #removeSpecial(button) {
		const id = button.dataset.id;
		const specials = this.system.specials.filter((t) => t.id !== id);

		await this.item.update({ "system.specials": specials });
	}

	async #toggleEditSpecial(specialId) {
		if (this.#editingSpecials.has(specialId)) {
			const row = this.element.querySelector(
				`[data-special-id="${specialId}"]`,
			);
			if (row) {
				const nameEl = row.querySelector("[data-input^='special-name']");
				const descEl = row.querySelector("[data-input^='special-desc']");
				const specials = foundry.utils.deepClone(
					this.system.specials.map((s) => (s.toObject ? s.toObject() : s)),
				);
				const special = specials.find((s) => s.id === specialId);
				if (special) {
					if (nameEl) special.name = nameEl.textContent.trim();
					if (descEl) special.description = descEl.textContent.trim();
					await this.item.update({ "system.specials": specials });
				}
			}
			this.#editingSpecials.delete(specialId);
		} else {
			this.#editingSpecials.add(specialId);
		}
		this.render();
	}

	async #sendSpecialToChat(specialId) {
		const special = this.system.specials.find((s) => s.id === specialId);
		if (!special) return;
		const enriched = await TextEditor.enrichHTML(special.description || "");
		CONFIG.ChatMessage.documentClass.create({
			content: `<strong>${special.name}</strong>: ${enriched}`,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: this.actor,
			}),
		});
	}

	async #addDraftTag() {
		const drafts = this.system.draftTags;
		drafts.push({
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-tag"),
			isWeakness: false,
		});

		await this.item.update({ "system.draftTags": drafts });
	}

	async #removeDraftTag(id) {
		const drafts = this.system.draftTags.filter((d) => d.id !== id);

		await this.item.update({ "system.draftTags": drafts });
	}

	async #toggleDraftWeakness(id) {
		const drafts = this.system.draftTags;
		const draft = drafts.find((d) => d.id === id);
		if (!draft) return;

		draft.isWeakness = !draft.isWeakness;
		await this.item.update({ "system.draftTags": drafts });
	}

	async #promoteDraft(id) {
		const drafts = this.system.draftTags;
		const draftIndex = drafts.findIndex((d) => d.id === id);
		if (draftIndex === -1) return;

		const draft = drafts[draftIndex];
		const isWeakness = draft.isWeakness;
		const tagType = isWeakness ? "weaknessTag" : "powerCrispy";
		const fieldType = isWeakness ? "weaknessTag" : "powerTag";
		const newTag = {
			name: draft.name,
			isScratched: false,
			type: tagType,
			id: foundry.utils.randomID(),
		};

		const tags = foundry.utils.deepClone(this.system[`${fieldType}s`]);
		tags.push(newTag);

		drafts.splice(draftIndex, 1);

		await this.item.update({
			[`system.${fieldType}s`]: tags,
			"system.draftTags": drafts,
		});
	}

	async #increase(field) {
		const track = field.replace("system.", "");
		await ThemeAdvancement.increaseFellowshipTrack(this.item, track);
	}

	async #selectThemebook(uuid) {
		const source = uuid ? await fromUuid(uuid) : null;
		if (!source || source.type !== "themebook" || !source.system.isFellowship)
			return;
		await this.item.update({
			"system.themebook": source.name,
			"system.themebookUuid": source.uuid,
			"system.themebookCustom": false,
		});
		this.#customThemebookEditing = false;
		this.render();
	}

	async #selectCustomThemebook() {
		this.#customThemebookEditing = true;
		await this.item.update({
			"system.themebook": this.system.themebookCustom
				? this.system.themebook
				: "",
			"system.themebookUuid": "",
			"system.themebookCustom": true,
		});
		this.render();
	}

	#toggleThemebooks(event) {
		event.preventDefault();
		event.stopImmediatePropagation();
		const picker = event.currentTarget.closest(".litm--fc-themebook-picker");
		if (!picker) return;
		picker.classList.toggle("open");
		if (picker.classList.contains("open")) {
			document.addEventListener("click", this.#handleCloseThemebooks);
			requestAnimationFrame(() =>
				picker.querySelector("[data-themebook-search]")?.focus(),
			);
		} else document.removeEventListener("click", this.#handleCloseThemebooks);
	}

	#filterThemebooks(query) {
		const normalized = query.trim().toLocaleLowerCase();
		this.element.querySelectorAll("[data-themebook-row]").forEach((row) => {
			row.hidden =
				Boolean(normalized) &&
				!row.dataset.search.toLocaleLowerCase().includes(normalized);
		});
		this.element.querySelectorAll("[data-themebook-group]").forEach((group) => {
			group.hidden = !group.querySelector("[data-themebook-row]:not([hidden])");
		});
	}

	async #openThemebook(uuid) {
		const source = uuid ? await fromUuid(uuid) : null;
		const level = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
		if (
			source?.type !== "themebook" ||
			!source.testUserPermission(game.user, level)
		) {
			ui.notifications.error(t("Litm.themebook-picker.permission-error"));
			return;
		}
		new ThemebookSheet({
			document: source,
			id: `litm-themebook-fellowship-${this.item.id}`,
			forceObserver: true,
			fellowshipUuid: this.item.uuid,
		}).render({ force: true });
	}

	async #decrease(field) {
		const track = field.replace("system.", "");
		await ThemeAdvancement.decreaseFellowshipTrack(this.item, track);
	}

	async #addFellowshipMember() {
		if (!game.user.isGM) return;

		const available =
			game.actors?.filter(
				(a) => a.type === "character" && !a.system?.fellowshipId,
			) ?? [];

		const picked = await new Promise((resolve) => {
			const gridHtml = available.length
				? `
          <div class="litm--fc-member-pick-header">${t("Litm.other.heroes")}</div>
          <div class="litm--fc-member-pick-grid">
            ${available
							.map(
								(a) => `
              <div class="litm--fc-member-pick-card" data-actor-id="${a.id}">
                <img src="${a.img}" alt="${a.name}" data-tooltip="${a.name}">
              </div>
            `,
							)
							.join("")}
          </div>`
				: "";

			const content = `
        <div class="litm--fc-member-pick">
          ${gridHtml}
          <div class="litm--fc-member-pick-dropzone">
            ${t("Litm.ui.drop-actor-hint")}
          </div>
        </div>`;

			const dialog = new foundry.applications.api.DialogV2({
				window: { title: t("Litm.ui.add-member") },
				content,
				buttons: [
					{
						action: "cancel",
						label: t("Litm.ui.cancel"),
						callback: () => resolve(null),
					},
				],
				rejectClose: false,
			});

			dialog.render(true);

			requestAnimationFrame(() => {
				const el = dialog.element;
				if (!el) return;

				el.querySelectorAll("[data-actor-id]").forEach((card) => {
					card.addEventListener("click", () => {
						resolve(card.dataset.actorId);
						dialog.close();
					});
				});

				const dropZone = el.querySelector(".litm--fc-member-pick-dropzone");
				if (!dropZone) return;

				dropZone.addEventListener("dragover", (e) => {
					e.preventDefault();
					dropZone.classList.add("litm--fc-member-pick-dropzone--hover");
				});

				dropZone.addEventListener("dragleave", () => {
					dropZone.classList.remove("litm--fc-member-pick-dropzone--hover");
				});

				dropZone.addEventListener("drop", async (e) => {
					e.preventDefault();
					dropZone.classList.remove("litm--fc-member-pick-dropzone--hover");

					let actor;
					try {
						const raw = e.dataTransfer.getData("text/plain");
						const data = JSON.parse(raw);
						if (data.uuid) actor = fromUuidSync(data.uuid);
						else if (data.id) actor = game.actors?.get(data.id);
					} catch (_) {
						/* ignore parse errors */
					}

					if (!actor) {
						ui.notifications.warn(t("Litm.ui.invalid-actor-drop"));
						return;
					}

					if (
						actor.system?.fellowshipId ||
						this.#isActorInAnyFellowship(actor.id)
					) {
						ui.notifications.warn(t("Litm.ui.actor-already-in-fellowship"));
						return;
					}

					resolve(actor.id);
					dialog.close();
				});
			});
		});

		if (!picked) return;

		const actor = game.actors?.get(picked);
		if (!actor) return;

		const members = foundry.utils.deepClone(this.system.members ?? []);
		members.push({ actorId: actor.id, name: actor.name });

		await this.item.update({
			"system.members": members,
		});

		if (actor.type === "character") {
			await actor.update({ "system.fellowshipId": this.item.id });
		}
		this.render();
	}

	#isActorInAnyFellowship(actorId) {
		return (
			game.items?.some(
				(i) =>
					i.type === "fellowship" &&
					i.system.members?.some((m) => m.actorId === actorId),
			) ?? false
		);
	}

	async #removeFellowshipMember(actorId) {
		if (!game.user.isGM) return;

		const members = (this.system.members ?? []).filter(
			(m) => m.actorId !== actorId,
		);
		await this.item.update({ "system.members": members });

		const actor = game.actors?.get(actorId);
		if (actor?.type === "character") {
			await actor.update({ "system.fellowshipId": null });
		}
		this.render();
	}

	#openMemberActor(actorId) {
		const actor = game.actors?.get(actorId);
		if (actor?.sheet?.render) actor.sheet.render(true);
	}

	#onSpecialDragStart(event) {
		const el = event.currentTarget;
		const specialId = el.dataset.dragSpecial;
		const containerPath = el.dataset.dragSpecialPath;
		if (!specialId || !containerPath) return;

		const specials = foundry.utils.deepClone(
			foundry.utils.getProperty(this.item.toObject(), containerPath) || [],
		);
		const special = specials.find((s) => s.id === specialId);
		if (!special) return;

		const dragData = game.litm.specials.makeSpecialDragData(
			special,
			this.item.uuid,
			containerPath,
		);
		event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		event.dataTransfer.effectAllowed = "copyMove";
	}

	async #onDropSpecial(event, data) {
		const containerPath = "system.specials";
		if (data.source?.containerPath === containerPath) return;
		await game.litm.specials.addSpecialToContainer(
			this.item,
			containerPath,
			data.special,
		);
		this.render();
	}
}
