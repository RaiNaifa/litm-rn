import { Sockets } from "../../system/sockets.js";
import { getLinkedRote, getWorldRoteLink } from "./rote-links.js";

const worldCache = new Map();
const pending = new Map();
const REQUEST_TIMEOUT = 6000;
let registered = false;
let cacheGeneration = 0;

const invalidateWorldCache = () => {
	cacheGeneration += 1;
	worldCache.clear();
	Hooks.callAll("litmRoteRollUpdated");
};

const activeGM = () =>
	game.users.activeGM ?? game.users.find((user) => user.isGM && user.active);

const tagInOwner = (owner, tagId) => {
	const tag =
		owner.documentName === "Actor"
			? (owner.system.themes ?? [])
					.flatMap((theme) => [theme.themeTag, ...(theme.powerTags ?? [])])
					.find((entry) => entry?.id === tagId)
			: [owner.system.themeTag, ...(owner.system.powerTags ?? [])].find(
					(entry) => entry?.id === tagId,
				);
	return tag && !tag.isScratched ? tag : null;
};

const snapshot = (rote) =>
	rote?.type === "rote" && rote.system.isActive === true
		? {
				uuid: rote.uuid,
				name: rote.name,
				img: rote.img,
				description: rote.system.description ?? "",
				practitioners: rote.system.practitioners ?? "",
				powerHelping: rote.system.powerHelping ?? "",
				powerHindering: rote.system.powerHindering ?? "",
				effects: (rote.system.effects ?? []).map((effect) => ({
					type: effect.type,
					description: effect.description ?? "",
				})),
				consequences: [...(rote.system.consequences ?? [])],
			}
		: null;

const worldTheme = (ref) => {
	if (!ref?.startsWith("story-theme-")) return null;
	const item = game.items?.get(ref.slice("story-theme-".length));
	if (item?.type !== "story") return null;
	if (item.system.isArchived) return null;
	const ids = game.settings.get("litm-rn", "storytags")?.storyThemeIds ?? [];
	return ids.includes(item.id) ? item : null;
};

async function worldSnapshot(ref, tagId, user = game.user) {
	const theme = worldTheme(ref);
	const tag = theme && tagInOwner(theme, tagId);
	if (!tag || (tag.isPrivate && !user.isGM)) return null;
	const uuid = getWorldRoteLink(theme, tagId);
	if (!uuid) return null;
	try {
		const rote = await fromUuid(uuid);
		return snapshot(rote);
	} catch (error) {
		console.error(error);
		return null;
	}
}

function actorSnapshot(ref, tagId) {
	let actor = null;
	const actorRef = ref.includes(":") ? ref.slice(0, ref.lastIndexOf(":")) : ref;
	try {
		actor = foundry.utils.fromUuidSync(actorRef) ?? game.actors.get(actorRef);
	} catch (_error) {
		actor = game.actors.get(actorRef) ?? null;
	}
	if (actor?.documentName !== "Actor") return null;
	if (tagInOwner(actor, tagId)) return snapshot(getLinkedRote(actor, tagId));
	for (const story of actor.items.filter((item) => item.type === "story")) {
		if (story.system.isArchived || !tagInOwner(story, tagId)) continue;
		return snapshot(getLinkedRote(story, tagId));
	}
	return null;
}

function sharedSnapshot(targetActorId, shareId) {
	const target = game.actors.get(targetActorId);
	const sharedTag = game.litm?.getAcceptedSharedTag?.(targetActorId, shareId);
	if (
		target?.type !== "character" ||
		sharedTag?.id !== shareId ||
		sharedTag.targetActorId !== targetActorId ||
		!["themeTag", "powerTag"].includes(sharedTag.type) ||
		sharedTag.isScratched ||
		!sharedTag.sourceTagId
	)
		return null;
	const sender = game.actors.get(sharedTag.senderActorId);
	if (sender?.type !== "character") return null;
	return actorSnapshot(sender.uuid, sharedTag.sourceTagId);
}

