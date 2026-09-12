import { ChallengeData } from "./scripts/actor/challenge/challenge-data.js";
import { ChallengeSheet } from "./scripts/actor/challenge/challenge-sheet.js";
import { CharacterData } from "./scripts/actor/character/character-data.js";
import { CharacterSheet } from "./scripts/actor/character/character-sheet.js";
import { CampDialog } from "./scripts/apps/camp-dialog.js";
import {
	BackpackCard,
	HeroCard,
	NotesCard,
	ThemeCard,
} from "./scripts/apps/card-reader.js";
import { DENOMINATION, DoubleSix } from "./scripts/apps/dice.js";
import { importCharacter } from "./scripts/apps/import-character.js";
import { PromiseFulfillmentApp } from "./scripts/apps/promise-fulfillment.js";
import { ReferenceHandbook } from "./scripts/apps/reference-handbook.js";
import { LitmRollDialog } from "./scripts/apps/roll-dialog.js";
import { LitmRoll } from "./scripts/apps/roll.js";
import { TagManager } from "./scripts/apps/tag-manager.js";
import { ThemeAdvancementApp } from "./scripts/apps/theme-advancement.js";
import { ThemeBuilder } from "./scripts/apps/theme-builder.js";
import { SuperCheckbox } from "./scripts/components/super-checkbox.js";
import { ToggledInput } from "./scripts/components/toggled-input.js";
import { TagData } from "./scripts/data/abstract.js";
import { RelationshipData } from "./scripts/data/abstract.js";
import { SpecialData } from "./scripts/data/abstract.js";
import {
	DRAG_TYPE,
	addSpecialToContainer,
	makeSpecialDragData,
	moveSpecialWithinDocument,
	readSpecialDragData,
	removeSpecialFromContainer,
} from "./scripts/data/specials.js";
import { FellowshipThemeData } from "./scripts/item/fellowship/fellowship-data.js";
import { FellowshipThemeSheet } from "./scripts/item/fellowship/fellowship-sheet.js";
import { StoryThemeData } from "./scripts/item/storytheme/storytheme-data.js";
import { StoryThemeSheet } from "./scripts/item/storytheme/storytheme-sheet.js";
import { ThemebookData } from "./scripts/item/themebook/themebook-data.js";
import { ThemebookSheet } from "./scripts/item/themebook/themebook-sheet.js";
import { ThemeKitData } from "./scripts/item/themekit/themekit-data.js";
import { ThemeKitSheet } from "./scripts/item/themekit/themekit-sheet.js";
import { ThreatData } from "./scripts/item/threat/threat-data.js";
import { ThreatSheet } from "./scripts/item/threat/threat-sheet.js";
import { TropeData } from "./scripts/item/trope/trope-data.js";
import { TropeSheet } from "./scripts/item/trope/trope-sheet.js";
import { info, success } from "./scripts/logger.js";
import { LitmDropPlugin } from "./scripts/prosemirror/litm-drop-plugin.js";
import { LitmConfig } from "./scripts/system/config.js";
import { EMBEDDED_ONLY } from "./scripts/system/constants.js";
import { Enrichers } from "./scripts/system/enrichers.js";
import { Fonts } from "./scripts/system/fonts.js";
import {
	HandlebarsHelpers,
	HandlebarsPartials,
} from "./scripts/system/handlebars.js";
import { LitmHooks } from "./scripts/system/hooks.js";
import { KeyBindings } from "./scripts/system/keybindings.js";
import { WorldMigrations } from "./scripts/system/migrations.js";
import { LitmSettings } from "./scripts/system/settings.js";
import { Sockets } from "./scripts/system/sockets.js";
import { ThemeAdvancement } from "./scripts/system/theme-advancement.js";
import { ThemeSources } from "./scripts/system/theme-sources.js";

// Register Custom Elements
ToggledInput.Register();
SuperCheckbox.Register();

