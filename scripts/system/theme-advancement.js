import { getAssignedUser, getFellowshipActors } from "../utils.js";

const { DialogV2 } = foundry.applications.api;

/** Shared rules for Hero theme progress, advancement availability, and archives. */
export class ThemeAdvancement {
	/**
	 * Calculate cyclic Promise progress and accumulated Fulfillment moments.
	 * @param {Actor} actor Hero actor.
	 * @param {number} count Promises to add.
	 * @returns {{promise:number, availableFulfillments:number, gainedFulfillments:number}}
	 */
	static promiseProgress(actor, count) {
		const total =
			Number(actor.system.promise ?? 0) + Math.max(0, Number(count ?? 0));
		const gainedFulfillments = Math.floor(total / 5);
		return {
			promise: total % 5,
			availableFulfillments:
				Number(actor.system.availableFulfillments ?? 0) + gainedFulfillments,
			gainedFulfillments,
		};
	}

	/**
	 * Add Promise progress, converting every complete track into Fulfillment.
	 * @param {Actor} actor Hero actor.
	 * @param {number} count Promises to add.
	 * @returns {Promise<object>}
	 */
	static async addPromises(actor, count) {
		const progress = this.promiseProgress(actor, count);
		await actor.update({
			"system.promise": progress.promise,
			"system.availableFulfillments": progress.availableFulfillments,
		});
		return progress;
	}

	/**
	 * Convert filled Improve tracks into banked Improvements.
	 * Handles per-theme configurable tracks and outstanding one-point nascent awards.
	 * @param {object[]} themes Mutable theme array.
	 * @returns {{themeIndex:number, count:number}[]} Awarded Improvements.
	 */
	static normalizeImproveTracks(themes) {
		const awards = [];
		for (const [themeIndex, theme] of themes.entries()) {
			if (!theme || theme.isEmpty) continue;
			if (Number(theme.nascentPowerNeeded ?? 0) > 0) {
				theme.nascentPowerNeeded = Math.max(
					0,
					2 - (theme.powerTags?.length ?? 0),
				);
			}
			let points = Math.max(0, Number(theme.improve ?? 0));
			let available = Math.max(0, Number(theme.availableImprovements ?? 0));
			const outstandingNascent = Math.max(
				0,
				Number(theme.nascentPowerNeeded ?? 0) - available,
			);
			const nascentAwards = Math.min(points, outstandingNascent);
			points -= nascentAwards;
			available += nascentAwards;
			const trackLength = Math.max(1, Number(theme.improveTrackLength ?? 3));
			const awardSize = Math.max(1, Number(theme.improvementsPerTrack ?? 1));
			const ordinaryAwards = Math.floor(points / trackLength) * awardSize;
			points %= trackLength;
			const count = nascentAwards + ordinaryAwards;
			if (!count) continue;
			theme.improve = points;
			theme.availableImprovements = available + ordinaryAwards;
			awards.push({ themeIndex, count });
		}
		return awards;
	}

	/**
	 * Increase one theme progress track and apply its threshold rule.
	 * @param {Actor} actor Hero actor.
	 * @param {number} themeIndex Theme array index.
	 * @param {"improve"|"milestone"|"abandon"} field Track name.
	 * @returns {Promise<void>}
	 */
	static async increaseTrack(actor, themeIndex, field) {
		const themes = foundry.utils.duplicate(
			actor.toObject().system.themes ?? [],
		);
		const theme = themes[themeIndex];
		if (!theme || theme.isEmpty) return;
		const value = Number(theme[field] ?? 0);

		const pendingNascent =
			Number(theme.nascentPowerNeeded ?? 0) -
			Number(theme.availableImprovements ?? 0);
		if (field === "improve" && pendingNascent > 0) {
			theme.improve = 0;
			theme.availableImprovements =
				Number(theme.availableImprovements ?? 0) + 1;
			await actor.update({ "system.themes": themes });
			await this.notify(actor, theme, "improve", theme.availableImprovements);
			return;
		}

		const trackLength = Math.max(1, Number(theme.improveTrackLength ?? 3));
		const awardSize = Math.max(1, Number(theme.improvementsPerTrack ?? 1));
		if (field === "improve" && value >= trackLength - 1) {
			theme.improve = 0;
			theme.availableImprovements =
				Number(theme.availableImprovements ?? 0) + awardSize;
			await actor.update({ "system.themes": themes });
			await this.notify(actor, theme, "improve", theme.availableImprovements);
			return;
		}

		const maximum = field === "improve" ? trackLength : 3;
		theme[field] = Math.min(value + 1, maximum);
		if ((field === "milestone" || field === "abandon") && theme[field] === 3) {
			theme.thresholdNotifications ??= { milestone: false, abandon: false };
			if (!theme.thresholdNotifications[field]) {
				theme.thresholdNotifications[field] = true;
				await actor.update({ "system.themes": themes });
				await this.notify(actor, theme, field);
				return;
			}
		}
		await actor.update({ "system.themes": themes });
	}

