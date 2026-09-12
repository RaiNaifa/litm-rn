let privateCreationKeyHeld = false;

/** Register the configurable modifier used to create hidden tags and statuses. */
export function registerPrivateCreationKeybinding() {
	game.keybindings.register("litm-rn", "createPrivate", {
		name: "Litm.ui.create-private",
		hint: "Litm.ui.create-private-hint",
		editable: [{ key: "AltLeft" }, { key: "AltRight" }],
		onDown: () => {
			privateCreationKeyHeld = true;
			return false;
		},
		onUp: () => {
			privateCreationKeyHeld = false;
			return false;
		},
		restricted: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
	});
}

/**
 * Return whether newly added tag-like data should be hidden.
 * @param {KeyboardEvent|MouseEvent|DragEvent|null} event The triggering event, when available.
 * @returns {boolean}
 */
export function createPrivate(event = null) {
	return privateCreationKeyHeld || Boolean(event?.altKey);
}
