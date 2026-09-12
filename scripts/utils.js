export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the DOM document which owns an application element or event target.
 * Detached ApplicationV2 windows use a different Document from the main game UI.
 * @param {Node|EventTarget|null} [source] - Application element, DOM node, or event.
 * @returns {Document} The owning document, falling back to the main document.
 */
export function getOwningDocument(source = null) {
	const node = source?.currentTarget ?? source?.target ?? source;
	return node?.ownerDocument ?? globalThis.document;
}

/**
 * Resolve the Window paired with an application element or event target.
 * @param {Node|EventTarget|null} [source] - Application element, DOM node, or event.
 * @returns {Window} The owning window, falling back to the main window.
 */
export function getOwningWindow(source = null) {
	return getOwningDocument(source)?.defaultView ?? globalThis.window;
}

export function localize(...key) {
	if (key.length === 1) return game.i18n.localize(key[0]);
	return key.map((k) => game.i18n.localize(k)).join(" ");
}

export function sortByName(a, b) {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

export function sortTags(tags) {
	return tags.sort(sortByName);
}

/**
 * Merge an incoming status into an equally named status in a plain data array.
 * The existing entry, including its privacy, remains authoritative.
 * @param {object[]} statuses Existing tag/status data.
 * @param {object} incoming Incoming status data.
 * @returns {{statuses: object[], status: object, stacked: boolean}}
 */
export function addOrStackStatusData(statuses, incoming) {
	const result = [...statuses];
	const normalizedName = String(incoming?.name ?? "")
		.trim()
		.toLocaleLowerCase();
	const index = result.findIndex(
		(status) =>
			status?.type === "status" &&
			String(status.name ?? "")
				.trim()
				.toLocaleLowerCase() === normalizedName,
	);
	if (index === -1) {
		result.push(incoming);
		return { statuses: result, status: incoming, stacked: false };
	}

	const existing = result[index];
	const current = Array.from({ length: 6 }, (_, level) =>
		Boolean(existing.values?.[level]),
	);
	if (
		!current.some(Boolean) &&
		Number(existing.value) > 0 &&
		Number(existing.value) <= 6
	) {
		current[Number(existing.value) - 1] = true;
	}
	const added = Array.from({ length: 6 }, (_, level) =>
		Boolean(incoming.values?.[level]),
	);
	if (
		!added.some(Boolean) &&
		Number(incoming.value) > 0 &&
		Number(incoming.value) <= 6
	) {
		added[Number(incoming.value) - 1] = true;
	}
	for (let level = 0; level < added.length; level += 1) {
		if (!added[level]) continue;
		const freeLevel = current.findIndex(
			(occupied, candidate) => candidate >= level && !occupied,
		);
		if (freeLevel !== -1) current[freeLevel] = true;
	}
	const values = current.map((occupied, level) =>
		occupied ? level + 1 : false,
	);
	const status = {
		...existing,
		values,
		value: values.findLastIndex(Boolean) + 1,
	};
	result[index] = status;
	return { statuses: result, status, stacked: true };
}

/**
 * Add a status to an actor, stacking it into an equally named status.
 * Each incoming marked level occupies the first free level at or above its own.
 * @param {Actor} actor - Actor receiving the status.
 * @param {object} effectData - ActiveEffect source data for the incoming status.
 * @param {object} [options] - Embedded-document operation options.
 * @returns {Promise<ActiveEffect|null>} The updated existing effect or newly created effect.
 */
export async function addOrStackActorStatus(actor, effectData, options = {}) {
	const flags = effectData.flags?.["litm-rn"] ?? {};
	if (flags.type !== "status") {
		const [created] = await actor.createEmbeddedDocuments(
			"ActiveEffect",
			[effectData],
			options,
		);
		return created ?? null;
	}

	const normalizedName = String(effectData.name ?? "")
		.trim()
		.toLocaleLowerCase();
	const existing = actor.effects.find((effect) => {
		const existingFlags = effect.flags?.["litm-rn"];
		return (
			existingFlags?.type === "status" &&
			effect.name.trim().toLocaleLowerCase() === normalizedName
		);
	});
	if (!existing) {
		const [created] = await actor.createEmbeddedDocuments(
			"ActiveEffect",
			[effectData],
			options,
		);
		return created ?? null;
	}

	const existingFlags = existing.flags?.["litm-rn"] ?? {};
	const { status } = addOrStackStatusData(
		[{ name: existing.name, type: "status", ...existingFlags }],
		{ name: effectData.name, type: "status", ...flags },
	);
	const [updated] = await actor.updateEmbeddedDocuments(
		"ActiveEffect",
		[
			{
				_id: existing.id,
				"flags.litm-rn.values": status.values,
				"flags.litm-rn.value": status.value,
			},
		],
		options,
	);
	return updated ?? existing;
}

export function titleCase(str) {
	return (
		str.charAt(0).toUpperCase() +
		str
			.toLowerCase()
			.replace(/\b\w+/g, (l) => {
				if (["and", "the", "of", "or", "a", "an"].includes(l)) return l;
				return l.charAt(0).toUpperCase() + l.substr(1);
			})
			.slice(1)
	);
}

export function dispatch(data) {
	const isGM = game.user.isGM;
	const user = game.user.id;
	return game.socket.emit("system.litm-rn", { ...data, isGM, user });
}

export async function newTagDialog(actors) {
	const t = localize;
	return DialogV2.wait({
		window: { title: t("Litm.ui.add-tag") },
		classes: ["litm", "litm--new-tag"],
		content: await foundry.applications.handlebars.renderTemplate(
			"systems/litm-rn/templates/partials/new-tag.html",
			{ actors },
		),
		buttons: [
			{ action: "cancel", label: t("Litm.ui.cancel"), callback: () => null },
			{
				action: "create",
				label: t("Litm.ui.create"),
				default: true,
				callback: (_event, _button, dialog) => {
					const form = dialog.element.querySelector("form");
					const formData = new foundry.applications.ux.FormDataExtended(form);
					return foundry.utils.expandObject(formData.object);
				},
			},
		],
		rejectClose: false,
	});
}

const { DialogV2 } = foundry.applications.api;

export async function confirmDelete(string = "Item") {
	const thing = game.i18n.localize(string);
	return DialogV2.confirm({
		window: {
			title: game.i18n.format("Litm.ui.confirm-delete-title", { thing }),
			icon: "fa-solid fa-trash",
		},
		content: game.i18n.format("Litm.ui.confirm-delete-content", { thing }),
		rejectClose: false,
	});
}

export async function confirmUnlink(string = "Item") {
	const thing = game.i18n.localize(string);
	return DialogV2.confirm({
		window: {
			title: game.i18n.format("Litm.ui.confirm-unlink-title", { thing }),
		},
		content: game.i18n.format("Litm.ui.confirm-unlink-content", { thing }),
		rejectClose: false,
	});
}

export async function gmModeratedRoll(app, cb) {
	const id = foundry.utils.randomID();
	game.litm.rolls[id] = cb;

	dispatch({ app, id, type: "roll" });
}

export function getAssignedUser(actor) {
	return game.users.find((u) => u.character?.id === actor.id) ?? null;
}

export function getAvailableFellowships(actor) {
	const assignedUser = getAssignedUser(actor);
	if (!assignedUser) return [];

	return game.items.filter(
		(i) =>
			i.type === "fellowship" && i.testUserPermission(assignedUser, "OWNER"),
	);
}

const TAG_TYPE_ORDER = { limit: -1, status: 0, tag: 1, might: 2 };

export function compareTagTypes(a, b) {
	return (TAG_TYPE_ORDER[a.type] ?? 1) - (TAG_TYPE_ORDER[b.type] ?? 1);
}

/**
 * Compute the current value of a limit from its max value and contained status tag values.
 * @param {number|null} limitValue - The limit's max value (1-6), or null for immunity.
 * @param {Array<{values: Array|null}>} statusTags - Status tags inside the limit.
 * @returns {number} The computed current value (0 to limitValue).
 */
export function computeLimitCurrentValue(limitValue, statusTags) {
	const statusOnly = statusTags.filter((t) => t.type === "status");
	if (!limitValue || statusOnly.length === 0) return 0;

	const filled = new Array(6).fill(false);

	const firstValues = statusOnly[0].values || [];
	for (let i = 0; i < 6; i++) {
		if (
			firstValues[i] != null &&
			firstValues[i] !== false &&
			firstValues[i] !== 0
		) {
			filled[i] = true;
		}
	}

	for (let s = 1; s < statusOnly.length; s++) {
		const values = statusOnly[s].values || [];
		for (let i = 0; i < 6; i++) {
			if (values[i] == null || values[i] === false || values[i] === 0) continue;

			let placed = false;
			for (let j = i; j < 6; j++) {
				if (!filled[j]) {
					filled[j] = true;
					placed = true;
					break;
				}
			}

			if (!placed) continue;
		}
	}

	let lastFilledIndex = -1;
	for (let i = 5; i >= 0; i--) {
		if (filled[i]) {
			lastFilledIndex = i;
			break;
		}
	}

	if (lastFilledIndex === -1) return 0;
	return Math.min(lastFilledIndex + 1, limitValue);
}

/**
 * Get the fellowship members array for a given fellowship ID.
 * Falls back to filtering all actors if the fellowship item has no members field.
 * @param {string} fellowshipId
 * @returns {{ actorId: string, name: string }[]}
 */
export function getFellowshipMembers(fellowshipId) {
	if (!fellowshipId) return [];

	const item = game.items?.get(fellowshipId);
	if (item?.type === "fellowship" && item.system.members?.length) {
		return item.system.members;
	}

	return (
		game.actors
			?.filter(
				(a) =>
					a.type === "character" && a.system?.fellowshipId === fellowshipId,
			)
			.map((a) => ({ actorId: a.id, name: a.name })) ?? []
	);
}

/**
 * Resolve every actor explicitly listed as a Fellowship member.
 * The stored member list is authoritative and may contain both Heroes and Challenges.
 * @param {string} fellowshipId
 * @returns {Actor[]}
 */
export function getFellowshipActors(fellowshipId) {
	return getFellowshipMembers(fellowshipId)
		.map((member) => game.actors?.get(member.actorId) ?? null)
		.filter(Boolean);
}

/**
 * Find the Fellowship containing an actor.
 * CharacterData keeps fellowshipId as a fast lookup; other actor types are resolved through members.
 * @param {Actor|null|undefined} actor
 * @returns {string|null}
 */
export function getActorFellowshipId(actor) {
	if (!actor) return null;
	if (actor.type === "character" && actor.system?.fellowshipId) {
		return actor.system.fellowshipId;
	}
	return (
		game.items?.find(
			(item) =>
				item.type === "fellowship" &&
				item.system.members?.some((member) => member.actorId === actor.id),
		)?.id ?? null
	);
}

/**
 * Test membership against the Fellowship's authoritative members list.
 * @param {string} fellowshipId
 * @param {string} actorId
 * @returns {boolean}
 */
export function isFellowshipMember(fellowshipId, actorId) {
	return getFellowshipMembers(fellowshipId).some(
		(member) => member.actorId === actorId,
	);
}

/**
 * Get the fellowship item for a given fellowship ID.
 * @param {string} fellowshipId
 * @returns {Item|null}
 */
export function getFellowshipItem(fellowshipId) {
	if (!fellowshipId) return null;
	return game.items?.get(fellowshipId) ?? null;
}