	/**
	 * Increase a Fellowship progress track and bank configured Improvements.
	 * @param {Item} fellowship Fellowship Item.
	 * @param {"improve"|"milestone"|"abandon"} field Track name.
	 * @returns {Promise<void>}
	 */
	static async increaseFellowshipTrack(fellowship, field) {
		if (!fellowship || fellowship.type !== "fellowship") return;
		const value = Math.max(0, Number(fellowship.system[field] ?? 0));
		if (field === "improve") {
			const trackLength = Math.max(
				1,
				Number(fellowship.system.improveTrackLength ?? 3),
			);
			if (value >= trackLength - 1) {
				const awardSize = Math.max(
					1,
					Number(fellowship.system.improvementsPerTrack ?? 1),
				);
				const available =
					Number(fellowship.system.availableImprovements ?? 0) + awardSize;
				await fellowship.update({
					"system.improve": 0,
					"system.availableImprovements": available,
				});
				await this.notifyFellowship(fellowship, "improve", available);
				return;
			}
			await fellowship.update({
				"system.improve": Math.min(value + 1, trackLength),
			});
			return;
		}
		const next = Math.min(value + 1, 3);
		const notifications = foundry.utils.duplicate(
			fellowship.system.thresholdNotifications ?? {
				milestone: false,
				abandon: false,
			},
		);
		if (
			(field === "milestone" || field === "abandon") &&
			next === 3 &&
			!notifications[field]
		) {
			notifications[field] = true;
			await fellowship.update({
				[`system.${field}`]: next,
				"system.thresholdNotifications": notifications,
			});
			await this.notifyFellowship(fellowship, field);
			return;
		}
		await fellowship.update({ [`system.${field}`]: next });
	}

	/**
	 * Decrease a Fellowship track and re-arm threshold notifications.
	 * @param {Item} fellowship Fellowship Item.
	 * @param {"improve"|"milestone"|"abandon"} field Track name.
	 * @returns {Promise<void>}
	 */
	static async decreaseFellowshipTrack(fellowship, field) {
		if (!fellowship || fellowship.type !== "fellowship") return;
		const next = Math.max(0, Number(fellowship.system[field] ?? 0) - 1);
		const update = { [`system.${field}`]: next };
		if (field === "milestone" || field === "abandon") {
			const notifications = foundry.utils.duplicate(
				fellowship.system.thresholdNotifications ?? {
					milestone: false,
					abandon: false,
				},
			);
			if (next < 3 && notifications[field]) {
				notifications[field] = false;
				update["system.thresholdNotifications"] = notifications;
			}
		}
		await fellowship.update(update);
	}

	/**
	 * Decrease one theme progress track.
	 * @param {Actor} actor Hero actor.
	 * @param {number} themeIndex Theme array index.
	 * @param {"improve"|"milestone"|"abandon"} field Track name.
	 * @returns {Promise<void>}
	 */
	static async decreaseTrack(actor, themeIndex, field) {
		const themes = foundry.utils.duplicate(
			actor.toObject().system.themes ?? [],
		);
		const theme = themes[themeIndex];
		if (!theme) return;
		theme[field] = Math.max(0, Number(theme[field] ?? 0) - 1);
		if (field === "milestone" || field === "abandon") {
			theme.thresholdNotifications ??= { milestone: false, abandon: false };
			if (theme[field] < 3) theme.thresholdNotifications[field] = false;
		}
		await actor.update({ "system.themes": themes });
	}

