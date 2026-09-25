import { getRollRote } from "../item/rote/rote-roll.js";
import { Sockets } from "../system/sockets.js";
import {
	dispatch,
	getActorFellowshipId,
	getFellowshipActors,
	getOwningDocument,
	getOwningWindow,
	localize as t,
} from "../utils.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { fromUuidSync } = foundry.utils;

const isSceneSelectionRef = (ref) =>
	ref === "scene" || ref?.startsWith("scene:");
const getSceneForSelectionRef = (ref) => {
	if (ref?.startsWith("scene:"))
		return game.scenes?.get(ref.slice("scene:".length)) ?? null;
	return ref === "scene" ? canvas.scene : null;
};
const currentSceneSelectionRef = () =>
	canvas.scene?.id ? `scene:${canvas.scene.id}` : "scene";
const hasVisibleRoteHTML = (value) => {
	if (!value?.trim()) return false;
	const container = document.createElement("div");
	container.innerHTML = value;
	return Boolean(
		container.textContent?.trim() ||
			container.querySelector(
				"img, svg, video, audio, iframe, canvas, object, embed",
			),
	);
};

export class LitmRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
	static #instances = new Set();

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--roll"],
		position: { width: 900, height: 700 },
		window: {
			resizable: true,
		},
		form: { submitOnChange: false },
	};

	static PARTS = {
		main: { template: "systems/litm-rn/templates/apps/roll-dialog.html" },
	};

	static create({ actorId, speaker, shouldRoll, type, title, id }) {
		return new LitmRollDialog(actorId, {
			speaker,
			shouldRoll,
			type,
			title,
			id,
		});
	}

	// ── Preserve scroll across re-renders ──

	async render(options) {
		LitmRollDialog.#instances.add(this);
		this.#registerUpdateHooks();
		game.tooltip?.deactivate?.();
		const scrollEl =
			this.element?.querySelector(".litm--roll-columns") ||
			this.element?.querySelector(".litm--roll-tab-body");
		const saved = scrollEl
			? { top: scrollEl.scrollTop, left: scrollEl.scrollLeft }
			: null;
		const result = await super.render(options);
		const titleElement = this.element?.querySelector(".window-title");
		if (titleElement) titleElement.textContent = this.title;
		if (saved) {
			const el =
				this.element?.querySelector(".litm--roll-columns") ||
				this.element?.querySelector(".litm--roll-tab-body");
			if (el) {
				el.scrollTop = saved.top;
				el.scrollLeft = saved.left;
			}
		}
		return result;
	}

	/** Open the GM roll dialog with tabs for all fellowship characters, or toggle if already open */
	static toggleGmDialog(fellowshipId) {
		if (!game.user.isGM) return;
		if (game.litm?.gmRollDialog?.rendered) {
			game.litm.gmRollDialog.close();
			game.litm.gmRollDialog = null;
			return;
		}
		let selectedFellowshipId = fellowshipId;
		if (!selectedFellowshipId) {
			try {
				selectedFellowshipId = game.settings.get(
					"litm-rn",
					"selectedFellowship",
				);
			} catch (_) {}
		}
		if (!selectedFellowshipId) {
			// Fallback: find the first character with any fellowship
			const first = game.actors?.find(
				(a) => a.type === "character" && a.system?.fellowshipId,
			);
			if (first) selectedFellowshipId = first.system.fellowshipId;
		}
		if (!selectedFellowshipId) {
			ui.notifications.warn("Litm.ui.choose-fellowship-hint", {
				localize: true,
			});
			return;
		}
		const member = game.actors?.find(
			(a) =>
				a.type === "character" &&
				a.system?.fellowshipId === selectedFellowshipId,
		);
		if (!member) {
			ui.notifications.warn("Litm.ui.warn-no-character", { localize: true });
			return;
		}
		this.openForGm(member.id);
	}

	static roll({
		actorId,
		tags = [],
		title,
		type,
		rollTypeLabel = "",
		speaker,
		modifier = 0,
		might = 0,
		tradeMode = "",
		participants = null,
		fellowshipId = null,
		sacrifice = null,
		isGroup = false,
		campBonus = 0,
		campLabel = "",
		campFellowshipId = null,
		isCampAction = false,
		rote = null,
	}) {
		const {
			burntTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			crispyTags,
			heroWeaknessTags,
		} = LitmRollDialog.#filterTags(tags);

		const {
			burntValue,
			powerValue,
			weaknessValue,
			positiveStatusValue,
			negativeStatusValue,
			totalPower,
		} = game.litm.methods.calculatePower({
			burntTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			crispyTags,
			heroWeaknessTags,
			modifier: Number(modifier) || 0,
			might: Number(might) || 0,
		});

		let spendPower = totalPower;
		let rollPower = totalPower;
		let tradeModifier = 0;
		if (type === "tracked" && tradeMode === "caution") {
			tradeModifier = -1;
			rollPower = totalPower - 1;
			spendPower = Math.max(totalPower, 1) + 1;
		} else if (type === "tracked" && tradeMode === "hedge") {
			tradeModifier = 1;
			rollPower = totalPower + 1;
			spendPower = Math.max(totalPower - 1, 1);
		}

		const formula =
			type === "sacrifice"
				? "2d6 + @modifier"
				: typeof CONFIG.litm.roll.formula === "function"
					? CONFIG.litm.roll.formula({
							burntTags,
							powerTags,
							weaknessTags,
							positiveStatuses,
							negativeStatuses,
							crispyTags,
							heroWeaknessTags,
							burntValue,
							powerValue,
							weaknessValue,
							positiveStatusValue,
							negativeStatusValue,
							totalPower: rollPower,
							actorId,
							type,
							title,
							modifier,
							might,
							tradeMode,
							tradeModifier,
						})
					: CONFIG.litm.roll.formula ||
						"2d6 + (@burntValue + @powerValue + @positiveStatusValue - @weaknessValue - @negativeStatusValue + @modifier + @might + @tradeModifier)";

		// Calculate per-participant power breakdown
		if (participants) {
			for (const p of participants) {
				const pf = LitmRollDialog.#filterTags(p.tags);
				const pp = game.litm.methods.calculatePower({
					burntTags: pf.burntTags,
					powerTags: pf.powerTags,
					weaknessTags: pf.weaknessTags,
					positiveStatuses: pf.positiveStatuses,
					negativeStatuses: pf.negativeStatuses,
					crispyTags: pf.crispyTags,
					heroWeaknessTags: pf.heroWeaknessTags,
					modifier: 0,
					might: 0,
				});
				p.burntValue = pp.burntValue;
				p.powerValue = pp.powerValue;
				p.weaknessValue = pp.weaknessValue;
				p.positiveStatusValue = pp.positiveStatusValue;
				p.negativeStatusValue = pp.negativeStatusValue;
				p.subtotal = pp.totalPower;
				// Add categorized sub-arrays for display
				p.burntTags = pf.burntTags;
				p.powerTags = pf.powerTags;
				p.weaknessTags = pf.weaknessTags;
				p.positiveStatuses = pf.positiveStatuses;
				p.negativeStatuses = pf.negativeStatuses;
			}
		}

		const roll = new game.litm.LitmRoll(
			formula,
			{
				burntValue,
				powerValue,
				positiveStatusValue,
				weaknessValue,
				negativeStatusValue,
				modifier: Number(modifier) || 0,
				might: Number(might) || 0,
				tradeModifier,
				tradeMode,
			},
			{
				actorId,
				title,
				type,
				rollTypeLabel,
				burntTags,
				powerTags,
				weaknessTags,
				positiveStatuses,
				negativeStatuses,
				crispyTags,
				heroWeaknessTags,
				speaker,
				totalPower: rollPower,
				spendPower,
				modifier,
				displayModifier: (Number(modifier) || 0) - (Number(campBonus) || 0),
				campBonus: Number(campBonus) || 0,
				campLabel,
				campFellowshipId,
				isCampAction,
				might,
				tradeMode,
				participants,
				fellowshipId,
				sceneId: canvas.scene?.id ?? null,
				rollId: foundry.utils.randomID(),
				sacrifice,
				isGroup,
				rote: isGroup ? null : rote,
			},
		);

		const flavor =
			rollTypeLabel ||
			(type === "sacrifice"
				? t("Litm.ui.subtab-sacrifice")
				: type === "reaction" || type === "mitigate"
					? t("Litm.ui.roll-reaction")
					: type === "tracked"
						? t("Litm.ui.roll-tracked")
						: t("Litm.ui.roll-quick"));

		return roll
			.toMessage({
				speaker,
				flavor,
				...(isCampAction
					? { flags: { "litm-rn": { campAction: { method: "roll" } } } }
					: {}),
			})
			.then(async (res) => {
				Sockets.dispatch("clearRollApproval", { actorId });
				if (game.user.isGM) {
					const report = await game.litm.LitmRoll.postRollProcessing(roll);
					if (report?.failed > 0) {
						ui.notifications.warn(t("Litm.ui.post-roll-partial-failure"));
					}
				} else {
					Sockets.requestPostRollProcessing({
						...roll.litm,
						_total: roll.total,
						_outcome: roll.outcome?.label ?? null,
					});
				}
				if (fellowshipId) game.litm?.resetGroupRollSelections?.(fellowshipId);
				const actor = res.rolls[0]?.actor ?? game.actors.get(actorId);
				actor?.sheet.resetRollDialog();
				const gmDialog = game.litm?.gmRollDialog;
				if (
					gmDialog instanceof LitmRollDialog &&
					gmDialog.actorId === actorId
				) {
					await gmDialog.reset();
				}
				Sockets.dispatch("resetRollDialog", { actorId });
				return res;
			});
	}

	static calculatePower(tags) {
		const burntValue = tags.burntTags.length * 3;
		const powerValue = tags.powerTags.length;
		const weaknessValue = tags.weaknessTags.length;

		const positiveStatusValue = tags.positiveStatuses.reduce(
			(a, t) => a + (Number.parseInt(t.value) || 0),
			0,
		);
		const negativeStatusValue = tags.negativeStatuses.reduce(
			(a, t) => a + (Number.parseInt(t.value) || 0),
			0,
		);
		const modifier = Number(tags.modifier) || 0;
		const might = Number(tags.might) || 0;

		const totalPower =
			burntValue +
			powerValue +
			positiveStatusValue -
			weaknessValue -
			negativeStatusValue +
			modifier +
			might;

		return {
			burntValue,
			powerValue,
			weaknessValue,
			positiveStatusValue,
			negativeStatusValue,
			totalPower,
			modifier,
			might,
		};
	}

	static #filterTags(tags) {
		const burntTags = tags.filter((t) => t.state === "burned");
		const powerTags = tags.filter(
			(t) =>
				t.type &&
				t.type !== "crispy" &&
				t.type !== "status" &&
				t.type !== "might" &&
				t.type !== "limit" &&
				t.state === "positive",
		);
		const weaknessTags = tags.filter(
			(t) =>
				t.type !== "status" &&
				t.type !== "might" &&
				t.type !== "limit" &&
				t.state === "negative",
		);
		const crispyTags = tags.filter(
			(t) =>
				t.type === "crispy" ||
				t.type === "hero" ||
				t.type === "powerCrispy" ||
				t.type === "themeCrispy" ||
				t.isCrispy,
		);
		const heroWeaknessTags = tags.filter(
			(t) => t.type === "hero" && t.state === "negative",
		);
		const positiveStatuses = tags.filter(
			(t) =>
				(t.type === "status" || t.type === "might") && t.state === "positive",
		);
		const negativeStatuses = tags.filter(
			(t) =>
				(t.type === "status" || t.type === "might") && t.state === "negative",
		);

		return {
			burntTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			crispyTags,
			heroWeaknessTags,
		};
	}

	/** @type {Map<string, object>} Per-actor state (modifier, might, tradeMode); tabs/subtabs are global */
	static #actorStates = new Map();

	_modifier = 0;
	_might = 0;
	_tradeMode = "";
	_currentTab = "quick";
	_sourceTab = "hero";
	_tooltipEl = null;
	_roteTooltipEls = [];
	_sacrificeSyncTimeout = null;
	_storyTagsHookId = null;
	_subtab = ""; // "" | "sacrifice" | "reaction"
	_sacrifice = {
		level: "painful",
		themeId: "",
		statusName: "",
		achievement: "",
		state: "draft",
		proposerId: "",
	};
	_rollApproval = { state: "draft", power: null, userId: "" };
	_selectedRoteKey = "";
	_roteCandidates = [];

	constructor(actorId, options = {}) {
		const {
			speaker,
			shouldRoll,
			type,
			title: _legacyTitle,
			id,
			camp,
			...appOptions
		} = options;
		void _legacyTitle;
		super(appOptions);

		this.actorId = actorId;
		this.speaker =
			speaker ||
			CONFIG.ChatMessage.documentClass.getSpeaker({ actor: this.actor });
		this.type = type || "quick";
		this.camp = camp || null;
		LitmRollDialog.#instances.add(this);
		if (this.camp) {
			this._currentTab = "detailed";
			this._sourceTab = "hero";
		}

		this.#registerUpdateHooks();
	}

	#registerUpdateHooks() {
		if (this._storyTagsHookId == null) {
			this._storyTagsHookId = Hooks.on("litmStoryTagsUpdated", () => {
				if (this.rendered) this.render({ force: true });
			});
		}
		if (this._selectionHookId == null) {
			this._selectionHookId = Hooks.on("litmRollSelectionUpdated", () => {
				if (this.rendered) this.render({ force: true });
			});
		}
		if (this._roteHookId == null) {
			this._roteHookId = Hooks.on("litmRoteRollUpdated", () => {
				if (this.rendered) this.render({ force: true });
			});
		}
	}

	async close(options) {
		this.#saveState();
		clearTimeout(this._sacrificeSyncTimeout);
		game.tooltip?.deactivate?.();
		this._cleanupTooltip();
		this.#cleanupRoteTooltips();
		if (this._storyTagsHookId !== undefined) {
			Hooks.off("litmStoryTagsUpdated", this._storyTagsHookId);
			this._storyTagsHookId = undefined;
		}
		if (this._selectionHookId !== undefined) {
			Hooks.off("litmRollSelectionUpdated", this._selectionHookId);
			this._selectionHookId = undefined;
		}
		if (this._roteHookId !== undefined) {
			Hooks.off("litmRoteRollUpdated", this._roteHookId);
			this._roteHookId = undefined;
		}
		LitmRollDialog.#instances.delete(this);
		return super.close(options);
	}

	/** Route a remote state update to every matching roll-dialog instance. */
	static receiveRemoteUpdate(data) {
		let matched = 0;
		for (const dialog of this.#instances) {
			if (dialog.actorId !== data.actorId && dialog !== game.litm?.gmRollDialog)
				continue;
			if (Boolean(dialog.camp) !== Boolean(data.camp)) continue;
			if (
				data.camp &&
				(dialog.camp?.sessionId !== data.camp.sessionId ||
					dialog.camp?.phaseIndex !== data.camp.phaseIndex)
			)
				continue;
			dialog.receiveUpdate(data);
			matched += 1;
		}
		return matched;
	}

	get title() {
		const base = t("Litm.ui.roll-title");
		return `${base}: ${this.rollTypeLabel}`;
	}

	/** Return the localized label for the currently selected roll type. */
	get rollTypeLabel() {
		if (this.camp) return t("Litm.camp.roll-label");
		if (this._subtab === "sacrifice") return t("Litm.ui.subtab-sacrifice");
		if (this._subtab === "reaction") return t("Litm.ui.subtab-reaction");
		if (this._currentTab === "group") return t("Litm.ui.roll-group");
		if (this._currentTab === "detailed" || this.type === "tracked")
			return t("Litm.ui.roll-tracked");
		return t("Litm.ui.roll-quick");
	}

	get actor() {
		return game.actors.get(this.actorId);
	}

	/** Returns the actor's selection Map: Map<ref, Map<tagId, string>> */
	#getSelection() {
		return game.litm?.rollSelection?.get(this.actorId) ?? new Map();
	}

	/** Returns the tagId→state Map for a given ref within this actor's selection */
	#getRefMap(ref) {
		return this.#getSelection().get(ref) ?? new Map();
	}

	/** Returns the GM's ref map: Map<tagId, string> */
	#getGmRefMap(ref) {
		if (!game.user.isGM || !game.litm?.gmRollSelection) return new Map();
		return game.litm.gmRollSelection.get(game.user.id)?.get(ref) ?? new Map();
	}

	/** Gets state for a tag in its ref, or empty string */
	#tagState(id, ref) {
		return this.#getRefMap(ref).get(id) || "";
	}

	/** Gets GM's state for a tag in its ref, or empty string */
	#gmTagState(id, ref) {
		return this.#getGmRefMap(ref).get(id) || "";
	}

	/** Returns states string for a tag type (matches old #getTagStates) */
	#statesForType(type, toBurn, isHindering, isCrispy) {
		const stripBurned = (states) =>
			isCrispy ? states.replace(",burned", "") : states;
		switch (type) {
			case "themeCrispy":
			case "powerCrispy":
				return { state: "positive", states: ",positive" };
			case "powerTag":
			case "themeTag":
				return {
					state: toBurn ? "burned" : "positive",
					states: stripBurned(",positive,burned"),
				};
			case "weaknessTag":
			case "weaknessStoryTag":
				return { state: "negative", states: ",negative" };
			case "crispy":
			case "hero":
				return { state: "positive", states: ",negative,positive" };
			case "status":
			case "might":
				return {
					state: isHindering ? "negative" : "positive",
					states: ",negative,positive",
				};
			default:
				return {
					state: isHindering ? "negative" : toBurn ? "burned" : "positive",
					states: stripBurned(",negative,positive,burned"),
				};
		}
	}

	/** Enrich a tag with current roll state and states string */
	#enrichTag(tag, ref, toBurn, useGmSelection = false) {
		const state = useGmSelection
			? this.#gmTagState(tag.id, ref)
			: this.#tagState(tag.id, ref);
		const { states } = this.#statesForType(
			tag.type,
			toBurn,
			tag.isHindering,
			tag.isCrispy,
		);
		// Normalize status value
		let value = tag.value;
		if (tag.values && (tag.type === "status" || typeof value === "boolean")) {
			const lastIdx = tag.values.findLastIndex((v) => !!v);
			value = lastIdx >= 0 ? lastIdx + 1 : 0;
		}
		// Compute might value CSS class and icon URL
		let _mightValClass = "";
		let _mightIconUrl = "";
		if (tag.type === "might") {
			const mv = Number(value) || 0;
			if (mv === 0) {
				_mightValClass = "litm--might-val-origin";
				_mightIconUrl =
					"systems/litm-rn/assets/media/icons/origin-color_litm_btn_active.svg";
			} else if (mv === 6) {
				_mightValClass = "litm--might-val-greatness";
				_mightIconUrl =
					"systems/litm-rn/assets/media/icons/greatness-color_litm_btn_active.svg";
			} else {
				_mightValClass = "litm--might-val-adventure";
				_mightIconUrl =
					"systems/litm-rn/assets/media/icons/adventure-color_litm_btn_active.svg";
			}
		}
		return {
			...tag,
			value,
			state,
			states,
			_ref: ref,
			actorRef: tag.actorRef || ref,
			_mightValClass,
			_mightIconUrl,
		};
	}

	/** Resolve actor from a UUID-string ref */
	#resolveRefActor(ref) {
		let actor = game.actors.get(ref);
		if (!actor) {
			try {
				actor = fromUuidSync(ref);
			} catch (_) {
				/* no-op */
			}
		}
		if (!actor && ref.includes(":")) {
			const baseRef = ref.substring(0, ref.lastIndexOf(":"));
			try {
				actor = fromUuidSync(baseRef);
			} catch (_) {
				/* no-op */
			}
		}
		return actor;
	}

	/** Find a tag on a linked world Story Theme by its roll-selection ref. */
	#findStoryThemeTag(id, ref) {
		if (!ref?.startsWith("story-theme-")) return null;
		const item = game.items?.get(ref.slice("story-theme-".length));
		if (!item || item.type !== "story") return null;
		const system = item.system;
		const tag = system?.allTags?.find((t) => t.id === id);
		if (!tag) return null;
		const source =
			tag instanceof foundry.abstract.DataModel ? tag.toObject() : { ...tag };
		if (system.themeTag?.id === id)
			return { ...source, type: "themeTag", isHindering: false };
		if (system.powerTags?.some((t) => t.id === id))
			return { ...source, type: "powerTag", isHindering: false };
		return { ...source, type: "weaknessTag", isHindering: true };
	}

	/** Find an accepted tag shared specifically with the target actor. */
	#getSharedTag(targetActorId, tagId) {
		return game.litm?.getAcceptedSharedTag?.(targetActorId, tagId) ?? null;
	}

	/** Get all selected tags from all participants for the group tab.
	 * Returns { tags: flatTag[], participants: participantEntry[] }
	 */
	#getAllGroupTags() {
		const tags = [];
		const participants = [];
		if (!game.litm) return { tags, participants };

		// All fellowship characters
		const fellowshipId = getActorFellowshipId(this.actor);
		if (fellowshipId) {
			const allChars = getFellowshipActors(fellowshipId).filter(
				(member) => member.type === "character",
			);

			for (const char of allChars) {
				const charSel = game.litm.rollSelection?.get(char.id);
				if (!charSel) continue;
				const participantTags = [];
				for (const [ref, tagMap] of charSel) {
					if (tagMap.size === 0) continue;

					if (ref === "fellowship") {
						const fellow = char.system?.fellowship;
						const resolvedIds = new Set();
						if (fellow) {
							for (const ft of fellow.system?.allTags ?? []) {
								if (tagMap.has(ft.id)) {
									resolvedIds.add(ft.id);
									const enriched = this.#enrichTag(
										ft instanceof foundry.abstract.DataModel
											? ft.toObject()
											: { ...ft },
										ref,
									);
									enriched.state = tagMap.get(ft.id);
									enriched.actorId = char.id;
									tags.push(enriched);
									participantTags.push(enriched);
								}
							}
						}
						for (const [tagId, state] of tagMap) {
							if (resolvedIds.has(tagId)) continue;
							const sharedTag = this.#getSharedTag(char.id, tagId);
							if (!sharedTag) continue;
							const enriched = this.#enrichTag(sharedTag, ref);
							enriched.state = state;
							enriched.actorId = char.id;
							enriched.displayName = this.#maskTagName(sharedTag);
							tags.push(enriched);
							participantTags.push(enriched);
						}
					} else if (ref === "story") {
						try {
							const storyConfig =
								game.settings.get("litm-rn", "storytags") || {};
							for (const [tagId, state] of tagMap) {
								const srcTag = (storyConfig.tags || []).find(
									(t) => t.id === tagId,
								);
								if (srcTag) {
									const e = this.#enrichTag({ ...srcTag }, ref);
									e.state = state;
									e.actorId = char.id;
									tags.push(e);
									participantTags.push(e);
								}
							}
						} catch (_) {
							/* no-op */
						}
					} else if (isSceneSelectionRef(ref)) {
						try {
							const sceneConfig =
								getSceneForSelectionRef(ref)?.getFlag("litm-rn", "scenetags") ||
								{};
							for (const [tagId, state] of tagMap) {
								const srcTag = (sceneConfig.tags || []).find(
									(t) => t.id === tagId,
								);
								if (srcTag) {
									const e = this.#enrichTag({ ...srcTag }, ref);
									e.state = state;
									e.actorId = char.id;
									tags.push(e);
									participantTags.push(e);
								}
							}
						} catch (_) {
							/* no-op */
						}
					} else if (ref.startsWith("story-theme-")) {
						for (const [tagId, state] of tagMap) {
							const srcTag = this.#findStoryThemeTag(tagId, ref);
							if (!srcTag) continue;
							const e = this.#enrichTag(srcTag, ref);
							e.state = state;
							e.actorId = char.id;
							tags.push(e);
							participantTags.push(e);
						}
					} else {
						// Actor ref
						const refActor = this.#resolveRefActor(ref);
						if (!refActor) continue;
						for (const [tagId, state] of tagMap) {
							const srcTag = this.#findTagOnActor(tagId, refActor);
							if (srcTag) {
								const e = this.#enrichTag({ ...srcTag }, ref);
								e.state = state;
								e.actorId = char.id;
								tags.push(e);
								participantTags.push(e);
							}
						}
					}
				}
				if (participantTags.length > 0) {
					participants.push({
						name: char.name,
						img: char.img,
						actorId: char.id,
						tags: participantTags,
					});
				}
			}
		}

		// Fellowship participant (tags from ALL characters' fellowship refs, deduplicated)
		const fellowTags = tags.filter((t) => t._ref === "fellowship");
		const seenFellow = new Set();
		const uniqueFellow = [];
		for (const ft of fellowTags) {
			if (!seenFellow.has(ft.id)) {
				seenFellow.add(ft.id);
				uniqueFellow.push(ft);
			}
		}
		if (uniqueFellow.length > 0) {
			participants.push({
				name: game.i18n.localize("Litm.other.fellowship"),
				img: null,
				actorId: null,
				isFellowship: true,
				tags: uniqueFellow,
			});
		}

		// GM selections (any ref type) — Narrator participant
		const gmTags = [];
		if (game.litm.gmRollSelection) {
			for (const [, refMap] of game.litm.gmRollSelection) {
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) continue;
					for (const [tagId, state] of tagMap) {
						let srcTag = null;
						let ownerId = null;
						if (ref === "story") {
							try {
								const storyConfig =
									game.settings.get("litm-rn", "storytags") || {};
								srcTag = (storyConfig.tags || []).find((t) => t.id === tagId);
							} catch (_) {
								/* no-op */
							}
						} else if (isSceneSelectionRef(ref)) {
							try {
								const sceneConfig =
									getSceneForSelectionRef(ref)?.getFlag(
										"litm-rn",
										"scenetags",
									) || {};
								srcTag = (sceneConfig.tags || []).find((t) => t.id === tagId);
							} catch (_) {
								/* no-op */
							}
						} else if (ref.startsWith("story-theme-")) {
							srcTag = this.#findStoryThemeTag(tagId, ref);
						} else {
							const refActor = this.#resolveRefActor(ref);
							if (refActor) srcTag = this.#findTagOnActor(tagId, refActor);
							if (!srcTag) srcTag = this.#findTagAnywhere(tagId);
							ownerId = refActor?.id ?? null;
						}
						if (!srcTag) continue;
						const e = this.#enrichTag({ ...srcTag }, ref);
						e.state = state;
						if (ownerId) e.actorId = ownerId;
						tags.push(e);
						gmTags.push(e);
					}
				}
			}
		}
		if (gmTags.length > 0) {
			participants.push({
				name: game.i18n.localize("Litm.ui.story-column"),
				img: null,
				actorId: null,
				isGM: true,
				tags: gmTags,
			});
		}

		return { tags, participants };
	}

	/** Get all selected tags across all refs for this actor (flat array) */
	#getAllSelectedTags() {
		const tags = [];
		const sel = this.#getSelection();
		const actor = this.actor;
		if (!actor) return tags;

		for (const [ref, tagMap] of sel.entries()) {
			if (tagMap.size === 0) continue;

			if (ref === "fellowship") {
				const fellow = actor.system?.fellowship;
				const resolvedIds = new Set();
				for (const ft of fellow?.system?.allTags ?? []) {
					if (tagMap.has(ft.id)) {
						resolvedIds.add(ft.id);
						const enriched = this.#enrichTag(
							ft instanceof foundry.abstract.DataModel
								? ft.toObject()
								: { ...ft },
							ref,
						);
						enriched.state = tagMap.get(ft.id);
						tags.push(enriched);
					}
				}
				for (const [tagId, state] of tagMap) {
					if (resolvedIds.has(tagId)) continue;
					const sharedTag = this.#getSharedTag(actor.id, tagId);
					if (!sharedTag) continue;
					const enriched = this.#enrichTag(sharedTag, ref);
					enriched.state = state;
					enriched.displayName = this.#maskTagName(sharedTag);
					tags.push(enriched);
				}
			} else if (ref === "story") {
				try {
					const storyConfig = game.settings.get("litm-rn", "storytags") || {};
					for (const st of storyConfig.tags || []) {
						if (tagMap.has(st.id)) {
							const e = this.#enrichTag({ ...st }, ref);
							e.state = tagMap.get(st.id);
							tags.push(e);
						}
					}
				} catch (_) {
					/* no-op */
				}
			} else if (isSceneSelectionRef(ref)) {
				try {
					const sceneConfig =
						getSceneForSelectionRef(ref)?.getFlag("litm-rn", "scenetags") || {};
					for (const sc of sceneConfig.tags || []) {
						if (tagMap.has(sc.id)) {
							const e = this.#enrichTag({ ...sc }, ref);
							e.state = tagMap.get(sc.id);
							tags.push(e);
						}
					}
				} catch (_) {
					/* no-op */
				}
			} else if (ref === "camp" && this.camp) {
				const session = game.litm?.CampDialog?.getSession?.(
					this.camp.fellowshipId,
				);
				for (const [id, state] of tagMap.entries()) {
					const srcTag = session?.campsite?.tags?.find((tag) => tag.id === id);
					if (!srcTag) continue;
					const enriched = this.#enrichTag({ ...srcTag }, ref);
					enriched.state = state;
					tags.push(enriched);
				}
			} else if (ref.startsWith("story-theme-")) {
				for (const [id, state] of tagMap.entries()) {
					const srcTag = this.#findStoryThemeTag(id, ref);
					if (!srcTag) continue;
					const e = this.#enrichTag(srcTag, ref);
					e.state = state;
					tags.push(e);
				}
			} else {
				// Actor ref: search the resolved actor (self or another character)
				const refActor = this.#resolveRefActor(ref);
				if (!refActor) continue;
				for (const [id, state] of tagMap.entries()) {
					const srcTag = this.#findTagOnActor(id, refActor);
					if (srcTag) {
						const e = this.#enrichTag({ ...srcTag }, ref);
						e.state = state;
						tags.push(e);
					}
				}
			}
		}

		return tags;
	}

	async #rollRoteCandidates(tags, { fresh = false } = {}) {
		if (this._currentTab === "group" || this._subtab || this.camp) return [];
		const eligible = tags.filter(
			(tag) =>
				["themeTag", "powerTag"].includes(tag.type) &&
				["positive", "burned"].includes(tag.state) &&
				!tag.isScratched &&
				tag.id &&
				tag._ref,
		);
		const resolved = await Promise.all(
			eligible.map(async (tag) => {
				const rote = await getRollRote(tag._ref, tag.id, {
					fresh,
					actorId: this.actorId,
				});
				return rote
					? {
							...rote,
							tagId: tag.id,
							ref: tag._ref,
							key: `${tag._ref}::${tag.id}`,
						}
					: null;
			}),
		);
		return resolved.filter(Boolean);
	}

	async #displayRollRote(rote, { full = false } = {}) {
		const enrich = (html) =>
			foundry.applications.ux.TextEditor.implementation.enrichHTML(html || "", {
				secrets: false,
			});
		const descriptionHTML = await enrich(rote.description);
		const hasDescription = hasVisibleRoteHTML(descriptionHTML);
		const hasPowerHelping = Boolean(rote.powerHelping?.trim());
		const hasPowerHindering = Boolean(rote.powerHindering?.trim());
		const hasPower = hasPowerHelping || hasPowerHindering;
		let effects;
		let consequences;
		if (full) {
			effects = (
				await Promise.all(
					(rote.effects ?? []).map(async (effect) => ({
						...effect,
						typeLabel: t(`Litm.rote.types.${effect.type}`),
						descriptionHTML: await enrich(effect.description),
					})),
				)
			).filter((effect) => hasVisibleRoteHTML(effect.descriptionHTML));
			consequences = (
				await Promise.all(
					(rote.consequences ?? []).map((value) => enrich(value)),
				)
			).filter(hasVisibleRoteHTML);
		}
		return {
			...rote,
			selected: this._selectedRoteKey === rote.key,
			descriptionHTML: hasDescription ? descriptionHTML : "",
			...(full ? { effects, consequences } : {}),
			hasDescription,
			hasPractitioners: Boolean(rote.practitioners?.trim()),
			hasPower,
			hasPowerHelping,
			hasPowerHindering,
			hasPreview: hasDescription || hasPower,
			previewPowerHelping: hasPowerHelping ? rote.powerHelping : "—",
			previewPowerHindering: hasPowerHindering ? rote.powerHindering : "—",
		};
	}

	async #showRollRote(key) {
		const rote = this._roteCandidates.find((entry) => entry.key === key);
		if (!rote) return;
		const data = await this.#displayRollRote(rote, { full: true });
		const content = await foundry.applications.handlebars.renderTemplate(
			"systems/litm-rn/templates/apps/roll-rote-viewer.html",
			data,
		);
		const doc = getOwningDocument(this.element);
		const dark =
			doc.querySelector("#interface")?.classList.contains("theme-dark") ||
			doc.body.classList.contains("theme-dark");
		foundry.applications.api.DialogV2.wait({
			window: { title: rote.name },
			position: { width: 420 },
			classes: [
				"litm",
				"litm--roll-rote-viewer",
				dark ? "theme-dark" : "theme-light",
			],
			content,
			buttons: [
				{ action: "close", label: t("Litm.rote.close"), default: true },
			],
			rejectClose: false,
		});
	}

	async #openRollRote(key) {
		const roteData = this._roteCandidates.find((entry) => entry.key === key);
		if (!roteData) return;
		let rote = null;
		try {
			rote = await fromUuid(roteData.uuid);
		} catch (_error) {
			// The player may use a linked world Rote without Item access.
		}
		if (rote?.testUserPermission(game.user, "OWNER")) {
			rote.sheet.render({ force: true });
			return;
		}
		ui.notifications.warn(t("Litm.rote.roll-no-edit-access"));
	}

	get basePower() {
		const isGroup = this._currentTab === "group";
		const allSelected = isGroup
			? this.#getAllGroupTags().tags
			: this.#getAllSelectedTags();
		const filtered = LitmRollDialog.#filterTags(allSelected);
		const { totalPower } = LitmRollDialog.calculatePower({
			...filtered,
			modifier: this._modifier,
			might: this._might,
		});
		return totalPower + (Number(this.camp?.bonus) || 0);
	}

	get rollPower() {
		const base = this.basePower;
		if (this._tradeMode === "caution") return base - 1;
		if (this._tradeMode === "hedge") return base + 1;
		return base;
	}

	get spendPower() {
		const base = this.basePower;
		if (this._tradeMode === "caution") return Math.max(base, 1) + 1;
		if (this._tradeMode === "hedge") return Math.max(base - 1, 1);
		return base;
	}

	get canThrowCaution() {
		return this.basePower <= 2;
	}

	get canHedgeRisks() {
		return this.basePower >= 2;
	}

	get totalPower() {
		return this.rollPower;
	}

	#maskTagName(tag) {
		if (!tag.isPrivate) return tag.name;
		if (game.user.isGM) return tag.name;
		const ref = tag.actorRef || tag.actorId;
		if (ref) {
			const id = typeof ref === "string" ? ref.replaceAll("___", ".") : ref;
			let actor = game.actors.get(id);
			if (!actor) {
				try {
					const doc = fromUuidSync(id);
					if (doc?.documentName === "Token") actor = doc.actor;
					else if (doc?.documentName === "Actor") actor = doc;
				} catch (_) {
					/* no-op */
				}
			}
			if (actor?.isOwner) return tag.name;
		}
		return "???";
	}

	/** Whether a private tag should be hidden entirely from this user */
	#shouldHidePrivateTag(tag, ownerActor) {
		if (!tag.isPrivate) return false;
		if (game.user.isGM) return false;
		if (ownerActor?.isOwner) return false;
		// Fallback: check tag's own actorRef/actorId (global story/scene tags)
		const ref = tag.actorRef || tag.actorId;
		if (ref) {
			const id = typeof ref === "string" ? ref.replaceAll("___", ".") : ref;
			let actor = game.actors.get(id);
			if (!actor) {
				try {
					actor = fromUuidSync(id);
				} catch (_) {
					/* no-op */
				}
			}
			if (actor?.isOwner) return false;
		}
		return true;
	}

	/** Whether a tag is selected for the current actor's roll */
	#isTagSelectedForRoll(tagId, ref) {
		const sel = this.#getSelection();
		return sel.get(ref)?.has(tagId) ?? false;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const actor = this.actor;
		if (!actor) return context;
		const campSession = this.camp
			? game.litm?.CampDialog?.getSession?.(this.camp.fellowshipId)
			: null;
		this.#invalidateRollApproval(false);
		if (this.#clearInvalidTradeMode()) this.#saveState();

		const heroGroups = [];
		const fellowGroups = [];
		const storyGroups = [];
		const storyThemeGroups = [];

		// ── HERO COLUMN ──

		// Themes
		const allThemes = (actor.system.themes || []).filter(
			(theme) => !theme.isEmpty,
		);
		for (const theme of allThemes) {
			const ref = actor.uuid;
			const level = theme.level || "origin";
			const themeIcon = `${
				CONFIG.litm.themeicon_src?.[level] ||
				"systems/litm-rn/assets/media/icons/origin"
			}-color_litm_icn.svg`;
			const themeTag = theme.themeTag
				? this.#enrichTag({ ...theme.themeTag, type: "themeTag" }, ref)
				: null;
			if (themeTag) {
				themeTag._themeIcon = themeIcon;
				themeTag.displayName = this.#maskTagName(themeTag);
			}
			const enrichCharacterTag = (tag, type) => {
				const enriched = this.#enrichTag(
					{ ...tag, type: tag.type || type },
					ref,
				);
				enriched.displayName = this.#maskTagName(enriched);
				return enriched;
			};
			const group = {
				type: "theme",
				name: theme.name,
				themeLevel: level,
				themeIcon,
				themeTag,
				powerTags: (theme.powerTags || []).map((t) =>
					enrichCharacterTag(t, "powerTag"),
				),
				weaknessTags: (theme.weaknessTags || []).map((t) =>
					enrichCharacterTag(t, "weaknessTag"),
				),
			};
			heroGroups.push(group);
		}

		// Backpack
		const heroTags = actor.system.backpackTags || [];
		if (heroTags.length > 0) {
			const tags = heroTags.map((t) => {
				const enriched = this.#enrichTag(
					{ ...t, type: t.type || "backpack" },
					actor.uuid,
				);
				enriched.displayName = this.#maskTagName(enriched);
				return enriched;
			});
			heroGroups.push({ type: "backpack", tags, hasItems: tags.length > 0 });
		}

		const relationships = (actor.system.relationships ?? []).map((tag) => {
			const source =
				tag instanceof foundry.abstract.DataModel ? tag.toObject() : { ...tag };
			const enriched = this.#enrichTag({ ...source, type: "hero" }, actor.uuid);
			enriched.displayName = this.#maskTagName(enriched);
			return enriched;
		});
		if (relationships.length > 0) {
			heroGroups.push({
				type: "relationships",
				tags: relationships,
				hasItems: true,
			});
		}

		// Story Themes
		const storyItems = actor.items
			.filter(
				(item) => item.type === "story" && item.system.isArchived !== true,
			)
			.sort((a, b) => a.sort - b.sort);
		for (const item of storyItems) {
			const sys = item.system;
			const level = sys.level || "origin";
			const themeIcon = `${
				CONFIG.litm.themeicon_src?.[level] ||
				"systems/litm-rn/assets/media/icons/origin"
			}-color_litm_icn.svg`;
			const themeTag = this.#enrichTag(
				{ ...sys.themeTag, type: "themeTag" },
				actor.uuid,
			);
			themeTag._themeIcon = themeIcon;
			const group = {
				type: "storyTheme",
				name: item.name,
				themeLevel: level,
				themeIcon,
				themeTag,
				powerTags: (sys.powerTags || []).map((t) =>
					this.#enrichTag({ ...t, type: t.type || "powerTag" }, actor.uuid),
				),
				weaknessTags: (sys.weaknessTags || []).map((t) =>
					this.#enrichTag({ ...t, type: t.type || "weaknessTag" }, actor.uuid),
				),
			};
			heroGroups.push(group);
		}

		// Personal story tags + statuses (ActiveEffects)
		const personalTags = [
			...(actor.system?.storyTags ?? [])
				.filter(
					(t) =>
						!this.#shouldHidePrivateTag(t, actor) ||
						this.#isTagSelectedForRoll(t.id, actor.uuid),
				)
				.map((t) => {
					const e = this.#enrichTag(
						{ ...t, type: t.type || "tag" },
						actor.uuid,
					);
					e.displayName = this.#shouldHidePrivateTag(t, actor)
						? this.#maskTagName(t)
						: t.name;
					return e;
				}),
			...(actor.system?.statuses ?? [])
				.filter(
					(t) =>
						!this.#shouldHidePrivateTag(t, actor) ||
						this.#isTagSelectedForRoll(t.id, actor.uuid),
				)
				.map((t) => {
					const e = this.#enrichTag(
						{ ...t, type: t.type || "status" },
						actor.uuid,
					);
					e.displayName = this.#shouldHidePrivateTag(t, actor)
						? this.#maskTagName(t)
						: t.name;
					return e;
				}),
		];
		if (personalTags.length > 0) {
			heroGroups.push({ type: "personal", tags: personalTags, hasItems: true });
		}

		// ── FELLOWSHIP COLUMN ──

		const fellowshipItem = actor.system?.fellowship;
		if (fellowshipItem) {
			const sys = fellowshipItem.system;
			const allTags = sys?.allTags ?? [];
			const tagArr = allTags.map((t) => {
				const obj =
					t instanceof foundry.abstract.DataModel ? t.toObject() : { ...t };
				return this.#enrichTag(obj, "fellowship");
			});
			// Use the fellowship's themeTag as the section title
			const rawTheme = sys?.themeTag;
			const themeTag = rawTheme
				? this.#enrichTag(
						rawTheme instanceof foundry.abstract.DataModel
							? rawTheme.toObject()
							: { ...rawTheme },
						"fellowship",
					)
				: null;
			const fellowLevel = sys?.level || "origin";
			const fellowIcon = `${
				CONFIG.litm.themeicon_src?.[fellowLevel] ||
				"systems/litm-rn/assets/media/icons/origin"
			}-color_litm_icn.svg`;
			if (themeTag) themeTag._themeIcon = fellowIcon;
			const weaknessTags = tagArr.filter((t) => t.type === "weaknessTag");
			const powerTags = tagArr.filter(
				(t) => t.id !== themeTag?.id && t.type !== "weaknessTag",
			);
			fellowGroups.push({
				type: "fellowship",
				name: sys?.themebook?.trim() || t("Litm.other.fellowship"),
				themeLevel: fellowLevel,
				themeTag,
				powerTags,
				weaknessTags,
				fellowIcon,
				hasItems: tagArr.length > 0,
			});
		}

		const sharedSelection = this.#getSelection().get("fellowship");
		if (sharedSelection?.size) {
			const powerTags = [];
			const weaknessTags = [];
			for (const [tagId, state] of sharedSelection) {
				const sharedTag = this.#getSharedTag(actor.id, tagId);
				if (!sharedTag) continue;
				const enriched = this.#enrichTag(sharedTag, "fellowship");
				enriched.state = state;
				enriched.displayName = this.#maskTagName(sharedTag);
				if (state === "negative") weaknessTags.push(enriched);
				else powerTags.push(enriched);
			}
			if (powerTags.length || weaknessTags.length) {
				fellowGroups.unshift({
					type: "shared",
					name: t("Litm.ui.shared-tags"),
					themeTag: null,
					powerTags,
					weaknessTags,
					hasItems: true,
				});
			}
		}

		// ── STORY TAGS COLUMN ──

		const sortTags = (arr) =>
			arr.sort((a, b) => {
				const cat = (t) =>
					t.type === "status" ? 0 : t.type === "might" ? 2 : 1;
				return cat(a) - cat(b);
			});

		try {
			const storyConfig = game.settings.get("litm-rn", "storytags") || {};
			const storyTagArr = (storyConfig.tags || [])
				.filter(
					(t) =>
						!this.#shouldHidePrivateTag(t, null) ||
						this.#isTagSelectedForRoll(t.id, "story"),
				)
				.map((t) => {
					const e = this.#enrichTag({ ...t }, "story");
					e.displayName = this.#maskTagName(t);
					return e;
				})
				.filter((t) => !!t.name && t.type !== "limit");
			const sceneConfig = canvas.scene?.getFlag("litm-rn", "scenetags") || {};
			const sceneRef = currentSceneSelectionRef();
			const sceneTagArr = (sceneConfig.tags || [])
				.filter(
					(t) =>
						!this.#shouldHidePrivateTag(t, null) ||
						this.#isTagSelectedForRoll(t.id, sceneRef),
				)
				.map((t) => {
					const e = this.#enrichTag({ ...t }, sceneRef);
					e.displayName = this.#maskTagName(t);
					return e;
				})
				.filter((t) => !!t.name && t.type !== "limit");
			const allTags = [...storyTagArr, ...sceneTagArr];
			if (allTags.length > 0) {
				allTags.sort((a, b) => {
					const cat = (t) =>
						t.type === "status" ? 0 : t.type === "might" ? 2 : 1;
					return cat(a) - cat(b);
				});
				storyGroups.push({ type: "storyTags", tags: allTags, hasItems: true });
			}
		} catch (_) {
			/* no-op */
		}

		try {
			const storyConfig = game.settings.get("litm-rn", "storytags") || {};
			for (const itemId of storyConfig.storyThemeIds || []) {
				const item = game.items?.get(itemId);
				if (!item || item.type !== "story") continue;
				const ref = `story-theme-${item.id}`;
				const sys = item.system;
				const visible = (tag) => game.user.isGM || !tag.isPrivate;
				const level = sys.level || "origin";
				const themeIcon = `${
					CONFIG.litm.themeicon_src?.[level] ||
					"systems/litm-rn/assets/media/icons/origin"
				}-color_litm_icn.svg`;
				const enrichStoryThemeTag = (tag, type) => {
					if (!tag) return null;
					const source =
						tag instanceof foundry.abstract.DataModel
							? tag.toObject()
							: { ...tag };
					const normalizedType =
						type === "themeTag"
							? "themeTag"
							: type === "powerTag"
								? "powerTag"
								: "weaknessTag";
					const enriched = this.#enrichTag(
						{
							...source,
							type: normalizedType,
							isHindering: normalizedType === "weaknessTag",
						},
						ref,
					);
					enriched.displayName = this.#maskTagName(enriched);
					return enriched;
				};
				const themeTag =
					sys.themeTag && visible(sys.themeTag)
						? enrichStoryThemeTag(sys.themeTag, "themeTag")
						: null;
				if (themeTag) themeTag._themeIcon = themeIcon;
				storyThemeGroups.push({
					type: "storyTheme",
					name: item.name,
					themeLevel: level,
					themeIcon,
					themeTag,
					powerTags: (sys.powerTags || [])
						.filter(visible)
						.map((t) => enrichStoryThemeTag(t, "powerTag")),
					weaknessTags: (sys.weaknessTags || [])
						.filter(visible)
						.map((t) => enrichStoryThemeTag(t, "weaknessTag")),
				});
			}
		} catch (_) {
			/* no-op */
		}

		// ── FELLOWSHIP MEMBERS (in Fellowship column) ──
		const fellowshipId = getActorFellowshipId(actor);
		const fellowMembers = [];
		if (fellowshipId) {
			const members = getFellowshipActors(fellowshipId).filter(
				(member) => member.id !== actor.id,
			);
			for (const member of members) {
				const ref = member.uuid;
				const { storyTags, statuses } = this.#getActorEffects(member);
				const tags = sortTags([
					...storyTags
						.filter(
							(t) =>
								!this.#shouldHidePrivateTag(t, member) ||
								this.#isTagSelectedForRoll(t.id, ref),
						)
						.map((t) => {
							const e = this.#enrichTag({ ...t, type: t.type || "tag" }, ref);
							e.displayName = this.#shouldHidePrivateTag(t, member)
								? this.#maskTagName(t)
								: t.name;
							return e;
						}),
					...statuses
						.filter(
							(t) =>
								!this.#shouldHidePrivateTag(t, member) ||
								this.#isTagSelectedForRoll(t.id, ref),
						)
						.map((t) => {
							const e = this.#enrichTag(
								{ ...t, type: t.type || "status" },
								ref,
							);
							e.displayName = this.#shouldHidePrivateTag(t, member)
								? this.#maskTagName(t)
								: t.name;
							return e;
						}),
				]);
				const relationship = (actor.system.relationships ?? []).find(
					(r) => r.fellowActorId === member.id,
				);
				let relationshipTag = null;
				if (relationship) {
					const source =
						relationship instanceof foundry.abstract.DataModel
							? relationship.toObject()
							: { ...relationship };
					relationshipTag = this.#enrichTag(
						{ ...source, type: "hero" },
						actor.uuid,
					);
					relationshipTag.displayName = this.#maskTagName(relationshipTag);
				}
				fellowMembers.push({
					id: member.id,
					name: member.name,
					img: member.img,
					relationshipTag,
					tags,
				});
			}
		}

		// ── NON-FELLOWSHIP ACTORS (in Story Tags column) — from storyConfig.actors ──
		const fellowMemberIds = new Set(fellowMembers.map((m) => m.id));
		const storyMembers = [];
		try {
			const storyConfig = game.settings.get("litm-rn", "storytags") || {};
			const hiddenRefs = new Set(storyConfig.hiddenActors || []);
			for (const ref of storyConfig.actors || []) {
				if (hiddenRefs.has(ref) && !game.user.isGM) continue;
				const refActor = this.#resolveRefActor(ref);
				if (!refActor) continue;
				if (refActor.id === actor.id) continue;
				if (fellowMemberIds.has(refActor.id)) continue;
				const refUuid = refActor.uuid;
				const { storyTags, statuses } = this.#getActorEffects(refActor);
				const tags = sortTags([
					...storyTags
						.filter(
							(t) =>
								!this.#shouldHidePrivateTag(t, refActor) ||
								this.#isTagSelectedForRoll(t.id, refUuid),
						)
						.map((t) => {
							const e = this.#enrichTag(
								{ ...t, type: t.type || "tag" },
								refUuid,
							);
							e.displayName = this.#shouldHidePrivateTag(t, refActor)
								? this.#maskTagName(t)
								: t.name;
							return e;
						}),
					...statuses
						.filter(
							(t) =>
								!this.#shouldHidePrivateTag(t, refActor) ||
								this.#isTagSelectedForRoll(t.id, refUuid),
						)
						.map((t) => {
							const e = this.#enrichTag(
								{ ...t, type: t.type || "status" },
								refUuid,
							);
							e.displayName = this.#shouldHidePrivateTag(t, refActor)
								? this.#maskTagName(t)
								: t.name;
							return e;
						}),
				]);
				if (tags.length > 0) {
					storyMembers.push({
						id: refActor.id,
						name: refActor.name,
						img: refActor.img,
						tags,
					});
				}
			}
		} catch (_) {
			/* no-op */
		}

		// ── SCENE ACTORS (in Story Tags column) — from sceneConfig.actors ──
		const sceneActors = [];
		try {
			const sceneConfig = canvas.scene?.getFlag("litm-rn", "scenetags") || {};
			for (const entry of sceneConfig.actors || []) {
				if (entry.hidden && !game.user.isGM) continue;
				const refActor = this.#resolveRefActor(entry.ref);
				if (!refActor) continue;
				if (refActor.id === actor.id) continue;
				if (fellowMemberIds.has(refActor.id)) continue;
				const ref = refActor.uuid;
				const { storyTags, statuses } = this.#getActorEffects(refActor);
				const tags = sortTags([
					...storyTags
						.filter(
							(t) =>
								!this.#shouldHidePrivateTag(t, refActor) ||
								this.#isTagSelectedForRoll(t.id, ref),
						)
						.map((t) => {
							const e = this.#enrichTag({ ...t, type: t.type || "tag" }, ref);
							e.displayName = this.#shouldHidePrivateTag(t, refActor)
								? this.#maskTagName(t)
								: t.name;
							return e;
						}),
					...statuses
						.filter(
							(t) =>
								!this.#shouldHidePrivateTag(t, refActor) ||
								this.#isTagSelectedForRoll(t.id, ref),
						)
						.map((t) => {
							const e = this.#enrichTag(
								{ ...t, type: t.type || "status" },
								ref,
							);
							e.displayName = this.#shouldHidePrivateTag(t, refActor)
								? this.#maskTagName(t)
								: t.name;
							return e;
						}),
				]);
				if (tags.length > 0) {
					sceneActors.push({
						id: refActor.id,
						name: refActor.name,
						img: refActor.img,
						tags,
					});
				}
			}
		} catch (_) {
			/* no-op */
		}

		// ── GM-enriched story/scene tags for Group tab (use gmRollSelection, not character's) ──
		const gmGroupStoryTags = [];
		if (game.user.isGM) {
			// Global story tags (flat)
			try {
				const storyConfig = game.settings.get("litm-rn", "storytags") || {};
				const gmStoryTags = (storyConfig.tags || [])
					.filter((t) => !!t.name && t.type !== "limit")
					.map((t) => {
						const e = this.#enrichTag({ ...t }, "story", false, true);
						e.displayName = this.#maskTagName(t);
						return e;
					});
				gmGroupStoryTags.push(...gmStoryTags);
			} catch (_) {
				/* no-op */
			}
			// Scene tags (flat)
			try {
				const sceneConfig = canvas.scene?.getFlag("litm-rn", "scenetags") || {};
				const sceneRef = currentSceneSelectionRef();
				const gmSceneTags = (sceneConfig.tags || [])
					.filter((t) => !!t.name && t.type !== "limit")
					.map((t) => {
						const e = this.#enrichTag({ ...t }, sceneRef, false, true);
						e.displayName = this.#maskTagName(t);
						return e;
					});
				gmGroupStoryTags.push(...gmSceneTags);
			} catch (_) {
				/* no-op */
			}
			// Linked world Story Themes (structured like Fellowship)
			try {
				const storyConfig = game.settings.get("litm-rn", "storytags") || {};
				for (const itemId of storyConfig.storyThemeIds || []) {
					const item = game.items?.get(itemId);
					if (!item || item.type !== "story") continue;
					const ref = `story-theme-${item.id}`;
					const sys = item.system;
					const level = sys.level || "origin";
					const themeIcon = `${
						CONFIG.litm.themeicon_src?.[level] ||
						"systems/litm-rn/assets/media/icons/origin"
					}-color_litm_icn.svg`;
					const enrich = (tag, type) => {
						if (!tag) return null;
						const source =
							tag instanceof foundry.abstract.DataModel
								? tag.toObject()
								: { ...tag };
						const normalizedType =
							type === "themeTag"
								? "themeTag"
								: type === "powerTag"
									? "powerTag"
									: "weaknessTag";
						const result = this.#enrichTag(
							{
								...source,
								type: normalizedType,
								isHindering: normalizedType === "weaknessTag",
							},
							ref,
							false,
							true,
						);
						result.displayName = this.#maskTagName(result);
						return result;
					};
					const themeTag = enrich(sys.themeTag, "themeTag");
					if (themeTag) themeTag._themeIcon = themeIcon;
					gmGroupStoryTags.push({
						_isTheme: true,
						name: item.name,
						themeLevel: level,
						themeTag,
						powerTags: (sys.powerTags || []).map((t) => enrich(t, "powerTag")),
						weaknessTags: (sys.weaknessTags || []).map((t) =>
							enrich(t, "weaknessTag"),
						),
					});
				}
			} catch (_) {
				/* no-op */
			}
			// Non-fellowship story/scene actors (as member blocks)
			for (const m of storyMembers) {
				gmGroupStoryTags.push({
					_isMember: true,
					id: m.id,
					name: m.name,
					img: m.img,
					tags: m.tags,
				});
			}
			for (const m of sceneActors) {
				gmGroupStoryTags.push({
					_isMember: true,
					id: m.id,
					name: m.name,
					img: m.img,
					tags: m.tags,
				});
			}
			gmGroupStoryTags.sort((a, b) => {
				const groupRank = (entry) =>
					entry._isMember ? 2 : entry._isTheme ? 1 : 0;
				if (groupRank(a) !== groupRank(b)) return groupRank(a) - groupRank(b);
				if (a._isTheme || a._isMember) return 0;
				const cat = (t) =>
					t.type === "status" ? 0 : t.type === "might" ? 2 : 1;
				return cat(a) - cat(b);
			});
		}

		const gmStoryCatalogTags = gmGroupStoryTags.filter(
			(entry) => !entry._isMember,
		);
		const enrichGmMember = (member) => ({
			...member,
			tags: member.tags.map((tag) =>
				this.#enrichTag({ ...tag }, tag._ref, false, true),
			),
		});
		const gmStoryCatalogMembers = game.user.isGM
			? storyMembers.map(enrichGmMember)
			: [];
		const gmSceneCatalogActors = game.user.isGM
			? sceneActors.map(enrichGmMember)
			: [];

		// Entries remain in this list even with an empty state until explicitly removed.
		const flatSelectedTags = this.#getAllSelectedTags();
		const roteCandidates = await this.#rollRoteCandidates(flatSelectedTags);
		this._roteCandidates = roteCandidates;
		if (this._currentTab !== "group" && !this._subtab) {
			await Promise.all(
				flatSelectedTags.map(async (tag) => {
					if (!["themeTag", "powerTag"].includes(tag.type) || tag.isScratched)
						return;
					tag.hasRollRote = Boolean(
						await getRollRote(tag._ref, tag.id, { actorId: this.actorId }),
					);
				}),
			);
		}
		if (
			this._currentTab !== "group" &&
			!this._subtab &&
			this._selectedRoteKey &&
			!roteCandidates.some((rote) => rote.key === this._selectedRoteKey)
		) {
			this._selectedRoteKey = "";
			this.#revokeRoteApproval();
			this.#saveState();
			this._dispatchUpdate();
			ui.notifications.warn(t("Litm.rote.roll-unavailable"));
		}
		const displayedRotes = await Promise.all(
			roteCandidates.map((rote) => this.#displayRollRote(rote)),
		);
		if (this._currentTab !== "group" && !this._subtab) {
			const catalogTags = [...heroGroups, ...storyThemeGroups].flatMap(
				(group) => [group.themeTag, ...(group.powerTags ?? [])],
			);
			await Promise.all(
				catalogTags.map(async (tag) => {
					if (
						!tag?.id ||
						!tag._ref ||
						tag.isScratched ||
						!["themeTag", "powerTag"].includes(tag.type)
					)
						return;
					tag.hasRollRote = Boolean(
						await getRollRote(tag._ref, tag.id, { actorId: this.actorId }),
					);
				}),
			);
		}

		// ── GM actor tabs ──
		const actorTabs = [];
		const isGmDialog = game.user.isGM && fellowshipId;
		if (isGmDialog) {
			const members = getFellowshipActors(fellowshipId).filter(
				(member) => member.type === "character",
			);
			for (const m of members) {
				actorTabs.push({ id: m.id, name: m.name, img: m.img });
			}
		}

		// ── GROUP TAB selected tags block ──
		const groupSelected = this.#buildGroupSelected(
			fellowshipId,
			fellowshipItem,
		);

		// ── Group tab warnings ──
		let groupWarning = "";
		if (fellowshipId && game.litm?.rollSelection) {
			const allChars = getFellowshipActors(fellowshipId).filter(
				(member) => member.type === "character",
			);
			const actorIds = new Set(allChars.map((a) => a.id));
			let maxSelections = 0;
			let maxBurned = 0;
			for (const [actorId, refMap] of game.litm.rollSelection) {
				if (!actorIds.has(actorId)) continue;
				let total = 0;
				let burned = 0;
				for (const [ref, tagMap] of refMap) {
					if (ref === "fellowship") continue;
					for (const [, state] of tagMap) {
						total++;
						if (state === "burned") burned++;
					}
				}
				if (total > maxSelections) maxSelections = total;
				if (burned > maxBurned) maxBurned = burned;
			}
			// Also check GM selections for burned
			if (game.litm.gmRollSelection) {
				for (const [, refMap] of game.litm.gmRollSelection) {
					let gmBurned = 0;
					for (const [, tagMap] of refMap) {
						for (const [, state] of tagMap) {
							if (state === "burned") gmBurned++;
						}
					}
					if (gmBurned > maxBurned) maxBurned = gmBurned;
				}
			}
			if (maxBurned > 1) {
				groupWarning = t("Litm.ui.group-burn-warning");
			} else if (maxSelections > 1) {
				groupWarning = t("Litm.ui.group-tag-warning");
			}
		}

		return {
			...context,
			actorId: this.actorId,
			isCamp: !!this.camp,
			campTags: (campSession?.campsite?.tags ?? [])
				.filter((tag) => game.user.isGM || !tag.isPrivate)
				.map((tag) => {
					const enriched = this.#enrichTag({ ...tag }, "camp");
					enriched.displayName = this.#maskTagName(tag);
					return enriched;
				}),
			campSpendPower: Math.ceil(this.basePower / 2),
			canCampSpend: this.basePower >= 1,
			campBonus: Number(this.camp?.bonus) || 0,
			campTypeLabel:
				this.camp?.duration === "camp"
					? t("Litm.camp.duration-camp")
					: t("Litm.camp.duration-sojourn"),
			currentTab: this._currentTab,
			subtab: this._subtab,
			sourceTab: this._sourceTab,
			flatSelectedTags,
			roteCandidates: displayedRotes,
			heroGroups,
			hasHeroStoryThemes: heroGroups.some(
				(group) => group.type === "storyTheme",
			),
			fellowGroups,
			fellowMembers,
			storyMembers,
			storyGroups,
			storyThemeGroups,
			sceneActors,
			type: this.type,
			modifier: this._modifier,
			might: this._might,
			tradeMode: this._tradeMode,
			rollApproved:
				this._rollApproval.state === "approved" &&
				this._rollApproval.power === this.totalPower,
			rollBlocked:
				!game.user.isGM &&
				game.settings.get("litm-rn", "block_rolls_until_moderated") &&
				!(
					this._rollApproval.state === "approved" &&
					this._rollApproval.power === this.totalPower
				),
			isGM: game.user.isGM,
			isGmDialog,
			actorTabs,
			totalPower: this.totalPower,
			spendPower: this.spendPower,
			canThrowCaution: this.canThrowCaution,
			canHedgeRisks: this.canHedgeRisks,
			groupSelected,
			groupWarning,
			groupEmpty:
				groupSelected.heroes.length === 0 &&
				groupSelected.fellowship.length === 0 &&
				groupSelected.story.length === 0,
			gmGroupStoryTags,
			gmStoryCatalogTags,
			gmStoryCatalogMembers,
			gmSceneCatalogActors,
			sacrifice: this.#sacrificeData(),
			sacrificeThemes: (actor.system.themes ?? []).map((theme) => ({
				id: theme.id,
				name: theme.themeTag?.name || theme.name,
				level: theme.level,
			})),
			isSacrifice: this._subtab === "sacrifice",
			sacrificePending: this._sacrifice.state === "pending",
			sacrificeApproved: this._sacrifice.state === "approved",
			sacrificeChanged: this._sacrifice.state === "changed",
			sacrificeRollBlocked:
				!game.user.isGM &&
				game.settings.get("litm-rn", "block_rolls_until_moderated") &&
				this._sacrifice.state !== "approved",
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const form = this.form ?? this.element?.querySelector("form");
		if (!form) return;

		form.addEventListener("submit", (event) => {
			event.preventDefault();
			const formData = new foundry.applications.ux.FormDataExtended(form);
			this._processSubmitData(event, form, formData);
		});
		form.querySelectorAll("[data-roll-rote-select]").forEach((button) => {
			button.addEventListener("click", () => {
				const key = button.dataset.rollRoteSelect;
				if (!this._roteCandidates.some((rote) => rote.key === key)) return;
				this._selectedRoteKey = this._selectedRoteKey === key ? "" : key;
				this.#revokeRoteApproval();
				this.#saveState();
				this._dispatchUpdate();
				this.render();
			});
		});
		form.querySelectorAll("[data-roll-rote-view]").forEach((button) => {
			button.addEventListener("click", () =>
				this.#showRollRote(button.dataset.rollRoteView),
			);
		});
		form.querySelectorAll("[data-roll-rote-open]").forEach((button) => {
			button.addEventListener("click", () =>
				this.#openRollRote(button.dataset.rollRoteOpen),
			);
		});
		this.#cleanupRoteTooltips();
		for (const wrapper of form.querySelectorAll(
			".litm--roll-rote-image-wrap",
		)) {
			const button = wrapper.querySelector(".litm--roll-rote-image");
			const tooltip = wrapper.querySelector(".litm--roll-rote-tooltip");
			if (!button || !tooltip) continue;
			const doc = getOwningDocument(button);
			tooltip.classList.toggle(
				"theme-dark",
				doc.querySelector("#interface")?.classList.contains("theme-dark") ||
					doc.body.classList.contains("theme-dark"),
			);
			doc.body.appendChild(tooltip);
			this._roteTooltipEls.push(tooltip);
			button.addEventListener("mouseenter", () => {
				tooltip.style.display = "block";
				const rect = button.getBoundingClientRect();
				const width = tooltip.offsetWidth;
				const height = tooltip.offsetHeight;
				const win = getOwningWindow(button);
				tooltip.style.left = `${Math.max(12, Math.min(rect.left, win.innerWidth - width - 12))}px`;
				tooltip.style.top = `${rect.bottom + height + 8 < win.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8)}px`;
			});
			button.addEventListener("mouseleave", () => {
				tooltip.style.display = "none";
			});
		}

		// Tab switching (main tabs: clear subtab)
		form.querySelectorAll("[data-tab]:not([data-subtab])").forEach((el) => {
			el.addEventListener("click", (event) => {
				const tab = event.currentTarget.dataset.tab;
				this._currentTab = tab;
				this._subtab = "";
				if (tab === "quick") this.type = "quick";
				else if (tab === "detailed") this.type = "tracked";
				this.#clearInvalidTradeMode();
				this.#saveState();
				this.render();
			});
		});

		// Subtabs (may also switch the main tab)
		form.querySelectorAll("[data-subtab]").forEach((el) => {
			el.addEventListener("click", (event) => {
				const target = event.currentTarget;
				const tab = target.dataset.tab;
				if (tab) {
					this.#saveState();
					this._currentTab = tab;
					if (tab === "quick") this.type = "quick";
					else if (tab === "detailed") this.type = "tracked";
				}
				this._subtab = target.dataset.subtab;
				if (this._subtab === "sacrifice") this.type = "sacrifice";
				else if (this._subtab === "reaction") this.type = "reaction";
				this.#clearInvalidTradeMode();
				this.#saveState();
				this.render();
			});
		});

		form
			.querySelector("[data-click='propose-sacrifice']")
			?.addEventListener("click", () => {
				if (game.user.isGM) this.#approveSacrifice(form);
				else this.#proposeSacrifice(form);
			});

		form
			.querySelector("[data-click='roll-sacrifice']")
			?.addEventListener("click", (event) => {
				const formData = new foundry.applications.ux.FormDataExtended(form);
				this._processSubmitData(event, form, formData);
			});

		form
			.querySelector("[data-click='moderate-roll']")
			?.addEventListener("click", () => {
				if (game.user.isGM) this.#approveRoll();
				else this.#requestRollApproval();
			});

		form
			.querySelector("[data-click='roll']")
			?.addEventListener("click", (event) => {
				const formData = new foundry.applications.ux.FormDataExtended(form);
				formData.object.shouldRoll = true;
				this._processSubmitData(event, form, formData);
			});

		form
			.querySelector("[data-click='camp-without-roll']")
			?.addEventListener("click", () => this.#resolveCampWithoutRoll());

		form.querySelectorAll("[data-sacrifice-input]").forEach((el) => {
			el.addEventListener("change", () => this.#syncSacrificeForm(form, true));
			if (el.matches("textarea, input[type='text']")) {
				el.addEventListener("input", () =>
					this.#syncSacrificeForm(form, false),
				);
			}
		});

		form.querySelectorAll("[data-source-tab]").forEach((el) => {
			el.addEventListener("click", (event) => {
				this._sourceTab = event.currentTarget.dataset.sourceTab;
				this.render();
			});
		});

		form
			.querySelectorAll("[data-click='remove-selected-tag']")
			.forEach((el) => {
				el.addEventListener("click", (event) => {
					event.stopPropagation();
					const { id, ref, selectionActorId, selectionKind } =
						event.currentTarget.dataset;
					if (!id || !ref) return;
					if (selectionKind === "gm") {
						game.litm?.gmRemoveTagFromRoll?.(game.user.id, ref, id);
					} else {
						const actorId = selectionActorId || this.actorId;
						const actor = game.actors.get(actorId);
						if (!game.user.isGM && !actor?.isOwner) return;
						game.litm?.removeTagFromRoll?.(actorId, ref, id);
					}
				});
			});

		// Tag click → cycle state
		form.querySelectorAll("[data-click='cycle-tag']").forEach((el) => {
			el.addEventListener("click", (event) => {
				const id = event.currentTarget.dataset.id;
				const ref = event.currentTarget.dataset.ref;
				if (!id || !ref) return;
				const isSelectedView = !!event.currentTarget.closest(
					".litm--roll-selected-tags",
				);
				const isGroupSelected = !!event.currentTarget.closest(
					".litm--roll-group-selected",
				);
				const isCatalog = !!event.currentTarget.closest(".litm--roll-catalog");
				if (isGroupSelected) {
					const { selectionActorId, selectionKind } =
						event.currentTarget.dataset;
					if (selectionKind === "gm")
						this.#gmCycleTag(id, ref, event.shiftKey, false, true);
					else {
						const actorId = selectionActorId || this.actorId;
						const actor = game.actors.get(actorId);
						if (game.user.isGM || actor?.isOwner)
							this.#cycleTag(id, ref, event.shiftKey, true, false, actorId);
					}
					return;
				}
				// Group tab: GM always uses own gmRollSelection, not character's
				if (this._currentTab === "group" && game.user.isGM) {
					this.#gmCycleTag(
						id,
						ref,
						isCatalog ? false : event.shiftKey,
						isCatalog,
					);
					return;
				}
				this.#cycleTag(
					id,
					ref,
					isCatalog ? false : event.shiftKey,
					isSelectedView,
					isCatalog,
				);
			});
		});

		// Might radios
		form
			.querySelectorAll('input[name="might"]')
			.forEach((el) =>
				el.addEventListener("change", this.#handleMightChange.bind(this)),
			);

		// Modifier input
		form
			.querySelectorAll("[data-update='modifier']")
			.forEach((el) =>
				el.addEventListener("change", this.#handleModifierChange.bind(this)),
			);

		// Type radios
		form
			.querySelectorAll('input[name="type"]')
			.forEach((el) =>
				el.addEventListener("change", this.#handleTypeChange.bind(this)),
			);

		// Modifier +/- buttons
		form.querySelectorAll("[data-click='mod-inc']").forEach((el) => {
			el.addEventListener("click", () => {
				if (
					this._subtab === "sacrifice" &&
					this._sacrifice.state === "approved"
				) {
					this._sacrifice.state = "changed";
				}
				this._modifier += 1;
				const input = this.element.querySelector('[data-update="modifier"]');
				if (input) input.value = this._modifier;
				this.#saveState();
				this._updateTradeUI();
				this._dispatchUpdate();
				if (this._subtab === "sacrifice") this.#broadcastSacrifice();
			});
		});
		form.querySelectorAll("[data-click='mod-dec']").forEach((el) => {
			el.addEventListener("click", () => {
				if (
					this._subtab === "sacrifice" &&
					this._sacrifice.state === "approved"
				) {
					this._sacrifice.state = "changed";
				}
				this._modifier -= 1;
				const input = this.element.querySelector('[data-update="modifier"]');
				if (input) input.value = this._modifier;
				this.#saveState();
				this._updateTradeUI();
				this._dispatchUpdate();
				if (this._subtab === "sacrifice") this.#broadcastSacrifice();
			});
		});

		// Trade buttons
		form
			.querySelectorAll(
				"[data-click='trade-caution'], [data-click='trade-hedge']",
			)
			.forEach((el) => {
				el.addEventListener("click", this.#handleTrade.bind(this));
			});

		// Might tooltip
		this._cleanupTooltip();
		const wrapper = form.querySelector(".litm--might-name-wrapper");
		const tooltip = form.querySelector(".litm--might-tooltip");
		if (wrapper && tooltip) {
			this._bindMightTooltip(wrapper, tooltip);
		}

		// GM actor tabs
		form.querySelectorAll("[data-actor-tab]").forEach((el) => {
			el.addEventListener("click", (event) => {
				const actorId = event.currentTarget.dataset.actorTab;
				if (actorId && actorId !== this.actorId) {
					this.#saveState();
					this.actorId = actorId;
					const newActor = game.actors.get(actorId);
					if (newActor)
						this.speaker = CONFIG.ChatMessage.documentClass.getSpeaker({
							actor: newActor,
						});
					this.#restoreState();
					this.render();
				}
			});
		});
	}

	/** Cycle tag state: unselected → positive → negative → burned → unselected */
	#cycleTag(
		id,
		ref,
		shiftKey,
		retainEmpty = false,
		toggleOnly = false,
		selectionActorId = this.actorId,
	) {
		const refMap =
			game.litm?.rollSelection?.get(selectionActorId)?.get(ref) ?? new Map();
		const isPresent = refMap.has(id);
		const current = refMap.get(id) || "";
		if (toggleOnly && isPresent) {
			game.litm?.removeTagFromRoll?.(selectionActorId, ref, id);
			return;
		}

		// Find the tag to determine allowed states
		const actor = game.actors.get(selectionActorId) || this.actor;
		let srcTag = null;

		if (ref === "fellowship" && actor.system?.fellowship) {
			srcTag = actor.system.fellowship.system.allTags.find((t) => t.id === id);
		} else if (ref === "story") {
			try {
				const config = game.settings.get("litm-rn", "storytags") || {};
				srcTag = (config.tags || []).find((t) => t.id === id);
			} catch (_) {
				/* no-op */
			}
		} else if (isSceneSelectionRef(ref)) {
			try {
				const config =
					getSceneForSelectionRef(ref)?.getFlag("litm-rn", "scenetags") || {};
				srcTag = (config.tags || []).find((t) => t.id === id);
			} catch (_) {
				/* no-op */
			}
		} else if (ref === "camp" && this.camp) {
			const session = game.litm?.CampDialog?.getSession?.(
				this.camp.fellowshipId,
			);
			srcTag = session?.campsite?.tags?.find((tag) => tag.id === id) ?? null;
		} else if (ref.startsWith("story-theme-")) {
			srcTag = this.#findStoryThemeTag(id, ref);
		} else {
			const refActor = this.#resolveRefActor(ref);
			if (refActor) srcTag = this.#findTagOnActor(id, refActor);
		}
		if (!srcTag && ref === "fellowship") {
			srcTag = this.#getSharedTag(actor.id, id);
		}
		if (!srcTag) {
			// Fallback: search all sources
			srcTag = this.#findTagAnywhere(id);
		}
		if (!srcTag) return;

		const { states } = this.#statesForType(
			srcTag.type || "tag",
			false,
			srcTag.isHindering,
			srcTag.isCrispy,
		);
		const allowed = states.split(",").filter(Boolean);
		// allowed = ["negative", "positive", "burned"] etc.

		let nextState;
		if (!isPresent || !current) {
			// Not selected → set to default (first allowed, but skip burned unless shift)
			nextState =
				shiftKey &&
				!ref.startsWith("story-theme-") &&
				allowed.includes("burned")
					? "burned"
					: allowed[0];
		} else {
			// Cycle to next, or remove
			const idx = allowed.indexOf(current);
			if (idx < 0 || idx >= allowed.length - 1) {
				nextState = retainEmpty ? "" : null;
			} else {
				nextState = allowed[idx + 1];
			}
		}

		if (nextState === null)
			game.litm?.removeTagFromRoll?.(selectionActorId, ref, id);
		else game.litm?.addTagToRoll?.(selectionActorId, ref, id, nextState);
	}

	/** Extract story tags and statuses from any actor (works for characters, challenges, etc.) */
	#getActorEffects(actor) {
		// Use DataModel getters if available (character actors)
		if (actor.system?.storyTags || actor.system?.statuses) {
			return {
				storyTags: [...(actor.system?.storyTags ?? [])],
				statuses: [...(actor.system?.statuses ?? [])],
			};
		}
		// Fallback: read from appliedEffects flags (challenge actors, etc.)
		const storyTags = [];
		const statuses = [];
		for (const effect of actor.appliedEffects ?? []) {
			const flags = effect.flags?.["litm-rn"];
			if (!flags) continue;
			if (flags.type === "status") {
				statuses.push({
					...flags,
					type: "status",
					value: flags.values?.findLast((v) => !!v) ?? 0,
					id: effect.id,
					name: effect.name,
				});
			} else if (flags.type === "might") {
				statuses.push({
					...flags,
					type: "might",
					value: flags.value ?? 0,
					id: effect.id,
					name: effect.name,
				});
			} else if (flags.type === "tag" || !flags.type) {
				storyTags.push({
					...flags,
					type: "tag",
					id: effect.id,
					name: effect.name,
				});
			}
		}
		return { storyTags, statuses };
	}

	/** Search all sources on a specific actor for a tag by id */
	#findTagOnActor(id, actor) {
		if (!actor) return null;
		// Effects (storyTags, statuses)
		const { storyTags, statuses } = this.#getActorEffects(actor);
		for (const e of [...storyTags, ...statuses]) {
			if (e.id === id) return e;
		}
		// Character themes
		for (const theme of actor.system.themes || []) {
			if (theme.themeTag?.id === id) return theme.themeTag;
			for (const t of theme.powerTags ?? []) {
				if (t.id === id) return t;
			}
			for (const t of theme.weaknessTags ?? []) {
				if (t.id === id) return t;
			}
		}
		// Embedded Story Themes use the actor's roll-selection ref as well.
		for (const story of actor.items ?? []) {
			if (story.type !== "story" || story.system.isArchived) continue;
			for (const tag of [
				story.system.themeTag,
				...(story.system.powerTags ?? []),
			]) {
				if (tag?.id === id) return tag;
			}
			for (const tag of story.system.weaknessTags ?? []) {
				if (tag.id === id) return tag;
			}
		}
		// Character backpack tags
		for (const t of actor.system.backpackTags ?? []) {
			if (t.id === id) return t;
		}
		for (const relationship of actor.system.relationships ?? []) {
			if (relationship.id !== id) continue;
			const source =
				relationship instanceof foundry.abstract.DataModel
					? relationship.toObject()
					: { ...relationship };
			return { ...source, type: "hero" };
		}
		// Fellowship
		if (actor.system?.fellowship) {
			for (const t of actor.system.fellowship.system.allTags ?? []) {
				if (t.id === id) return t;
			}
		}
		return null;
	}

	/** Search all sources for a tag by id (current actor + global) */
	#findTagAnywhere(id) {
		const tag = this.#findTagOnActor(id, this.actor);
		if (tag) return tag;
		// Global story tags
		try {
			const config = game.settings.get("litm-rn", "storytags") || {};
			for (const t of config.tags ?? []) {
				if (t.id === id) return t;
			}
		} catch (_) {
			/* no-op */
		}
		// Scene tags
		try {
			const config = canvas.scene?.getFlag("litm-rn", "scenetags") || {};
			for (const t of config.tags ?? []) {
				if (t.id === id) return t;
			}
		} catch (_) {
			/* no-op */
		}
		// Linked world Story Themes
		try {
			const config = game.settings.get("litm-rn", "storytags") || {};
			for (const itemId of config.storyThemeIds || []) {
				const item = game.items?.get(itemId);
				for (const t of item?.system?.allTags ?? []) {
					if (t.id === id)
						return t instanceof foundry.abstract.DataModel
							? t.toObject()
							: { ...t };
				}
			}
		} catch (_) {
			/* no-op */
		}
		return null;
	}

	#handleMightChange(event) {
		const value = Number.parseInt(event.currentTarget.value);
		this._might = value || 0;
		this.#saveState();
		this._updateTradeUI();
		this._dispatchUpdate();
	}

	#handleModifierChange(event) {
		const input = event.currentTarget;
		if (
			this._subtab === "sacrifice" &&
			Number(input.value) !== this._modifier &&
			this._sacrifice.state === "approved"
		) {
			this._sacrifice.state = "changed";
		}
		this._modifier = Number(input.value) || 0;
		this.#saveState();
		this._updateTradeUI();
		this._dispatchUpdate();
		if (this._subtab === "sacrifice") this.#broadcastSacrifice();
	}

	#handleTypeChange(event) {
		this.type = event.currentTarget.value;
		this.#clearInvalidTradeMode();
		this.#saveState();
		this._dispatchUpdate();
		this.render();
	}

	#handleTrade(event) {
		const action = event.currentTarget.dataset.click;
		if (action === "trade-caution") {
			if (!this.canThrowCaution) return;
			this._tradeMode = this._tradeMode === "caution" ? "" : "caution";
		} else if (action === "trade-hedge") {
			if (!this.canHedgeRisks) return;
			this._tradeMode = this._tradeMode === "hedge" ? "" : "hedge";
		}
		this.#saveState();
		this._dispatchUpdate();
		this.render();
	}

	#clearInvalidTradeMode() {
		const unavailable =
			(!this.camp && this.type !== "tracked") ||
			this._currentTab !== "detailed" ||
			Boolean(this._subtab);
		const invalidCaution =
			this._tradeMode === "caution" && !this.canThrowCaution;
		const invalidHedge = this._tradeMode === "hedge" && !this.canHedgeRisks;
		if (!this._tradeMode || (!unavailable && !invalidCaution && !invalidHedge))
			return false;
		this._tradeMode = "";
		return true;
	}

	_updateTradeUI() {
		const el = this.element;
		if (!el) return;
		if (this.#clearInvalidTradeMode()) {
			this.#saveState();
			el.querySelector(".litm--roll-trade-info")?.classList.remove(
				"is-visible",
			);
			const tradeModeInput = el.querySelector('input[name="tradeMode"]');
			if (tradeModeInput) tradeModeInput.value = "";
		}
		const totalPowerEl = el.querySelector("[data-update='totalPower']");
		if (totalPowerEl) totalPowerEl.textContent = this.totalPower;
		this.#invalidateRollApproval();
		const spendPowerEl = el.querySelector("[data-update='spendPower']");
		if (spendPowerEl) spendPowerEl.textContent = this.spendPower;
		const campSpendPowerEl = el.querySelector("[data-update='campSpendPower']");
		if (campSpendPowerEl)
			campSpendPowerEl.textContent = Math.ceil(this.basePower / 2);
		const campWithoutRollButton = el.querySelector(
			"[data-click='camp-without-roll']",
		);
		if (campWithoutRollButton)
			campWithoutRollButton.disabled = this.basePower < 1;
		const cautionBtn = el.querySelector(".litm--trade-caution");
		const hedgeBtn = el.querySelector(".litm--trade-hedge");
		if (cautionBtn) {
			cautionBtn.disabled = !this.canThrowCaution;
			cautionBtn.classList.toggle("active", this._tradeMode === "caution");
		}
		if (hedgeBtn) {
			hedgeBtn.disabled = !this.canHedgeRisks;
			hedgeBtn.classList.toggle("active", this._tradeMode === "hedge");
		}
	}

	_bindMightTooltip(wrapper, tooltip) {
		const tooltipEl = tooltip;
		this._tooltipEl = tooltipEl;
		const doc = getOwningDocument(wrapper);
		const win = getOwningWindow(wrapper);
		doc.body.appendChild(tooltipEl);

		wrapper.addEventListener("mouseenter", () => {
			if (!tooltipEl.isConnected) return;
			const rect = wrapper.getBoundingClientRect();
			tooltipEl.style.display = "block";
			const tooltipRect = tooltipEl.getBoundingClientRect();
			let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
			let top = rect.top - tooltipRect.height - 8;
			if (left < 4) left = 4;
			if (left + tooltipRect.width > win.innerWidth - 4) {
				left = win.innerWidth - tooltipRect.width - 4;
			}
			if (top < 4) {
				top = rect.bottom + 8;
				tooltipEl.classList.add("litm--might-tooltip-below");
			} else {
				tooltipEl.classList.remove("litm--might-tooltip-below");
			}
			tooltipEl.style.left = `${left}px`;
			tooltipEl.style.top = `${top}px`;
		});

		wrapper.addEventListener("mouseleave", () => {
			tooltipEl.style.display = "none";
		});
	}

	/** Programmatic add (called from character sheet) */
	addTag(tag, toBurn) {
		const ref = tag.actorId === this.actorId ? this.actor.uuid : "fellowship";
		const { state } = this.#statesForType(tag.type, toBurn, tag.isHindering);
		game.litm?.addTagToRoll?.(this.actorId, ref, tag.id, state);
	}

	/** Programmatic remove (called from character sheet) */
	removeTag(tag) {
		game.litm?.removeTagFromActorRoll?.(this.actorId, tag.id);
	}

	async reset() {
		this._modifier = 0;
		this._might = 0;
		this._tradeMode = "";
		this._selectedRoteKey = "";
		this._sacrifice = {
			level: "painful",
			themeId: "",
			statusName: "",
			achievement: "",
			state: "draft",
			proposerId: "",
		};
		this._rollApproval = { state: "draft", power: null, userId: "" };
		this.#saveState();
		const hadSelection = game.litm?.rollSelection?.has(this.actorId);
		game.litm?.clearActorRollSelection?.(this.actorId);
		if (!hadSelection && this.rendered) this.render();
	}

	/** No-op — kept for external callers; _prepareContext reads fresh data each render */
	refreshTags() {}

	async _processSubmitData(event, form, formData) {
		const data = formData.object;
		const { actorId, type, shouldRoll, modifier, might, tradeMode } = data;
		if (this._subtab === "sacrifice") {
			this.#readSacrificeForm(formData.object);
			if (!this.#validateSacrifice()) return;
			if (
				!game.user.isGM &&
				game.settings.get("litm-rn", "block_rolls_until_moderated") &&
				this._sacrifice.state !== "approved"
			)
				return;
			const rollData = {
				actorId: actorId ?? this.actorId,
				type: "sacrifice",
				rollTypeLabel: this.rollTypeLabel,
				tags: [],
				title: t("Litm.ui.subtab-sacrifice"),
				speaker: this.speaker,
				modifier: modifier ?? this._modifier,
				might: 0,
				tradeMode: "",
				sacrifice: this.#sacrificeData(),
			};
			this.#clearSacrificeProposal(true);
			return LitmRollDialog.roll(rollData);
		}
		const isGroup = this._currentTab === "group";
		const groupData = isGroup ? this.#getAllGroupTags() : null;
		const tags = isGroup ? groupData.tags : this.#getAllSelectedTags();
		let selectedRote = null;
		if (shouldRoll && !isGroup && !this._subtab && this._selectedRoteKey) {
			const candidates = await this.#rollRoteCandidates(tags, { fresh: true });
			selectedRote = candidates.find(
				(rote) => rote.key === this._selectedRoteKey,
			);
			if (!selectedRote) {
				this._selectedRoteKey = "";
				this.#revokeRoteApproval();
				this.#saveState();
				this._dispatchUpdate();
				this.render();
				ui.notifications.warn(t("Litm.rote.roll-unavailable"));
				return;
			}
		}
		const rollType = this.camp ? "tracked" : (type ?? this.type);
		const typeLabel =
			rollType === "reaction" || rollType === "mitigate"
				? t("Litm.ui.roll-reaction")
				: rollType === "tracked"
					? t("Litm.ui.roll-tracked")
					: t("Litm.ui.roll-quick");
		const rollTypeLabel = isGroup
			? `${t("Litm.ui.roll-group")} (${typeLabel})`
			: this.rollTypeLabel;

		const rollData = {
			actorId: actorId ?? this.actorId,
			type: rollType,
			rollTypeLabel,
			tags,
			title: rollTypeLabel,
			speaker: this.speaker,
			modifier: (modifier ?? this._modifier) + (Number(this.camp?.bonus) || 0),
			might: might ?? this._might,
			tradeMode:
				this._currentTab === "detailed" &&
				!this._subtab &&
				(this.camp || (type ?? this.type) === "tracked")
					? tradeMode || ""
					: "",
			participants: groupData?.participants?.length
				? groupData.participants
				: null,
			fellowshipId: isGroup ? getActorFellowshipId(this.actor) : null,
			isGroup,
			campBonus: Number(this.camp?.bonus) || 0,
			campLabel: this.camp
				? this.camp.duration === "camp"
					? t("Litm.camp.duration-camp")
					: t("Litm.camp.duration-sojourn")
				: "",
			campFellowshipId: this.camp?.fellowshipId ?? null,
			isCampAction: !!this.camp,
			rote: selectedRote
				? {
						uuid: selectedRote.uuid,
						name: selectedRote.name,
						img: selectedRote.img,
						effects: selectedRote.effects,
						consequences: selectedRote.consequences,
					}
				: null,
		};

		if (shouldRoll) {
			const approved =
				this._rollApproval.state === "approved" &&
				this._rollApproval.power === this.totalPower;
			if (
				!game.user.isGM &&
				game.settings.get("litm-rn", "block_rolls_until_moderated") &&
				!approved
			)
				return;
			const campActionPower = this.camp ? this.totalPower : null;
			const result = await LitmRollDialog.roll(rollData);
			if (this.camp) {
				game.litm?.CampDialog?.recordAction?.(this.camp, this.actorId, {
					method: "roll",
					power: campActionPower,
					messageId: result?.id ?? null,
					at: Date.now(),
				});
				game.litm?.clearActorRollSelection?.(this.actorId);
				await this.close();
			}
			return result;
		}
	}

	async #resolveCampWithoutRoll() {
		if (!this.camp || this.basePower < 1) return;
		const safePower = this.basePower;
		const effects = Math.ceil(safePower / 2);
		const filtered = LitmRollDialog.#filterTags(this.#getAllSelectedTags());
		const preview = new game.litm.LitmRoll(
			"0",
			{},
			{
				actorId: this.actorId,
				rollId: foundry.utils.randomID(),
				type: "tracked",
				rollTypeLabel: this.rollTypeLabel,
				...filtered,
				totalPower: safePower,
				spendPower: safePower,
				modifier: this._modifier + (Number(this.camp?.bonus) || 0),
				displayModifier: this._modifier,
				campBonus: Number(this.camp?.bonus) || 0,
				campLabel:
					this.camp.duration === "camp"
						? t("Litm.camp.duration-camp")
						: t("Litm.camp.duration-sojourn"),
				might: this._might,
				tradeMode: "",
				sceneId: canvas.scene?.id ?? null,
				campFellowshipId: this.camp.fellowshipId,
				safeCamp: true,
				_total: 0,
				_outcome: null,
			},
		);
		const content = await foundry.applications.handlebars.renderTemplate(
			game.litm.LitmRoll.CHAT_TEMPLATE,
			{
				actor: this.actor,
				outcome: { label: "", description: "" },
				power: effects,
				tooltip: await preview.getTooltip(),
				total: safePower,
				type: "tracked",
				safeCamp: true,
				tradeMode: "",
			},
		);
		const message = await CONFIG.ChatMessage.documentClass.create({
			content,
			speaker: this.speaker,
			flavor: this.rollTypeLabel,
			flags: {
				"litm-rn": {
					campAction: { method: "spend", power: safePower, effects },
				},
			},
		});
		game.litm?.CampDialog?.recordAction?.(this.camp, this.actorId, {
			method: "spend",
			power: safePower,
			effects,
			messageId: message?.id ?? null,
			at: Date.now(),
		});
		try {
			if (game.user.isGM) {
				const report = await game.litm.LitmRoll.postRollProcessing(preview);
				if (report?.failed > 0)
					ui.notifications.warn(t("Litm.ui.post-roll-partial-failure"));
			} else {
				Sockets.requestPostRollProcessing({
					...preview.litm,
					_total: 0,
					_outcome: null,
				});
			}
		} finally {
			await this.reset();
			await this.close();
		}
	}

	/** Send the current roll to every active Narrator for review. */
	#requestRollApproval() {
		if (!game.users.some((user) => user.isGM && user.active)) {
			ui.notifications.warn(t("Litm.ui.roll-no-active-gm"));
			return;
		}
		Sockets.dispatch("requestRollApproval", this.#rollModerationData());
		ui.notifications.info(t("Litm.ui.roll-approval-request-sent"));
	}

	/** Approve the current total power and synchronize it with actor owners. */
	#approveRoll() {
		this._rollApproval = {
			state: "approved",
			power: this.totalPower,
			userId: this._rollApproval.userId || game.user.id,
		};
		this.#saveState();
		Sockets.dispatch("approveRoll", this.#rollModerationData());
		this.render();
	}

	/** Return the serializable state required to reopen this exact roll view. */
	#rollModerationData() {
		return {
			actorId: this.actorId,
			userId: this._rollApproval.userId || game.user.id,
			power: this.totalPower,
			modifier: this._modifier,
			might: this._might,
			tradeMode: this._tradeMode,
			selectedRoteKey: this._selectedRoteKey,
			currentTab: this._currentTab,
			subtab: this._subtab,
			type: this.type,
			camp: this.camp ? foundry.utils.deepClone(this.camp) : null,
		};
	}

	/** Require fresh moderation after the chosen Rote changes. */
	#revokeRoteApproval() {
		if (this._rollApproval.state !== "approved") return;
		this._rollApproval = { state: "draft", power: null, userId: "" };
		Sockets.dispatch("clearRollApproval", { actorId: this.actorId });
	}

	/** Permanently revoke approval as soon as total power changes. */
	#invalidateRollApproval(rerender = true) {
		if (
			this._rollApproval.state !== "approved" ||
			this._rollApproval.power === this.totalPower
		)
			return;
		this._rollApproval = { state: "draft", power: null, userId: "" };
		this.#saveState();
		Sockets.dispatch("clearRollApproval", { actorId: this.actorId });
		if (rerender && this.rendered) this.render();
	}

	/** Save current per-actor state (modifier/might/tradeMode) to the static map */
	#saveState() {
		if (!this.actorId) return;
		LitmRollDialog.#actorStates.set(this.actorId, {
			modifier: this._modifier,
			might: this._might,
			tradeMode: this._tradeMode,
			selectedRoteKey: this._selectedRoteKey,
			sacrifice: { ...this._sacrifice },
			rollApproval: { ...this._rollApproval },
		});
	}

	/** Restore per-actor state from the static map (tab/subtab are global, not per-actor) */
	#restoreState() {
		if (!this.actorId) return;
		const state = LitmRollDialog.#actorStates.get(this.actorId);
		if (state) {
			this._modifier = state.modifier ?? 0;
			this._might = state.might ?? 0;
			this._tradeMode = state.tradeMode ?? "";
			this._selectedRoteKey = state.selectedRoteKey ?? "";
			this._sacrifice = { ...this._sacrifice, ...state.sacrifice };
			this._rollApproval = { ...this._rollApproval, ...state.rollApproval };
		} else {
			this._modifier = 0;
			this._might = 0;
			this._tradeMode = "";
			this._selectedRoteKey = "";
			this._sacrifice = {
				level: "painful",
				themeId: "",
				statusName: "",
				achievement: "",
				state: "draft",
				proposerId: "",
			};
			this._rollApproval = { state: "draft", power: null, userId: "" };
		}
	}

	_dispatchUpdate() {
		Sockets.dispatch("updateRollDialog", {
			actorId: this.actorId,
			modifier: this._modifier,
			might: this._might,
			tradeMode: this._tradeMode,
			selectedRoteKey: this._selectedRoteKey,
			camp: this.camp ? foundry.utils.deepClone(this.camp) : null,
		});
	}

	/** Return an existing roll dialog for the same actor and optional Camp activity. */
	static findOpen(actorId, camp = null) {
		return (
			[...this.#instances].find((dialog) => {
				if (dialog.actorId !== actorId) return false;
				if (!camp) return !dialog.camp;
				return (
					dialog.camp?.sessionId === camp.sessionId &&
					dialog.camp?.phaseIndex === camp.phaseIndex
				);
			}) ?? null
		);
	}

	/** Open or retarget the Narrator's single reusable roll dialog. */
	static openForGm(actorId, { camp = null, type = null } = {}) {
		if (!game.user.isGM || !actorId) return null;
		let dialog = game.litm?.gmRollDialog;
		if (!(dialog instanceof LitmRollDialog)) {
			dialog = new LitmRollDialog(actorId, {
				camp,
				type: type ?? (camp ? "tracked" : "quick"),
			});
			game.litm.gmRollDialog = dialog;
		} else if (dialog.actorId !== actorId) {
			dialog.switchTab(actorId);
		}
		const previousCamp = dialog.camp;
		const nextType =
			type ?? (camp ? "tracked" : previousCamp ? "quick" : dialog.type);
		dialog.receiveUpdate({
			actorId,
			camp,
			type: nextType,
			currentTab:
				camp || nextType === "tracked"
					? "detailed"
					: previousCamp
						? "quick"
						: dialog._currentTab,
			subtab: "",
		});
		dialog.render({ force: true });
		return dialog;
	}

	/** Return the serializable Sacrifice form data. */
	#sacrificeData() {
		return {
			level: this._sacrifice.level,
			themeId: this._sacrifice.themeId,
			statusName: this._sacrifice.statusName,
			achievement: this._sacrifice.achievement,
			state: this._sacrifice.state,
			proposerId: this._sacrifice.proposerId,
		};
	}

	/** Read the Sacrifice controls from submitted form data. */
	#readSacrificeForm(data) {
		const previous = JSON.stringify([
			this._sacrifice.level,
			this._sacrifice.themeId,
			this._sacrifice.statusName,
			this._sacrifice.achievement,
			Number(this._modifier) || 0,
		]);
		this._sacrifice.level = data.sacrificeLevel || this._sacrifice.level;
		this._sacrifice.themeId = data.sacrificeThemeId || "";
		this._sacrifice.statusName = String(data.sacrificeStatusName || "");
		this._sacrifice.achievement = String(data.sacrificeAchievement || "");
		if (data.modifier !== undefined)
			this._modifier = Number(data.modifier) || 0;
		const current = JSON.stringify([
			this._sacrifice.level,
			this._sacrifice.themeId,
			this._sacrifice.statusName,
			this._sacrifice.achievement,
			Number(data.modifier ?? this._modifier) || 0,
		]);
		if (previous !== current && this._sacrifice.state === "approved") {
			this._sacrifice.state = "changed";
		}
		return previous !== current;
	}

	/** Synchronize Sacrifice controls; text fields are debounced to preserve typing. */
	#syncSacrificeForm(form, rerender) {
		const formData = new foundry.applications.ux.FormDataExtended(form);
		const wasApproved = this._sacrifice.state === "approved";
		if (!this.#readSacrificeForm(formData.object)) return;
		if (!this._sacrifice.proposerId && !game.user.isGM) {
			this._sacrifice.proposerId = game.user.id;
		}
		this.#saveState();
		clearTimeout(this._sacrificeSyncTimeout);
		const dispatchSync = () =>
			Sockets.dispatch("syncSacrifice", {
				actorId: this.actorId,
				modifier: this._modifier,
				sacrifice: this.#sacrificeData(),
			});
		if (rerender) {
			dispatchSync();
			this.render();
		} else {
			if (wasApproved && this._sacrifice.state === "changed") {
				const state = this.element?.querySelector(".litm--sacrifice-state");
				if (state) {
					state.className = "litm--sacrifice-state changed";
					state.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${t("Litm.ui.sacrifice-changed-indicator")}`;
				}
				const rollButton = this.element?.querySelector(
					"[data-click='roll-sacrifice']",
				);
				rollButton?.classList.remove("approved");
				if (
					rollButton &&
					!game.user.isGM &&
					game.settings.get("litm-rn", "block_rolls_until_moderated")
				) {
					rollButton.disabled = true;
				}
			}
			this._sacrificeSyncTimeout = setTimeout(dispatchSync, 250);
		}
	}

	/** Broadcast the current Sacrifice state after a non-text control changes. */
	#broadcastSacrifice() {
		this.#saveState();
		Sockets.dispatch("syncSacrifice", {
			actorId: this.actorId,
			modifier: this._modifier,
			sacrifice: this.#sacrificeData(),
		});
		if (this.rendered) this.render();
	}

	/** Validate the required Sacrifice choices before proposing or rolling. */
	#validateSacrifice() {
		if (!this._sacrifice.themeId) {
			ui.notifications.warn(t("Litm.ui.sacrifice-select-theme-warning"));
			return false;
		}
		if (
			this._sacrifice.level === "grave" &&
			!this._sacrifice.statusName.trim()
		) {
			ui.notifications.warn(t("Litm.ui.sacrifice-status-warning"));
			return false;
		}
		return true;
	}

	/** Send the current Sacrifice proposal to the active Narrator. */
	#proposeSacrifice(form) {
		const formData = new foundry.applications.ux.FormDataExtended(form);
		this.#readSacrificeForm(formData.object);
		if (!this.#validateSacrifice()) return;
		const activeGM =
			game.users.activeGM ??
			game.users.find((user) => user.isGM && user.active);
		if (!activeGM) {
			ui.notifications.warn(t("Litm.ui.sacrifice-no-active-gm"));
			return;
		}
		this._sacrifice.state = "pending";
		this._sacrifice.proposerId = game.user.id;
		Sockets.dispatch("proposeSacrifice", {
			actorId: this.actorId,
			userId: game.user.id,
			modifier: this._modifier,
			sacrifice: this.#sacrificeData(),
		});
		ui.notifications.info(t("Litm.ui.sacrifice-proposal-sent"));
		this.render();
	}

	/** Approve the proposal currently displayed in the Narrator's dialog. */
	#approveSacrifice(form) {
		const formData = new foundry.applications.ux.FormDataExtended(form);
		this.#readSacrificeForm(formData.object);
		if (!this.#validateSacrifice()) return;
		this._sacrifice.state = "approved";
		Sockets.dispatch("approveSacrifice", {
			actorId: this.actorId,
			userId: this._sacrifice.proposerId,
			modifier: this._modifier,
			sacrifice: this.#sacrificeData(),
		});
		ui.notifications.info(t("Litm.ui.sacrifice-approved"));
		this.render();
	}

	/** Clear local and remote proposal state after a Sacrifice roll. */
	#clearSacrificeProposal(dispatchRemote = false) {
		const userId = this._sacrifice.proposerId;
		this._sacrifice = {
			level: "painful",
			themeId: "",
			statusName: "",
			achievement: "",
			state: "draft",
			proposerId: "",
		};
		this.#saveState();
		if (this.rendered) this.render();
		if (dispatchRemote) {
			Sockets.dispatch("clearSacrifice", { actorId: this.actorId, userId });
		}
	}

	_cleanupTooltip() {
		this._tooltipEl?.remove();
		this._tooltipEl = null;
	}

	#cleanupRoteTooltips() {
		for (const tooltip of this._roteTooltipEls) tooltip.remove();
		this._roteTooltipEls = [];
	}

	/** Build the groupSelected object for the Group tab top block */
	#buildGroupSelected(fellowshipId, fellowshipItem) {
		const result = { heroes: [], fellowship: [], story: [] };
		if (!game.litm) return result;

		// Heroes: all fellowship characters with their selected tags
		if (fellowshipId) {
			const allChars = getFellowshipActors(fellowshipId).filter(
				(member) => member.type === "character",
			);
			for (const char of allChars) {
				const charSel = game.litm.rollSelection?.get(char.id);
				if (!charSel) continue;
				const tags = [];
				for (const [ref, tagMap] of charSel) {
					if (tagMap.size === 0) continue;
					if (ref === "fellowship") continue;
					for (const [tagId, state] of tagMap) {
						let srcTag = null;
						if (ref === "story") {
							try {
								const storyConfig =
									game.settings.get("litm-rn", "storytags") || {};
								srcTag = (storyConfig.tags || []).find((t) => t.id === tagId);
							} catch (_) {
								/* no-op */
							}
						} else if (isSceneSelectionRef(ref)) {
							try {
								const sceneConfig =
									getSceneForSelectionRef(ref)?.getFlag(
										"litm-rn",
										"scenetags",
									) || {};
								srcTag = (sceneConfig.tags || []).find((t) => t.id === tagId);
							} catch (_) {
								/* no-op */
							}
						} else if (ref.startsWith("story-theme-")) {
							srcTag = this.#findStoryThemeTag(tagId, ref);
						} else {
							const refActor = this.#resolveRefActor(ref);
							if (refActor) srcTag = this.#findTagOnActor(tagId, refActor);
						}
						if (srcTag) {
							const e = this.#enrichTag({ ...srcTag }, ref);
							e.state = state;
							e.displayName = this.#maskTagName(srcTag);
							e._selectionActorId = char.id;
							e._selectionKind = "actor";
							e._canRemove = game.user.isGM || char.isOwner;
							tags.push(e);
						}
					}
				}
				if (tags.length > 0) {
					result.heroes.push({
						id: char.id,
						name: char.name,
						img: char.img,
						tags,
					});
				}
			}
		}

		// Fellowship: selected fellowship tags from all actors (deduplicated)
		if (fellowshipItem) {
			const seenTagIds = new Set();
			for (const [selectedActorId, refMap] of game.litm.rollSelection ?? []) {
				const fellowMap = refMap.get("fellowship");
				if (!fellowMap) continue;
				for (const [tagId, state] of fellowMap) {
					if (seenTagIds.has(tagId)) continue;
					seenTagIds.add(tagId);
					const allTags = fellowshipItem.system?.allTags ?? [];
					const srcTag =
						allTags.find((t) => t.id === tagId) ??
						this.#getSharedTag(selectedActorId, tagId);
					if (srcTag) {
						const selectedActor = game.actors.get(selectedActorId);
						const obj =
							srcTag instanceof foundry.abstract.DataModel
								? srcTag.toObject()
								: { ...srcTag };
						const e = this.#enrichTag(obj, "fellowship");
						e.state = state;
						e.displayName = this.#maskTagName(obj);
						e._selectionActorId = selectedActorId;
						e._selectionKind = "actor";
						e._canRemove = game.user.isGM || selectedActor?.isOwner;
						result.fellowship.push(e);
					}
				}
			}
		}

		// Story (Narrator column): all GM selections (any ref type)
		if (game.litm.gmRollSelection) {
			for (const [, refMap] of game.litm.gmRollSelection) {
				for (const [ref, tagMap] of refMap) {
					if (tagMap.size === 0) continue;
					for (const [tagId, state] of tagMap) {
						let srcTag = null;
						if (ref === "story") {
							try {
								const storyConfig =
									game.settings.get("litm-rn", "storytags") || {};
								srcTag = (storyConfig.tags || []).find((t) => t.id === tagId);
							} catch (_) {
								/* no-op */
							}
						} else if (isSceneSelectionRef(ref)) {
							try {
								const sceneConfig =
									getSceneForSelectionRef(ref)?.getFlag(
										"litm-rn",
										"scenetags",
									) || {};
								srcTag = (sceneConfig.tags || []).find((t) => t.id === tagId);
							} catch (_) {
								/* no-op */
							}
						} else if (ref.startsWith("story-theme-")) {
							srcTag = this.#findStoryThemeTag(tagId, ref);
						} else {
							const refActor = this.#resolveRefActor(ref);
							if (refActor) srcTag = this.#findTagOnActor(tagId, refActor);
							if (!srcTag) srcTag = this.#findTagAnywhere(tagId);
						}
						if (!srcTag) continue;
						const e = this.#enrichTag({ ...srcTag }, ref);
						e.state = state;
						e.displayName = this.#maskTagName(srcTag);
						e._selectionKind = "gm";
						e._canRemove = game.user.isGM;
						result.story.push(e);
					}
				}
			}
		}

		return result;
	}

	/** Cycle a tag in the GM's roll selection (used in Group tab for story/scene tags) */
	#gmCycleTag(id, ref, shiftKey, toggleOnly = false, retainEmpty = false) {
		if (!game.user.isGM) return;
		const userId = game.user.id;
		const refMap =
			game.litm?.gmRollSelection?.get(userId)?.get(ref) ?? new Map();
		const isPresent = refMap.has(id);
		const current = refMap.get(id) || "";
		if (toggleOnly && isPresent) {
			game.litm?.gmRemoveTagFromRoll?.(userId, ref, id);
			return;
		}

		let srcTag = null;
		if (ref === "story") {
			try {
				const config = game.settings.get("litm-rn", "storytags") || {};
				srcTag = (config.tags || []).find((t) => t.id === id);
			} catch (_) {
				/* no-op */
			}
		} else if (isSceneSelectionRef(ref)) {
			try {
				const config =
					getSceneForSelectionRef(ref)?.getFlag("litm-rn", "scenetags") || {};
				srcTag = (config.tags || []).find((t) => t.id === id);
			} catch (_) {
				/* no-op */
			}
		} else if (ref.startsWith("story-theme-")) {
			srcTag = this.#findStoryThemeTag(id, ref);
		} else {
			const refActor = this.#resolveRefActor(ref);
			if (refActor) srcTag = this.#findTagOnActor(id, refActor);
			if (!srcTag) srcTag = this.#findTagAnywhere(id);
		}
		if (!srcTag) return;

		const { states } = this.#statesForType(
			srcTag.type || "tag",
			false,
			srcTag.isHindering,
			srcTag.isCrispy,
		);
		const allowed = states.split(",").filter(Boolean);

		let nextState;
		if (!isPresent || !current) {
			nextState =
				shiftKey &&
				!ref.startsWith("story-theme-") &&
				allowed.includes("burned")
					? "burned"
					: allowed[0];
		} else {
			const idx = allowed.indexOf(current);
			if (idx < 0 || idx >= allowed.length - 1) {
				nextState = retainEmpty ? "" : null;
			} else {
				nextState = allowed[idx + 1];
			}
		}

		if (nextState === null) game.litm?.gmRemoveTagFromRoll?.(userId, ref, id);
		else game.litm?.gmAddTagToRoll?.(userId, ref, id, nextState);
	}

	async receiveUpdate({
		actorId,
		modifier,
		might,
		tradeMode,
		selectedRoteKey,
		sacrifice,
		openSacrifice = false,
		rollApproval,
		currentTab,
		subtab,
		type,
		camp,
	}) {
		if (actorId !== this.actorId) {
			const state = LitmRollDialog.#actorStates.get(actorId) ?? {};
			LitmRollDialog.#actorStates.set(actorId, {
				modifier: modifier ?? state.modifier ?? 0,
				might: might ?? state.might ?? 0,
				tradeMode: tradeMode ?? state.tradeMode ?? "",
				selectedRoteKey: selectedRoteKey ?? state.selectedRoteKey ?? "",
				sacrifice: sacrifice
					? { ...state.sacrifice, ...sacrifice }
					: state.sacrifice,
				rollApproval: rollApproval
					? { ...state.rollApproval, ...rollApproval }
					: state.rollApproval,
			});
			return;
		}
		if (modifier !== undefined) this._modifier = modifier;
		if (might !== undefined) this._might = might;
		if (tradeMode !== undefined) this._tradeMode = tradeMode;
		if (selectedRoteKey !== undefined) this._selectedRoteKey = selectedRoteKey;
		if (sacrifice) this._sacrifice = { ...this._sacrifice, ...sacrifice };
		if (rollApproval)
			this._rollApproval = { ...this._rollApproval, ...rollApproval };
		if (currentTab) this._currentTab = currentTab;
		if (subtab !== undefined) this._subtab = subtab;
		if (type) this.type = type;
		if (camp !== undefined) {
			this.camp = camp ? foundry.utils.deepClone(camp) : null;
			if (this.camp) {
				this._currentTab = "detailed";
				this._sourceTab = "hero";
			}
		}
		if (openSacrifice) {
			this._currentTab = "quick";
			this._subtab = "sacrifice";
			this.type = "sacrifice";
		}
		this.#saveState();
		if (this.rendered) this.render();
	}

	/** Switch to a different actor's tab in the dialog (preserves per-actor state) */
	switchTab(actorId) {
		if (actorId === this.actorId) return;
		this.#saveState();
		this.actorId = actorId;
		const newActor = game.actors.get(actorId);
		if (newActor)
			this.speaker = CONFIG.ChatMessage.documentClass.getSpeaker({
				actor: newActor,
			});
		this.#restoreState();
		if (this.rendered) this.render();
	}
}
