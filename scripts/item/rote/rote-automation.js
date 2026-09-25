import { getWorldRoteLink } from "./rote-links.js";

const processed = new Set();
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** Accept executable code only from an authenticated GM document update for this local roll. */
export function getApprovedRoteExecution(
	message,
	changes,
	updaterId,
	activeGmId,
	localUserId,
	pending,
) {
	const payload =
		changes.flags?.["litm-rn"]?.roteExecution ??
		changes["flags.litm-rn.roteExecution"];
	if (!payload || typeof payload !== "object") return null;
	const authorId =
		typeof message.author === "string"
			? message.author
			: (message.author?.id ?? message.user?.id);
	if (
		updaterId !== activeGmId ||
		!pending ||
		pending.messageId !== message.id ||
		pending.roteUuid !== payload.context?.roteUuid ||
		payload.messageId !== message.id ||
		payload.initiatorId !== localUserId ||
		authorId !== localUserId ||
		!Number.isFinite(payload.issuedAt) ||
		Math.abs(Date.now() - payload.issuedAt) > 120000
	)
		return null;
	return payload;
}

/** Validate a completed Rote use and collect its automation on the active GM. */
export async function prepareRoteAutomation(data) {
	if (!game.user.isGM || !data?.roteUuid || !data?.rollId)
		return { payload: null, failed: 0 };
	if (processed.has(data.rollId)) return { payload: null, failed: 0 };
	const actor = game.actors.get(data.actorId);
	if (actor?.type !== "character" || data.isGroup)
		return { payload: null, failed: 0 };
	let message = game.messages.get(data.messageId);
	for (let attempt = 0; !message && attempt < 5; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		message = game.messages.get(data.messageId);
	}
	const proof =
		message?.getFlag("litm-rn", "roteAutomation") ??
		message?.getFlag("litm-rn", "roteSimple");
	const authorId =
		typeof message?.author === "string"
			? message.author
			: (message?.author?.id ?? message?.user?.id);
	if (
		!proof ||
		authorId !== data.initiatorId ||
		proof.rollId !== data.rollId ||
		proof.actorId !== actor.id ||
		proof.roteUuid !== data.roteUuid ||
		proof.tagId !== data.roteTagId
	)
		return { payload: null, failed: 0 };
	if (proof.ref && proof.ref !== data.roteRef)
		return { payload: null, failed: 0 };
	const rote = await fromUuid(data.roteUuid).catch(() => null);
	if (rote?.type !== "rote") return { payload: null, failed: 0 };
	let linked = false;
	if (data.roteRef?.startsWith("story-theme-")) {
		const story = game.items.get(data.roteRef.slice("story-theme-".length));
		linked =
			story?.type === "story" &&
			getWorldRoteLink(story, data.roteTagId) === rote.uuid;
	} else if (data.roteRef === "fellowship") {
		const share = game.litm?.getAcceptedSharedTag?.(actor.id, data.roteTagId);
		linked = Boolean(
			share &&
				rote.parent?.id === share.senderActorId &&
				rote.getFlag("litm-rn", "roteLink")?.tagId === share.sourceTagId,
		);
	} else {
		linked =
			rote.parent?.id === actor.id &&
			rote.getFlag("litm-rn", "roteLink")?.tagId === data.roteTagId;
	}
	if (!linked) return { payload: null, failed: 0 };
	processed.add(data.rollId);
	if (processed.size > 500) processed.delete(processed.values().next().value);

	const settings = rote.getFlag("litm-rn", "automation") ?? {};
	const script = String(settings.script ?? "").trim();
	const macros = [];
	let failed = 0;
	for (const uuid of Array.isArray(settings.macros) ? settings.macros : []) {
		try {
			const macro = await fromUuid(uuid);
			if (macro?.documentName !== "Macro")
				throw new Error(`Unavailable Macro: ${uuid}`);
			macros.push({
				uuid,
				name: macro.name,
				type: macro.type,
				command: macro.command,
			});
		} catch (error) {
			failed += 1;
			console.error(`LITM | Rote Macro could not be prepared: ${rote.name} (${uuid})`, error);
		}
	}
	if (!script && !macros.length) return { payload: null, failed };
	return {
		failed,
		payload: {
			rollId: data.rollId,
			messageId: data.messageId,
			initiatorId: data.initiatorId,
			issuedAt: Date.now(),
			context: {
				mode: data.mode ?? "roll",
				rollType: data.rollType ?? "quick",
				outcome: data.outcome ?? null,
				isCampAction: Boolean(data.isCampAction),
				totalPower: data.totalPower ?? null,
				actorId: actor.id,
				roteId: rote.id,
				roteUuid: rote.uuid,
				roteName: rote.name,
				initiatorId: data.initiatorId,
				sceneId: data.sceneId ?? null,
				tokenId: data.tokenId ?? null,
				targetIds: Array.isArray(data.targetIds) ? [...data.targetIds] : [],
				rollId: data.rollId,
				messageId: data.messageId,
			},
			script,
			macros,
		},
	};
}

/** Run a GM-approved automation package on the initiating user's client. */
export async function executeRoteAutomation(payload) {
	if (payload?.initiatorId !== game.user.id) return { failed: 0 };
	const context = Object.freeze({ ...payload.context });
	const actor = game.actors.get(context.actorId);
	const api = Object.freeze({
		getActor: () => actor,
		getRote: () => {
			try {
				return fromUuidSync(context.roteUuid);
			} catch {
				return null;
			}
		},
		getMessage: () => game.messages.get(context.messageId),
	});
	let failed = 0;
	if (payload.script) {
		try {
			await new AsyncFunction("context", "api", payload.script)(context, api);
		} catch (error) {
			failed += 1;
			console.error(`LITM | Rote script failed: ${context.roteName}`, error);
		}
	}
	for (const entry of payload.macros ?? []) {
		try {
			let macro = await fromUuid(entry.uuid).catch(() => null);
			if (macro?.documentName !== "Macro" || !macro.canUserExecute(game.user)) {
				// This unsaved copy grants no permission on the source world Macro.
				const MacroDocument = getDocumentClass("Macro");
				macro = new MacroDocument({
					name: entry.name,
					type: entry.type,
					command: entry.command,
					ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
				});
			}
			if (!macro.canUserExecute(game.user))
				throw new Error(`Macro could not be executed: ${entry.name}`);
			await macro.execute({
				actor,
				token: context.tokenId ? canvas?.tokens?.get(context.tokenId) : null,
				speaker: ChatMessage.getSpeaker({ actor }),
				event: { roteContext: context, roteApi: api },
			});
		} catch (error) {
			failed += 1;
			console.error(`LITM | Rote Macro failed: ${context.roteName} (${entry.name})`, error);
		}
	}
	return { failed };
}

/** Run automation immediately when the person using the Rote is the GM. */
export async function runRoteAutomation(data) {
	if (!game.user.isGM || data?.initiatorId !== game.user.id)
		return { failed: 0 };
	const { payload, failed } = await prepareRoteAutomation(data);
	if (!payload) return { failed };
	const result = await executeRoteAutomation(payload);
	return { failed: failed + result.failed };
}
