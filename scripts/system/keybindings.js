import { localize as t } from "../utils.js";

export class KeyBindings {
	static register() {
		game.keybindings.register("litm-rn", "openDiceRoller", {
			name: t("Litm.ui.dice-roller"),
			hint: t("Litm.ui.dice-roller-hint"),
			editable: [
				{
					key: "KeyR",
				},
			],
			onDown: () => {
				const token = canvas.tokens.controlled[0];
				const actor = token?.actor;

				if (!actor?.sheet) {
					const sheet = game.user.character?.sheet;
	
					if (sheet) {
						return sheet.renderRollDialog({ toggle: true });
					}

					return ui.notifications.warn("Litm.ui.warn-no-character", {
						localize: true,
					});
				}

				if (game.user.isGM || actor.isOwner) {
					return actor.sheet.renderRollDialog({ toggle: true });
				}

				return ui.notifications.warn("Litm.ui.warn-no-character", {
					localize: true,
				});
			},
			onUp: () => {},
			restricted: false,
			precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});

		game.keybindings.register("litm-rn", "openStoryTagApp", {
			name: t("Litm.ui.manage-tags"),
			hint: t("Litm.ui.manage-tags-hint"),
			editable: [
				{
					key: "KeyT",
				},
			],
			onDown: () => {
				const app = game.litm.storyTags;
				if (app.rendered) return app.close();
				return app.render(true);
			},
			onUp: () => {},
			restricted: false,
			precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});
	}
}
