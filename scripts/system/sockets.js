import { getFellowshipActors } from "../utils.js";
import {
	executeRoteAutomation,
	getApprovedRoteExecution,
	prepareRoteAutomation,
} from "../item/rote/rote-automation.js";
const { fromUuid } = foundry.utils;

export class Sockets {
	static #pendingPostRoll = new Map();
	static #pendingRoteExecution = new Map();
	static #roteExecutionCleanup = new Map();
	static #processedPostRollIds = new Set();

	static dispatch(event, data) {
		if (!game.ready)
			return console.error(
				`Tried to dispatch ${event} socket event before the game was ready.`,
			);

		const senderIsGM = game.user.isGM;
		const senderId = game.user.id;
		const id = foundry.utils.randomID();
		game.socket.emit("system.litm-rn", {
			id,
			data,
			event,
			senderIsGM,
			senderId,
		});
	}

	static on(event, cb) {
		game.socket.on("system.litm-rn", (data) => {
			const { event: e, senderId, ...d } = data;
			if (e !== event || senderId === game.userId) return;
			cb({ ...d, senderId });
		});
	}

	/** Send the completed roll to the GM for post-roll processing and Rote automation. */
	static async requestPostRollProcessing(data) {
		const activeGM =
			game.users.activeGM ??
			game.users.find((user) => user.isGM && user.active);
		if (!activeGM) {
			ui.notifications.warn(game.i18n.localize("Litm.ui.roll-no-active-gm"));
			ui.notifications.warn(
				game.i18n.localize("Litm.ui.post-roll-not-processed"),
			);
			return false;
		}
		const rollId = data.rollId || foundry.utils.randomID();
		if (data.rote?.uuid) {
			const executionTimeout = setTimeout(
				() => this.#pendingRoteExecution.delete(rollId),
				120000,
			);
			this.#pendingRoteExecution.set(rollId, {
				messageId: data.messageId,
				roteUuid: data.rote.uuid,
				executionTimeout,
			});
		}
		const timeout = setTimeout(() => {
			this.#pendingPostRoll.delete(rollId);
			ui.notifications.warn(
				game.i18n.localize("Litm.ui.post-roll-not-confirmed"),
			);
		}, 10000);
		this.#pendingPostRoll.set(rollId, timeout);
		this.dispatch("processPostRoll", { ...data, rollId });
		return true;
	}

	static #roteAutomationData(data, initiatorId) {
		return {
			actorId: data.actorId,
			roteUuid: data.rote?.uuid,
			roteRef: data.rote?.ref,
			roteTagId: data.rote?.tagId,
			rollId: data.rollId,
			mode: data.mode ?? (data.safeCamp ? "campNoRoll" : "roll"),
			rollType: data.type,
			outcome: data.safeCamp ? "success" : data._outcome,
			totalPower: data.totalPower,
			isCampAction: data.isCampAction,
			sceneId: data.sceneId,
			initiatorId,
			messageId: data.messageId,
			tokenId: data.tokenId,
			targetIds: data.targetIds,
			isGroup: data.isGroup,
		};
	}

	static registerListeners() {
		this.#registerRollUpdateListener();
		this.#registerRollModerationListeners();
		this.#registerRollSelectionSyncListener();
		this.#registerGmRollSelectionSyncListener();
		this.#registerRollSelectionBatchSyncListener();
		this.#registerGroupResetListener();
		this.#registerTagShareListener();
		this.#registerSharedWeaknessExperienceListener();
		this.#registerSharedTagBurnListener();
		this.#registerPostRollListener();
		this.#registerRoteExecutionListener();
		this.#registerSacrificeListeners();
		this.#registerFellowshipThemebookListener();

		Hooks.once("ready", () => {
			if (game.user.isGM) this.#registerGMRollListeners();
		});
	}

	static #registerFellowshipThemebookListener() {
		Sockets.on("fellowshipThemebookMutation", async ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (activeGM?.id !== game.user.id) return;
			const sender = game.users.get(senderId);
			const fellowship = data.fellowshipUuid
				? await fromUuid(data.fellowshipUuid)
				: null;
			if (!sender || fellowship?.type !== "fellowship") return;
			const isMember = (fellowship.system.members ?? []).some((member) => {
				const actor = game.actors.get(member.actorId);
				return (
					actor &&
					(sender.character?.id === actor.id ||
						actor.testUserPermission(sender, "OWNER"))
				);
			});
			if (!isMember) return;
			const allowed = new Set([
				"system.themebookAnswers",
				"system.powerTags",
				"system.weaknessTags",
				"system.specials",
				"system.claimedSpecials",
			]);
			const updates = Object.fromEntries(
				Object.entries(data.updates ?? {}).filter(
					([path, value]) => allowed.has(path) && Array.isArray(value),
				),
			);
			if (!Object.keys(updates).length) return;
			await fellowship.update(updates);
		});
	}

	static #registerSacrificeListeners() {
		Sockets.on("syncSacrifice", ({ data }) => {
			const actor = game.actors.get(data.actorId);
			if (!actor || (!game.user.isGM && !actor.isOwner)) return;
			const update = {
				actorId: data.actorId,
				modifier: data.modifier,
				sacrifice: data.sacrifice,
			};
			actor.sheet.updateRollDialog(update);
			if (game.user.isGM && game.litm?.gmRollDialog?.actorId === data.actorId) {
				game.litm.gmRollDialog.receiveUpdate(update);
			}
		});

		Sockets.on("proposeSacrifice", ({ data }) => {
			if (!game.user.isGM) return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (activeGM?.id !== game.user.id) return;
			const actor = game.actors.get(data.actorId);
			if (!actor) return;
			this.#showSacrificeProposal(actor, data);
		});

		Sockets.on("approveSacrifice", ({ data }) => {
			const actor = game.actors.get(data.actorId);
			if (!actor || (!game.user.isGM && !actor.isOwner)) return;
			const update = {
				actorId: actor.id,
				modifier: data.modifier,
				sacrifice: data.sacrifice,
				openSacrifice: true,
			};
			actor.sheet.updateRollDialog(update);
			if (game.user.isGM && game.litm?.gmRollDialog?.actorId === actor.id) {
				game.litm.gmRollDialog.receiveUpdate(update);
			} else actor.sheet.renderRollDialog();
			ui.notifications.info(game.i18n.localize("Litm.ui.sacrifice-approved"));
		});

		Sockets.on("clearSacrifice", ({ data }) => {
			if (data.userId && data.userId !== game.user.id && !game.user.isGM)
				return;
			const actor = game.actors.get(data.actorId);
			if (!actor) return;
			actor.sheet.updateRollDialog({
				actorId: actor.id,
				sacrifice: {
					level: "painful",
					themeId: "",
					statusName: "",
					achievement: "",
					state: "draft",
					proposerId: "",
				},
			});
			document
				.querySelector(`[data-sacrifice-proposal="${data.actorId}"]`)
				?.remove();
		});
	}

	/** Show a compact Narrator-only Sacrifice proposal above the player list. */
	static #showSacrificeProposal(actor, data) {
		let container = document.querySelector("#litm-sacrifice-proposals");
		if (!container) {
			container = document.createElement("div");
			container.id = "litm-sacrifice-proposals";
			document.body.appendChild(container);
		}
		document.querySelector(`[data-sacrifice-proposal="${actor.id}"]`)?.remove();

		const card = document.createElement("div");
		card.className = "litm litm--sacrifice-proposal";
		card.dataset.sacrificeProposal = actor.id;

		const text = document.createElement("span");
		text.textContent = game.i18n.format("Litm.ui.sacrifice-proposal-received", {
			name: actor.name,
		});

		const open = document.createElement("button");
		open.type = "button";
		open.className = "litm--sacrifice-proposal-open";
		open.innerHTML = '<i class="fas fa-envelope-open"></i>';
		open.dataset.tooltip = "Litm.ui.sacrifice-open-proposal";
		open.addEventListener("click", () => {
			const dialog = game.litm.LitmRollDialog.openForGm(actor.id);
			dialog.receiveUpdate({
				actorId: actor.id,
				modifier: data.modifier,
				sacrifice: data.sacrifice,
				openSacrifice: true,
			});
			dialog.render({ force: true });
			card.remove();
		});

		const close = document.createElement("button");
		close.type = "button";
		close.className = "litm--sacrifice-proposal-close";
		close.innerHTML = '<i class="fas fa-xmark"></i>';
		close.dataset.tooltip = "Close";
		close.addEventListener("click", () => card.remove());

		card.append(text, open, close);
		container.appendChild(card);
	}

	static #registerTagShareListener() {
		Sockets.on("resolveTagShare", async ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (activeGM?.id !== game.user.id) return;
			await game.litm?.resolveTagShare?.(
				data.messageId,
				data.decision,
				senderId,
			);
		});
	}

	static #registerSharedWeaknessExperienceListener() {
		Sockets.on("gainSharedWeaknessExperience", async ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (activeGM?.id !== game.user.id) return;
			await game.litm?.grantSharedWeaknessExperience?.(
				data.shareId,
				data.targetActorId,
				senderId,
			);
		});
	}

	static #registerSharedTagBurnListener() {
		Sockets.on("scratchSharedRollTag", async ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (activeGM?.id !== game.user.id) return;
			await game.litm?.scratchSharedRollTag?.(
				data.shareId,
				data.targetActorId,
				senderId,
			);
		});
	}

	static #registerRoteExecutionListener() {
		Hooks.once("ready", () => {
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (!game.user.isGM || activeGM?.id !== game.user.id) return;
			for (const message of game.messages) {
				if (
					!message.getFlag("litm-rn", "roteAutomation") &&
					!message.getFlag("litm-rn", "roteSimple")
				)
					continue;
				const payload = message.getFlag("litm-rn", "roteExecution");
				if (payload && (!payload.issuedAt || Date.now() - payload.issuedAt > 120000))
					message
						.unsetFlag("litm-rn", "roteExecution")
						.catch((error) => console.error("LITM | Could not clear stale Rote execution", error));
			}
		});
		Hooks.on("updateChatMessage", async (message, changes, _options, userId) => {
			if (game.user.isGM || !this.#pendingRoteExecution.size) return;
			const candidate =
				changes?.flags?.["litm-rn"]?.roteExecution ??
				changes?.["flags.litm-rn.roteExecution"];
			if (!candidate?.rollId) return;
			if (
				!message.getFlag("litm-rn", "roteAutomation") &&
				!message.getFlag("litm-rn", "roteSimple")
			)
				return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (!activeGM) return;
			const pending = this.#pendingRoteExecution.get(candidate?.rollId);
			const changedPayload = getApprovedRoteExecution(
				message,
				changes,
				userId,
				activeGM.id,
				game.user.id,
				pending,
			);
			if (!changedPayload) return;
			clearTimeout(pending.executionTimeout);
			this.#pendingRoteExecution.delete(changedPayload.rollId);
			try {
				const result = await executeRoteAutomation(changedPayload);
				if (result.failed)
					ui.notifications.warn(
						game.i18n.localize("Litm.ui.post-roll-partial-failure"),
					);
			} catch (error) {
				console.error("LITM | Rote execution failed", error);
				ui.notifications.warn(
					game.i18n.localize("Litm.ui.post-roll-partial-failure"),
				);
			} finally {
				this.dispatch("roteExecutionAcknowledged", {
					rollId: changedPayload.rollId,
					messageId: message.id,
				});
			}
		});
		Sockets.on("roteExecutionAcknowledged", ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const pending = this.#roteExecutionCleanup.get(data.rollId);
			if (
				pending?.initiatorId !== senderId ||
				pending.messageId !== data.messageId
			)
				return;
			clearTimeout(pending.timeout);
			this.#roteExecutionCleanup.delete(data.rollId);
			game.messages
				.get(data.messageId)
				?.unsetFlag("litm-rn", "roteExecution")
				.catch((error) => console.error("LITM | Could not clear Rote execution", error));
		});
	}

	static #registerPostRollListener() {
		Sockets.on("processPostRoll", async ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const activeGM =
				game.users.activeGM ??
				game.users.find((user) => user.isGM && user.active);
			if (activeGM?.id !== game.user.id) return;
			const sender = game.users.get(senderId);
			const actor = game.actors.get(data.actorId);
			if (!sender || !actor) return;
			const isAssignedCharacter = sender.character?.id === actor.id;
			if (
				!sender.isGM &&
				!isAssignedCharacter &&
				!actor.testUserPermission(sender, "OWNER")
			)
				return;
			const selectionActorIds =
				data.isGroup && data.fellowshipId
					? new Set(
							getFellowshipActors(data.fellowshipId)
								.filter((entry) => entry.type === "character")
								.map((entry) => entry.id),
						)
					: new Set([actor.id]);
			const allowedTags = new Set();
			for (const actorId of selectionActorIds) {
				for (const [ref, tagMap] of game.litm?.rollSelection?.get(actorId) ??
					[]) {
					for (const tagId of tagMap.keys())
						allowedTags.add(`${ref}\0${tagId}`);
				}
			}
			if (data.isGroup) {
				for (const [, refMap] of game.litm?.gmRollSelection ?? []) {
					for (const [ref, tagMap] of refMap) {
						for (const tagId of tagMap.keys())
							allowedTags.add(`${ref}\0${tagId}`);
					}
				}
			}
			const claimedTags = [
				...(data.burntTags ?? []),
				...(data.crispyTags ?? []),
				...(data.weaknessTags ?? []),
				...(data.heroWeaknessTags ?? []),
			];
			if (
				claimedTags.some(
					(tag) =>
						!tag?.id ||
						!tag?._ref ||
						!allowedTags.has(`${tag._ref}\0${tag.id}`),
				)
			) {
				console.warn(
					"LITM | Rejected post-roll snapshot with tags outside roll selection",
					data,
				);
				this.dispatch("postRollProcessed", {
					rollId: data.rollId,
					targetUserId: senderId,
					processed: 0,
					failed: 1,
				});
				return;
			}
			if (this.#processedPostRollIds.has(data.rollId)) {
				this.dispatch("postRollProcessed", {
					rollId: data.rollId,
					targetUserId: senderId,
					processed: 0,
					failed: 0,
				});
				return;
			}
			this.#processedPostRollIds.add(data.rollId);
			if (this.#processedPostRollIds.size > 500) {
				this.#processedPostRollIds.delete(
					this.#processedPostRollIds.values().next().value,
				);
			}
			try {
				const automation = await prepareRoteAutomation(
					this.#roteAutomationData(data, senderId),
				);
				if (automation.payload) {
					const message = game.messages.get(data.messageId);
					const timeout = setTimeout(() => {
						this.#roteExecutionCleanup.delete(data.rollId);
						message
							.unsetFlag("litm-rn", "roteExecution")
							.catch((error) => console.error("LITM | Could not clear Rote execution", error));
					}, 120000);
					this.#roteExecutionCleanup.set(data.rollId, {
						initiatorId: senderId,
						messageId: message.id,
						timeout,
					});
					await message.update({
						"flags.litm-rn.roteExecution": automation.payload,
					});
				}
				const report = await game.litm?.LitmRoll.postRollProcessing({
					litm: data,
				});
				report.failed += automation.failed;
				this.dispatch("postRollProcessed", {
					rollId: data.rollId,
					targetUserId: senderId,
					...report,
				});
			} catch (error) {
				console.error("LITM | Post-roll processing failed", error, data);
				this.dispatch("postRollProcessed", {
					rollId: data.rollId,
					targetUserId: senderId,
					processed: 0,
					failed: 1,
				});
			}
		});

		Sockets.on("postRollProcessed", ({ data }) => {
			if (data.targetUserId !== game.user.id) return;
			const timeout = this.#pendingPostRoll.get(data.rollId);
			if (timeout) clearTimeout(timeout);
			this.#pendingPostRoll.delete(data.rollId);
			if (data.failed > 0)
				ui.notifications.warn(
					game.i18n.localize("Litm.ui.post-roll-partial-failure"),
				);
		});
	}

	static #registerGroupResetListener() {
		Sockets.on("resetGroupRoll", ({ data: { fellowshipId } }) => {
			game.litm?.resetGroupRollSelections?.(fellowshipId, { dispatch: false });
		});
	}

	static #registerRollUpdateListener() {
		Sockets.on("updateRollDialog", (event) => {
			const { data } = event;
			const actor = game.actors.get(data.actorId);
			if (!actor) return console.warn(`Actor ${data.actorId} not found`);
			const matched =
				game.litm?.LitmRollDialog?.receiveRemoteUpdate?.(data) ?? 0;
			if (!matched && !data.camp) actor.sheet.updateRollDialog(data);
		});
	}

	static #registerRollModerationListeners() {
		Sockets.on("requestRollApproval", ({ data, senderId }) => {
			if (!game.user.isGM) return;
			const actor = game.actors.get(data.actorId);
			if (!actor) return;
			this.#showRollApprovalRequest(actor, { ...data, userId: senderId });
		});

		Sockets.on("approveRoll", ({ data }) => {
			const actor = game.actors.get(data.actorId);
			if (!actor || (!game.user.isGM && !actor.isOwner)) return;
			const update = {
				...data,
				rollApproval: {
					state: "approved",
					power: data.power,
					userId: data.userId,
				},
			};
			const matched =
				game.litm?.LitmRollDialog?.receiveRemoteUpdate?.(update) ?? 0;
			if (!matched) {
				actor.sheet.updateRollDialog(update);
				actor.sheet.renderRollDialog();
			}
			document
				.querySelector(`[data-roll-approval-request="${data.actorId}"]`)
				?.remove();
		});

		Sockets.on("clearRollApproval", ({ data }) => {
			const actor = game.actors.get(data.actorId);
			if (actor && (game.user.isGM || actor.isOwner)) {
				const update = {
					actorId: data.actorId,
					rollApproval: { state: "draft", power: null, userId: "" },
				};
				actor.sheet.updateRollDialog(update);
				if (
					game.user.isGM &&
					game.litm?.gmRollDialog?.actorId === data.actorId
				) {
					game.litm.gmRollDialog.receiveUpdate(update);
				}
			}
			document
				.querySelector(`[data-roll-approval-request="${data.actorId}"]`)
				?.remove();
		});

		Sockets.on("rollDice", ({ data: { userId, data } }) => {
			if (userId !== game.userId) return;
			game.litm.LitmRollDialog.roll(data);
		});

		Sockets.on("rejectRoll", ({ data: { userId, actorId, name } }) => {
			if (userId !== game.userId) return;
			ui.notifications.warn(
				game.i18n.format("Litm.ui.roll-rejected", { name }),
			);
			const actor = game.actors.get(actorId);
			if (!actor) return console.warn(`Actor ${actorId} not found`);
			actor.sheet.renderRollDialog();
		});

		Sockets.on("resetRollDialog", async ({ data: { actorId } }) => {
			const actor = game.actors.get(actorId);
			if (!actor) return console.warn(`Actor ${actorId} not found`);
			if (!game.user.isGM && !actor.isOwner) return;
			const gmDialog = game.litm?.gmRollDialog;
			if (game.user.isGM) {
				if (gmDialog?.actorId === actorId) await gmDialog.reset();
				return;
			}
			actor.sheet.resetRollDialog();
		});
	}

	/** Show a compact roll-review request to this Narrator. */
	static #showRollApprovalRequest(actor, data) {
		let container = document.querySelector("#litm-roll-approval-requests");
		if (!container) {
			container = document.createElement("div");
			container.id = "litm-roll-approval-requests";
			document.body.appendChild(container);
		}
		document
			.querySelector(`[data-roll-approval-request="${actor.id}"]`)
			?.remove();

		const card = document.createElement("div");
		card.className = "litm litm--sacrifice-proposal";
		card.dataset.rollApprovalRequest = actor.id;
		const label = document.createElement("span");
		label.textContent = game.i18n.format(
			"Litm.ui.roll-approval-request-received",
			{ name: actor.name },
		);

		const open = document.createElement("button");
		open.type = "button";
		open.className = "litm--sacrifice-proposal-open";
		open.innerHTML = '<i class="fas fa-envelope-open"></i>';
		open.dataset.tooltip = "Litm.ui.open-roll-approval-request";
		open.addEventListener("click", () => {
			const dialog = game.litm.LitmRollDialog.openForGm(actor.id, {
				camp: data.camp ?? null,
				type: data.type ?? null,
			});
			dialog.receiveUpdate({
				...data,
				rollApproval: { state: "draft", power: null, userId: data.userId },
			});
			dialog.render({ force: true });
			card.remove();
		});

		const close = document.createElement("button");
		close.type = "button";
		close.className = "litm--sacrifice-proposal-close";
		close.innerHTML = '<i class="fas fa-xmark"></i>';
		close.dataset.tooltip = "Close";
		close.addEventListener("click", () => card.remove());
		card.append(label, open, close);
		container.appendChild(card);
	}

	static #registerRollSelectionSyncListener() {
		Sockets.on("syncRollSelection", (event) => {
			const { data } = event;
			if (!data?.actorId || !data?.selection) return;
			const sel = game.litm.rollSelection;
			const actorMap = new Map();
			for (const [ref, tagMap] of Object.entries(data.selection)) {
				actorMap.set(ref, new Map(Object.entries(tagMap)));
			}
			sel.set(data.actorId, actorMap);
			game.litm?._finalizeRollSelectionChange?.({
				scope: "actor",
				ownerId: data.actorId,
				operation: "sync",
				changes: Object.keys(data.selection).map((ref) => ({
					ownerId: data.actorId,
					ref,
				})),
			});
		});
	}

	static #registerGmRollSelectionSyncListener() {
		Sockets.on("syncGmRollSelection", (event) => {
			const { data } = event;
			if (!data?.userId || !data?.selection) return;
			const sel = game.litm.gmRollSelection;
			const userMap = new Map();
			for (const [ref, tagMap] of Object.entries(data.selection)) {
				userMap.set(ref, new Map(Object.entries(tagMap)));
			}
			sel.set(data.userId, userMap);
			game.litm?._finalizeRollSelectionChange?.({
				scope: "gm",
				ownerId: data.userId,
				operation: "sync",
				changes: Object.keys(data.selection).map((ref) => ({
					ownerId: data.userId,
					ref,
				})),
			});
		});
	}

	static #registerRollSelectionBatchSyncListener() {
		Sockets.on("syncRollSelectionBatch", ({ data }) => {
			const entries = Object.entries(data?.selections ?? {});
			if (!entries.length) return;
			const changes = [];
			for (const [actorId, selection] of entries) {
				const actorMap = new Map();
				for (const [ref, tagMap] of Object.entries(selection)) {
					actorMap.set(ref, new Map(Object.entries(tagMap)));
					changes.push({ ownerId: actorId, ref, operation: "sync" });
				}
				game.litm.rollSelection.set(actorId, actorMap);
				if (!Object.keys(selection).length)
					changes.push({ ownerId: actorId, operation: "reset" });
			}
			game.litm?._finalizeRollSelectionChange?.({
				scope: "actor",
				operation: "batch",
				changes,
			});
		});

		Sockets.on("syncGmRollSelectionBatch", ({ data }) => {
			const entries = Object.entries(data?.selections ?? {});
			if (!entries.length) return;
			const changes = [];
			for (const [userId, selection] of entries) {
				const userMap = new Map();
				for (const [ref, tagMap] of Object.entries(selection)) {
					userMap.set(ref, new Map(Object.entries(tagMap)));
					changes.push({ ownerId: userId, ref, operation: "sync" });
				}
				game.litm.gmRollSelection.set(userId, userMap);
				if (!Object.keys(selection).length)
					changes.push({ ownerId: userId, operation: "reset" });
			}
			game.litm?._finalizeRollSelectionChange?.({
				scope: "gm",
				operation: "batch",
				changes,
			});
		});
	}

	static #registerGMRollListeners() {
		Sockets.on("skipModeration", ({ data: { name } }) => {
			ui.notifications.info(
				game.i18n.format("Litm.ui.player-skipped-moderation", { name }),
			);
		});

		// Sockets.on ?
		game.socket.on("system.litm-rn", async (data) => {
			if (
				data.app === "helping-tags" &&
				data.type === "update" &&
				game.user.isGM
			) {
				const config = game.settings.get("litm-rn", "storytags") || {};
				await game.settings.set("litm-rn", "storytags", {
					...config,
					helpingTags: data.helpingTags,
				});
			}
		});
	}
}