	/**
	 * Remove all banked improvements after confirmation and notify owners.
	 * @param {Actor} actor Hero actor.
	 * @param {number} themeIndex Theme array index.
	 * @returns {Promise<boolean>}
	 */
	static async resetAvailable(actor, themeIndex) {
		const theme = actor.system.themes?.[themeIndex];
		if (!theme?.availableImprovements) return false;
		const confirmed = await DialogV2.confirm({
			window: { title: game.i18n.localize("Litm.advancement.reset-title") },
			content: `<p>${game.i18n.format("Litm.advancement.reset-confirm", {
				count: theme.availableImprovements,
			})}</p>`,
			rejectClose: false,
		});
		if (!confirmed) return false;
		const themes = foundry.utils.duplicate(
			actor.toObject().system.themes ?? [],
		);
		const snapshot = themes[themeIndex];
		const count = snapshot.availableImprovements;
		snapshot.availableImprovements = 0;
		await actor.update({ "system.themes": themes });
		await this.notify(actor, snapshot, "reset", count);
		return true;
	}

	/**
	 * Remove all banked Fellowship Improvements after confirmation.
	 * @param {Item} fellowship Fellowship Item.
	 * @returns {Promise<boolean>}
	 */
	static async resetFellowshipAvailable(fellowship) {
		const count = Number(fellowship?.system?.availableImprovements ?? 0);
		if (!count) return false;
		const confirmed = await DialogV2.confirm({
			window: { title: game.i18n.localize("Litm.advancement.reset-title") },
			content: `<p>${game.i18n.format("Litm.advancement.reset-confirm", { count })}</p>`,
			rejectClose: false,
		});
		if (!confirmed) return false;
		await fellowship.update({ "system.availableImprovements": 0 });
		await this.notifyFellowship(fellowship, "reset", count);
		return true;
	}

	/**
	 * Store a complete immutable snapshot of a theme.
	 * @param {Actor} actor Hero actor.
	 * @param {object} theme Theme source data.
	 * @param {string} reason Archive reason.
	 * @returns {Promise<object>}
	 */
	static async archive(actor, theme, reason) {
		const entry = {
			id: foundry.utils.randomID(),
			archivedAt: Date.now(),
			reason,
			theme: foundry.utils.duplicate(theme),
		};
		const archive = foundry.utils.duplicate(
			actor.toObject().system.themeArchive ?? [],
		);
		archive.push(entry);
		await actor.update({ "system.themeArchive": archive });
		return entry;
	}

	/**
	 * Reconcile a changed theme's tags with ActiveEffect storage.
	 * @param {Actor} actor Hero actor.
	 * @param {string} oldThemeId Previous owner id.
	 * @param {object} theme Updated theme data.
	 * @returns {Promise<void>}
	 */
	static async syncThemeEffects(actor, oldThemeId, theme) {
		const existing = actor.effects
			.filter((effect) => {
				const flags = effect.flags?.["litm-rn"];
				return (
					flags?.ownerType === "theme" &&
					(flags.ownerId === oldThemeId || flags.ownerId === theme.id)
				);
			})
			.map((effect) => effect.id);
		if (existing.length)
			await actor.deleteEmbeddedDocuments("ActiveEffect", existing);
		const entries = [
			{ tag: theme.themeTag, hindering: false },
			...(theme.powerTags ?? []).map((tag) => ({ tag, hindering: false })),
			...(theme.weaknessTags ?? []).map((tag) => ({ tag, hindering: true })),
		];
		const effects = entries
			.filter(({ tag }) => tag?.name)
			.map(({ tag, hindering }) => ({
				name: tag.name,
				disabled: false,
				transfer: false,
				flags: {
					"litm-rn": {
						type: "tag",
						ownerType: "theme",
						ownerId: theme.id,
						isScratched: tag.isScratched ?? false,
						isHindering: hindering,
						isCrispy: tag.isCrispy ?? false,
					},
				},
			}));
		if (effects.length)
			await actor.createEmbeddedDocuments("ActiveEffect", effects);
		Hooks.callAll("litmActorDataUpdated", actor.uuid);
	}

	/**
	 * Send a private threshold/reset message to the assigned player and active GMs.
	 * @param {Actor} actor Hero actor.
	 * @param {object} theme Theme source data.
	 * @param {string} kind Event kind.
	 * @param {number|null} count Optional count.
	 * @returns {Promise<void>}
	 */
	static async notify(actor, theme, kind, count = null) {
		const assigned = getAssignedUser(actor);
		const recipients = new Set(
			game.users
				.filter((user) => user.isGM && user.active)
				.map((user) => user.id),
		);
		if (assigned) recipients.add(assigned.id);
		if (!recipients.size) return;
		const key = `Litm.advancement.chat-${kind}`;
		await CONFIG.ChatMessage.documentClass.create({
			content: `<p>${game.i18n.format(key, {
				actor: actor.name,
				theme: theme.name || theme.themeTag?.name || "",
				count: count ?? "",
			})}</p>`,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({ actor }),
			whisper: [...recipients],
		});
	}