/** Return the active Rote for a selected power tag without granting Item access. */
export async function getRollRote(
	ref,
	tagId,
	{ fresh = false, actorId = null } = {},
) {
	if (!ref || !tagId) return null;
	const shared = ref === "fellowship";
	if (!shared && !ref.startsWith("story-theme-"))
		return actorSnapshot(ref, tagId);
	const sharedTag = shared
		? game.litm?.getAcceptedSharedTag?.(actorId, tagId)
		: null;
	if (shared && !sharedTag) return null;
	if (shared && !game.user.isGM) {
		const sender = game.actors.get(sharedTag?.senderActorId);
		if (sender?.testUserPermission(game.user, "OBSERVER"))
			return sharedSnapshot(actorId, tagId);
	}
	const key = `${game.user.isGM ? "gm" : actorId}:${ref}:${tagId}`;
	const cached = worldCache.get(key);
	if (!fresh && cached && cached.expires > Date.now()) return cached.value;
	const generation = cacheGeneration;
	if (game.user.isGM) {
		const result = shared
			? sharedSnapshot(actorId, tagId)
			: await worldSnapshot(ref, tagId);
		if (generation !== cacheGeneration) return null;
		worldCache.set(key, { value: result, expires: Number.POSITIVE_INFINITY });
		return result;
	}
	const gm = activeGM();
	if (!gm) return null;
	const requestId = foundry.utils.randomID();
	const result = await new Promise((resolve) => {
		const timeout = setTimeout(() => {
			pending.delete(requestId);
			resolve(null);
		}, REQUEST_TIMEOUT);
		pending.set(requestId, (value) => {
			clearTimeout(timeout);
			resolve(value);
		});
		Sockets.dispatch("requestRollRote", {
			requestId,
			gmId: gm.id,
			actorId,
			ref,
			tagId,
		});
	});
	if (generation !== cacheGeneration) return null;
	worldCache.set(key, {
		value: result,
		expires: result ? Number.POSITIVE_INFINITY : Date.now() + 2000,
	});
	return result;
}

/** Register the GM relay for read-only world Rote roll data. */
export function registerRoteRollHandlers() {
	if (registered) return;
	registered = true;
	Sockets.on("requestRollRote", async ({ data, senderId }) => {
		if (!game.user.isGM || activeGM()?.id !== game.user.id) return;
		if (data.gmId !== game.user.id || !data.requestId) return;
		const sender = game.users.get(senderId);
		const actor = game.actors.get(data.actorId);
		if (!sender || !actor?.testUserPermission(sender, "OWNER")) return;
		let rote = null;
		try {
			rote =
				data.ref === "fellowship"
					? sharedSnapshot(data.actorId, data.tagId)
					: await worldSnapshot(data.ref, data.tagId, sender);
		} catch (error) {
			console.error(error);
		}
		Sockets.dispatch("replyRollRote", {
			requestId: data.requestId,
			userId: senderId,
			rote,
		});
	});
	Sockets.on("replyRollRote", ({ data, senderId }) => {
		if (data.userId !== game.user.id || senderId !== activeGM()?.id) return;
		const resolve = pending.get(data.requestId);
		pending.delete(data.requestId);
		resolve?.(data.rote ?? null);
	});
	Sockets.on("invalidateRollRotes", ({ senderId }) => {
		if (!game.users.get(senderId)?.isGM) return;
		invalidateWorldCache();
	});
	Hooks.on("updateItem", (item) => {
		if (!["rote", "story"].includes(item.type)) return;
		invalidateWorldCache();
		if (game.user.isGM && activeGM()?.id === game.user.id)
			Sockets.dispatch("invalidateRollRotes", {});
	});
	Hooks.on("deleteItem", (item) => {
		if (!["rote", "story"].includes(item.type)) return;
		invalidateWorldCache();
		if (game.user.isGM && activeGM()?.id === game.user.id)
			Sockets.dispatch("invalidateRollRotes", {});
	});
	Hooks.on("createItem", (item) => {
		if (!["rote", "story"].includes(item.type)) return;
		invalidateWorldCache();
		if (game.user.isGM && activeGM()?.id === game.user.id)
			Sockets.dispatch("invalidateRollRotes", {});
	});
	Hooks.on("updateActor", (actor) => {
		if (actor.type !== "character") return;
		const hasAcceptedShare = game.messages.some((message) => {
			const share = message.getFlag("litm-rn", "tagShare");
			return share?.status === "accepted" && share.senderActorId === actor.id;
		});
		if (!hasAcceptedShare) {
			Hooks.callAll("litmRoteRollUpdated");
			return;
		}
		invalidateWorldCache();
		if (game.user.isGM && activeGM()?.id === game.user.id)
			Sockets.dispatch("invalidateRollRotes", {});
	});
	for (const event of ["updateChatMessage", "deleteChatMessage"]) {
		Hooks.on(event, (message) => {
			if (!message.getFlag("litm-rn", "tagShare")) return;
			invalidateWorldCache();
		});
	}
	Hooks.on("updateSetting", (setting) => {
		if (setting.key === "litm-rn.storytags") invalidateWorldCache();
	});
	Hooks.on("litmStoryTagsUpdated", invalidateWorldCache);
}
