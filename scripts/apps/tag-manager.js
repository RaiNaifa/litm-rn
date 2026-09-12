import { RollTargetPopup } from "../apps/roll-target-popup.js";
import { createPrivate } from "../system/private-creation.js";
import {
	addOrStackActorStatus,
	addOrStackStatusData,
	compareTagTypes,
	computeLimitCurrentValue,
	confirmDelete,
	dispatch,
	getActorFellowshipId,
	getFellowshipActors,
	getOwningDocument,
	getOwningWindow,
	isFellowshipMember,
	localize as t,
} from "../utils.js";
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const { AbstractSidebarTab } = foundry.applications.sidebar;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuidSync } = foundry.utils;

/** Global flag to prevent re-render during popup toggle operations (shared across sidebar + pop-out instances) */
let _skipEffectHook = false;

export class TagManager extends HandlebarsApplicationMixin(AbstractSidebarTab) {
	static tabName = "combat";

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--tag-manager"],
		position: { width: 900, height: 600 },
		window: { title: "Litm.ui.tag-manager", resizable: true },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/tag-manager.html" },
	};

	/** Stub — required because TagManager replaces CONFIG.ui.combat and Token._onHoverIn calls this */
	hoverCombatant() {}

	/** Stub — required because Token._onHoverIn calls this */
	_isTokenVisible() {
		return true;
	}

	#storyTagHookId = null;
	#crudSocketCallback = null;
	#resizeObserver = null;
	#_syncing = false;
	#pruning = false;
	#_tokenCycleIdx = null;
	#editingTagId = null;
	#contextMenu = null;
	#contextMenuAnchor = null;
	#dragSource = null;
	#deferSync = false;

	get title() {
		return t("Litm.ui.tag-manager");
	}

	// ── Preserve scroll across re-renders ──

	async render(options) {
		const scrollEl = this.element?.querySelector(".litm--tm-content");
		const saved = scrollEl
			? { top: scrollEl.scrollTop, left: scrollEl.scrollLeft }
			: null;
		const result = await super.render(options);
		if (saved) {
			const el = this.element?.querySelector(".litm--tm-content");
			if (el) {
				el.scrollTop = saved.top;
				el.scrollLeft = saved.left;
			}
		}
		// Sync other TagManager instances (pop-out)
		const other = this === ui.combat ? game.litm?._tmPopOut : ui.combat;
		if (other && other !== this && other.rendered && !this.#_syncing) {
			this.#_syncing = true;
			try {
				await other.render({ force: true });
			} catch {
				/* no-op */
			} finally {
				this.#_syncing = false;
			}
		}
		return result;
	}

	async renderPopout() {
		const popOutApp = await super.renderPopout();
		game.litm._tmPopOut = popOutApp || null;
		return popOutApp;
	}

	// ── Storage ──

	get #collapseStorageKey() {
		const view = this === ui.combat ? "sidebar" : "popout";
		return `litm-tm-collapsed-${game.user.id}-${view}`;
	}

	#getCollapsed() {
		try {
			const stored = localStorage.getItem(this.#collapseStorageKey);
			if (stored) return JSON.parse(stored);
			if (this === ui.combat) {
				return JSON.parse(
					localStorage.getItem(`litm-tm-collapsed-${game.user.id}`) || "[]",
				);
			}
			return [];
		} catch {
			return [];
		}
	}

	#saveCollapsed(collapsed) {
		localStorage.setItem(this.#collapseStorageKey, JSON.stringify(collapsed));
	}

	#getSelectedFellowship() {
		return game.settings.get("litm-rn", "selectedFellowship") || null;
	}
	#setSelectedFellowship(id) {
		return game.settings.set("litm-rn", "selectedFellowship", id);
	}
	#clearSelectedFellowship() {
		return game.settings.set("litm-rn", "selectedFellowship", "");
	}

	// ── Socket sync ──

	#socketRegistered = false;

	#rollSelectionRef(ref) {
		return ref === "scene" && canvas.scene?.id
			? `scene:${canvas.scene.id}`
			: ref;
	}

	#registerSocketListener() {
		if (this.#socketRegistered) return;
		this.#socketRegistered = true;
		this.#crudSocketCallback = async (data) => {
			if (data.app !== "tag-manager") return;
			if (data.user === game.user.id) return;

			// Handle CRUD delegation from non-GM players (GM-only execution)
			if (data.type === "story-scene-crud" && game.user.isGM) {
				await this.#handleCrudDelegation(data);
				return;
			}

			this.render();
			Hooks.callAll("litmStoryTagsUpdated");
		};
		game.socket.on("system.litm-rn", this.#crudSocketCallback);
	}

	async #handleCrudDelegation(data) {
		if (data.operation === "scratch-story-theme-tag") {
			const item = game.items?.get(data.itemId);
			if (!item || item.type !== "story") return;
			if (item.system.themeTag?.id === data.tagId) {
				await item.update({ "system.themeTag.isScratched": true });
				game.litm?.removeTagFromAllRolls?.(data.tagId);
				game.litm?.gmRemoveTagFromAllRolls?.(data.tagId);
				Hooks.callAll("litmStoryTagsUpdated");
				return;
			}
			const powerTags = item.system.powerTags.map((tag) => tag.toObject());
			const tag = powerTags.find((entry) => entry.id === data.tagId);
			if (!tag) return;
			tag.isScratched = true;
			game.litm?.removeTagFromAllRolls?.(data.tagId);
			game.litm?.gmRemoveTagFromAllRolls?.(data.tagId);
			await item.update({ "system.powerTags": powerTags });
			Hooks.callAll("litmStoryTagsUpdated");
			return;
		}
		if (data.operation === "link-story-theme") {
			const current = this.#storyConfig;
			const storyThemeIds = [
				...new Set([...(current.storyThemeIds || []), data.itemId]),
			];
			await game.settings.set("litm-rn", "storytags", {
				...current,
				storyThemeIds,
			});
			Hooks.callAll("litmStoryTagsUpdated");
			return;
		}
		if (data.operation === "unlink-story-theme") {
			const current = this.#storyConfig;
			const storyThemeIds = (current.storyThemeIds || []).filter(
				(id) => id !== data.itemId,
			);
			await game.settings.set("litm-rn", "storytags", {
				...current,
				storyThemeIds,
			});
			Hooks.callAll("litmStoryTagsUpdated");
			return;
		}

		const getSet = (section) =>
			section === "scene"
				? {
						get: () => this.#sceneConfig,
						set: (tags) =>
							canvas.scene?.setFlag("litm-rn", "scenetags", {
								...this.#sceneConfig,
								tags,
							}),
					}
				: {
						get: () => this.#storyConfig,
						set: (tags) =>
							game.settings.set("litm-rn", "storytags", {
								...this.#storyConfig,
								tags,
							}),
					};

		const { get, set } = getSet(data.section);
		const current = get();
		const tags = [...(current.tags || [])];

		if (
			data.operation === "add-tag" ||
			data.operation === "add-status" ||
			data.operation === "add-might" ||
			data.operation === "add-limit"
		) {
			tags.push(data.tagData);
		} else if (data.operation === "update-tag") {
			const idx = tags.findIndex((t) => t.id === data.tagId);
			if (idx !== -1) tags[idx] = data.tagData;
		} else if (data.operation === "rename-tag") {
			const idx = tags.findIndex((t) => t.id === data.tagId);
			if (idx !== -1) tags[idx] = { ...tags[idx], name: data.newName };
		} else if (data.operation === "remove-tag") {
			const idx = tags.findIndex((t) => t.id === data.tagId);
			if (idx !== -1) tags.splice(idx, 1);
		} else if (data.operation === "toggle-scene-actor") {
			const scene = canvas.scene;
			if (!scene) return;
			const cfg = scene.getFlag("litm-rn", "scenetags") || {
				tags: [],
				actors: [],
			};
			let actors = [...(cfg.actors || [])];
			const tokenTagVisibility = new Set(cfg.tokenTagVisibility || []);
			const storyActorRefs = new Set(this.#storyConfig.actors || []);
			const selectedFellowshipId = this.#getSelectedFellowship();
			const actorEntries =
				data.actorEntries ||
				(data.actorUuids || []).map((uuid) => ({ uuid, hidden: false }));
			for (const { uuid, hidden = false } of actorEntries) {
				const exists = actors.some((a) => a.ref === uuid);
				const actor = this.#resolveActor(uuid);
				const isPersistent =
					storyActorRefs.has(uuid) ||
					(selectedFellowshipId &&
						isFellowshipMember(selectedFellowshipId, actor?.id));
				if (data.makeActive) {
					if (isPersistent) tokenTagVisibility.add(uuid);
					else if (!exists) actors.push({ ref: uuid, hidden });
				} else {
					actors = actors.filter((a) => a.ref !== uuid);
					tokenTagVisibility.delete(uuid);
				}
			}
			try {
				await scene.setFlag("litm-rn", "scenetags", {
					...cfg,
					actors,
					tokenTagVisibility: [...tokenTagVisibility],
				});
				Hooks.callAll("litmStoryTagsUpdated");
			} catch {
				/* no-op */
			}
			return;
		}

		try {
			await set(tags);
			Hooks.callAll("litmStoryTagsUpdated");
		} catch {
			/* no-op */
		}
	}

	#broadcast() {
		dispatch({ app: "tag-manager" });
	}

	// ── Config ──

	get #storyConfig() {
		const config = game.settings.get("litm-rn", "storytags");
		if (!config || foundry.utils.isEmpty(config))
			return { actors: [], tags: [] };
		return config;
	}

	async #setStoryConfig(data, { silent = false } = {}) {
		const current = this.#storyConfig;
		await game.settings.set("litm-rn", "storytags", { ...current, ...data });
		if (silent || this.#deferSync) return;
		this.#broadcast();
		this.render();
	}

	get #sceneConfig() {
		const scene = canvas.scene;
		if (!scene) return { tags: [], actors: [] };
		return scene.getFlag("litm-rn", "scenetags") || { tags: [], actors: [] };
	}

	async #setSceneConfig(data, { silent = false } = {}) {
		const scene = canvas.scene;
		if (!scene) return;
		const current = scene.getFlag("litm-rn", "scenetags") || {
			tags: [],
			actors: [],
		};
		await scene.setFlag(
			"litm-rn",
			"scenetags",
			foundry.utils.mergeObject(current, data, { inplace: false }),
		);
		if (silent || this.#deferSync) return;
		this.#broadcast();
		this.render();
	}

	// ── Context ──

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const isGM = game.user.isGM;
		const storyConfig = this.#storyConfig;
		const collapsed = this.#getCollapsed();
		const hiddenActors = storyConfig.hiddenActors || [];

		const allStoryTags = storyConfig.tags || [];
		const storyTagsRaw = allStoryTags.filter((t) => this.#isVisible(t));
		// Build limit containers for story tags — only statuses inside VISIBLE limits are hidden from main list
		const storyStatusIdsInLimits = new Set();
		for (const t of allStoryTags) {
			if (t.type === "limit" && this.#isVisible(t)) {
				for (const id of t.statusIds || []) storyStatusIdsInLimits.add(id);
			}
		}
		const storyTags = storyTagsRaw
			.filter((t) => !storyStatusIdsInLimits.has(t.id))
			.map((t) => {
				if (t.type !== "limit") return t;
				const statusIds = t.statusIds || [];
				const allContained = statusIds
					.map((id) => allStoryTags.find((s) => s.id === id))
					.filter(Boolean)
					.sort(compareTagTypes);
				const containedStatuses = allContained.filter((s) =>
					this.#isVisible(s),
				);
				const currentValue = computeLimitCurrentValue(t.value, allContained);
				return { ...t, containedStatuses, currentValue };
			})
			.sort((a, b) => compareTagTypes(a, b));

		const orderedStoryThemeIds = storyConfig.storyThemeIds || [];
		const storyThemeIds = new Set(orderedStoryThemeIds);
		const storyThemeOrder = new Map(
			orderedStoryThemeIds.map((id, index) => [id, index]),
		);
		const storyThemes = (game.items?.contents ?? [])
			.filter((item) => item.type === "story" && storyThemeIds.has(item.id))
			.sort((a, b) => storyThemeOrder.get(a.id) - storyThemeOrder.get(b.id))
			.map((item) => {
				const system = item.system;
				const visible = (tag) => isGM || !tag.isPrivate;
				const themeTag = visible(system.themeTag)
					? {
							...system.themeTag.toObject(),
							type: "themeTag",
							isHindering: false,
						}
					: null;
				return {
					id: item.id,
					ref: `story-theme-${item.id}`,
					collapseId: `story-theme-${item.id}`,
					name: item.name,
					img: item.img,
					level: system.level || "origin",
					powerTags: [
						...(themeTag ? [themeTag] : []),
						...system.powerTags.filter(visible).map((tag) => ({
							...tag.toObject(),
							type: "powerTag",
							isHindering: false,
						})),
					],
					weaknessTags: system.weaknessTags.filter(visible).map((tag) => ({
						...tag.toObject(),
						type: "weaknessTag",
						isHindering: true,
					})),
				};
			});

		const actorRefs = storyConfig.actors || [];
		const allActors = actorRefs
			.map((ref) => this.#buildActorContext(ref, hiddenActors))
			.filter(Boolean);

		const fellowshipItems = game.items.filter((i) => i.type === "fellowship");
		const selectedFellowshipId = this.#getSelectedFellowship();
		const hasSelection = !!selectedFellowshipId;
		const selectedFellowshipItem = hasSelection
			? game.items.get(selectedFellowshipId)
			: null;

		const allFellowshipOptions = fellowshipItems.map((f) => ({
			id: f.id,
			name: f.name,
		}));

		let activeFellowship = null;
		let fellowshipActors = [];

		if (selectedFellowshipItem) {
			const sys = selectedFellowshipItem.system;
			fellowshipActors = allActors
				.filter((a) => a.fellowshipId === selectedFellowshipId)
				.map((a) => ({ ...a, collapseId: `actor-${a.id}` }));

			// Also include all world actors with this fellowship (not just those in storyConfig)
			const seenRefs = new Set(fellowshipActors.map((a) => a.ref));
			for (const actor of getFellowshipActors(selectedFellowshipId)) {
				const ref = actor.uuid;
				if (!seenRefs.has(ref)) {
					const ctx = this.#buildActorContext(ref, hiddenActors);
					if (ctx) {
						seenRefs.add(ref);
						fellowshipActors.push({ ...ctx, collapseId: `actor-${ctx.id}` });
					}
				}
			}
			// Sort fellowship actors by stored order
			const order = storyConfig.fellowshipActorOrder || [];
			fellowshipActors.sort((a, b) => {
				const ai = order.indexOf(a.ref);
				const bi = order.indexOf(b.ref);
				if (ai === -1 && bi === -1) return 0;
				if (ai === -1) return 1;
				if (bi === -1) return -1;
				return ai - bi;
			});
			// User's own character always first
			const userChar = game.user.character;
			if (!isGM && userChar) {
				const userRef = userChar.uuid;
				const userIdx = fellowshipActors.findIndex((a) => a.ref === userRef);
				if (userIdx > 0) {
					const [userActor] = fellowshipActors.splice(userIdx, 1);
					fellowshipActors.unshift(userActor);
				}
			}
			// Cleanup: remove fellowship members from storyConfig.actors
			const memberRefs = new Set(fellowshipActors.map((a) => a.ref));
			const oldRefs = storyConfig.actors || [];
			const cleanedRefs = oldRefs.filter((a) => !memberRefs.has(a));
			if (cleanedRefs.length !== oldRefs.length) {
				const current = this.#storyConfig;
				game.settings
					.set("litm-rn", "storytags", { ...current, actors: cleanedRefs })
					.catch(() => {});
			}

			const specials = await Promise.all(
				(sys.specials || []).map(async (s) => ({
					id: s.id,
					name: s.name,
					enrichedDescription: await TextEditor.enrichHTML(s.description || ""),
				})),
			);
			activeFellowship = {
				id: selectedFellowshipId,
				campActive:
					game.litm?.CampDialog?.isActive?.(selectedFellowshipId) ?? false,
				collapseId: `fellowship-${selectedFellowshipId}`,
				name: selectedFellowshipItem.name,
				motivation: selectedFellowshipItem.system.motivation,
				img: selectedFellowshipItem.img,
				themebook: sys.themebook,
				level: sys.level,
				powerTags: ([sys.themeTag] || [])
					.concat(sys.powerTags || [])
					.map((t) => ({ ...t, isHindering: false })),
				weaknessTags: (sys.weaknessTags || []).map((t) => ({
					...t,
					isScratched: false,
					isHindering: true,
				})),
				specials,
				actors: fellowshipActors,
			};
		}

		const selectedFellowshipMemberRefs = new Set(
			fellowshipActors.map((a) => a.ref),
		);
		const nonFellowshipActors = allActors
			.filter((a) => !selectedFellowshipMemberRefs.has(a.ref))
			.map((a) => ({ ...a, collapseId: `actor-${a.id}` }));

		const scene = canvas.scene;
		const sceneConfig = scene?.getFlag("litm-rn", "scenetags") || {
			tags: [],
			actors: [],
		};
		const allSceneTags = sceneConfig.tags || [];
		const sceneTagsRaw = allSceneTags.filter((t) => this.#isVisible(t));
		// Build limit containers for scene tags — only visible limits hide their statuses from main list
		const sceneStatusIdsInLimits = new Set();
		for (const t of allSceneTags) {
			if (t.type === "limit" && this.#isVisible(t)) {
				for (const id of t.statusIds || []) sceneStatusIdsInLimits.add(id);
			}
		}
		const sceneTags = sceneTagsRaw
			.filter((t) => !sceneStatusIdsInLimits.has(t.id))
			.map((t) => {
				if (t.type !== "limit") return t;
				const statusIds = t.statusIds || [];
				const allContained = statusIds
					.map((id) => allSceneTags.find((s) => s.id === id))
					.filter(Boolean)
					.sort(compareTagTypes);
				const containedStatuses = allContained.filter((s) =>
					this.#isVisible(s),
				);
				const currentValue = computeLimitCurrentValue(t.value, allContained);
				return { ...t, containedStatuses, currentValue };
			})
			.sort((a, b) => compareTagTypes(a, b));

		const sceneActors = (sceneConfig.actors || [])
			.map((entry) => {
				if (actorRefs.includes(entry.ref)) return null;
				if (entry.hidden && !game.user.isGM) return null;
				const ctx = this.#buildActorContext(entry.ref);
				if (!ctx) return null;
				if (ctx.fellowshipId && game.items.get(ctx.fellowshipId)) return null;
				return {
					...ctx,
					ref: entry.ref,
					hidden: entry.hidden || false,
					sceneControls: true,
					collapseId: `actor-${entry.ref}`,
				};
			})
			.filter(Boolean);

		const rollSelMap = {};
		const allCharacters =
			game.actors?.filter((a) => a.type === "character") || [];
		if (game.litm?.rollSelection) {
			for (const [actorId, refMap] of game.litm.rollSelection) {
				for (const [ref, tagMap] of refMap) {
					for (const [tagId, state] of tagMap) {
						if (!rollSelMap[tagId]) rollSelMap[tagId] = [];
						const char = allCharacters.find((c) => c.id === actorId);
						rollSelMap[tagId].push({
							actorId,
							actorName: char?.name || actorId,
							state,
							portrait:
								char?.img ||
								"systems/litm-rn/assets/media/litm-custom-logo.webp",
						});
					}
				}
			}
		}

		const playerRollSelMap = {};
		const playerCharacter = !isGM ? game.user.character : null;
		const playerSelection = playerCharacter
			? game.litm?.rollSelection?.get(playerCharacter.id)
			: null;
		for (const [ref, tagMap] of playerSelection || []) {
			for (const [tagId, state] of tagMap) {
				playerRollSelMap[`${ref}:${tagId}`] = state;
				if (ref === `scene:${canvas.scene?.id}`)
					playerRollSelMap[`scene:${tagId}`] = state;
			}
		}

		return {
			...context,
			isGM,
			storyTags,
			storyThemes,
			selectedFellowshipId,
			hasSelection,
			allFellowshipOptions,
			activeFellowship,
			nonFellowshipActors,
			sceneName: scene?.name || null,
			sceneTags,
			sceneActors,
			collapsed,
			editingId: this.#editingTagId,
			rollSelMap,
			playerRollSelMap,
			hasPlayerCharacter: !!playerCharacter,
		};
	}

	#buildActorContext(ref, hiddenActors = []) {
		const actor = this.#resolveActor(ref);
		if (!actor) return null;
		const isOwner = actor.isOwner;
		const isCharacter = actor.type === "character";
		const allTags = this.#buildActorTags(actor);
		const isHidden = hiddenActors.includes(ref);
		// If GM hid this actor from players, hide the entire block from non-GMs
		if (isHidden && !game.user.isGM) return null;

		// Filter out statuses that are visually inside VISIBLE limits
		const statusIdsInLimits = new Set();
		for (const tag of allTags) {
			if (
				tag.type === "limit" &&
				tag.statusIds &&
				this.#isVisible(tag, isOwner && !isHidden)
			) {
				for (const sid of tag.statusIds) statusIdsInLimits.add(sid);
			}
		}

		const visibleTags = allTags
			.filter((t) => this.#isVisible(t, isOwner && !isHidden))
			.filter((t) => !(statusIdsInLimits.has(t.id) && t.type !== "limit"));

		const modeSetting = `portraitMode-${actor.type}`;
		const useToken = game.settings.get("litm-rn", modeSetting) === "token";
		return {
			ref,
			id: ref,
			name: actor.name,
			img: useToken ? actor.prototypeToken.texture.src || actor.img : actor.img,
			fellowshipId: getActorFellowshipId(actor),
			isOwner,
			isCharacter,
			hideFromPlayers: isHidden,
			tags: visibleTags,
		};
	}

	#isVisible(tag, isOwner = false) {
		return game.user.isGM || isOwner || !tag.isPrivate;
	}

	#resolveActor(ref) {
		if (!ref) return null;
		const cleanRef = ref.replaceAll("___", ".");
		const actor = game.actors.get(cleanRef);
		if (actor) return actor;
		try {
			const doc = foundry.utils.fromUuidSync(cleanRef);
			if (doc?.documentName === "Actor") return doc;
			if (doc?.documentName === "Token") return doc.actor;
		} catch {
			/* no-op */
		}
		return null;
	}

	#buildActorTags(actor) {
		const tags = (actor.effects || [])
			.filter((e) => {
				const flags = e.flags?.["litm-rn"];
				if (!flags?.type) return false;
				// Theme/backpack tags are managed via CardReader, not TagManager
				if (flags.ownerType) return false;
				return true;
			})
			.map((e) => {
				const flags = e.flags["litm-rn"];
				const rawType = flags.type;
				const tag = {
					id: e._id,
					name: e.name,
					sort: e.sort ?? 0,
					values: flags.values,
					isScratched: flags.isScratched,
					isHindering: flags.isHindering || false,
					isCrispy: flags.isCrispy || false,
					isPrivate: flags.isPrivate || false,
					value:
						rawType === "might"
							? (flags.value ?? 3)
							: rawType === "limit"
								? (flags.value ?? null)
								: (flags.values?.reduce((last, v, i) => (v ? i : last), -1) ??
										-1) + 1 || 0,
					type:
						rawType === "status"
							? "status"
							: rawType === "might"
								? "might"
								: rawType === "limit"
									? "limit"
									: rawType === "tag"
										? flags.values?.some((v) => !!v)
											? "status"
											: "tag"
										: flags.values?.length === 3
											? "might"
											: flags.values?.some((v) => !!v)
												? "status"
												: "tag",
				};
				// For limit ActiveEffects, build contained statuses and current value
				if (rawType === "limit" && actor.type !== "challenge") {
					const statusIds = flags.statusIds || [];
					const allContained = statusIds
						.map((sid) => {
							const effect = actor.effects.get(sid);
							if (!effect) return null;
							const ef = effect.flags["litm-rn"] || {};
							return {
								id: effect.id,
								name: effect.name,
								values: ef.values,
								type: ef.type || "tag",
								isScratched: ef.isScratched,
								isHindering: ef.isHindering || false,
								isCrispy: ef.isCrispy || false,
								isPrivate: ef.isPrivate || false,
							};
						})
						.filter(Boolean)
						.sort(compareTagTypes);
					const containedStatuses = allContained.filter((s) =>
						this.#isVisible(s, actor.isOwner),
					);
					tag.statusIds = statusIds;
					tag.containedStatuses = containedStatuses;
					tag.currentValue = computeLimitCurrentValue(tag.value, allContained);
				}
				return tag;
			});

		// Challenge actors store limits in system.limits, not as ActiveEffects
		if (actor.type === "challenge" && actor.system?.limits) {
			for (let i = 0; i < actor.system.limits.length; i++) {
				const limit = actor.system.limits[i];
				const statusIds = limit.statusIds || [];
				const allContained = statusIds
					.map((sid) => {
						const effect = actor.effects.get(sid);
						if (!effect) return null;
						const flags = effect.flags["litm-rn"] || {};
						return {
							id: effect.id,
							name: effect.name,
							values: flags.values,
							type: flags.type || "tag",
							isScratched: flags.isScratched,
							isHindering: flags.isHindering || false,
							isCrispy: flags.isCrispy || false,
							isPrivate: flags.isPrivate || false,
						};
					})
					.filter(Boolean)
					.sort(compareTagTypes);
				const containedStatuses = allContained.filter((s) =>
					this.#isVisible(s, actor.isOwner),
				);
				const currentValue = computeLimitCurrentValue(
					limit.value,
					allContained,
				);
				tags.push({
					id: `_limit_${i}`,
					name: limit.name || t("Litm.other.limit"),
					value: limit.value,
					isScratched: false,
					isHindering: false,
					isCrispy: false,
					isPrivate: limit.isPrivate || false,
					type: "limit",
					statusIds,
					containedStatuses,
					currentValue,
				});
			}
		}

		return tags.sort(
			(a, b) => compareTagTypes(a, b) || (a.sort ?? 0) - (b.sort ?? 0),
		);
	}

	#updateTagDom(ref, id) {
		let tagData = null;
		if (ref === "story") {
			const raw = (this.#storyConfig.tags || []).find((t) => t.id === id);
			if (raw) {
				tagData = { ...raw };
				if (raw.type === "limit") {
					const statusIds = raw.statusIds || [];
					const allContained = statusIds
						.map((sid) =>
							(this.#storyConfig.tags || []).find((t) => t.id === sid),
						)
						.filter(Boolean)
						.sort(compareTagTypes);
					tagData.containedStatuses = allContained.filter((s) =>
						this.#isVisible(s),
					);
					tagData.currentValue = computeLimitCurrentValue(
						raw.value,
						allContained,
					);
				}
			}
		} else if (ref === "scene") {
			const raw = (this.#sceneConfig.tags || []).find((t) => t.id === id);
			if (raw) {
				tagData = { ...raw };
				if (raw.type === "limit") {
					const statusIds = raw.statusIds || [];
					const allContained = statusIds
						.map((sid) =>
							(this.#sceneConfig.tags || []).find((t) => t.id === sid),
						)
						.filter(Boolean)
						.sort(compareTagTypes);
					tagData.containedStatuses = allContained.filter((s) =>
						this.#isVisible(s),
					);
					tagData.currentValue = computeLimitCurrentValue(
						raw.value,
						allContained,
					);
				}
			}
		} else {
			const actor = this.#resolveActor(ref);
			if (actor) {
				if (id.startsWith("_limit_")) {
					const index = Number.parseInt(id.slice(7), 10);
					const limit = actor.system?.limits?.[index];
					if (limit) {
						const statusIds = limit.statusIds || [];
						const allContained = statusIds
							.map((sid) => {
								const effect = actor.effects.get(sid);
								if (!effect) return null;
								const flags = effect.flags["litm-rn"] || {};
								return {
									id: effect.id,
									name: effect.name,
									values: flags.values,
									type: flags.type || "tag",
									isScratched: flags.isScratched,
									isHindering: flags.isHindering || false,
									isCrispy: flags.isCrispy || false,
									isPrivate: flags.isPrivate || false,
								};
							})
							.filter(Boolean)
							.sort(compareTagTypes);
						const containedStatuses = allContained.filter((s) =>
							this.#isVisible(s, actor.isOwner),
						);
						tagData = {
							...limit,
							type: "limit",
							id,
							containedStatuses,
							currentValue: computeLimitCurrentValue(limit.value, allContained),
						};
					}
				} else {
					const effect = actor.effects.get(id);
					if (effect) {
						const flags = effect.flags["litm-rn"] || {};
						tagData = {
							id: effect.id,
							name: effect.name,
							type: flags.type || "tag",
							value: flags.value,
							values: flags.values,
							isScratched: flags.isScratched,
							isHindering: flags.isHindering || false,
							isCrispy: flags.isCrispy || false,
							isPrivate: flags.isPrivate || false,
						};
						if (flags.type === "limit") {
							const statusIds = flags.statusIds || [];
							const allContained = statusIds
								.map((sid) => {
									const e = actor.effects.get(sid);
									if (!e) return null;
									const f = e.flags["litm-rn"] || {};
									return {
										id: e.id,
										name: e.name,
										values: f.values,
										type: f.type || "tag",
										isScratched: f.isScratched,
										isHindering: f.isHindering || false,
										isCrispy: f.isCrispy || false,
										isPrivate: f.isPrivate || false,
									};
								})
								.filter(Boolean)
								.sort(compareTagTypes);
							tagData.containedStatuses = allContained.filter((s) =>
								this.#isVisible(s, actor.isOwner),
							);
							tagData.currentValue = computeLimitCurrentValue(
								flags.value,
								allContained,
							);
							tagData.statusIds = statusIds;
						}
					}
				}
			}
		}
		const li = this.element?.querySelector(
			`[data-tag-id="${id}"][data-ref="${ref}"]`,
		);
		if (!li || !tagData) return;

		// Update li-level classes
		li.classList.toggle("litm--tm-private", !!tagData.isPrivate);
		li.classList.toggle("litm--tm-hindering", !!tagData.isHindering);
		li.classList.toggle("litm--tm-crispy", !!tagData.isCrispy);
		li.classList.toggle("litm--tm-permanent", !!tagData.isPermanent);
		// Find inner and popup containers
		const inner = li.querySelector(".litm--tm-tag-inner");
		const popup = li.querySelector(".litm--tm-tag-popup");
		if (!inner) return;

		// Work inside .litm--tm-tag-indicators (right-aligned block after name)
		const indicators = inner.querySelector(".litm--tm-tag-indicators");
		if (!indicators) return;

		// Private indicator — order depends on type:
		//   tag: hourglass before eye → eye goes after crispy
		//   status/might/limit: eye is first → prepend
		const privIcon = indicators.querySelector(".litm--tm-icon-private");
		if (tagData.isPrivate && !privIcon) {
			const icon = document.createElement("i");
			icon.className =
				"litm--tm-tag-icon litm--tm-icon-private fa-solid fa-mask";
			if (tagData.type === "tag") {
				const crispy = indicators.querySelector(".litm--tm-icon-crispy");
				if (crispy) {
					crispy.after(icon);
				} else {
					indicators.prepend(icon);
				}
			} else {
				indicators.prepend(icon);
			}
		} else if (!tagData.isPrivate && privIcon) {
			privIcon.remove();
		}

		// Crispy indicator (tag type only) — always first in indicators
		const crispyIcon = indicators.querySelector(".litm--tm-icon-crispy");
		if (tagData.type === "tag" && tagData.isCrispy && !crispyIcon) {
			const icon = document.createElement("i");
			icon.className =
				"litm--tm-tag-icon litm--tm-icon-crispy fas fa-hourglass-half";
			indicators.prepend(icon);
		} else if ((tagData.type !== "tag" || !tagData.isCrispy) && crispyIcon) {
			crispyIcon.remove();
		}

		const permanentIcon = indicators.querySelector(".litm--tm-icon-permanent");
		if (tagData.type === "tag" && tagData.isPermanent && !permanentIcon) {
			const icon = document.createElement("i");
			icon.className =
				"litm--tm-tag-icon litm--tm-icon-permanent fas fa-infinity";
			indicators.prepend(icon);
		} else if (
			(tagData.type !== "tag" || !tagData.isPermanent) &&
			permanentIcon
		) {
			permanentIcon.remove();
		}

		// Status dots
		if (tagData.type === "status" && tagData.values) {
			const dots = indicators.querySelectorAll(".litm--tm-status-dot");
			dots.forEach((dot, i) => {
				if (i < tagData.values.length) {
					dot.classList.toggle("litm--tm-filled", !!tagData.values[i]);
				}
			});
		}

		// Might indicator
		if (tagData.type === "might") {
			const mightInd = indicators.querySelector(".litm--tm-might-indicator");
			if (mightInd) {
				const cls =
					tagData.value === 0
						? "origin"
						: tagData.value === 6
							? "greatness"
							: "adventure";
				mightInd.className = `litm--tm-might-indicator litm--tm-might-${cls}`;
			}
			li.classList.remove(
				"litm--tm-might-val-origin",
				"litm--tm-might-val-adventure",
				"litm--tm-might-val-greatness",
			);
			const valCls =
				tagData.value === 0
					? "origin"
					: tagData.value === 6
						? "greatness"
						: "adventure";
			li.classList.add(`litm--tm-might-val-${valCls}`);
		}

		// Limit indicator
		if (tagData.type === "limit") {
			const limitInd = indicators.querySelector(".litm--tm-limit-indicator");
			if (limitInd) {
				if (tagData.value != null && tagData.value > 0) {
					const cv = tagData.currentValue ?? 0;
					limitInd.innerHTML = `<span class="litm--tm-limit-current">${cv}</span><span class="litm--tm-limit-sep">/</span><span class="litm--tm-limit-max">${tagData.value}</span>`;
				} else {
					limitInd.innerHTML = `<span class="litm--tm-limit-immune">~</span>`;
				}
			}
			// Sync hint in limit contents: show when immune and statuses exist, hide otherwise
			const wrapper = li.closest(".litm--tm-limit-wrapper");
			if (wrapper) {
				const contents = wrapper.querySelector(".litm--tm-limit-contents");
				if (contents) {
					const existingHint = contents.querySelector(".litm--tm-limit-hint");
					const isImmune = tagData.value == null || tagData.value === 0;
					if (isImmune && !existingHint && contents.children.length) {
						const hint = document.createElement("span");
						hint.className = "litm--tm-limit-hint";
						hint.textContent = game.i18n.localize("Litm.ui.limit-immune-hint");
						contents.prepend(hint);
					} else if (!isImmune && existingHint) {
						existingHint.remove();
					}
				}
			}
		}

		if (!popup) return;

		// Update popup buttons
		// Hindering toggle
		// const hindBtn = popup.querySelector('[data-action="toggle-hindering"]');
		// if (hindBtn) {
		//   const img = hindBtn.querySelector("img");
		//   if (img) {
		//     img.src = `systems/litm-rn/assets/media/icons/weakness-marker-litm_${tagData.isHindering ? "active" : "inactive"}.svg`;
		//   }
		//   const tt = tagData.isHindering ? "Litm.ui.make-helping" : "Litm.tags.toHindering";
		//   hindBtn.dataset.tooltip = game.i18n.localize(tt);
		// }

		// Private toggle
		const privBtn = popup.querySelector('[data-action="toggle-private"]');
		if (privBtn) {
			const icon = privBtn.querySelector("i");
			if (icon) {
				icon.className = "fa-solid fa-mask";
			}
			const tt = tagData.isPrivate
				? "Litm.tags.isPrivate"
				: "Litm.tags.toPrivate";
			privBtn.dataset.tooltip = game.i18n.localize(tt);
		}

		// Crispy toggle
		if (tagData.type === "tag") {
			const crispyBtn = popup.querySelector('[data-action="toggle-crispy"]');
			if (crispyBtn) {
				const icon = crispyBtn.querySelector("i");
				if (icon) {
					icon.className = `fas ${tagData.isCrispy ? "fa-hourglass-half" : "fa-hourglass"}`;
				}
				const tt = tagData.isCrispy
					? "Litm.tags.isCrispy"
					: "Litm.tags.toCrispy";
				crispyBtn.dataset.tooltip = game.i18n.localize(tt);
			}
		}

		// Status value buttons
		if (tagData.type === "status") {
			const statusBtns = popup.querySelectorAll(
				'[data-action="toggle-status-value"]',
			);
			statusBtns.forEach((btn, i) => {
				if (i < (tagData.values || []).length) {
					btn.classList.toggle("filled", !!tagData.values[i]);
				}
			});
		}

		// Might value buttons
		if (tagData.type === "might") {
			const mightBtns = popup.querySelectorAll(
				'[data-action="set-might-value"]',
			);
			mightBtns.forEach((btn) => {
				btn.classList.toggle(
					"active",
					Number(btn.dataset.value) === tagData.value,
				);
			});
		}

		// Limit value buttons
		if (tagData.type === "limit") {
			const limitBtns = popup.querySelectorAll(
				'[data-action="set-limit-value"]',
			);
			limitBtns.forEach((btn) => {
				const val = btn.dataset.value;
				const isActive =
					val === "" ? tagData.value == null : Number(val) === tagData.value;
				btn.classList.toggle("active", isActive);
			});
		}
	}

	// ── Cross-instance sync (sidebar ↔ popout) ──

	#syncOtherInstance(ref, id) {
		const other = this === ui.combat ? game.litm?._tmPopOut : ui.combat;
		if (other && other !== this && other.rendered) {
			other.#updateTagDom(ref, id);
		}
	}

	// ── Shared toggle helpers ──

	#getTagConfig(ref) {
		if (ref === "story")
			return { tags: [...(this.#storyConfig.tags || [])], key: "story" };
		if (ref === "scene")
			return { tags: [...(this.#sceneConfig.tags || [])], key: "scene" };
		return null;
	}

	#saveTagConfig(ref, tags) {
		if (ref === "story")
			return this.#setStoryConfig({ tags }, { silent: true });
		if (ref === "scene")
			return this.#setSceneConfig({ tags }, { silent: true });
		return null;
	}

	async #toggleStorySceneTag(ref, id, updater) {
		const config = this.#getTagConfig(ref);
		if (!config) return;
		const tags = config.tags.map((t) => (t.id === id ? updater(t) : t));
		if (!tags.find((t) => t.id === id)) return;
		if (game.user.isGM) {
			_skipEffectHook = true;
			await this.#saveTagConfig(ref, tags);
			_skipEffectHook = false;
			this.#broadcast();
			this.#updateTagDom(ref, id);
			this.#updateParentLimitDom(ref, id);
			this.#syncOtherInstance(ref, id);
		} else {
			const updatedTag = tags.find((t) => t.id === id);
			dispatch({
				app: "tag-manager",
				type: "story-scene-crud",
				section: ref,
				operation: "update-tag",
				tagId: id,
				tagData: updatedTag,
			});
		}
	}

	async #toggleActorTag(ref, id, updater) {
		const actor = this.#resolveActor(ref);
		if (!actor || !actor.isOwner) return;
		if (id.startsWith("_limit_")) {
			const index = Number.parseInt(id.slice(7), 10);
			if (!Number.isFinite(index)) return;
			const limits = foundry.utils.deepClone(actor.system.limits || []);
			if (!limits[index]) return;
			limits[index] = updater(limits[index]);
			try {
				await actor.update({ "system.limits": limits });
			} catch {
				/* no-op */
			}
			this.#updateTagDom(ref, id);
			this.#syncOtherInstance(ref, id);
		} else {
			const effect = actor.effects.get(id);
			if (!effect) return;
			const flags = foundry.utils.deepClone(effect.flags["litm-rn"] || {});
			const updated = updater(flags);
			_skipEffectHook = true;
			try {
				await actor.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: id, flags: { ["litm-rn"]: updated } },
				]);
			} catch {
				/* no-op */
			}
			_skipEffectHook = false;
			this.#broadcast();
			this.#updateTagDom(ref, id);
			this.#updateParentLimitDom(ref, id);
			this.#syncOtherInstance(ref, id);
		}
	}

	async #toggleTag(ref, id, updater) {
		if (ref === "story" || ref === "scene") {
			await this.#toggleStorySceneTag(ref, id, updater);
		} else {
			await this.#toggleActorTag(ref, id, updater);
		}
	}

	// ── Action dispatch ──

	#onClick = (event) => {
		const target = event.target.closest("[data-action]");
		if (!target) return;
		const action = target.dataset.action;
		if (typeof this[action] === "function") {
			try {
				Promise.resolve(this[action](event, target, target.dataset)).catch(
					() => {},
				);
			} catch {
				/* no-op */
			}
		}
	};

	#onFellowshipChange = async (event) => {
		if (!game.user.isGM) return;
		const id = event.target.value;
		if (!id) return;
		await this.#setSelectedFellowship(id);
		this.#broadcast();
		this.render();
	};

	_onRender(context, options) {
		super._onRender(context, options);
		this.#closeTagContextMenu(false);
		if (!this.#hooksInitialized) {
			this.#hooksInitialized = true;
			this.#storyTagHookId = Hooks.on("litmStoryTagsUpdated", () => {
				if (_skipEffectHook) return;
				this.render();
			});
			this.#registerSocketListener();
			for (const ev of [
				"createActiveEffect",
				"updateActiveEffect",
				"deleteActiveEffect",
			]) {
				this.#mainHookIds.push(
					Hooks.on(ev, () => {
						if (_skipEffectHook) return;
						this.render();
					}),
				);
			}
			this.#mainHookIds.push(Hooks.on("preDeleteActor", () => this.render()));
			this.#mainHookIds.push(
				Hooks.on("updateItem", (item) => {
					if (item.type === "fellowship") {
						for (const tag of [
							item.system.themeTag,
							...(item.system.powerTags || []),
						]) {
							if (!tag?.isScratched) continue;
							game.litm?.removeTagFromAllRolls?.(tag.id);
							game.litm?.gmRemoveTagFromAllRolls?.(tag.id);
						}
					}
					if (item.type === "fellowship" || item.type === "story")
						this.render();
				}),
			);
			this.#mainHookIds.push(
				Hooks.on("updateActor", (actor, changes) => {
					if (changes.system?.fellowshipId !== undefined) this.render();
				}),
			);
			for (const ev of ["createItem", "deleteItem"]) {
				this.#mainHookIds.push(
					Hooks.on(ev, (item) => {
						if (item.type === "fellowship" || item.type === "story")
							this.render();
					}),
				);
			}
			this.#mainHookIds.push(
				Hooks.on("updateSetting", (setting) => {
					if (setting.key === "litm-rn.selectedFellowship") this.render();
				}),
			);
			this.#sceneHookId = Hooks.on("deleteToken", (...args) => {
				const tokenDoc = args.find((a) => a?.documentName === "Token");
				if (!tokenDoc) return;
				const scene = tokenDoc.parent;
				if (!scene?.isView) return;
				if (!game.user.isGM) return;
				const ref = tokenDoc.actor?.uuid || tokenDoc.uuid;
				if (!ref) return;
				const config = scene.getFlag("litm-rn", "scenetags") || {
					tags: [],
					actors: [],
				};
				const actors = (config.actors || []).filter((a) => a.ref !== ref);
				if (actors.length === (config.actors || []).length) return;
				scene
					.setFlag("litm-rn", "scenetags", { ...config, actors })
					.then(() => this.render())
					.catch(() => {});
			});
			this.#mainHookIds.push(
				Hooks.on("updateScene", (scene, changes) => {
					if (_skipEffectHook) return;
					if (scene.isView && changes.flags?.["litm-rn"]?.scenetags)
						this.render();
				}),
			);
		}

		if (this.#resizeObserver) this.#resizeObserver.disconnect();
		this.#resizeObserver = new ResizeObserver((entries) => {
			if (!this.element) return;
			for (const entry of entries) {
				const w = entry.contentRect.width;
				this.element.classList.toggle("litm--tm-wide", w >= 870);
				this.element.classList.toggle("litm--tm-medium", w >= 580 && w < 870);
				this.element.classList.toggle("litm--tm-narrow", w < 580);
			}
		});
		this.#resizeObserver.observe(this.element);
		this.element.removeEventListener("click", this.#onClick);
		this.element.addEventListener("click", this.#onClick);
		this.element
			.querySelectorAll("[data-context-tag]")
			.forEach((el) =>
				el.addEventListener("contextmenu", this.#openTagContextMenu),
			);
		this.element.removeEventListener("dragover", this.#onDragOver);
		this.element.addEventListener("dragover", this.#onDragOver);
		this.element.removeEventListener("drop", this.#onDrop);
		this.element.addEventListener("drop", this.#onDrop);
		this.element.removeEventListener("dragstart", this.#onDragStart);
		this.element.addEventListener("dragstart", this.#onDragStart);
		this.element.removeEventListener("dragend", this.#onDragEnd);
		this.element.addEventListener("dragend", this.#onDragEnd);
		for (const img of this.element.querySelectorAll(".litm--tm-actor-img")) {
			img.removeEventListener("mouseenter", this.#onImgEnter);
			img.addEventListener("mouseenter", this.#onImgEnter);
			img.removeEventListener("mouseleave", this.#onImgLeave);
			img.addEventListener("mouseleave", this.#onImgLeave);
		}
		const sel = this.element.querySelector('[data-action="select-fellowship"]');
		if (sel) {
			sel.removeEventListener("change", this.#onFellowshipChange);
			sel.addEventListener("change", this.#onFellowshipChange);
		}

		this.#pruneSceneConfig();

		if (this.#editingTagId) {
			const el = this.element?.querySelector(
				`[data-tag-id="${this.#editingTagId}"]`,
			);
			const nameEl = el?.querySelector(".litm--tm-tag-name");
			if (nameEl) {
				if (nameEl.dataset.editInit) return; // already set up
				nameEl.dataset.editInit = "1";
				nameEl.addEventListener("blur", () => {
					if (this.#editingTagId !== nameEl.dataset.id) return;
					this["save-edit-tag"](null, nameEl, {
						id: nameEl.dataset.id,
						ref: nameEl.dataset.ref,
					});
				});
				nameEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						nameEl.blur();
					} else if (e.key === "Escape") {
						this.#editingTagId = null;
						this.render();
					}
				});
				requestAnimationFrame(() => {
					nameEl.focus();
					const doc = getOwningDocument(nameEl);
					const range = doc.createRange();
					range.selectNodeContents(nameEl);
					const sel = doc.defaultView.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
				});
			}
		}

		if (this.#contextMenuAnchor)
			queueMicrotask(() => this.#restoreTagContextMenu());
	}

	#pruneSceneConfig() {
		if (this.#pruning || !game.user.isGM || !canvas?.ready || !canvas.scene)
			return;
		this.#pruning = true;
		try {
			const scene = canvas.scene;
			const config = scene.getFlag("litm-rn", "scenetags");
			if (!config?.actors?.length && !config?.tokenTagVisibility?.length)
				return;
			const validRefs = new Set(
				canvas.tokens.placeables
					.map((t) => t.actor?.uuid || t.uuid)
					.filter(Boolean),
			);
			const sceneActors = config.actors || [];
			const pruned = sceneActors.filter((a) => validRefs.has(a.ref));
			const tokenTagVisibility = (config.tokenTagVisibility || []).filter(
				(ref) => validRefs.has(ref),
			);
			if (
				pruned.length === sceneActors.length &&
				tokenTagVisibility.length === (config.tokenTagVisibility || []).length
			)
				return;
			scene
				.setFlag("litm-rn", "scenetags", {
					...config,
					actors: pruned,
					tokenTagVisibility,
				})
				.catch(() => {});
		} finally {
			this.#pruning = false;
		}
	}

	#onImgEnter = (event) => {
		const ref = event.currentTarget.dataset.ref;
		if (!ref) return;
		const token = this.#getToken(ref);
		if (token)
			token._onHoverIn(new MouseEvent("mouseenter"), { hoverOutOthers: true });
	};

	#onImgLeave = (event) => {
		const ref = event.currentTarget.dataset.ref;
		if (!ref) return;
		const token = this.#getToken(ref);
		if (token) token._onHoverOut(new MouseEvent("mouseleave"));
	};

	// ── Tag context menu ──

	#openTagContextMenu = (event) => {
		event.preventDefault();
		event.stopPropagation();
		const trigger = event.currentTarget;
		const doc = getOwningDocument(trigger);
		const win = getOwningWindow(trigger);
		const readonly = trigger.dataset.readonly === "true";
		if (readonly && (game.user.isGM || !game.user.character)) return;
		const { ref, tagId: id } = trigger.dataset;
		const tag = this.#findTag(ref, id);
		if (!tag) return;
		const isBurnableTag =
			["tag", "powerTag", "themeTag"].includes(tag.type) && !tag.isCrispy;
		const playerActorId = !game.user.isGM ? game.user.character?.id : null;
		const isBurnedInRoll = playerActorId
			? game.litm?.rollSelection
					?.get(playerActorId)
					?.get(this.#rollSelectionRef(ref))
					?.get(id) === "burned"
			: false;
		if (readonly && (!isBurnableTag || isBurnedInRoll)) return;
		const actor = !["story", "scene"].includes(ref)
			? this.#resolveActor(ref)
			: null;
		const canManage =
			!readonly && (["story", "scene"].includes(ref) || actor?.isOwner);
		if (!canManage && (!playerActorId || !isBurnableTag)) return;
		if (!canManage && isBurnedInRoll) return;

		this.#closeTagContextMenu();
		this.#contextMenuAnchor = { ref, id, x: event.clientX, y: event.clientY };
		const menu = doc.createElement("div");
		menu.className = "litm--character-tag-menu";
		menu.setAttribute("role", "menu");
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		const reopen = () => this.#restoreTagContextMenu();
		const addOption = (
			label,
			icon,
			callback,
			{ separator = false, keepOpen = false } = {},
		) => {
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.classList.toggle("litm--character-tag-menu-separator", separator);
			button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
			button.addEventListener("click", async () => {
				if (!keepOpen) this.#closeTagContextMenu();
				await callback();
				if (keepOpen) reopen();
			});
			menu.append(button);
		};
		const addValueGroup = (className, values, action) => {
			const group = doc.createElement("div");
			group.className = `litm--tag-menu-values ${className}`;
			for (const value of values) {
				const button = doc.createElement("button");
				button.type = "button";
				const buttonClass = className.includes("status")
					? "litm--tm-popup-status-btn"
					: className.includes("might")
						? "litm--tm-popup-might-btn"
						: "litm--tm-popup-limit-btn";
				button.className = `${buttonClass} ${value.className || ""}`.trim();
				button.classList.toggle("active", !!value.active);
				button.classList.toggle("filled", !!value.filled);
				button.dataset.tooltip = value.tooltip || value.label;
				button.textContent = value.label || "";
				button.addEventListener("click", async () => {
					await action(value.value);
					reopen();
				});
				group.append(button);
			}
			menu.append(group);
		};

		if (canManage)
			addOption(t("Litm.ui.edit"), "fa-solid fa-pen", () =>
				this["edit-tag"](null, null, { ref, id }),
			);
		if (canManage && game.user.isGM) {
			addOption(
				t(tag.isPrivate ? "Litm.ui.reveal-secret-tag" : "Litm.ui.make-secret"),
				"fa-solid fa-mask",
				() => this["toggle-private"](null, null, { ref, id }),
			);
		}
		if (canManage && tag.type === "status") {
			addValueGroup(
				"litm--tm-popup-status",
				(tag.values || Array(6).fill(null)).map((filled, index) => ({
					value: index,
					label: "",
					tooltip: String(index + 1),
					filled: !!filled,
				})),
				(value) => this["toggle-status-value"](null, null, { ref, id, value }),
			);
			addOption(
				t("Litm.ui.decrease-status"),
				"fa-solid fa-arrow-left",
				() => this["decrease-status"](null, null, { ref, id }),
				{ keepOpen: true },
			);
		}
		if (canManage && tag.type === "might") {
			addValueGroup(
				"litm--tm-popup-might",
				[
					{
						value: 0,
						label: "",
						className: "litm--might-origin",
						active: tag.value === 0,
						tooltip: t("Litm.tags.origin-0"),
					},
					{
						value: 3,
						label: "",
						className: "litm--might-adventure",
						active: tag.value === 3,
						tooltip: t("Litm.tags.adventure-3"),
					},
					{
						value: 6,
						label: "",
						className: "litm--might-greatness",
						active: tag.value === 6,
						tooltip: t("Litm.tags.greatness-6"),
					},
				],
				(value) => this["set-might-value"](null, null, { ref, id, value }),
			);
		}
		if (canManage && tag.type === "limit") {
			addValueGroup(
				"litm--tm-popup-limits",
				[null, 1, 2, 3, 4, 5, 6].map((value) => ({
					value: value ?? "",
					label: value?.toString() || "~",
					active: value === (tag.value ?? null),
				})),
				(value) => this["set-limit-value"](null, null, { ref, id, value }),
			);
		}
		if (isBurnableTag && !game.user.isGM && game.user.character) {
			const actorId = game.user.character.id;
			if (!isBurnedInRoll)
				addOption(t("Litm.ui.burn-in-roll"), "fa-solid fa-fire", () =>
					game.litm?.addTagToRoll?.(
						actorId,
						this.#rollSelectionRef(ref),
						id,
						"burned",
					),
				);
		}
		if (canManage && tag.type === "tag") {
			addOption(
				t(
					tag.isCrispy
						? "Litm.ui.single-use-active"
						: "Litm.ui.make-single-use",
				),
				"fa-solid fa-hourglass-half",
				() => this["toggle-crispy"](null, null, { ref, id }),
			);
		}
		if (canManage && tag.type === "tag" && ["story", "scene"].includes(ref)) {
			addOption(
				t(tag.isPermanent ? "Litm.tags.isPermanent" : "Litm.tags.toPermanent"),
				"fa-solid fa-infinity",
				() => this["toggle-permanent"](null, null, { ref, id }),
			);
		}
		if (
			canManage &&
			(actor?.isOwner || game.user.isGM || ["story", "scene"].includes(ref))
		) {
			addOption(
				t("Litm.ui.remove"),
				"fa-solid fa-trash",
				() => this["remove-tag"](null, null, { ref, id }),
				{ separator: true },
			);
		}

		doc.body.append(menu);
		this.#contextMenu = menu;
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			if (rect.right > win.innerWidth)
				menu.style.left = `${Math.max(8, win.innerWidth - rect.width - 8)}px`;
			if (rect.bottom > win.innerHeight)
				menu.style.top = `${Math.max(8, win.innerHeight - rect.height - 8)}px`;
		});
		setTimeout(
			() => doc.addEventListener("pointerdown", this.#onTagContextOutside),
			0,
		);
	};

	#onTagContextOutside = (event) => {
		if (!this.#contextMenu?.contains(event.target)) this.#closeTagContextMenu();
	};

	#restoreTagContextMenu() {
		const anchor = this.#contextMenuAnchor;
		if (!anchor) return;
		const trigger = [
			...(this.element?.querySelectorAll("[data-context-tag]") || []),
		].find(
			(element) =>
				element.dataset.tagId === anchor.id &&
				element.dataset.ref === anchor.ref,
		);
		if (!trigger) return this.#closeTagContextMenu();
		this.#openTagContextMenu({
			preventDefault() {},
			stopPropagation() {},
			currentTarget: trigger,
			clientX: anchor.x,
			clientY: anchor.y,
		});
	}

	#closeTagContextMenu(clearAnchor = true) {
		this.#contextMenu?.ownerDocument.removeEventListener(
			"pointerdown",
			this.#onTagContextOutside,
		);
		this.#contextMenu?.remove();
		this.#contextMenu = null;
		if (clearAnchor) this.#contextMenuAnchor = null;
	}

	// ── Actions ──

	"toggle-collapse"(event, target, { collapseId }) {
		if (!collapseId) return;
		const collapsed = this.#getCollapsed();
		const idx = collapsed.indexOf(collapseId);
		if (idx !== -1) collapsed.splice(idx, 1);
		else collapsed.push(collapseId);
		this.#saveCollapsed(collapsed);
		this.render();
	}

	"open-sheet"(event, target, { ref }) {
		if (!ref) return;
		const actor = this.#resolveActor(ref);
		if (!actor || !actor.testUserPermission(game.user, "OBSERVER")) return;
		actor.sheet.render({ force: true });
	}

	#getToken(ref) {
		if (!ref || !canvas?.ready) return null;
		// Strip .Actor.zzzz suffix for direct document UUID match (unlinked tokens)
		const docUuid = ref.includes(".Actor.")
			? ref.slice(0, ref.lastIndexOf(".Actor."))
			: ref;
		const byDoc = canvas.tokens.placeables.find(
			(t) => t.document.uuid === docUuid,
		);
		if (byDoc) return byDoc;
		// Fallback: resolve actor reference (linked tokens: ref = actor.uuid)
		const actor = this.#resolveActor(ref);
		if (!actor) return null;
		const tokens =
			canvas.tokens.placeables.filter(
				(t) => t.actor?.uuid === actor.uuid || t.actor?.id === actor.id,
			) || [];
		if (tokens.length === 0) return null;
		if (tokens.length === 1) return tokens[0];
		// Multiple matches: check if they have different UUIDs (unlinked from same prototype)
		const allUnique = new Set(tokens.map((t) => t.actor?.uuid));
		if (allUnique.size === tokens.length) {
			// Each unlinked token has its own UUID: find the exact match
			return tokens.find((t) => t.actor?.uuid === actor.uuid) || tokens[0];
		}
		// Linked tokens (all share the same actor UUID): cycle through them
		if (!this.#_tokenCycleIdx) this.#_tokenCycleIdx = new Map();
		const next = (this.#_tokenCycleIdx.get(ref) ?? -1) + 1;
		const idx = next % tokens.length;
		this.#_tokenCycleIdx.set(ref, idx);
		return tokens[idx];
	}

	#canSeeToken(token) {
		return token?.visible || game.user.isGM;
	}

	"ping-token"(event, target, { ref }) {
		const token = this.#getToken(ref);
		if (!token) return;
		if (!this.#canSeeToken(token)) {
			ui.notifications.warn(game.i18n.localize("Litm.ui.token-not-visible"));
			return;
		}
		canvas.ping(token.center);
	}

	"focus-token"(event, target, { ref }) {
		const token = this.#getToken(ref);
		if (!token) return;
		if (!this.#canSeeToken(token)) {
			ui.notifications.warn(game.i18n.localize("Litm.ui.token-not-visible"));
			return;
		}
		canvas.animatePan({ x: token.center.x, y: token.center.y });
	}

	async "toggle-hide-story"(event, target, { ref }) {
		if (!ref || !game.user.isGM) return;
		const config = this.#storyConfig;
		const hidden = config.hiddenActors || [];
		const idx = hidden.indexOf(ref);
		if (idx !== -1) hidden.splice(idx, 1);
		else hidden.push(ref);
		await this.#setStoryConfig({ hiddenActors: hidden });
	}

	async "toggle-hidden"(event, target, { ref }) {
		if (!game.user.isGM || !ref) return;
		const config = this.#sceneConfig;
		const actors = (config.actors || []).map((a) => {
			if (a.ref === ref) return { ...a, hidden: !a.hidden };
			return a;
		});
		await this.#setSceneConfig({ actors });
	}

	async "remove-actor"(event, target, { ref }) {
		if (!game.user.isGM || !ref) return;
		const config = this.#sceneConfig;
		const actors = (config.actors || []).filter((a) => a.ref !== ref);
		const tokenTagVisibility = (config.tokenTagVisibility || []).filter(
			(actorRef) => actorRef !== ref,
		);
		await this.#setSceneConfig({ actors, tokenTagVisibility });
	}

	async "remove-story-actor"(event, target, { ref }) {
		if (!game.user.isGM || !ref) return;
		const config = this.#storyConfig;
		const actors = (config.actors || []).filter((a) => a !== ref);
		await this.#setStoryConfig({ actors });
	}

	async "clear-fellowship"(event, target, dataset) {
		if (!game.user.isGM) return;
		await this.#clearSelectedFellowship();
		this.#broadcast();
		this.render();
	}

	async "add-all-tokens"(event, target, dataset) {
		if (!game.user.isGM || !canvas?.ready || !canvas.scene) return;
		const scene = canvas.scene;
		const currentConfig = scene.getFlag("litm-rn", "scenetags") || {
			tags: [],
			actors: [],
		};
		const existingRefs = new Set(
			(currentConfig.actors || []).map((a) => a.ref),
		);
		const storyActorRefs = new Set(this.#storyConfig.actors || []);
		const tokenTagVisibility = new Set(currentConfig.tokenTagVisibility || []);
		const newActors = [];
		for (const token of canvas.tokens.placeables) {
			const actor = token.actor;
			if (!actor) continue;
			const ref = actor.uuid;
			if (existingRefs.has(ref)) continue;
			if (storyActorRefs.has(ref)) {
				tokenTagVisibility.add(ref);
				continue;
			}
			existingRefs.add(ref);
			if (getActorFellowshipId(actor)) {
				tokenTagVisibility.add(ref);
				continue;
			}
			newActors.push({ ref, hidden: !!token.document.hidden });
		}
		if (
			newActors.length === 0 &&
			tokenTagVisibility.size ===
				(currentConfig.tokenTagVisibility || []).length
		)
			return;
		const actors = [...(currentConfig.actors || []), ...newActors];
		await scene.setFlag("litm-rn", "scenetags", {
			...currentConfig,
			actors,
			tokenTagVisibility: [...tokenTagVisibility],
		});
		this.#broadcast();
		this.render();
	}

	async "clear-story-tags"() {
		if (!game.user.isGM) return;
		if (!(await confirmDelete("Litm.other.story-tags"))) return;
		await this.#setStoryConfig({ tags: [] });
	}

	async "clear-scene-tags"() {
		if (!game.user.isGM || !canvas.scene) return;
		if (!(await confirmDelete("Litm.other.scene-tags"))) return;
		await this.#setSceneConfig({ tags: [] });
	}

	async "clear-story-actors"() {
		if (!game.user.isGM) return;
		if (!(await this.#confirmClearActors("story"))) return;
		await this.#setStoryConfig({ actors: [] });
	}

	async "clear-scene-actors"() {
		if (!game.user.isGM || !canvas.scene) return;
		if (!(await this.#confirmClearActors("scene"))) return;
		await this.#setSceneConfig({ actors: [], tokenTagVisibility: [] });
	}

	async #confirmClearActors(scope) {
		return foundry.applications.api.DialogV2.confirm({
			window: {
				title: t(`Litm.ui.clear-${scope}-actors-title`),
				icon: "fa-solid fa-trash",
			},
			content: `<p>${t(`Litm.ui.clear-${scope}-actors-content`)}</p>`,
			rejectClose: false,
		});
	}

	/**
	 * Toggle token-tag visibility, adding only non-persistent actors to the scene category.
	 * @param {string} actorUuid Actor UUID represented by the token.
	 * @param {{hidden?: boolean}} options Initial player visibility for a newly added scene actor.
	 */
	static async toggleSceneActor(actorUuid, { hidden = false } = {}) {
		if (!game.user.isGM || !canvas?.ready || !canvas.scene) return;
		const scene = canvas.scene;
		const config = scene.getFlag("litm-rn", "scenetags") || {
			tags: [],
			actors: [],
		};
		const existing = (config.actors || []).find((a) => a.ref === actorUuid);
		const tokenTagVisibility = new Set(config.tokenTagVisibility || []);
		const storyConfig = game.settings.get("litm-rn", "storytags") || {
			actors: [],
		};
		const actor = fromUuidSync(actorUuid);
		const selectedFellowshipId =
			game.settings.get("litm-rn", "selectedFellowship") || null;
		const isPersistent =
			(storyConfig.actors || []).includes(actorUuid) ||
			(selectedFellowshipId &&
				isFellowshipMember(selectedFellowshipId, actor?.id));
		const isActive = !!existing || tokenTagVisibility.has(actorUuid);
		let actors;
		if (isActive) {
			actors = (config.actors || []).filter((a) => a.ref !== actorUuid);
			tokenTagVisibility.delete(actorUuid);
		} else if (isPersistent) {
			actors = config.actors || [];
			tokenTagVisibility.add(actorUuid);
		} else {
			actors = [...(config.actors || []), { ref: actorUuid, hidden }];
		}
		await scene.setFlag("litm-rn", "scenetags", {
			...config,
			actors,
			tokenTagVisibility: [...tokenTagVisibility],
		});
	}

	async "add-tag"(event, target, { section }) {
		if (section === "story" || section === "scene") {
			const tagDef = {
				id: foundry.utils.randomID(),
				name: t("Litm.ui.name-tag"),
				type: "tag",
				isScratched: false,
				isHindering: false,
				isPrivate: createPrivate(event),
				isCrispy: false,
				isPermanent: false,
			};
			if (game.user.isGM) {
				this.#editingTagId = tagDef.id;
				if (section === "scene") {
					const tags = [...(this.#sceneConfig.tags || [])];
					tags.push(tagDef);
					await this.#setSceneConfig({ tags });
				} else {
					const tags = [...(this.#storyConfig.tags || [])];
					tags.push(tagDef);
					await this.#setStoryConfig({ tags });
				}
			} else {
				this.#editingTagId = tagDef.id;
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section,
					operation: "add-tag",
					tagData: tagDef,
				});
			}
		} else if (section?.startsWith("actor-")) {
			const ref = section.slice(6);
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			try {
				const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
					{
						name: t("Litm.ui.name-tag"),
						flags: {
							["litm-rn"]: {
								type: "tag",
								isScratched: false,
								isHindering: false,
								isCrispy: false,
								isPrivate: createPrivate(event),
							},
						},
					},
				]);
				if (effect) this.#editingTagId = effect.id;
			} catch {
				/* no-op */
			}
			this.#broadcast();
			this.render();
		}
	}

	/** Open the Story Theme picker for the global Story section. */
	async "add-story-theme"() {
		const linkedIds = new Set(this.#storyConfig.storyThemeIds || []);
		const storyThemes = (game.items?.contents ?? []).filter(
			(item) => item.type === "story",
		);
		const folderById = new Map(
			(game.folders?.contents ?? []).map((folder) => [folder.id, folder]),
		);
		const getParentId = (folder) =>
			folder?.folder?.id ?? folder?._source?.folder ?? null;
		const relevantFolderIds = new Set();

		for (const item of storyThemes) {
			let folder = item.folder;
			const visited = new Set();
			while (folder && !visited.has(folder.id)) {
				visited.add(folder.id);
				relevantFolderIds.add(folder.id);
				folder = folderById.get(getParentId(folder));
			}
		}

		const foldersByParent = new Map();
		for (const folderId of relevantFolderIds) {
			const folder = folderById.get(folderId);
			if (!folder) continue;
			const parentId = relevantFolderIds.has(getParentId(folder))
				? getParentId(folder)
				: null;
			if (!foldersByParent.has(parentId)) foldersByParent.set(parentId, []);
			foldersByParent.get(parentId).push(folder);
		}

		const itemsByFolder = new Map();
		for (const item of storyThemes) {
			const folderId = item.folder?.id ?? item._source?.folder ?? null;
			if (!itemsByFolder.has(folderId)) itemsByFolder.set(folderId, []);
			itemsByFolder.get(folderId).push(item);
		}

		const bySortThenName = (a, b) =>
			(a.sort ?? 0) - (b.sort ?? 0) ||
			a.name.localeCompare(b.name, game.i18n.lang);
		for (const folders of foldersByParent.values())
			folders.sort(bySortThenName);
		for (const items of itemsByFolder.values()) items.sort(bySortThenName);

		const collapseKey = `litm-tm-story-picker-folders-${game.user.id}`;
		let collapsedFolders;
		try {
			collapsedFolders = new Set(
				JSON.parse(localStorage.getItem(collapseKey) || "[]"),
			);
		} catch {
			collapsedFolders = new Set();
		}

		const renderItem = (item) => {
			const linked = linkedIds.has(item.id);
			const name = foundry.utils.escapeHTML(item.name);
			const image = foundry.utils.escapeHTML(item.img);
			return `
        <div class="litm--tm-story-pick-row" data-item-id="${item.id}"
          data-search-name="${name.toLocaleLowerCase()}">
          <img src="${image}" alt="">
          <span class="litm--tm-story-pick-label">${name}</span>
          <button type="button" data-add-story-theme="${item.id}"
            data-tooltip="${t(linked ? "Litm.ui.story-theme-added" : "Litm.ui.add-to-manager")}"
            ${linked ? "disabled" : ""}>
            <i class="fas ${linked ? "fa-check" : "fa-plus"}"></i>
          </button>
        </div>`;
		};

		const renderFolder = (folder) => {
			const collapsed = collapsedFolders.has(folder.id);
			const children = (foldersByParent.get(folder.id) || [])
				.map(renderFolder)
				.join("");
			const items = (itemsByFolder.get(folder.id) || [])
				.map(renderItem)
				.join("");
			const name = foundry.utils.escapeHTML(folder.name);
			const folderColor = folder.color
				? foundry.utils.escapeHTML(String(folder.color))
				: "var(--sidebar-folder-color, var(--color-dark-1))";
			return `
        <div class="litm--tm-story-pick-folder" data-folder-node data-folder-id="${folder.id}"
          data-search-name="${name.toLocaleLowerCase()}" style="--story-folder-color:${folderColor}">
          <button type="button" class="litm--tm-story-pick-folder-head" data-toggle-folder="${folder.id}">
            <i class="fas ${collapsed ? "fa-caret-right" : "fa-caret-down"}"></i>
            <i class="fas ${collapsed ? "fa-folder" : "fa-folder-open"}"></i>
            <span>${name}</span>
          </button>
          <div class="litm--tm-story-pick-folder-contents" ${collapsed ? "hidden" : ""}>
            ${children}${items}
          </div>
        </div>`;
		};

		const rootItems = (itemsByFolder.get(null) || []).map(renderItem).join("");
		const rootFolders = (foldersByParent.get(null) || [])
			.map(renderFolder)
			.join("");
		const tree = storyThemes.length
			? `${rootItems}${rootFolders}`
			: `<p class="litm--tm-empty">${t("Litm.ui.no-story-themes")}</p>`;

		const createButton = game.user.isGM
			? `<button type="button" class="litm--tm-story-pick-create" data-create-story-theme>
          <i class="fas fa-plus"></i>
          <span>${t("Litm.ui.create-story-theme")}</span>
        </button>`
			: "";

		const dialog = new foundry.applications.api.DialogV2({
			window: { title: t("Litm.ui.add-story-theme") },
			classes: ["litm", "litm--tm-story-picker"],
			content: `
        <div class="litm--tm-story-pick">
          ${createButton}
          <label class="litm--tm-story-pick-search">
            <i class="fas fa-magnifying-glass"></i>
            <input type="search" placeholder="${t("Litm.ui.search-story-themes")}" data-story-theme-search>
          </label>
          <div class="litm--tm-story-pick-list">${tree}</div>
        </div>`,
			buttons: [
				{
					action: "cancel",
					label: t("Litm.ui.cancel"),
				},
			],
			rejectClose: false,
		});
		dialog.render(true);

		requestAnimationFrame(() => {
			const element = dialog.element;
			if (!element) return;

			element.querySelectorAll("[data-add-story-theme]").forEach((button) => {
				button.addEventListener("click", async () => {
					await this.#linkStoryTheme(button.dataset.addStoryTheme);
					button.disabled = true;
					button.querySelector("i")?.classList.replace("fa-plus", "fa-check");
				});
			});

			element.querySelectorAll("[data-toggle-folder]").forEach((button) => {
				button.addEventListener("click", () => {
					const folderId = button.dataset.toggleFolder;
					const node = button.closest("[data-folder-node]");
					const contents = node?.querySelector(
						":scope > .litm--tm-story-pick-folder-contents",
					);
					if (!contents) return;
					contents.hidden = !contents.hidden;
					collapsedFolders[contents.hidden ? "add" : "delete"](folderId);
					localStorage.setItem(
						collapseKey,
						JSON.stringify([...collapsedFolders]),
					);
					button
						.querySelector(".fa-caret-right, .fa-caret-down")
						?.classList.replace(
							contents.hidden ? "fa-caret-down" : "fa-caret-right",
							contents.hidden ? "fa-caret-right" : "fa-caret-down",
						);
					button
						.querySelector(".fa-folder, .fa-folder-open")
						?.classList.replace(
							contents.hidden ? "fa-folder-open" : "fa-folder",
							contents.hidden ? "fa-folder" : "fa-folder-open",
						);
				});
			});

			const searchInput = element.querySelector("[data-story-theme-search]");
			searchInput?.addEventListener("input", () => {
				const query = searchInput.value.trim().toLocaleLowerCase();

				const filterFolder = (node) => {
					const folderMatch = node.dataset.searchName.includes(query);
					const contents = node.querySelector(
						":scope > .litm--tm-story-pick-folder-contents",
					);
					let hasVisibleChild = false;

					contents
						?.querySelectorAll(":scope > .litm--tm-story-pick-row")
						.forEach((row) => {
							const visible = !query || row.dataset.searchName.includes(query);
							row.hidden = !visible;
							hasVisibleChild ||= visible;
						});
					contents
						?.querySelectorAll(":scope > [data-folder-node]")
						.forEach((child) => {
							const childVisible = filterFolder(child);
							hasVisibleChild ||= childVisible;
						});

					const visible = !query || folderMatch || hasVisibleChild;
					node.hidden = !visible;
					if (contents)
						contents.hidden = query
							? false
							: collapsedFolders.has(node.dataset.folderId);
					return visible;
				};

				const list = element.querySelector(".litm--tm-story-pick-list");
				list
					?.querySelectorAll(":scope > .litm--tm-story-pick-row")
					.forEach((row) => {
						row.hidden = !!query && !row.dataset.searchName.includes(query);
					});
				list
					?.querySelectorAll(":scope > [data-folder-node]")
					.forEach(filterFolder);
			});

			element
				.querySelector("[data-create-story-theme]")
				?.addEventListener("click", async () => {
					const item = await CONFIG.Item.documentClass.create({
						name: t("TYPES.Item.story"),
						type: "story",
					});
					if (!item) return;
					await this.#linkStoryTheme(item.id);
					await dialog.close();
					item.sheet?.render({ force: true });
				});
		});
	}

	/** Open a Story Theme displayed in the global Story section. */
	"open-story-theme"(event, target, { itemId }) {
		const item = game.items?.get(itemId);
		if (item?.sheet) item.sheet.render({ force: true });
	}

	/** Remove a Story Theme from the manager without deleting its world Item. */
	async "remove-story-theme"(event, target, { itemId }) {
		if (!itemId) return;
		if (!(await confirmDelete("Litm.other.story-theme"))) return;
		if (!game.user.isGM) {
			dispatch({
				app: "tag-manager",
				type: "story-scene-crud",
				section: "story",
				operation: "unlink-story-theme",
				itemId,
			});
			return;
		}

		const storyThemeIds = (this.#storyConfig.storyThemeIds || []).filter(
			(id) => id !== itemId,
		);
		await this.#setStoryConfig({ storyThemeIds });
	}

	async #linkStoryTheme(itemId) {
		if (!itemId) return;
		if (!game.user.isGM) {
			dispatch({
				app: "tag-manager",
				type: "story-scene-crud",
				section: "story",
				operation: "link-story-theme",
				itemId,
			});
			return;
		}

		const storyThemeIds = [
			...new Set([...(this.#storyConfig.storyThemeIds || []), itemId]),
		];
		await this.#setStoryConfig({ storyThemeIds });
	}

	async "add-status"(event, target, { section }) {
		const def = {
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-status"),
			type: "status",
			values: Array(6).fill(null),
			isScratched: false,
			isHindering: false,
			isPrivate: createPrivate(event),
			isCrispy: false,
		};
		if (section === "story" || section === "scene") {
			if (game.user.isGM) {
				this.#editingTagId = def.id;
				if (section === "scene") {
					const tags = [...(this.#sceneConfig.tags || [])];
					tags.push(def);
					await this.#setSceneConfig({ tags });
				} else {
					const tags = [...(this.#storyConfig.tags || [])];
					tags.push(def);
					await this.#setStoryConfig({ tags });
				}
			} else {
				this.#editingTagId = def.id;
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section,
					operation: "add-status",
					tagData: def,
				});
			}
		} else if (section?.startsWith("actor-")) {
			const ref = section.slice(6);
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			try {
				const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
					{
						name: t("Litm.ui.name-status"),
						flags: {
							["litm-rn"]: {
								type: "status",
								values: Array(6).fill(null),
								isScratched: false,
								isHindering: false,
								isPrivate: createPrivate(event),
							},
						},
					},
				]);
				if (effect) this.#editingTagId = effect.id;
			} catch {
				/* no-op */
			}
			this.#broadcast();
			this.render();
		}
	}

	async "add-might"(event, target, { section }) {
		const def = {
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-might"),
			type: "might",
			value: 3,
			isScratched: false,
			isHindering: false,
			isPrivate: createPrivate(event),
			isCrispy: false,
		};
		if (section === "story" || section === "scene") {
			if (game.user.isGM) {
				this.#editingTagId = def.id;
				if (section === "scene") {
					const tags = [...(this.#sceneConfig.tags || [])];
					tags.push(def);
					await this.#setSceneConfig({ tags });
				} else {
					const tags = [...(this.#storyConfig.tags || [])];
					tags.push(def);
					await this.#setStoryConfig({ tags });
				}
			} else {
				this.#editingTagId = def.id;
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section,
					operation: "add-might",
					tagData: def,
				});
			}
		} else if (section?.startsWith("actor-")) {
			const ref = section.slice(6);
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			try {
				const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
					{
						name: t("Litm.ui.name-might"),
						flags: {
							["litm-rn"]: {
								type: "might",
								value: 3,
								isScratched: false,
								isHindering: false,
								isPrivate: createPrivate(event),
							},
						},
					},
				]);
				if (effect) this.#editingTagId = effect.id;
			} catch {
				/* no-op */
			}
			this.#broadcast();
			this.render();
		}
	}

	async "add-limit"(event, target, { section }) {
		const isPrivate = createPrivate(event);
		const def = {
			id: foundry.utils.randomID(),
			name: t("Litm.ui.name-limit"),
			type: "limit",
			value: 6,
			isScratched: false,
			isHindering: false,
			isPrivate,
			isCrispy: false,
			statusIds: [],
		};
		if (section === "story" || section === "scene") {
			if (game.user.isGM) {
				this.#editingTagId = def.id;
				if (section === "scene") {
					const tags = [...(this.#sceneConfig.tags || [])];
					tags.push(def);
					await this.#setSceneConfig({ tags });
				} else {
					const tags = [...(this.#storyConfig.tags || [])];
					tags.push(def);
					await this.#setStoryConfig({ tags });
				}
			} else {
				this.#editingTagId = def.id;
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section,
					operation: "add-limit",
					tagData: def,
				});
			}
		} else if (section?.startsWith("actor-")) {
			const ref = section.slice(6);
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			if (actor.type === "challenge") {
				const limits = foundry.utils.deepClone(actor.system.limits || []);
				this.#editingTagId = `_limit_${limits.length}`;
				limits.push({
					name: t("Litm.ui.name-limit"),
					value: 6,
					consequence: "",
					isPrivate,
					statusIds: [],
				});
				try {
					await actor.update({ "system.limits": limits });
				} catch {
					/* no-op */
				}
			} else {
				try {
					const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
						{
							name: t("Litm.ui.name-limit"),
							flags: {
								["litm-rn"]: {
									type: "limit",
									value: 6,
									isPrivate,
									isScratched: false,
								},
							},
						},
					]);
					if (effect) this.#editingTagId = effect.id;
				} catch {
					/* no-op */
				}
			}
			this.#broadcast();
			this.render();
		}
	}

	// async "toggle-hindering"(event, target, { ref, id }) {
	//   if (!ref || !id) return;
	//   await this.#toggleTag(ref, id, (t) => ({ ...t, isHindering: !t.isHindering }));
	// }

	async "toggle-private"(event, target, { ref, id }) {
		if (!ref || !id) return;
		await this.#toggleTag(ref, id, (t) => ({ ...t, isPrivate: !t.isPrivate }));
	}

	async "toggle-crispy"(event, target, { ref, id }) {
		if (!ref || !id) return;
		const isCrispy = !this.#findTag(ref, id)?.isCrispy;
		if (isCrispy) game.litm?.normalizeBurnedTagSelections?.(id);
		await this.#toggleTag(ref, id, (t) => {
			return { ...t, isCrispy, ...(isCrispy ? { isPermanent: false } : {}) };
		});
		if (isCrispy) game.litm?.normalizeBurnedTagSelections?.(id);
	}

	/** Toggle whether a global Story or Scene tag survives scratching and burning. */
	async "toggle-permanent"(event, target, { ref, id }) {
		if (!["story", "scene"].includes(ref) || !id) return;
		await this.#toggleTag(ref, id, (tag) => ({
			...tag,
			isPermanent: !tag.isPermanent,
			...(!tag.isPermanent ? { isCrispy: false, isScratched: false } : {}),
		}));
	}

	async "toggle-status-value"(event, target, { ref, id, value }) {
		if (!ref || !id || value == null) return;
		const idx = Number.parseInt(value, 10);
		if (!Number.isFinite(idx)) return;
		await this.#toggleTag(ref, id, (t) => {
			const values = [...(t.values || Array(6).fill(null))];
			values[idx] = values[idx] ? null : true;
			return { ...t, values };
		});
	}

	async "set-might-value"(event, target, { ref, id, value }) {
		if (!ref || !id || value == null) return;
		await this.#toggleTag(ref, id, (t) => ({ ...t, value: Number(value) }));
	}

	async "set-limit-value"(event, target, { ref, id, value }) {
		if (!ref || !id) return;
		const newValue = value === "" ? null : Number(value);
		await this.#toggleTag(ref, id, (t) => ({ ...t, value: newValue }));
	}

	async "edit-tag"(event, target, { ref, id }) {
		if (!id) return;
		this.#editingTagId = id;
		this.render();
	}

	async select(event, target, { ref, id }) {
		if (!game.user.isGM) return;
		if (this.#editingTagId) return;
		if (event?.detail > 1) return;
		if (!id) return;
		if (target.dataset.tagType === "limit") return;
		const tag = this.#findTag(ref || "story", id);
		if (ref === "fellowship" && tag?.isScratched && tag.type !== "weaknessTag")
			return;

		const tagName = target.textContent?.trim() || "";
		const result = await RollTargetPopup.show(event, {
			tagId: id,
			tagName,
			ref: ref || "story",
		});
		if (!result) return;

		const { action, actorId, state } = result;
		const selectionRef = this.#rollSelectionRef(ref || "story");
		if (action === "remove") {
			game.litm?.removeTagFromRoll?.(actorId, selectionRef, id);
		} else {
			game.litm?.addTagToRoll?.(actorId, selectionRef, id, state);
		}
		this.render();
	}

	async "player-select"(event, target, { ref, id }) {
		if (
			game.user.isGM ||
			!game.user.character ||
			event?.detail > 1 ||
			!ref ||
			!id
		)
			return;
		const tag = this.#findTag(ref, id);
		if (!tag || ["limit", "might"].includes(tag.type)) return;
		if (ref === "fellowship" && tag.isScratched && tag.type !== "weaknessTag")
			return;
		const actorId = game.user.character.id;
		const selectionRef = this.#rollSelectionRef(ref);
		const selected = game.litm?.rollSelection
			?.get(actorId)
			?.get(selectionRef)
			?.has(id);
		if (selected) {
			game.litm?.removeTagFromRoll?.(actorId, selectionRef, id);
			return;
		}
		const state =
			tag.isHindering || ["weaknessTag", "weaknessStoryTag"].includes(tag.type)
				? "negative"
				: "positive";
		game.litm?.addTagToRoll?.(actorId, selectionRef, id, state);
	}

	async "remove-tag"(event, target, { ref, id }) {
		if (!id) return;
		if (ref === "story") {
			if (!game.user.isGM) {
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section: ref,
					operation: "remove-tag",
					tagId: id,
				});
				return;
			}
			const tags = (this.#storyConfig.tags || []).filter((t) => t.id !== id);
			await this.#setStoryConfig({ tags });
		} else if (ref === "scene") {
			if (!game.user.isGM) {
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section: ref,
					operation: "remove-tag",
					tagId: id,
				});
				return;
			}
			const tags = (this.#sceneConfig.tags || []).filter((t) => t.id !== id);
			await this.#setSceneConfig({ tags });
		} else {
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			if (id.startsWith("_limit_")) {
				const index = Number.parseInt(id.slice(7), 10);
				if (!Number.isFinite(index)) return;
				const limits = foundry.utils.deepClone(actor.system.limits || []);
				if (!limits[index]) return;
				limits.splice(index, 1);
				try {
					await actor.update({ "system.limits": limits });
				} catch {
					/* no-op */
				}
			} else {
				try {
					await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
				} catch {
					/* already deleted */
				}
			}
			this.#broadcast();
			this.render();
		}
	}

	async "save-edit-tag"(event, target, { id, ref }) {
		const newName = (target.value ?? target.textContent)?.trim();
		this.#editingTagId = null;
		if (!newName) return this["remove-tag"](null, target, { ref, id });
		if (ref === "story" || ref === "scene") {
			if (game.user.isGM) {
				if (ref === "story") {
					const tags = (this.#storyConfig.tags || []).map((t) =>
						t.id === id ? { ...t, name: newName } : t,
					);
					await this.#setStoryConfig({ tags });
				} else {
					const tags = (this.#sceneConfig.tags || []).map((t) =>
						t.id === id ? { ...t, name: newName } : t,
					);
					await this.#setSceneConfig({ tags });
				}
			} else {
				dispatch({
					app: "tag-manager",
					type: "story-scene-crud",
					section: ref,
					operation: "rename-tag",
					tagId: id,
					newName,
				});
			}
		} else {
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			if (id.startsWith("_limit_")) {
				const index = Number.parseInt(id.slice(7), 10);
				if (!Number.isFinite(index)) return;
				const limits = foundry.utils.deepClone(actor.system.limits || []);
				if (!limits[index]) return;
				limits[index] = { ...limits[index], name: newName };
				try {
					await actor.update({ "system.limits": limits });
				} catch {
					/* no-op */
				}
			} else {
				try {
					await actor.updateEmbeddedDocuments("ActiveEffect", [
						{ _id: id, name: newName },
					]);
				} catch {
					/* no-op */
				}
			}
			this.#broadcast();
			this.render();
		}
	}

	"open-fellowship"() {
		const id = this.#getSelectedFellowship();
		if (!id) return;
		const item = game.items.get(id);
		if (item?.sheet) item.sheet.render({ force: true });
	}

	async "send-special"(event, target, { specialId }) {
		const id = this.#getSelectedFellowship();
		if (!id) return;
		const item = game.items.get(id);
		if (!item) return;
		const special = item.system?.specials?.find((s) => s.id === specialId);
		if (!special) return;
		const enriched = await TextEditor.enrichHTML(special.description || "");
		CONFIG.ChatMessage.documentClass.create({
			content: `<strong>${special.name}</strong>: ${enriched}`,
			speaker: CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: game.user.character,
			}),
		});
	}

	// ── Drop handlers ──

	#onDragStart = (event) => {
		if (!game.user.isGM) {
			event.preventDefault();
			return;
		}
		if (event.target.closest(".litm--roll-selected-indicators")) {
			event.preventDefault();
			return;
		}

		const storyThemeHandle = event.target.closest(
			"[data-action='reorder-story-theme']",
		);
		if (storyThemeHandle) {
			const themeBlock = storyThemeHandle.closest(".litm--tm-story-theme");
			const itemId =
				themeBlock?.querySelector("[data-item-id]")?.dataset.itemId;
			if (!themeBlock || !itemId) return;
			event.dataTransfer.setData(
				"application/litm-story-theme-reorder",
				JSON.stringify({ itemId }),
			);
			event.dataTransfer.effectAllowed = "move";
			themeBlock.classList.add("litm--tm-dragging");
			this.#dragSource = { storyThemeId: itemId };
			return;
		}

		// Actor block drag — only by the name element
		const reorderHandle = event.target.closest("[data-action='reorder-actor']");
		const tagItem = event.target.closest("[data-tag-id]");

		if (reorderHandle && !tagItem) {
			const actorBlock = reorderHandle.closest(".litm--tm-actor[data-ref]");
			if (!actorBlock) return;
			const ref = actorBlock.dataset.ref;
			const parentSection = actorBlock.dataset.parentSection;
			if (!ref || !parentSection) return;
			event.dataTransfer.setData(
				"application/litm-actor-reorder",
				JSON.stringify({ ref, section: parentSection }),
			);
			event.dataTransfer.effectAllowed = "move";
			actorBlock.classList.add("litm--tm-dragging");
			this.#dragSource = { ref, section: parentSection };
			return;
		}

		// Tag drag
		if (!tagItem) return;

		const tagId = tagItem.dataset.tagId;
		const ref = tagItem.dataset.ref;
		const tagType = tagItem.dataset.tagType;
		if (!tagId || !ref) return;

		// Build enriched drag data for text editor drops
		let tagData = null;
		if (ref === "story") {
			tagData = (this.#storyConfig.tags || []).find((t) => t.id === tagId);
		} else if (ref === "scene") {
			tagData = (this.#sceneConfig.tags || []).find((t) => t.id === tagId);
		} else {
			const actor = this.#resolveActor(ref);
			if (actor) {
				if (tagId.startsWith("_limit_")) {
					const index = Number.parseInt(tagId.slice(7), 10);
					const limit = actor.system?.limits?.[index];
					if (limit) {
						tagData = {
							id: tagId,
							name: limit.name,
							type: "limit",
							value: limit.value,
						};
					}
				} else {
					const effect = actor.effects.get(tagId);
					if (effect) {
						const flags = effect.flags["litm-rn"] || {};
						tagData = {
							id: effect.id,
							name: effect.name,
							type: flags.type || "tag",
							values: flags.values,
							value: flags.value,
							isScratched: flags.isScratched,
						};
					}
				}
			}
		}
		if (!tagData) return;

		// Set drag data for external drops (text/plain for enrichers)
		const dragData = {
			id: tagData.id || foundry.utils.randomID(),
			name: tagData.name,
			type:
				tagData.type === "status" ||
				(tagData.type === "tag" && tagData.values?.some((v) => !!v))
					? "status"
					: tagData.type === "might"
						? "might"
						: tagData.type === "limit"
							? "limit"
							: "tag",
			values: tagData.values,
			value: tagData.value,
			isScratched: false,
		};
		event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
		event.dataTransfer.effectAllowed = "copy";

		// Also store internal drag metadata
		event.dataTransfer.setData(
			"application/litm-tag-manager",
			JSON.stringify({
				tagId,
				ref,
				tagType,
			}),
		);

		tagItem.classList.add("litm--tm-dragging");
	};

	#onDragEnd = (event) => {
		this.#dragSource = null;
		if (!this.element) return;
		this.element
			.querySelectorAll(
				".litm--tm-drag-over, .litm--tm-drag-over-before, .litm--tm-drag-over-after, .litm--tm-dragging",
			)
			.forEach((el) => {
				el.classList.remove(
					"litm--tm-drag-over",
					"litm--tm-drag-over-before",
					"litm--tm-drag-over-after",
					"litm--tm-dragging",
				);
			});
	};

	#onDragOver = (event) => {
		if (!game.user.isGM) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";

		// Clear previous highlights
		if (this.element) {
			this.element
				.querySelectorAll(
					".litm--tm-drag-over, .litm--tm-drag-over-before, .litm--tm-drag-over-after",
				)
				.forEach((el) => {
					el.classList.remove(
						"litm--tm-drag-over",
						"litm--tm-drag-over-before",
						"litm--tm-drag-over-after",
					);
				});
		}

		if (this.#dragSource?.storyThemeId) {
			const themeBlock = event.target.closest(".litm--tm-story-theme");
			if (themeBlock) {
				event.dataTransfer.dropEffect = "move";
				const rect = themeBlock.getBoundingClientRect();
				const className =
					event.clientY < rect.top + rect.height / 2
						? "litm--tm-drag-over-before"
						: "litm--tm-drag-over-after";
				themeBlock.classList.add(className);
			}
			return;
		}

		// Actor block highlight — only when dragging an actor in the same section
		const isActorDrag = this.#dragSource?.section != null;
		if (isActorDrag) {
			const actorBlock = event.target.closest(".litm--tm-actor[data-ref]");
			if (actorBlock) {
				event.dataTransfer.dropEffect = "move";
				if (this.#dragSource.section === actorBlock.dataset.parentSection) {
					const rect = actorBlock.getBoundingClientRect();
					const midY = rect.top + rect.height / 2;
					if (event.clientY < midY) {
						actorBlock.classList.add("litm--tm-drag-over-before");
					} else {
						actorBlock.classList.add("litm--tm-drag-over-after");
					}
				}
				return;
			}
		}

		const target = event.target.closest("[data-tag-id]");
		const limitWrapper = event.target.closest(".litm--tm-limit-wrapper");
		const sectionBody = event.target.closest(".litm--tm-section-body");

		if (target) {
			const rect = target.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			if (event.clientY < midY) {
				target.classList.add("litm--tm-drag-over-before");
			} else {
				target.classList.add("litm--tm-drag-over-after");
			}
		} else if (limitWrapper) {
			limitWrapper.classList.add("litm--tm-drag-over");
		} else if (sectionBody) {
			sectionBody.classList.add("litm--tm-drag-over");
		}
	};

	#onDrop = async (event) => {
		event.preventDefault();
		if (!game.user.isGM) return;

		// Clear highlights
		if (this.element) {
			this.element
				.querySelectorAll(
					".litm--tm-drag-over, .litm--tm-drag-over-before, .litm--tm-drag-over-after",
				)
				.forEach((el) => {
					el.classList.remove(
						"litm--tm-drag-over",
						"litm--tm-drag-over-before",
						"litm--tm-drag-over-after",
					);
				});
		}

		const storyThemeReorderRaw = event.dataTransfer.getData(
			"application/litm-story-theme-reorder",
		);
		if (storyThemeReorderRaw) {
			let storyThemeData;
			try {
				storyThemeData = JSON.parse(storyThemeReorderRaw);
			} catch {
				return;
			}
			const targetTheme = event.target.closest(".litm--tm-story-theme");
			const targetId =
				targetTheme?.querySelector("[data-item-id]")?.dataset.itemId;
			if (targetId && storyThemeData.itemId !== targetId) {
				await this.#reorderStoryTheme(
					storyThemeData.itemId,
					targetId,
					event,
					targetTheme,
				);
			}
			return;
		}

		// Actor reorder — only when same section
		const actorReorderRaw = event.dataTransfer.getData(
			"application/litm-actor-reorder",
		);
		if (actorReorderRaw) {
			let actorData;
			try {
				actorData = JSON.parse(actorReorderRaw);
			} catch {
				return;
			}
			const targetActorBlock = event.target.closest(
				".litm--tm-actor[data-ref]",
			);
			if (targetActorBlock) {
				const targetRef = targetActorBlock.dataset.ref;
				const targetSection = targetActorBlock.dataset.parentSection;
				if (
					targetRef &&
					targetSection &&
					targetSection === actorData.section &&
					actorData.ref !== targetRef
				) {
					await this.#reorderActor(
						actorData.ref,
						targetRef,
						targetSection,
						event,
						targetActorBlock,
					);
				}
			}
			return;
		}

		const raw = event.dataTransfer.getData("text/plain");
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		// Check for internal tag-manager drag
		const internalRaw = event.dataTransfer.getData(
			"application/litm-tag-manager",
		);
		let internalData = null;
		try {
			internalData = internalRaw ? JSON.parse(internalRaw) : null;
		} catch {
			/* no-op */
		}

		// Determine the drop target section from the DOM
		const section = event.target.closest("[data-section]");
		const sectionName = section?.dataset.section || "story";

		// Actor drops: always go to story tag actors
		if (data.type === "Actor") {
			const ref = data.uuid || data.id;
			const actor = fromUuidSync(ref) || game.actors.get(data.id);
			if (!actor) return;
			const config = this.#storyConfig;
			if (config.actors.includes(ref)) {
				ui.notifications.warn(
					game.i18n.format("Litm.ui.actor-already-in-story", {
						name: actor.name,
					}),
				);
				return;
			}
			await this.#setStoryConfig({ actors: [...config.actors, ref] });
			return;
		}

		// Internal drag: reorder or status→limit
		if (internalData) {
			const previousSkipEffectHook = _skipEffectHook;
			this.#deferSync = true;
			_skipEffectHook = true;
			try {
				await this.#handleInternalDrop(event, internalData, sectionName);
			} finally {
				this.#deferSync = false;
				_skipEffectHook = previousSkipEffectHook;
			}
			// Persist every related document update first, then synchronize and render once.
			this.#broadcast();
			await this.render({ force: true });
			return;
		}

		// External tag drops (from story-tags app or other sources)
		const tagTypes = ["tag", "status", "might", "limit"];
		if (!tagTypes.includes(data.type)) return;

		// If dropped on an actor block, add to that actor
		const actorBlock = event.target.closest("[data-ref]");
		if (actorBlock && !actorBlock.dataset.section) {
			const actorRef = actorBlock.dataset.ref;
			if (actorRef) {
				const actor = this.#resolveActor(actorRef);
				if (actor) {
					// Block might tags on character actors
					if (data.type === "might" && actor.type === "character") {
						ui.notifications.warn(
							game.i18n.localize("Litm.ui.might-not-for-characters"),
						);
						return;
					}
					const effectData = this.#buildTagEffectData(data, event);
					if (effectData) {
						if (data.type === "status")
							await addOrStackActorStatus(actor, effectData);
						else
							await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
					}
				}
				return;
			}
		}

		// If dropped on scene section (not on actor) → scene tags
		// Otherwise → story tags (default)
		if (sectionName === "scene" && !actorBlock) {
			const config = this.#sceneConfig;
			const newTag = this.#buildTagFromDrop(data, event);
			if (newTag) {
				const tags =
					newTag.type === "status"
						? addOrStackStatusData(config.tags, newTag).statuses
						: [...config.tags, newTag];
				await this.#setSceneConfig({ tags });
			}
		} else {
			const config = this.#storyConfig;
			const newTag = this.#buildTagFromDrop(data, event);
			if (newTag) {
				const tags =
					newTag.type === "status"
						? addOrStackStatusData(config.tags, newTag).statuses
						: [...config.tags, newTag];
				await this.#setStoryConfig({ tags });
			}
		}
	};

	// ── Internal drag handler ──

	async #handleInternalDrop(event, internalData, sectionName) {
		const { tagId: sourceId, ref: sourceRef } = internalData;

		// Determine drop target — check limit wrapper first (including nested tagItems)
		const limitWrapper = event.target.closest(".litm--tm-limit-wrapper");
		const targetTagEl = event.target.closest("[data-tag-id]");

		// Is the source currently inside a limit?
		const sourceInLimit = this.#findSourceLimit(sourceRef, sourceId);

		// ── Drop on limit wrapper (the <div> itself, not a child tag) ──
		if (
			limitWrapper &&
			(!targetTagEl || !targetTagEl.closest(".litm--tm-limit-wrapper"))
		) {
			const limitId = limitWrapper.dataset.limitId;
			const limitRef = limitWrapper.dataset.ref;
			if (limitId && limitRef && sourceId !== limitId) {
				await this.#addStatusToLimit(sourceRef, sourceId, limitRef, limitId);
			}
			return;
		}

		// ── Drop on a tag ──
		if (targetTagEl && targetTagEl.dataset.tagId !== sourceId) {
			const targetId = targetTagEl.dataset.tagId;
			const targetRef = targetTagEl.dataset.ref;

			// Check if target is a limit tag (never inside limit contents)
			const targetIsLimit = targetTagEl.dataset.tagType === "limit";

			// Drop on a limit tag → place inside that limit
			if (targetIsLimit && sourceId !== targetId) {
				await this.#addStatusToLimit(sourceRef, sourceId, targetRef, targetId);
				return;
			}

			// Check if both source and target are inside the SAME limit wrapper
			const sourceLimitEl = this.element
				?.querySelector(`[data-tag-id="${sourceId}"]`)
				?.closest(".litm--tm-limit-wrapper");
			const targetLimitEl = targetTagEl.closest(".litm--tm-limit-wrapper");
			if (sourceLimitEl && targetLimitEl && sourceLimitEl === targetLimitEl) {
				// Both in same limit → reorder within that limit's statusIds
				const limitId = sourceLimitEl.dataset.limitId;
				const limitRef = sourceLimitEl.dataset.ref;
				if (limitId && limitRef) {
					const rect = targetTagEl.getBoundingClientRect();
					const insertBefore = event.clientY < rect.top + rect.height / 2;
					await this.#reorderWithinLimit(
						limitRef,
						limitId,
						sourceId,
						targetId,
						insertBefore,
					);
				}
				return;
			}

			// Target is inside a different limit → add to that limit
			if (targetLimitEl && !sourceLimitEl) {
				const limitId = targetLimitEl.dataset.limitId;
				const limitRef = targetLimitEl.dataset.ref;
				if (limitId && limitRef) {
					await this.#addStatusToLimit(sourceRef, sourceId, limitRef, limitId);
				}
				return;
			}

			// Normal reorder (both in main tag list, or source from limit → main list)
			await this.#removeStatusFromLimits(sourceRef, sourceId);
			const rect = targetTagEl.getBoundingClientRect();
			const insertBefore = event.clientY < rect.top + rect.height / 2;
			await this.#reorderTag(
				sourceRef,
				sourceId,
				targetRef,
				targetId,
				insertBefore,
			);
			return;
		}

		// ── Drop on section body (not on any tag) ──
		if (sectionName === "story" || sectionName === "scene") {
			await this.#removeStatusFromLimits(sourceRef, sourceId);

			const config =
				sectionName === "story" ? this.#storyConfig : this.#sceneConfig;
			const tags = [...(config.tags || [])];
			const sourceIdx = tags.findIndex((t) => t.id === sourceId);
			if (sourceIdx === -1) return;

			const sourceTag = tags[sourceIdx];
			// Determine if dragging upward or downward relative to the source tag's position
			const sourceEl = this.element?.querySelector(
				`[data-tag-id="${sourceId}"]`,
			);
			if (sourceEl) {
				const sourceRect = sourceEl.getBoundingClientRect();
				const draggingUp =
					event.clientY < sourceRect.top + sourceRect.height / 2;
				// Remove and place at beginning or end of same-type group
				tags.splice(sourceIdx, 1);
				const firstOfType = tags.findIndex((t) => t.type === sourceTag.type);
				const lastOfType = tags.findLastIndex((t) => t.type === sourceTag.type);
				if (draggingUp) {
					const insertIdx = firstOfType === -1 ? tags.length : firstOfType;
					tags.splice(insertIdx, 0, sourceTag);
				} else {
					const insertIdx = lastOfType === -1 ? tags.length : lastOfType + 1;
					tags.splice(insertIdx, 0, sourceTag);
				}
			} else {
				// Fallback: put at end
				const [tag] = tags.splice(sourceIdx, 1);
				tags.push(tag);
			}

			if (sectionName === "story") {
				await this.#setStoryConfig({ tags });
			} else {
				await this.#setSceneConfig({ tags });
			}
		}
	}

	// ── Find which limit contains a status ──

	#findSourceLimit(ref, statusId) {
		if (ref === "story") {
			const tags = this.#storyConfig.tags || [];
			return (
				tags.find(
					(t) => t.type === "limit" && (t.statusIds || []).includes(statusId),
				) || null
			);
		}
		if (ref === "scene") {
			const tags = this.#sceneConfig.tags || [];
			return (
				tags.find(
					(t) => t.type === "limit" && (t.statusIds || []).includes(statusId),
				) || null
			);
		}
		const actor = this.#resolveActor(ref);
		if (!actor) return null;
		if (actor.type === "challenge") {
			return (
				(actor.system.limits || []).find((l) =>
					(l.statusIds || []).includes(statusId),
				) || null
			);
		}
		// Non-challenge: limits are ActiveEffects
		const limitEffect = (actor.effects || []).find(
			(e) =>
				e.flags?.["litm-rn"]?.type === "limit" &&
				(e.flags["litm-rn"].statusIds || []).includes(statusId),
		);
		return limitEffect ? { id: limitEffect.id } : null;
	}

	/** After a contained status changes, recalculate the parent limit's currentValue in DOM */
	#updateParentLimitDom(ref, statusId) {
		if (ref === "story" || ref === "scene") {
			const limit = this.#findSourceLimit(ref, statusId);
			if (limit) this.#updateTagDom(ref, limit.id);
		} else {
			const actor = this.#resolveActor(ref);
			if (!actor) return;
			if (actor.type === "challenge") {
				const idx = (actor.system.limits || []).findIndex((l) =>
					(l.statusIds || []).includes(statusId),
				);
				if (idx !== -1) this.#updateTagDom(ref, `_limit_${idx}`);
			} else {
				// Non-challenge: limits are ActiveEffects
				const limitEffect = (actor.effects || []).find(
					(e) =>
						e.flags?.["litm-rn"]?.type === "limit" &&
						(e.flags["litm-rn"].statusIds || []).includes(statusId),
				);
				if (limitEffect) this.#updateTagDom(ref, limitEffect.id);
			}
		}
	}

	// ── Reorder within a limit's statusIds ──

	async #reorderWithinLimit(
		ref,
		limitId,
		sourceStatusId,
		targetStatusId,
		insertBefore,
	) {
		const reorderInStatusIds = (tags, limitIdx) => {
			const limit = tags[limitIdx];
			const statusIds = [...(limit.statusIds || [])];
			const srcIdx = statusIds.indexOf(sourceStatusId);
			const tgtIdx = statusIds.indexOf(targetStatusId);
			if (srcIdx === -1 || tgtIdx === -1) return null;
			statusIds.splice(srcIdx, 1);
			const newTgtIdx = statusIds.indexOf(targetStatusId);

			const sourceTag = tags.find((t) => t.id === sourceStatusId);
			const targetTag = tags.find((t) => t.id === targetStatusId);
			if (!sourceTag || !targetTag) return null;

			if (sourceTag.type === targetTag.type) {
				statusIds.splice(
					insertBefore ? newTgtIdx : newTgtIdx + 1,
					0,
					sourceStatusId,
				);
			} else {
				const firstOfType = statusIds.findIndex(
					(id) => tags.find((t) => t.id === id)?.type === sourceTag.type,
				);
				const lastOfType = statusIds.findLastIndex(
					(id) => tags.find((t) => t.id === id)?.type === sourceTag.type,
				);
				if (insertBefore) {
					const insertIdx = firstOfType === -1 ? statusIds.length : firstOfType;
					statusIds.splice(insertIdx, 0, sourceStatusId);
				} else {
					const insertIdx = lastOfType === -1 ? 0 : lastOfType + 1;
					statusIds.splice(insertIdx, 0, sourceStatusId);
				}
			}
			return statusIds;
		};

		if (ref === "story") {
			const config = this.#storyConfig;
			const tags = [...(config.tags || [])];
			const limitIdx = tags.findIndex((t) => t.id === limitId);
			if (limitIdx === -1) return;
			const statusIds = reorderInStatusIds(tags, limitIdx);
			if (!statusIds) return;
			tags[limitIdx] = { ...tags[limitIdx], statusIds };
			await this.#setStoryConfig({ tags });
		} else if (ref === "scene") {
			const config = this.#sceneConfig;
			const tags = [...(config.tags || [])];
			const limitIdx = tags.findIndex((t) => t.id === limitId);
			if (limitIdx === -1) return;
			const statusIds = reorderInStatusIds(tags, limitIdx);
			if (!statusIds) return;
			tags[limitIdx] = { ...tags[limitIdx], statusIds };
			await this.#setSceneConfig({ tags });
		} else {
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			if (actor.type === "challenge") {
				const limits = foundry.utils.deepClone(actor.system.limits || []);
				const limit = limits.find(
					(l) => l.name === this.#findTag(ref, limitId)?.name,
				);
				if (!limit) return;
				const statusIds = [...(limit.statusIds || [])];
				const srcIdx = statusIds.indexOf(sourceStatusId);
				const tgtIdx = statusIds.indexOf(targetStatusId);
				if (srcIdx === -1 || tgtIdx === -1) return;
				statusIds.splice(srcIdx, 1);
				const newTgtIdx = statusIds.indexOf(targetStatusId);
				const effectLookup = (id) => {
					const e = actor.effects.get(id);
					return e ? { type: e.flags?.["litm-rn"]?.type || "tag" } : null;
				};
				const sourceTag = effectLookup(sourceStatusId);
				const targetTag = effectLookup(targetStatusId);
				if (sourceTag && targetTag && sourceTag.type !== targetTag.type) {
					const firstOfType = statusIds.findIndex(
						(id) => effectLookup(id)?.type === sourceTag.type,
					);
					const lastOfType = statusIds.findLastIndex(
						(id) => effectLookup(id)?.type === sourceTag.type,
					);
					if (insertBefore) {
						const insertIdx =
							firstOfType === -1 ? statusIds.length : firstOfType;
						statusIds.splice(insertIdx, 0, sourceStatusId);
					} else {
						const insertIdx = lastOfType === -1 ? 0 : lastOfType + 1;
						statusIds.splice(insertIdx, 0, sourceStatusId);
					}
				} else {
					statusIds.splice(
						insertBefore ? newTgtIdx : newTgtIdx + 1,
						0,
						sourceStatusId,
					);
				}
				limit.statusIds = statusIds;
				await actor.update({ "system.limits": limits });
			}
		}
	}

	async #removeStatusFromLimits(ref, statusId) {
		if (ref === "story") {
			const config = this.#storyConfig;
			const tags = [...(config.tags || [])];
			let changed = false;
			for (let i = 0; i < tags.length; i++) {
				if (tags[i].type === "limit" && tags[i].statusIds?.includes(statusId)) {
					tags[i] = {
						...tags[i],
						statusIds: tags[i].statusIds.filter((id) => id !== statusId),
					};
					changed = true;
				}
			}
			if (changed) await this.#setStoryConfig({ tags });
		} else if (ref === "scene") {
			const config = this.#sceneConfig;
			const tags = [...(config.tags || [])];
			let changed = false;
			for (let i = 0; i < tags.length; i++) {
				if (tags[i].type === "limit" && tags[i].statusIds?.includes(statusId)) {
					tags[i] = {
						...tags[i],
						statusIds: tags[i].statusIds.filter((id) => id !== statusId),
					};
					changed = true;
				}
			}
			if (changed) await this.#setSceneConfig({ tags });
		} else {
			const actor = this.#resolveActor(ref);
			if (!actor || !actor.isOwner) return;
			if (actor.type === "challenge") {
				const limits = foundry.utils.deepClone(actor.system.limits || []);
				let changed = false;
				for (const limit of limits) {
					if (limit.statusIds?.includes(statusId)) {
						limit.statusIds = limit.statusIds.filter((id) => id !== statusId);
						changed = true;
					}
				}
				if (changed) await actor.update({ "system.limits": limits });
			} else {
				const limits = actor.effects.filter(
					(e) => e.flags?.["litm-rn"]?.type === "limit",
				);
				const updates = [];
				for (const e of limits) {
					if (e.flags["litm-rn"].statusIds?.includes(statusId)) {
						updates.push({
							_id: e.id,
							flags: {
								["litm-rn"]: {
									statusIds: e.flags["litm-rn"].statusIds.filter(
										(id) => id !== statusId,
									),
								},
							},
						});
					}
				}
				if (updates.length)
					await actor.updateEmbeddedDocuments("ActiveEffect", updates);
			}
		}
	}

	// ── Limit status management ──

	/** Find the index where sourceTag should be inserted to maintain type order (statuses, tags, mights) */
	#findTypeOrderedIndex(statusIds, sourceType, tagLookup) {
		return statusIds.findIndex((id) => {
			const t = tagLookup(id);
			return t && compareTagTypes({ type: sourceType }, { type: t.type }) < 0;
		});
	}

	async #addStatusToLimit(sourceRef, sourceId, limitRef, limitId) {
		// Source must be a status, tag, or might tag
		const sourceTag = this.#findTag(sourceRef, sourceId);
		if (
			!sourceTag ||
			(sourceTag.type !== "status" &&
				sourceTag.type !== "tag" &&
				sourceTag.type !== "might")
		)
			return;

		// Limit must be same ref (same config/actor)
		if (sourceRef !== limitRef) return;

		if (sourceRef === "story") {
			const config = this.#storyConfig;
			const tags = [...(config.tags || [])];
			const limitIdx = tags.findIndex((t) => t.id === limitId);
			if (limitIdx === -1) return;
			const limit = tags[limitIdx];
			if (limit.type !== "limit") return;
			const statusIds = [...(limit.statusIds || [])];
			if (statusIds.includes(sourceId)) return;
			const insertIdx = this.#findTypeOrderedIndex(
				statusIds,
				sourceTag.type,
				(id) => tags.find((t) => t.id === id),
			);
			statusIds.splice(
				insertIdx === -1 ? statusIds.length : insertIdx,
				0,
				sourceId,
			);
			tags[limitIdx] = { ...limit, statusIds };
			// Remove from any other limit in same config
			for (let i = 0; i < tags.length; i++) {
				if (i === limitIdx) continue;
				if (tags[i].type === "limit" && tags[i].statusIds?.includes(sourceId)) {
					tags[i] = {
						...tags[i],
						statusIds: tags[i].statusIds.filter((id) => id !== sourceId),
					};
				}
			}
			await this.#setStoryConfig({ tags });
		} else if (sourceRef === "scene") {
			const config = this.#sceneConfig;
			const tags = [...(config.tags || [])];
			const limitIdx = tags.findIndex((t) => t.id === limitId);
			if (limitIdx === -1) return;
			const limit = tags[limitIdx];
			if (limit.type !== "limit") return;
			const statusIds = [...(limit.statusIds || [])];
			if (statusIds.includes(sourceId)) return;
			const insertIdx = this.#findTypeOrderedIndex(
				statusIds,
				sourceTag.type,
				(id) => tags.find((t) => t.id === id),
			);
			statusIds.splice(
				insertIdx === -1 ? statusIds.length : insertIdx,
				0,
				sourceId,
			);
			tags[limitIdx] = { ...limit, statusIds };
			// Remove from any other limit in same config
			for (let i = 0; i < tags.length; i++) {
				if (i === limitIdx) continue;
				if (tags[i].type === "limit" && tags[i].statusIds?.includes(sourceId)) {
					tags[i] = {
						...tags[i],
						statusIds: tags[i].statusIds.filter((id) => id !== sourceId),
					};
				}
			}
			await this.#setSceneConfig({ tags });
		} else {
			// Actor limits
			const actor = this.#resolveActor(sourceRef);
			if (!actor || !actor.isOwner) return;
			if (actor.type === "challenge") {
				const limits = foundry.utils.deepClone(actor.system.limits || []);
				const limitIdx = limits.findIndex(
					(l) => l.name === this.#findTag(limitRef, limitId)?.name,
				);
				if (limitIdx === -1) return;
				const statusIds = [...(limits[limitIdx].statusIds || [])];
				if (statusIds.includes(sourceId)) return;
				const effectLookup = (id) => {
					const e = actor.effects.get(id);
					return e ? { type: e.flags?.["litm-rn"]?.type || "tag" } : null;
				};
				const insertIdx = this.#findTypeOrderedIndex(
					statusIds,
					sourceTag.type,
					effectLookup,
				);
				statusIds.splice(
					insertIdx === -1 ? statusIds.length : insertIdx,
					0,
					sourceId,
				);
				limits[limitIdx].statusIds = statusIds;
				// Remove from any other limit
				for (let i = 0; i < limits.length; i++) {
					if (i === limitIdx) continue;
					limits[i].statusIds = (limits[i].statusIds || []).filter(
						(id) => id !== sourceId,
					);
				}
				await actor.update({ "system.limits": limits });
			} else {
				// Character/other actor limits are ActiveEffects
				const limits = actor.effects.filter(
					(e) => e.flags?.["litm-rn"]?.type === "limit",
				);
				const limitEffect = limits.find((e) => e.id === limitId);
				if (!limitEffect) return;
				const flagStatusIds = [
					...(limitEffect.flags["litm-rn"].statusIds || []),
				];
				if (flagStatusIds.includes(sourceId)) return;
				const effectLookup = (id) => {
					const e = actor.effects.get(id);
					return e ? { type: e.flags?.["litm-rn"]?.type || "tag" } : null;
				};
				const insertIdx = this.#findTypeOrderedIndex(
					flagStatusIds,
					sourceTag.type,
					effectLookup,
				);
				flagStatusIds.splice(
					insertIdx === -1 ? flagStatusIds.length : insertIdx,
					0,
					sourceId,
				);
				const updates = [
					{
						_id: limitId,
						flags: { ["litm-rn"]: { statusIds: flagStatusIds } },
					},
				];
				// Remove from any other limit effect
				for (const e of limits) {
					if (e.id === limitId) continue;
					if (e.flags["litm-rn"].statusIds?.includes(sourceId)) {
						updates.push({
							_id: e.id,
							flags: {
								["litm-rn"]: {
									statusIds: e.flags["litm-rn"].statusIds.filter(
										(id) => id !== sourceId,
									),
								},
							},
						});
					}
				}
				await actor.updateEmbeddedDocuments("ActiveEffect", updates);
			}
		}
	}

	#findTag(ref, tagId) {
		if (ref === "story") {
			return (this.#storyConfig.tags || []).find((t) => t.id === tagId) || null;
		}
		if (ref === "scene") {
			return (this.#sceneConfig.tags || []).find((t) => t.id === tagId) || null;
		}
		if (ref === "fellowship") {
			const item = game.items?.get(this.#getSelectedFellowship());
			if (!item) return null;
			const tag = item.system.allTags.find((entry) => entry.id === tagId);
			return tag?.toObject?.() ?? (tag ? { ...tag } : null);
		}
		if (ref?.startsWith("story-theme-")) {
			const item = game.items?.get(ref.slice("story-theme-".length));
			if (!item) return null;
			return (
				item.system.allTags.find((tag) => tag.id === tagId)?.toObject() ?? null
			);
		}
		const actor = this.#resolveActor(ref);
		if (!actor) return null;
		if (tagId.startsWith("_limit_")) {
			const idx = Number.parseInt(tagId.slice(7), 10);
			const limit = actor.system?.limits?.[idx];
			if (!limit) return null;
			return { ...limit, type: "limit", id: tagId };
		}
		const effect = actor.effects.get(tagId);
		if (!effect) return null;
		const flags = effect.flags["litm-rn"] || {};
		return {
			id: effect.id,
			name: effect.name,
			type: flags.type || "tag",
			values: flags.values,
			value: flags.value,
			isScratched: flags.isScratched,
			isHindering: flags.isHindering || false,
			isCrispy: flags.isCrispy || false,
			isPrivate: flags.isPrivate || false,
		};
	}

	// ── Tag reorder ──

	async #reorderTag(sourceRef, sourceId, targetRef, targetId, insertBefore) {
		// Only reorder within same ref (same config/actor)
		if (sourceRef !== targetRef) return;
		// Can't reorder fellowship power/weakness tags
		if (sourceRef === "fellowship") return;

		const reorderInTags = (tags) => {
			const sourceIdx = tags.findIndex((t) => t.id === sourceId);
			const targetIdx = tags.findIndex((t) => t.id === targetId);
			if (sourceIdx === -1 || targetIdx === -1) return tags;

			const sourceTag = tags[sourceIdx];
			const targetTag = tags[targetIdx];

			// Remove source first
			tags.splice(sourceIdx, 1);
			const adjustedTargetIdx = tags.findIndex((t) => t.id === targetId);

			if (sourceTag.type === targetTag.type) {
				// Same type → insert before target at gap position
				tags.splice(
					insertBefore ? adjustedTargetIdx : adjustedTargetIdx + 1,
					0,
					sourceTag,
				);
			} else {
				// Different type → find beginning/end of source's type group
				const firstOfType = tags.findIndex((t) => t.type === sourceTag.type);
				const lastOfType = tags.findLastIndex((t) => t.type === sourceTag.type);
				if (insertBefore) {
					// Dragged upward → place at beginning of same-type group
					const insertIdx = firstOfType === -1 ? tags.length : firstOfType;
					tags.splice(insertIdx, 0, sourceTag);
				} else {
					// Dragged downward → place at end of same-type group
					const insertIdx = lastOfType === -1 ? 0 : lastOfType + 1;
					tags.splice(insertIdx, 0, sourceTag);
				}
			}
			return tags;
		};

		if (sourceRef === "story") {
			const config = this.#storyConfig;
			const tags = reorderInTags([...(config.tags || [])]);
			await this.#setStoryConfig({ tags });
		} else if (sourceRef === "scene") {
			const config = this.#sceneConfig;
			const tags = reorderInTags([...(config.tags || [])]);
			await this.#setSceneConfig({ tags });
		} else {
			// Actor tags: reorder ActiveEffects (same actor only)
			const actor = this.#resolveActor(sourceRef);
			if (!actor || !actor.isOwner) return;
			const effects = [...actor.effects];
			const sourceIdx = effects.findIndex((e) => e.id === sourceId);
			const targetIdx = effects.findIndex((e) => e.id === targetId);
			if (sourceIdx === -1 || targetIdx === -1) return;

			const [effect] = effects.splice(sourceIdx, 1);
			const newTargetIdx = effects.findIndex((e) => e.id === targetId);
			effects.splice(insertBefore ? newTargetIdx : newTargetIdx + 1, 0, effect);

			// Update sort values
			const updates = effects.map((e, i) => ({ _id: e.id, sort: i }));
			await actor.updateEmbeddedDocuments("ActiveEffect", updates);
		}
	}

	// ── Actor reorder ──

	async #reorderStoryTheme(sourceId, targetId, event, targetBlock) {
		const ids = [...(this.#storyConfig.storyThemeIds || [])];
		const sourceIndex = ids.indexOf(sourceId);
		if (sourceIndex < 0) return;
		const [moved] = ids.splice(sourceIndex, 1);
		let targetIndex = ids.indexOf(targetId);
		if (targetIndex < 0) return;
		const rect = targetBlock.getBoundingClientRect();
		if (event.clientY >= rect.top + rect.height / 2) targetIndex++;
		ids.splice(targetIndex, 0, moved);
		await this.#setStoryConfig({ storyThemeIds: ids });
	}

	"open-camp"() {
		if (!game.user.isGM) return;
		const id = this.#getSelectedFellowship();
		if (id) game.litm?.CampDialog?.launch?.(id);
	}

	async "decrease-status"(event, target, { ref, id }) {
		if (!ref || !id) return;
		const tag = this.#findTag(ref, id);
		const values = [...(tag?.values || [])];
		const highest = values.findLastIndex((value) => !!value);
		if (highest <= 0) return this["remove-tag"](null, null, { ref, id });
		const shifted = new Array(Math.max(6, values.length)).fill(null);
		for (let index = 1; index < values.length; index += 1) {
			if (values[index]) shifted[index - 1] = index;
		}
		await this.#toggleTag(ref, id, (current) => ({
			...current,
			values: shifted,
			value: highest,
		}));
	}

	async #reorderActor(sourceRef, targetRef, section, event, targetBlock) {
		if (sourceRef === targetRef) return;
		const insertBefore = (() => {
			const rect = targetBlock.getBoundingClientRect();
			return event.clientY < rect.top + rect.height / 2;
		})();

		if (section === "scene") {
			// Scene actors — stored as objects { ref, hidden } in sceneConfig.actors
			const config = this.#sceneConfig;
			const actors = [...(config.actors || [])];
			const srcIdx = actors.findIndex((a) => a.ref === sourceRef);
			if (srcIdx === -1) return;
			const [moved] = actors.splice(srcIdx, 1);
			let tgtIdx = actors.findIndex((a) => a.ref === targetRef);
			if (tgtIdx === -1) return;
			if (!insertBefore) tgtIdx++;
			actors.splice(tgtIdx, 0, moved);
			await this.#setSceneConfig({ actors });
		} else if (section === "fellowship") {
			// Fellowship actors — order stored in storyConfig.fellowshipActorOrder
			const config = this.#storyConfig;
			const order = [...(config.fellowshipActorOrder || [])];
			// Ensure all current fellowship members are in the order array
			const allMembers = getFellowshipActors(this.#getSelectedFellowship()).map(
				(actor) => actor.uuid,
			);
			for (const ref of allMembers) {
				if (!order.includes(ref)) order.push(ref);
			}
			const srcIdx = order.indexOf(sourceRef);
			if (srcIdx === -1) return;
			order.splice(srcIdx, 1);
			let tgtIdx = order.indexOf(targetRef);
			if (tgtIdx === -1) return;
			if (!insertBefore) tgtIdx++;
			order.splice(tgtIdx, 0, sourceRef);
			await this.#setStoryConfig({ fellowshipActorOrder: order });
		} else {
			// Story actors (section === "actors") — stored as strings in storyConfig.actors
			const config = this.#storyConfig;
			const actors = [...(config.actors || [])];
			const srcIdx = actors.indexOf(sourceRef);
			if (srcIdx === -1) return;
			actors.splice(srcIdx, 1);
			let tgtIdx = actors.indexOf(targetRef);
			if (tgtIdx === -1) return;
			if (!insertBefore) tgtIdx++;
			actors.splice(tgtIdx, 0, sourceRef);
			await this.#setStoryConfig({ actors });
		}
	}

	/** Build a tag definition from drag data (from story-tags app) */
	#buildTagFromDrop(data, event) {
		return {
			id: foundry.utils.randomID(),
			name: data.name || data.label || "Tag",
			type: data.type,
			isScratched: false,
			isHindering: false,
			isCrispy: false,
			isPrivate: createPrivate(event),
			values:
				data.values ||
				(data.type === "status" ? new Array(6).fill(null) : undefined),
			value:
				data.value ??
				(data.type === "might" ? 3 : data.type === "limit" ? null : undefined),
			statusIds: data.type === "limit" ? [] : undefined,
		};
	}

	/** Build ActiveEffect data for a tag dropped onto an actor */
	#buildTagEffectData(data, event) {
		return {
			name: data.name || data.label || "Tag",
			img: data.img || "icons/svg/dice-black.svg",
			flags: {
				"litm-rn": {
					type: data.type,
					isScratched: false,
					isHindering: false,
					isCrispy: false,
					isPrivate: createPrivate(event),
					values:
						data.values ||
						(data.type === "status" ? new Array(6).fill(null) : undefined),
					value:
						data.value ??
						(data.type === "might"
							? 3
							: data.type === "limit"
								? null
								: undefined),
					statusIds: data.type === "limit" ? [] : undefined,
				},
			},
		};
	}

	// ── Lifecycle ──

	#hooksInitialized = false;
	#mainHookIds = [];
	#sceneHookId = null;

	_onActivate() {
		// Hooks are registered in _onRender to support pop-out without sidebar activation
	}

	_onDeactivate() {
		// Keep hooks and socket alive so pop-out continues to receive updates
		if (this.#resizeObserver) {
			this.#resizeObserver.disconnect();
			this.#resizeObserver = null;
		}
	}

	async close(options) {
		if (game.litm?._tmPopOut === this) game.litm._tmPopOut = null;
		return super.close(options);
	}
}