	/**
	 * Whisper a Fellowship advancement event to GMs and all assigned member players.
	 * @param {Item} fellowship Fellowship Item.
	 * @param {"improve"|"milestone"|"abandon"|"reset"} kind Event kind.
	 * @param {number|null} count Optional available Improvement count.
	 * @returns {Promise<void>}
	 */
	static async notifyFellowship(fellowship, kind, count = null) {
		const recipients = this.#getFellowshipRecipients(fellowship);
		if (!recipients.size) return;
		await CONFIG.ChatMessage.documentClass.create({
			content: `<p>${game.i18n.format(
				`Litm.advancement.chat-fellowship-${kind}`,
				{
					fellowship: fellowship.name,
					count: count ?? "",
				},
			)}</p>`,
			speaker: { alias: fellowship.name },
			whisper: [...recipients],
		});
	}

	/**
	 * Whisper the result of a spent Fellowship Improvement.
	 * @param {Item} fellowship Fellowship Item.
	 * @param {{kind:string, tag?:object, special?:object, rewrite?:object}} result Applied result.
	 * @returns {Promise<void>}
	 */
	static async notifyFellowshipImprovement(fellowship, result) {
		const recipients = this.#getFellowshipRecipients(fellowship);
		if (!recipients.size) return;
		const escapeHtml = (value) => foundry.utils.escapeHTML(String(value ?? ""));
		const choiceKeys = {
			power: "Litm.advancement.add-power",
			weakness: "Litm.advancement.add-weakness",
			"remove-weakness": "Litm.advancement.remove-weakness",
			special: "Litm.advancement.gain-special",
			"reset-abandon": "Litm.advancement.reset-abandon",
			"reset-milestone": "Litm.advancement.reset-milestone",
			"reset-both": "Litm.advancement.reset-both",
		};
		const parts = [
			`<p>${game.i18n.format("Litm.advancement.chat-fellowship-choice", {
				fellowship: escapeHtml(fellowship.name),
				choice: escapeHtml(game.i18n.localize(choiceKeys[result.kind])),
			})}</p>`,
		];
		if (result.kind === "power" || result.kind === "weakness") {
			parts.push(
				`<p>${game.i18n.format("Litm.advancement.chat-fellowship-created-tag", {
					tag: escapeHtml(result.tag?.name),
				})}</p>`,
			);
		} else if (result.kind === "remove-weakness") {
			parts.push(
				`<p>${game.i18n.format("Litm.advancement.chat-fellowship-removed-tag", {
					tag: escape(result.tag?.name),
				})}</p>`,
			);
		} else if (result.kind === "special") {
			const TextEditor = foundry.applications.ux.TextEditor.implementation;
			const description = await TextEditor.enrichHTML(
				result.special?.description || "",
			);
			parts.push(
				`<div>${game.i18n.format("Litm.advancement.chat-fellowship-special", {
					name: escape(result.special?.name),
					description,
				})}</div>`,
			);
		}
		if (result.rewrite) {
			parts.push(
				`<p>${game.i18n.format("Litm.advancement.chat-fellowship-rewrite", {
					old: escape(result.rewrite.oldName),
					new: escape(result.rewrite.newName),
				})}</p>`,
			);
		}
		await CONFIG.ChatMessage.documentClass.create({
			content: `<div class="litm--fellowship-improvement-message">${parts.join("")}</div>`,
			speaker: { alias: fellowship.name },
			whisper: [...recipients],
		});
	}

	static #getFellowshipRecipients(fellowship) {
		const recipients = new Set(
			game.users.filter((user) => user.isGM).map((user) => user.id),
		);
		for (const actor of getFellowshipActors(fellowship.id)) {
			const assigned = getAssignedUser(actor);
			if (assigned) recipients.add(assigned.id);
			for (const user of game.users.filter(
				(user) => !user.isGM && actor.testUserPermission(user, "OWNER"),
			)) {
				recipients.add(user.id);
			}
		}
		return recipients;
	}
}
