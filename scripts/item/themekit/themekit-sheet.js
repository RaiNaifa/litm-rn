import { ThemeSources } from "../../system/theme-sources.js";
import { ThemeContentSheet } from "../themebook/theme-content-sheet.js";

const TextEditor = foundry.applications.ux.TextEditor.implementation;
const { fromUuid } = foundry.utils;

/** Sidebar Item sheet for authoring premade Theme Kits. */
export class ThemeKitSheet extends ThemeContentSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--theme-content", "litm--themekit"],
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/item/themekit.html" },
	};

	/** Keep read-only controls interactive for users who can observe the Theme Kit. */
	get isEditable() {
		const limited = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
		if (this.item.testUserPermission(game.user, limited)) return true;
		return super.isEditable;
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const system = this.item.system.toObject();
		const canEdit = game.user.isGM || this.item.isOwner;
		const themebooks = await ThemeSources.getThemebooks();
		const linked = themebooks.find(
			(item) => item.uuid === system.themebookUuid,
		);
		const previewMight = system.mightOverride || "origin";
		const darkTheme = document.body.classList.contains("theme-dark");
		const iconSrc = (might) => {
			const variant =
				darkTheme && might !== "variable" ? "-color-light" : "-color";
			return `${CONFIG.litm.themeicon_src[might]}${variant}_litm_icn.svg`;
		};
		const compatibleThemebooks = themebooks.filter(
			(item) =>
				item.system.might === previewMight || item.system.might === "variable",
		);
		const themebookOptions = compatibleThemebooks
			.map((item) => {
				const might = item.system.might;
				const iconMight =
					might === "variable"
						? item.system.suggestedMight || previewMight
						: might;
				return {
					uuid: item.uuid,
					name: item.name,
					might,
					isVariable: might === "variable",
					icon: iconSrc(iconMight),
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		const selectedThemebook = themebookOptions.find(
			(item) => item.uuid === system.themebookUuid,
		);
		return {
			...context,
			document: this.item,
			system: {
				...system,
				specials: await this._prepareSpecialEntries(system.specials),
				descriptionEnriched: await TextEditor.enrichHTML(
					system.description || "",
				),
			},
			themebooks: themebookOptions,
			selectedThemebook,
			linkedThemebookMissing:
				canEdit && Boolean(system.themebookUuid && !linked),
			canEdit,
			readOnly: !canEdit,
			standardMightOptions: ["origin", "adventure", "greatness"],
			mightDropdownOptions: ["origin", "adventure", "greatness"].map(
				(might) => ({
					key: might,
					label: game.i18n.localize(`Litm.theme-content.might-${might}`),
					icon: iconSrc(might),
				}),
			),
			currentMightLabel: game.i18n.localize(
				`Litm.theme-content.might-${previewMight}`,
			),
			currentMightIcon: iconSrc(previewMight),
			previewMight,
			transitionSrc: `systems/litm-rn/assets/media/transition-left-${previewMight}-dark.webp`,
			hasCustomBackground: Boolean(system.background),
			backgroundArtStyle: this.#backgroundArtStyle(system),
			defaultDescription: game.i18n.localize(
				"Litm.theme-content.default-description",
			),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element.classList.toggle("litm--content-readonly", context.readOnly);
	}

	/** @override */
	async _processSubmitData(event, form, formData) {
		if (!game.user.isGM && !this.item.isOwner) return;
		return super._processSubmitData(event, form, formData);
	}

	/** @override */
	async _onContentAction(event) {
		event.preventDefault();
		const button = event.currentTarget;
		const action = button.dataset.contentAction;
		if (action === "open-themebook") {
			event.stopPropagation();
			const themebook = await fromUuid(this.system.themebookUuid);
			if (!themebook) {
				ui.notifications.error(
					game.i18n.localize("Litm.themebook-picker.permission-error"),
				);
				return;
			}
			themebook.sheet.render(true);
			return;
		}
		if (!game.user.isGM && !this.item.isOwner) return;
		const path = button.dataset.path;
		const id = button.dataset.id;
		if (action === "add-tag") {
			const weakness = path === "weaknessTags";
			await this._appendEntry(path, {
				id: foundry.utils.randomID(),
				name: game.i18n.localize(
					weakness ? "Litm.ui.name-weakness" : "Litm.ui.name-power",
				),
				type: weakness ? "weaknessTag" : "powerTag",
				isScratched: false,
			});
		} else if (action === "remove-entry") {
			await this._removeEntry(path, id, { confirm: path === "specials" });
		} else if (action === "add-special") {
			await this._appendEditingSpecial({
				id: foundry.utils.randomID(),
				name: game.i18n.localize("Litm.ui.name-special"),
				description: game.i18n.localize("Litm.ui.name-special-description"),
			});
		} else if (action === "toggle-special-edit") {
			await this._toggleSpecialEdit(button);
		} else if (action === "select-themebook") {
			event.stopPropagation();
			await this.item.update({
				"system.themebookUuid": button.dataset.uuid || "",
				"system.themebookName": button.dataset.name || "",
			});
		}
	}

	/** @override */
	async _prepareMightUpdate(field, value) {
		if (field !== "system.mightOverride" || !this.system.themebookUuid)
			return {};
		const themebook = await fromUuid(this.system.themebookUuid);
		if (!themebook || ["variable", value].includes(themebook.system.might))
			return {};
		return {
			"system.themebookUuid": "",
			"system.themebookName": "",
		};
	}

	#backgroundArtStyle(system) {
		if (!system.background) return "";
		const position = `center ${system.backgroundAnchorY || "center"}`;
		return `background-image:url("${system.background}");background-position:${position};`;
	}
}