// Init Hook
Hooks.once("init", () => {
	info("Initializing Legend in the Mist...");
	game.litm = {
		data: {
			TagData,
			RelationshipData,
			SpecialData,
		},
		methods: {
			calculatePower: LitmRollDialog.calculatePower,
		},
		importCharacter,
		LitmRollDialog,
		LitmRoll,
		TagManager,
		CampDialog,
		ThemeBuilder,
		ThemeAdvancementApp,
		PromiseFulfillmentApp,
		ReferenceHandbook,
		reference: {
			open: (target) => ReferenceHandbook.open(target),
		},
		themeAdvancement: ThemeAdvancement,
		themeSources: ThemeSources,
		specials: {
			DRAG_TYPE,
			makeSpecialDragData,
			readSpecialDragData,
			addSpecialToContainer,
			removeSpecialFromContainer,
			moveSpecialWithinDocument,
		},
		rollSelection: new Map(), // Map<actorId, Map<ref, Map<tagId, string>>>
		/** Map<userId, Map<ref, Map<tagId, string>>> — each GM's own tag selection for group rolls */
		gmRollSelection: new Map(),
		gmRollDialog: null,

		/** Get the per-actor selection map, creating if needed */
		getSelectionForActor(actorId) {
			if (!this.rollSelection.has(actorId))
				this.rollSelection.set(actorId, new Map());
			return this.rollSelection.get(actorId);
		},

		/** Get the ref sub-map within an actor's selection */
		getRefMap(actorId, ref) {
			const sel = this.getSelectionForActor(actorId);
			if (!sel.has(ref)) sel.set(ref, new Map());
			return sel.get(ref);
		},

		/** Add a tag to a character's roll selection */
		addTagToRoll(actorId, ref, tagId, state = "positive") {
			this.getRefMap(actorId, ref).set(tagId, state);
			this._dispatchRollSelection(actorId);
			this._finalizeRollSelectionChange({
				scope: "actor",
				ownerId: actorId,
				ref,
				tagId,
				state,
				operation: "set",
			});
		},

		/** Remove a tag from a specific actor+ref roll selection */
		removeTagFromRoll(actorId, ref, tagId) {
			const tagMap = this.rollSelection.get(actorId)?.get(ref);
			if (!tagMap?.delete(tagId)) return;
			this._dispatchRollSelection(actorId);
			this._finalizeRollSelectionChange({
				scope: "actor",
				ownerId: actorId,
				ref,
				tagId,
				state: "",
				operation: "remove",
			});
		},

		/** Remove a tag from every ref in one character's roll selection. */
		removeTagFromActorRoll(actorId, tagId) {
			const refMap = this.rollSelection.get(actorId);
			if (!refMap) return;
			let changed = false;
			for (const [, tagMap] of refMap)
				changed = tagMap.delete(tagId) || changed;
			if (!changed) return;
			this._dispatchRollSelection(actorId);
			this._finalizeRollSelectionChange({
				scope: "actor",
				ownerId: actorId,
				tagId,
				state: "",
				operation: "remove",
			});
		},

		/** Clear one character's complete roll selection. */
		clearActorRollSelection(actorId) {
			if (!this.rollSelection.delete(actorId)) return;
			this._dispatchRollSelection(actorId);
			this._finalizeRollSelectionChange({
				scope: "actor",
				ownerId: actorId,
				operation: "reset",
			});
		},

		/** Remove one source ref from several character selections as one local operation. */
		removeRollRefFromActors(actorIds, ref) {
			const changedActors = [];
			for (const actorId of actorIds) {
				if (!this.rollSelection.get(actorId)?.delete(ref)) continue;
				changedActors.push(actorId);
			}
			if (!changedActors.length) return;
			this._dispatchRollSelectionBatch(changedActors);
			this._finalizeRollSelectionChange({
				scope: "actor",
				operation: "batch",
				changes: changedActors.map((ownerId) => ({
					ownerId,
					ref,
					operation: "remove",
				})),
			});
		},

		/** Clear all participant and GM selections for a fellowship group roll. */
		resetGroupRollSelections(fellowshipId, { dispatch = true } = {}) {
			if (!fellowshipId) return;
			const actorIds = game.actors
				.filter(
					(actor) =>
						actor.type === "character" &&
						actor.system?.fellowshipId === fellowshipId,
				)
				.map((actor) => actor.id);
			let actorChanged = false;
			for (const actorId of actorIds)
				actorChanged = this.rollSelection.delete(actorId) || actorChanged;
			const gmChanged = this.gmRollSelection.size > 0;
			this.gmRollSelection.clear();
			if (actorChanged) this._persistRollSelections();
			if (gmChanged) this._persistGmRollSelections();
			if (dispatch) Sockets.dispatch("resetGroupRoll", { fellowshipId });
			if (actorChanged || gmChanged) {
				Hooks.callAll("litmRollSelectionUpdated", {
					scope: "all",
					operation: "reset",
					changes: actorIds.map((ownerId) => ({
						scope: "actor",
						ownerId,
						operation: "reset",
					})),
				});
				for (const actorId of actorIds) {
					const sheet = game.actors.get(actorId)?.sheet;
					if (sheet?.rendered) sheet.updateRollSelectionDisplay?.();
				}
				if (ui.combat?.rendered) ui.combat.render();
				if (game.litm?._tmPopOut?.rendered) game.litm._tmPopOut.render();
			}
		},

		/** Remove a tag from ALL actors' roll selections */
		removeTagFromAllRolls(tagId) {
			const changedActors = new Set();
			for (const [actorId, refMap] of this.rollSelection) {
				for (const [, tagMap] of refMap) {
					if (tagMap.delete(tagId)) changedActors.add(actorId);
				}
			}
			if (!changedActors.size) return;
			this._dispatchRollSelectionBatch(changedActors);
			this._finalizeRollSelectionChange({
				scope: "actor",
				operation: "batch",
				changes: [...changedActors].map((ownerId) => ({
					ownerId,
					tagId,
					state: "",
					operation: "remove",
				})),
			});
		},

		_dispatchRollSelection(actorId) {
			const sel = this.rollSelection.get(actorId);
			const selection = {};
			for (const [ref, tagMap] of sel ?? []) {
				if (tagMap.size === 0) continue;
				selection[ref] = Object.fromEntries(tagMap);
			}
			Sockets.dispatch("syncRollSelection", { actorId, selection });
		},

		/** Dispatch several actor selections in one socket message. */
		_dispatchRollSelectionBatch(actorIds) {
			const selections = {};
			for (const actorId of actorIds) {
				const selection = {};
				for (const [ref, tagMap] of this.rollSelection.get(actorId) ?? []) {
					if (tagMap.size) selection[ref] = Object.fromEntries(tagMap);
				}
				selections[actorId] = selection;
			}
			Sockets.dispatch("syncRollSelectionBatch", { selections });
		},

		/** Check if a tag is selected for a specific actor+ref */
		isTagSelectedForActor(actorId, ref, tagId) {
			return this.rollSelection.get(actorId)?.get(ref)?.has(tagId) ?? false;
		},

		/** Get a flat Set of tagIds selected for an actor (all refs) */
		getSelectedTagIds(actorId) {
			const ids = new Set();
			const sel = this.rollSelection.get(actorId);
			if (!sel) return ids;
			for (const [, tagMap] of sel) {
				for (const id of tagMap.keys()) ids.add(id);
			}
			return ids;
		},

		/** Get which actors have a given tag selected, with their ref and state */
		getTagSelections(tagId) {
			const results = [];
			for (const [actorId, refMap] of this.rollSelection) {
				for (const [ref, tagMap] of refMap) {
					if (tagMap.has(tagId)) {
						results.push({ actorId, ref, state: tagMap.get(tagId) });
					}
				}
			}
			return results;
		},

		/** Replace a burned tag with a normal positive selection everywhere. */
		normalizeBurnedTagSelections(tagId) {
			const changedActors = new Set();
			for (const [actorId, refMap] of this.rollSelection) {
				for (const [, tagMap] of refMap) {
					if (tagMap.get(tagId) !== "burned") continue;
					tagMap.set(tagId, "positive");
					changedActors.add(actorId);
				}
			}
			const changedUsers = new Set();
			for (const [userId, refMap] of this.gmRollSelection) {
				for (const [, tagMap] of refMap) {
					if (tagMap.get(tagId) !== "burned") continue;
					tagMap.set(tagId, "positive");
					changedUsers.add(userId);
				}
			}
			if (changedActors.size) this._dispatchRollSelectionBatch(changedActors);
			if (changedUsers.size) this._dispatchGmRollSelectionBatch(changedUsers);
			if (changedActors.size)
				this._finalizeRollSelectionChange({
					scope: "actor",
					operation: "batch",
					changes: [...changedActors].map((ownerId) => ({
						ownerId,
						tagId,
						state: "positive",
						operation: "set",
					})),
				});
			if (changedUsers.size)
				this._finalizeRollSelectionChange({
					scope: "gm",
					operation: "batch",
					changes: [...changedUsers].map((ownerId) => ({
						ownerId,
						tagId,
						state: "positive",
						operation: "set",
					})),
				});
		},

		/** Resolve an accepted shared tag stored on its whisper ChatMessage. */
		getAcceptedSharedTag(targetActorId, tagId) {
			for (const message of game.messages ?? []) {
				const share = message.getFlag("litm-rn", "tagShare");
				if (
					share?.status === "accepted" &&
					share.targetActorId === targetActorId &&
					share.shareId === tagId
				) {
					const tag = foundry.utils.deepClone(share.tag);
					const senderActor = game.actors.get(share.senderActorId);
					tag.senderActorId = share.senderActorId;
					tag.targetActorId = share.targetActorId;
					tag.actorRef = senderActor?.uuid ?? tag.actorRef;
					return tag;
				}
			}
			return null;
		},

		/** Resolve a pending tag share. This mutation is performed by a GM client. */
		async resolveTagShare(messageId, decision, requesterId = game.user.id) {
			if (!game.user.isGM || !["accepted", "declined"].includes(decision))
				return;
			const message = game.messages.get(messageId);
			const share = message?.getFlag("litm-rn", "tagShare");
			if (!message || !share || share.status !== "pending") return;

			const requester = game.users.get(requesterId);
			if (!requester?.isGM && requesterId !== share.targetUserId) return;

			await message.update({ "flags.litm-rn.tagShare.status": decision });
			if (decision === "accepted") {
				const state =
					share.tag?.isHindering || share.tag?.type === "weaknessTag"
						? "negative"
						: "positive";
				this.addTagToRoll(
					share.targetActorId,
					"fellowship",
					share.shareId,
					state,
				);
			}
		},

		/** Grant experience for an accepted weakness shared by another character. */
		async grantSharedWeaknessExperience(
			shareId,
			targetActorId,
			requesterId = game.user.id,
		) {
			if (!game.user.isGM) return;
			const message = game.messages.find((entry) => {
				const share = entry.getFlag("litm-rn", "tagShare");
				return (
					share?.shareId === shareId && share.targetActorId === targetActorId
				);
			});
			const share = message?.getFlag("litm-rn", "tagShare");
			if (!message || share?.status !== "accepted" || share.experienceGranted)
				return;

			const requester = game.users.get(requesterId);
			if (!requester?.isGM && requesterId !== share.targetUserId) return;
			if (
				share.tag?.type !== "weaknessTag" ||
				share.tag.senderActorId !== share.senderActorId
			)
				return;

			const actor = game.actors.get(share.senderActorId);
			if (!actor || typeof actor.sheet?.gainImprove !== "function") return;
			await message.update({
				"flags.litm-rn.tagShare.experienceGranted": true,
			});
			try {
				await actor.sheet.gainImprove({
					...share.tag,
					id: share.tag.sourceTagId,
				});
			} catch (error) {
				await message.update({
					"flags.litm-rn.tagShare.experienceGranted": false,
				});
				throw error;
			}
		},

		/** Scratch the sender's source tag when an accepted shared tag is burned. */
		async scratchSharedRollTag(
			shareId,
			targetActorId,
			requesterId = game.user.id,
		) {
			if (!game.user.isGM) return;
			const message = game.messages.find((entry) => {
				const share = entry.getFlag("litm-rn", "tagShare");
				return (
					share?.shareId === shareId && share.targetActorId === targetActorId
				);
			});
			const share = message?.getFlag("litm-rn", "tagShare");
			if (!message || share?.status !== "accepted") return;

			const requester = game.users.get(requesterId);
			if (!requester?.isGM && requesterId !== share.targetUserId) return;

			const actor = game.actors.get(share.senderActorId);
			const sourceTagId = share.tag?.sourceTagId;
			if (!actor || !sourceTagId) return;
			await message.update({ "flags.litm-rn.tagShare.burnProcessed": true });
			try {
				let scratched = false;
				const themes = foundry.utils.duplicate(actor.system.themes ?? []);
				for (const theme of themes) {
					if (theme.themeTag?.id === sourceTagId) {
						theme.themeTag.isScratched = true;
						scratched = true;
					}
					const powerTag = theme.powerTags?.find(
						(tag) => tag.id === sourceTagId,
					);
					if (powerTag) {
						powerTag.isScratched = true;
						scratched = true;
					}
				}
				if (scratched) {
					await actor.update({ "system.themes": themes }, { validate: false });
				} else {
					const backpackTags = foundry.utils.duplicate(
						actor.system.backpackTags ?? [],
					);
					const backpackTag = backpackTags.find(
						(tag) => tag.id === sourceTagId,
					);
					if (backpackTag) {
						backpackTag.isScratched = true;
						scratched = true;
						await actor.update(
							{ "system.backpackTags": backpackTags },
							{ validate: false },
						);
					}
				}

				if (!scratched) {
					const story = actor.items.find(
						(item) =>
							item.type === "story" &&
							item.system.allTags?.some((tag) => tag.id === sourceTagId),
					);
					if (story) {
						if (story.system.themeTag?.id === sourceTagId) {
							await story.update({ "system.themeTag.isScratched": true });
						} else {
							const powerTags = foundry.utils.duplicate(
								story.system.powerTags ?? [],
							);
							const powerTag = powerTags.find((tag) => tag.id === sourceTagId);
							if (powerTag) {
								powerTag.isScratched = true;
								await story.update({ "system.powerTags": powerTags });
							}
						}
						scratched = true;
					}
				}

				if (!scratched) {
					const effect = actor.effects.get(sourceTagId);
					if (effect) {
						await effect.update({ "flags.litm-rn.isScratched": true });
						scratched = true;
					}
				}

				if (!scratched) {
					await message.update({
						"flags.litm-rn.tagShare.burnProcessed": false,
					});
					return;
				}
				Hooks.callAll("litmActorDataUpdated", actor.uuid);
			} catch (error) {
				await message.update({ "flags.litm-rn.tagShare.burnProcessed": false });
				throw error;
			}
		},

		/** Remove empty refs and owners from one roll-selection store. */
		_cleanupRollSelection(scope) {
			const selection =
				scope === "gm" ? this.gmRollSelection : this.rollSelection;
			for (const [ownerId, refMap] of selection) {
				let hasAny = false;
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) refMap.delete(ref);
					else hasAny = true;
				}
				if (!hasAny) selection.delete(ownerId);
			}
		},

		/** Persist and publish one completed roll-selection mutation. */
		_finalizeRollSelectionChange(change, { persist = true } = {}) {
			const scope = change?.scope === "gm" ? "gm" : "actor";
			this._cleanupRollSelection(scope);
			if (persist) {
				if (scope === "gm") this._persistGmRollSelections();
				else this._persistRollSelections();
			}

			if (scope === "actor") {
				const actorIds =
					change.operation === "batch"
						? new Set(
								(change.changes ?? [])
									.map((entry) => entry.ownerId)
									.filter(Boolean),
							)
						: new Set(change.ownerId ? [change.ownerId] : []);
				for (const actorId of actorIds) {
					const sheet = game.actors.get(actorId)?.sheet;
					if (sheet?.rendered) sheet.updateRollSelectionDisplay?.(change);
				}
			}

			if (ui.combat?.rendered) ui.combat.render();
			if (game.litm?._tmPopOut?.rendered) game.litm._tmPopOut.render();
			Hooks.callAll("litmRollSelectionUpdated", change);
		},

		/** Compatibility fallback for callers which mutate the Maps directly. */
		refreshRollSelectionUI(change = { scope: "all", operation: "refresh" }) {
			for (const [actorId, refMap] of this.rollSelection) {
				let hasAny = false;
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) refMap.delete(ref);
					else hasAny = true;
				}
				if (!hasAny) this.rollSelection.delete(actorId);
			}
			for (const [userId, refMap] of this.gmRollSelection) {
				let hasAny = false;
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) refMap.delete(ref);
					else hasAny = true;
				}
				if (!hasAny) this.gmRollSelection.delete(userId);
			}
			this._persistRollSelections();
			this._persistGmRollSelections();
			for (const actor of game.actors) {
				if (actor.sheet?.rendered && actor.type === "character")
					actor.sheet.render();
			}
			if (ui.combat?.rendered) ui.combat.render();
			if (game.litm?._tmPopOut?.rendered) game.litm._tmPopOut.render();
			Hooks.callAll("litmRollSelectionUpdated", change);
		},

		/** Get the per-GM selection map, creating if needed */
		getGmSelection(userId) {
			if (!this.gmRollSelection.has(userId))
				this.gmRollSelection.set(userId, new Map());
			return this.gmRollSelection.get(userId);
		},

		/** Get the ref sub-map within a GM's selection */
		getGmRefMap(userId, ref) {
			const sel = this.getGmSelection(userId);
			if (!sel.has(ref)) sel.set(ref, new Map());
			return sel.get(ref);
		},

		/** Add a tag to a GM's roll selection */
		gmAddTagToRoll(userId, ref, tagId, state = "positive") {
			this.getGmRefMap(userId, ref).set(tagId, state);
			this._dispatchGmRollSelection(userId);
			this._finalizeRollSelectionChange({
				scope: "gm",
				ownerId: userId,
				ref,
				tagId,
				state,
				operation: "set",
			});
		},

		/** Remove a tag from a GM's roll selection */
		gmRemoveTagFromRoll(userId, ref, tagId) {
			const tagMap = this.gmRollSelection.get(userId)?.get(ref);
			if (!tagMap?.delete(tagId)) return;
			this._dispatchGmRollSelection(userId);
			this._finalizeRollSelectionChange({
				scope: "gm",
				ownerId: userId,
				ref,
				tagId,
				state: "",
				operation: "remove",
			});
		},

		/** Remove a tag from ALL GM selections */
		gmRemoveTagFromAllRolls(tagId) {
			const changedUsers = new Set();
			for (const [userId, refMap] of this.gmRollSelection) {
				for (const [, tagMap] of refMap) {
					if (tagMap.delete(tagId)) changedUsers.add(userId);
				}
			}
			if (!changedUsers.size) return;
			this._dispatchGmRollSelectionBatch(changedUsers);
			this._finalizeRollSelectionChange({
				scope: "gm",
				operation: "batch",
				changes: [...changedUsers].map((ownerId) => ({
					ownerId,
					tagId,
					state: "",
					operation: "remove",
				})),
			});
		},

		/** Check if a tag is selected by a GM */
		isGmTagSelected(userId, ref, tagId) {
			return this.gmRollSelection.get(userId)?.get(ref)?.has(tagId) ?? false;
		},

		/** Aggregate all GM selections into a flat array of {userId, ref, tagId, state} */
		getGmAllSelections() {
			const results = [];
			for (const [userId, refMap] of this.gmRollSelection) {
				for (const [ref, tagMap] of refMap) {
					for (const [tagId, state] of tagMap) {
						if (state) results.push({ userId, ref, tagId, state });
					}
				}
			}
			return results;
		},

		_dispatchGmRollSelection(userId) {
			const sel = this.gmRollSelection.get(userId);
			if (!sel) return;
			const selection = {};
			for (const [ref, tagMap] of sel) {
				if (tagMap.size === 0) continue;
				selection[ref] = Object.fromEntries(tagMap);
			}
			Sockets.dispatch("syncGmRollSelection", { userId, selection });
		},

		/** Dispatch several GM selections in one socket message. */
		_dispatchGmRollSelectionBatch(userIds) {
			const selections = {};
			for (const userId of userIds) {
				const selection = {};
				for (const [ref, tagMap] of this.gmRollSelection.get(userId) ?? []) {
					if (tagMap.size) selection[ref] = Object.fromEntries(tagMap);
				}
				selections[userId] = selection;
			}
			Sockets.dispatch("syncGmRollSelectionBatch", { selections });
		},

		_persistRollSelections() {
			const obj = {};
			for (const [actorId, refMap] of this.rollSelection) {
				const refObj = {};
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) continue;
					refObj[ref] = Object.fromEntries(tagMap);
				}
				if (Object.keys(refObj).length) obj[actorId] = refObj;
			}
			game.settings.set("litm-rn", "rollSelections", obj).catch(() => {});
		},

		_persistGmRollSelections() {
			const obj = {};
			for (const [userId, refMap] of this.gmRollSelection) {
				const refObj = {};
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) continue;
					refObj[ref] = Object.fromEntries(tagMap);
				}
				if (Object.keys(refObj).length) obj[userId] = refObj;
			}
			game.settings.set("litm-rn", "gmRollSelections", obj).catch(() => {});
		},

		_restoreRollSelections() {
			try {
				const saved = game.settings.get("litm-rn", "rollSelections") || {};
				for (const [actorId, refObj] of Object.entries(saved)) {
					const refMap = new Map();
					for (const [ref, tagObj] of Object.entries(refObj)) {
						refMap.set(ref, new Map(Object.entries(tagObj)));
					}
					if (refMap.size) this.rollSelection.set(actorId, refMap);
				}
			} catch (_) {
				/* no-op */
			}
		},

		_restoreGmRollSelections() {
			try {
				const saved = game.settings.get("litm-rn", "gmRollSelections") || {};
				for (const [userId, refObj] of Object.entries(saved)) {
					const refMap = new Map();
					for (const [ref, tagObj] of Object.entries(refObj)) {
						refMap.set(ref, new Map(Object.entries(tagObj)));
					}
					if (refMap.size) this.gmRollSelection.set(userId, refMap);
				}
			} catch (_) {
				/* no-op */
			}
		},
	};

	info("Initializing Config...");
	CONFIG.Actor.dataModels.character = CharacterData;
	CONFIG.Actor.dataModels.challenge = ChallengeData;
	CONFIG.Actor.trackableAttributes.character =
		CharacterData.getTrackableAttributes();
	CONFIG.Dice.terms[DENOMINATION] = DoubleSix;
	CONFIG.Dice.rolls.push(LitmRoll);
	CONFIG.Item.dataModels.fellowship = FellowshipThemeData;
	CONFIG.Item.dataModels.story = StoryThemeData;
	CONFIG.Item.dataModels.threat = ThreatData;
	CONFIG.Item.dataModels.themebook = ThemebookData;
	CONFIG.Item.dataModels.themekit = ThemeKitData;
	CONFIG.Item.dataModels.trope = TropeData;
	CONFIG.litm = new LitmConfig();

	info("Registering Sheets...");
	foundry.documents.collections.Actors.registerSheet(
		"litm-rn",
		ChallengeSheet,
		{
			types: ["challenge"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Actors.registerSheet(
		"litm-rn",
		CharacterSheet,
		{
			types: ["character"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet("litm-rn", ThreatSheet, {
		types: ["threat"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet(
		"litm-rn",
		FellowshipThemeSheet,
		{
			types: ["fellowship"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet(
		"litm-rn",
		StoryThemeSheet,
		{
			types: ["story"],
			makeDefault: true,
		},
	);
	foundry.documents.collections.Items.registerSheet("litm-rn", ThemebookSheet, {
		types: ["themebook"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litm-rn", ThemeKitSheet, {
		types: ["themekit"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litm-rn", TropeSheet, {
		types: ["trope"],
		makeDefault: true,
	});
	// CardReader standalone windows edit character-owned hero, backpack, and theme data.
	game.litm.HeroCard = HeroCard;
	game.litm.ThemeCard = ThemeCard;
	game.litm.BackpackCard = BackpackCard;
	game.litm.NotesCard = NotesCard;

	HandlebarsHelpers.register();
	HandlebarsPartials.register();
	ReferenceHandbook.registerHooks();
	Enrichers.register();
	Fonts.register();
	KeyBindings.register();
	LitmSettings.register();

	// Replace Combat Tracker with Tag Manager
	CONFIG.ui.combat = TagManager;
	CONFIG.ui.sidebar.TABS.combat = {
		tooltip: "Litm.ui.tag-manager",
		icon: "fas fa-tags",
	};

	LitmHooks.register();
	WorldMigrations.register();
	Sockets.registerListeners();
	CampDialog.register();

	game.litm._restoreRollSelections();
	game.litm._restoreGmRollSelections();

	const ItemDocument = CONFIG.Item.documentClass;
	ItemDocument.createDialog = ((orig) =>
		async function (data, createOptions, options = {}) {
			options.types = game.documentTypes.Item.filter(
				(t) => !EMBEDDED_ONLY.includes(t),
			);
			return orig.call(this, data, createOptions, options);
		})(ItemDocument.createDialog);

	// Patch ProseMirror to inject LitmDropPlugin into every editor
	const _origConfigurePlugins =
		foundry.applications.elements.HTMLProseMirrorElement.prototype
			._configurePlugins;

	foundry.applications.elements.HTMLProseMirrorElement.prototype._configurePlugins =
		function () {
			const plugins = _origConfigurePlugins.call(this);
			const currentSchema = this.schema;
			plugins.litmDropPlugin = LitmDropPlugin.build(currentSchema);
			return plugins;
		};

	success("Successfully initialized Legend in the Mist!");
});
