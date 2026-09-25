import { ReferenceHandbook } from "../apps/reference-handbook.js";
import { localize as t } from "../utils.js";
import { registerPrivateCreationKeybinding } from "./private-creation.js";

export class KeyBindings {
	static register() {
		registerPrivateCreationKeybinding();
		game.keybindings.register("litm-rn", "openReferenceHandbook", {
			name: t("Litm.reference.open-keybinding"),
			hint: t("Litm.reference.open-keybinding-hint"),
			editable: [
				{
					key: "KeyI",
				},
			],
			onDown: () => {
				ReferenceHandbook.toggle();
				return true;
			},
			onUp: () => {},
			restricted: false,
			precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});

		game.keybindings.register("litm-rn", "openDiceRoller", {
			name: t("Litm.ui.dice-roller"),
			hint: t("Litm.ui.dice-roller-hint"),
			editable: [
				{
					key: "KeyR",
				},
			],
			onDown: () => {
				const token = canvas?.tokens?.controlled?.[0];
				const actor = token?.actor;

				if (actor?.sheet) {
					if (game.user.isGM || actor.isOwner) {
						return actor.sheet.renderRollDialog({ toggle: true });
					}
				}

				// GM with hovered character token → open GM dialog on that character's tab
				if (game.user.isGM && canvas?.mousePosition) {
					const hoveredToken = canvas.tokens?.placeables?.find((t) =>
						t.hitArea?.contains(canvas.mousePosition.x, canvas.mousePosition.y),
					);
					if (hoveredToken?.actor?.type === "character") {
						const dialog = game.litm?.gmRollDialog;
						if (dialog?.rendered) {
							dialog.switchTab(hoveredToken.actor.id);
						} else {
							game.litm.LitmRollDialog.openForGm(hoveredToken.actor.id);
						}
						return;
					}
				}

				// GM fallback: open the GM roll dialog for the active fellowship
				if (game.user.isGM) {
					game.litm?.LitmRollDialog?.toggleGmDialog?.();
					return;
				}

				// Player fallback: try user-assigned character
				const sheet = game.user.character?.sheet;
				if (sheet) {
					return sheet.renderRollDialog({ toggle: true });
				}

				return ui.notifications.warn("Litm.ui.warn-no-character", {
					localize: true,
				});
			},
			onUp: () => {},
			restricted: false,
			precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});

		game.keybindings.register("litm-rn", "openTagManager", {
			name: t("Litm.ui.manage-tags"),
			hint: t("Litm.ui.manage-tags-hint"),
			editable: [
				{
					key: "KeyT",
				},
			],
			onDown: () => {
				const tab = ui.combat;
				if (!tab) return true;

				if (tab.popout?.rendered) {
					tab.popout.close().catch(() => {});
				} else {
					tab.renderPopout().catch(() => {});
				}
				return true;
			},
			onUp: () => {},
			restricted: false,
			precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});
	}
}
