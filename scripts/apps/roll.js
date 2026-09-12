import { ThemeAdvancement } from "../system/theme-advancement.js";
import { addOrStackActorStatus, localize as t } from "../utils.js";
const { fromUuidSync } = foundry.utils;

export class LitmRoll extends foundry.dice.Roll {
	static #processedPostRollIds = new Set();

	static CHAT_TEMPLATE = "systems/litm-rn/templates/chat/message.html";
	static TOOLTIP_TEMPLATE =
		"systems/litm-rn/templates/chat/message-tooltip.html";

	get litm() {
		return this.options;
	}

	get actor() {
		return game.actors.get(this.litm.actorId);
	}

	get speaker() {
		return { alias: this.actor.name };
	}

	get flavor() {
		if (this.litm.rollTypeLabel) return this.litm.rollTypeLabel;
		switch (this.litm.type) {
			case "sacrifice":
				return t("Litm.ui.subtab-sacrifice");
			case "reaction":
			case "mitigate":
				return t("Litm.ui.roll-reaction", "Litm.other.outcome");
			case "tracked":
				return t("Litm.ui.roll-tracked", "Litm.other.outcome");
			default:
				return t("Litm.ui.roll-quick", "Litm.other.outcome");
		}
	}

	/** Whether this is a Reaction roll, including legacy Mitigate messages. */
	get isReaction() {
		return this.litm.type === "reaction" || this.litm.type === "mitigate";
	}

	get effect() {
		if (!this.isReaction) return null;
		return {
			action: "Litm.reaction.action",
			description: "Litm.reaction.description",
			cost: "Litm.reaction.cost",
		};
	}

	get power() {
		const outcome = this.litm.safeCamp ? "" : this.outcome.label;

		if (this.litm.type === "quick" || this.litm.type === "sacrifice")
			return null;
		if (outcome === "failure") return 0;

		// spendPower already has trade adjustments and minimum applied
		const basePower = this.litm.spendPower ?? Math.max(this.litm.totalPower, 1);
		let totalPower = Math.max(basePower, 1);

		if (outcome === "consequence") return totalPower;

		if (this.isReaction) totalPower += 1;
		return totalPower;
	}

	get tradeMode() {
		return this.options.tradeMode || "";
	}

	get outcome() {
		if (this.litm.type === "sacrifice") {
			if (this.total >= 10) {
				return {
					label: "miracle",
					description: "Litm.ui.sacrifice-outcome-miracle-description",
				};
			}
			if (this.total >= 7) {
				return {
					label: "fate",
					description: "Litm.ui.sacrifice-outcome-fate-description",
				};
			}
			return {
				label: "in-vain",
				description: "Litm.ui.sacrifice-outcome-in-vain-description",
			};
		}
		const { resolver } = CONFIG.litm?.roll ?? {};

		if (typeof resolver === "function") return resolver(this);

		if (this.dice[0].total === 2)
			return { label: "failure", description: "Litm.ui.roll-failure" };

		if (this.total > 9 || this.dice[0].total === 12)
			return { label: "success", description: "Litm.ui.roll-success" };

		if (this.total > 6)
			return { label: "consequence", description: "Litm.ui.roll-consequence" };

		return { label: "failure", description: "Litm.ui.roll-failure" };
	}

	get modifier() {
		return this.options.modifier || 0;
	}

	get might() {
		return Number(this.options.might) || 0;
	}

	async render({
		template = this.constructor.CHAT_TEMPLATE,
		isPrivate = false,
	} = {}) {
		if (!this._evaluated) await this.evaluate({ async: true });

		const sacrificeOutcome = this.outcome.label;
		const sacrificeLevel = this.litm.sacrifice?.level;
		let sacrificeConsequence = "";
		if (this.litm.type === "sacrifice") {
			if (sacrificeOutcome === "miracle") {
				sacrificeConsequence =
					sacrificeLevel === "painful"
						? "scratch-one"
						: sacrificeLevel === "scarring"
							? "scratch-all"
							: "replace-theme";
			} else {
				sacrificeConsequence =
					sacrificeLevel === "painful"
						? "scratch-all"
						: sacrificeLevel === "scarring"
							? "replace-theme"
							: "status-six";
			}
		}
		const chatData = {
			actor: this.actor,
			formula: isPrivate ? "???" : this._formula.replace(/\s\+0/, ""),
			flavor: isPrivate ? null : this.flavor,
			outcome: isPrivate ? "???" : this.outcome,
			power: isPrivate ? "???" : this.power,
			result: isPrivate ? "???" : this.result,
			title: this.litm.title,
			tooltip: isPrivate ? "" : await this.getTooltip(),
			total: isPrivate ? "" : Math.round(this.total * 100) / 100,
			type: this.isReaction ? "reaction" : this.litm.type,
			effect: this.effect,
			modifier: isPrivate ? "???" : this.modifier,
			might: isPrivate ? "???" : this.might,
			tradeMode: isPrivate ? "" : this.tradeMode,
			spendPower: isPrivate ? "???" : (this.litm.spendPower ?? this.power),
			user: game.user.id,
			isOwner: game.user.isGM || this.actor.isOwner,
			sacrifice: this.litm.sacrifice
				? {
						...this.litm.sacrifice,
						levelLabel: t(`Litm.ui.sacrifice-${this.litm.sacrifice.level}`),
						themeName: (() => {
							const theme = this.actor.system.themes?.find(
								(entry) => entry.id === this.litm.sacrifice.themeId,
							);
							return theme?.themeTag?.name || theme?.name || "";
						})(),
						consequence: sacrificeConsequence,
					}
				: null,
		};

		return foundry.applications.handlebars.renderTemplate(template, chatData);
	}

	async getTooltip() {
		const parts = this.dice.map((d) => d.getTooltipData());
		const data = this.getTooltipData();
		return foundry.applications.handlebars.renderTemplate(
			LitmRoll.TOOLTIP_TEMPLATE,
			{ data, parts },
		);
	}

	getTooltipData() {
		const outcome = this.litm.safeCamp ? "" : this.outcome.label;
		const result = {
			reaction: this.isReaction && outcome === "success",
			modifier: this.litm.displayModifier ?? this.modifier,
			campBonus: Number(this.litm.campBonus) || 0,
			campLabel: this.litm.campLabel || "",
			might: this.might,
			tradeMode: this.tradeMode,
			sourceGroups: null,
		};

		if (this.litm.participants) {
			result.sourceGroups = this.litm.participants.map((p) => ({
				name: p.name,
				tags: p.tags.map((t) => {
					let value = 0;
					let flavor = "";
					let flavorClass = "";

					if (t.state === "burned") {
						value = 3;
						flavor = game.i18n.localize("Litm.tags.isBurnt");
						flavorClass = "burned";
					} else if (t.state === "positive") {
						if (t.type === "status" || t.type === "might") {
							value = Number(t.value) || 0;
							flavor = game.i18n.localize(
								t.type === "might" ? "Litm.other.might" : "Litm.other.status",
							);
							flavorClass = "positive";
						} else {
							value = 1;
							flavor =
								t.type === "storyTag"
									? game.i18n.localize("Litm.other.tag")
									: "";
							flavorClass = t.type === "storyTag" ? "warning" : "";
						}
					} else if (t.state === "negative") {
						if (t.type === "status" || t.type === "might") {
							value = -(Number(t.value) || 0);
							flavor = game.i18n.localize(
								t.type === "might" ? "Litm.other.might" : "Litm.other.status",
							);
							flavorClass = "positive";
						} else if (
							t.type === "weaknessTag" ||
							t.type === "weaknessStoryTag"
						) {
							value = -1;
							flavor = game.i18n.localize("Litm.tags.weakness");
							flavorClass = "negative";
						} else if (
							t.type === "crispy" ||
							t.type === "powerCrispy" ||
							t.type === "themeCrispy" ||
							t.isCrispy
						) {
							value = -1;
							flavor = game.i18n.localize("Litm.tags.isBurnt");
							flavorClass = "burned";
						} else {
							value = -1;
							flavor = game.i18n.localize("Litm.other.tag");
							flavorClass = "warning";
						}
					}
					if (
						t.isCrispy ||
						t.type === "crispy" ||
						t.type === "powerCrispy" ||
						t.type === "themeCrispy"
					) {
						flavorClass = "burned";
					}

					return {
						...t,
						value,
						flavor,
						flavorClass,
						id: t.id,
						isPrivate: t.isPrivate,
						actorRef: t.actorRef,
						actorId: t.actorId,
					};
				}),
			}));
		} else {
			result.burntTags = this.litm.burntTags;
			result.powerTags = this.litm.powerTags;
			result.weaknessTags = this.litm.weaknessTags;
			result.positiveStatuses = this.litm.positiveStatuses;
			result.negativeStatuses = this.litm.negativeStatuses;
			result.crispyTags = this.litm.crispyTags;
			result.heroWeaknessTags = this.litm.heroWeaknessTags;
		}

		return result;
	}

	/**
	 * Automatically process post-roll effects: scratch burnt/crispy tags and
	 * gain experience from weakness tags. Called after toMessage() so the chat
	 * message renders without manual buttons.
	 */
	static async postRollProcessing(roll) {
		if (!game.user.isGM) return;
		const rollId = roll.litm?.rollId;
		if (rollId && this.#processedPostRollIds.has(rollId))
			return { processed: 0, failed: 0 };
		if (rollId) {
			this.#processedPostRollIds.add(rollId);
			if (this.#processedPostRollIds.size > 500) {
				this.#processedPostRollIds.delete(
					this.#processedPostRollIds.values().next().value,
				);
			}
		}
		const hasStoredOutcome = Object.hasOwn(roll.litm ?? {}, "_outcome");
		const outcome = hasStoredOutcome
			? roll.litm._outcome
			: roll.dice?.length
				? (roll.outcome?.label ?? null)
				: null;
		return this.#postProcessFromOptions({
			...roll.litm,
			_total: roll.total ?? roll.litm?._total,
			_outcome: outcome,
		});
	}

	static async #postProcessFromOptions(opts) {
		const rollingActorId = opts?.actorId ?? null;
		const report = { processed: 0, failed: 0 };
		const processSafely = async (label, operation) => {
			try {
				await operation();
				report.processed += 1;
			} catch (error) {
				report.failed += 1;
				console.error(`LITM | Post-roll operation failed: ${label}`, error);
			}
		};
		if (opts?.type === "sacrifice") {
			await processSafely("sacrifice", () =>
				this.#applySacrificeConsequence(opts),
			);
			return report;
		}

		const processTag = async (tag) => {
			// Permanent Story, Scene, and campsite tags may be burned for Power,
			// but the burn must never scratch or remove their source tag.
			if (tag?._ref === "story") {
				const source = game.settings
					.get("litm-rn", "storytags")
					?.tags?.find((entry) => entry.id === tag.id);
				if (tag.isPermanent || source?.isPermanent) return;
			} else if (tag?._ref === "camp") {
				const session = game.litm?.CampDialog?.getSession?.(
					opts.campFellowshipId,
				);
				const source = session?.campsite?.tags?.find(
					(entry) => entry.id === tag.id,
				);
				if (tag.isPermanent || source?.isPermanent) return;
			} else if (tag?._ref === "scene" || tag?._ref?.startsWith("scene:")) {
				const sceneId = tag._ref.startsWith("scene:")
					? tag._ref.slice("scene:".length)
					: opts.sceneId;
				const source = game.scenes
					?.get(sceneId)
					?.getFlag("litm-rn", "scenetags")
					?.tags?.find((entry) => entry.id === tag.id);
				if (tag.isPermanent || source?.isPermanent) return;
			}
			const sharedTargetActorId =
				tag.targetActorId || tag.actorId || rollingActorId;
			const sharedTag = tag.senderActorId
				? tag
				: game.litm?.getAcceptedSharedTag?.(sharedTargetActorId, tag.id);
			if (sharedTag) {
				await game.litm?.scratchSharedRollTag?.(
					tag.id,
					sharedTargetActorId,
					game.user.id,
				);
				return;
			}

			if (tag._ref?.startsWith("story-theme-")) {
				const itemId = tag._ref.slice("story-theme-".length);
				const item = game.items?.get(itemId);
				const isPowerTag = item?.system?.powerTags?.some(
					(entry) => entry.id === tag.id,
				);
				const isThemeTag = item?.system?.themeTag?.id === tag.id;
				if (!item || (!isPowerTag && !isThemeTag)) return;
				const update = {};
				if (isThemeTag) {
					update["system.themeTag.isScratched"] = true;
				} else {
					const powerTags = item.system.powerTags.map((entry) =>
						entry.toObject(),
					);
					const source = powerTags.find((entry) => entry.id === tag.id);
					if (!source) return;
					source.isScratched = true;
					update["system.powerTags"] = powerTags;
				}
				game.litm?.removeTagFromAllRolls?.(tag.id);
				game.litm?.gmRemoveTagFromAllRolls?.(tag.id);
				await item.update(update);
				Hooks.callAll("litmStoryTagsUpdated");
				return;
			}

			if (tag._ref === "fellowship") {
				const selectionActor = game.actors.get(tag.actorId || rollingActorId);
				const fellowship = selectionActor?.system?.fellowship;
				const isThemeTag = fellowship?.system?.themeTag?.id === tag.id;
				const isPowerTag = fellowship?.system?.powerTags?.some(
					(entry) => entry.id === tag.id,
				);
				if (!fellowship || (!isThemeTag && !isPowerTag)) return;
				const update = {};
				if (isThemeTag) {
					update["system.themeTag.isScratched"] = true;
				} else {
					const powerTags = fellowship.system.powerTags.map((entry) =>
						entry.toObject(),
					);
					const source = powerTags.find((entry) => entry.id === tag.id);
					if (!source) return;
					source.isScratched = true;
					update["system.powerTags"] = powerTags;
				}
				game.litm?.removeTagFromAllRolls?.(tag.id);
				game.litm?.gmRemoveTagFromAllRolls?.(tag.id);
				await fellowship.update(update);
				Hooks.callAll("litmActorDataUpdated", selectionActor?.uuid);
				return;
			}

			if (tag._ref === "camp") {
				if (!opts.campFellowshipId)
					throw new Error("Missing Fellowship ID for campsite tag");
				const session = game.litm?.CampDialog?.getSession?.(
					opts.campFellowshipId,
				);
				if (!session?.campsite?.tags?.some((entry) => entry.id === tag.id))
					return;
				await game.litm?.CampDialog?.removeCampsiteTag?.(
					opts.campFellowshipId,
					tag.id,
				);
				game.litm?.removeTagFromAllRolls?.(tag.id);
				game.litm?.gmRemoveTagFromAllRolls?.(tag.id);
				return;
			}

			const tagOwnerRef = tag.actorRef || tag.actorId || rollingActorId;
			let actor = null;

			if (tagOwnerRef) {
				const id =
					typeof tagOwnerRef === "string"
						? tagOwnerRef.replaceAll("___", ".")
						: tagOwnerRef;
				actor = game.actors.get(id);
				if (!actor) {
					try {
						const doc = fromUuidSync(id);
						if (doc?.documentName === "Token") actor = doc.actor;
						else if (doc?.documentName === "Actor") actor = doc;
					} catch (_) {
						/* no-op */
					}
				}
			}

			const config = game.settings.get("litm-rn", "storytags");
			const isGlobalStoryTag = config?.tags?.some((t) => t.id === tag.id);

			if (isGlobalStoryTag) {
				const newTags = config.tags.filter((t) => t.id !== tag.id);
				await game.settings.set("litm-rn", "storytags", {
					...config,
					tags: newTags,
				});
				return;
			}

			const scene = tag._ref?.startsWith("scene:")
				? game.scenes?.get(tag._ref.slice("scene:".length))
				: tag._ref === "scene"
					? game.scenes?.get(opts.sceneId)
					: null;
			const sceneConfig = scene?.getFlag("litm-rn", "scenetags") || {};
			const isSceneTag = sceneConfig.tags?.some((t) => t.id === tag.id);
			if (isSceneTag) {
				const newTags = sceneConfig.tags.filter((t) => t.id !== tag.id);
				await scene.setFlag("litm-rn", "scenetags", {
					...sceneConfig,
					tags: newTags,
				});
				return;
			}

			if (actor) {
				const effect = actor.effects.get(tag.id);
				if (effect) {
					game.litm?.removeTagFromAllRolls?.(tag.id);
					game.litm?.gmRemoveTagFromAllRolls?.(tag.id);
					await effect.delete();
				} else if (typeof actor.sheet.toggleScratchTag === "function") {
					await actor.sheet.toggleScratchTag(tag, { scratched: true });
				}
			}
		};

		// Scratch burnt and crispy tags (no dedup — each instance is separate)
		for (const tag of opts.burntTags || []) {
			await processSafely(`burnt:${tag?._ref}:${tag?.id}`, () =>
				processTag(tag),
			);
		}
		for (const tag of opts.crispyTags || []) {
			await processSafely(`crispy:${tag?._ref}:${tag?.id}`, () =>
				processTag(tag),
			);
		}

		// Gain experience from weakness tags — deduplicate by tag ID
		const seenWeakness = new Set();
		for (const tag of opts.weaknessTags || []) {
			if (tag.type !== "weaknessTag") continue;
			if (seenWeakness.has(tag.id)) continue;
			seenWeakness.add(tag.id);
			const sharedTargetActorId =
				tag.targetActorId || tag.actorId || rollingActorId;
			const sharedTag = tag.senderActorId
				? tag
				: game.litm?.getAcceptedSharedTag?.(sharedTargetActorId, tag.id);
			if (sharedTag) {
				await processSafely(`weakness:${tag.id}`, () =>
					game.litm?.grantSharedWeaknessExperience?.(
						tag.id,
						sharedTargetActorId,
						game.user.id,
					),
				);
				continue;
			}
			const tagOwnerId = tag.actorId || rollingActorId;
			const actor = game.actors.get(tagOwnerId);
			if (actor)
				await processSafely(`weakness:${tag.id}`, () =>
					actor.sheet.gainImprove(tag),
				);
		}

		// Fellowship improves from hero/relationship weakness tags — deduplicate
		if (game.settings.get("litm-rn", "fellowship_relationship_as_weakness")) {
			const seenFellowship = new Set();
			for (const tag of opts.heroWeaknessTags || []) {
				if (seenFellowship.has(tag.id)) continue;
				seenFellowship.add(tag.id);
				const tagOwnerId = tag.actorId || rollingActorId;
				const actor = game.actors.get(tagOwnerId);
				if (!actor) continue;
				const fellowship = actor.system.fellowship;
				if (fellowship) {
					await processSafely(`fellowship-weakness:${tag.id}`, () =>
						ThemeAdvancement.increaseFellowshipTrack(fellowship, "improve"),
					);
				}
			}
		}

		Hooks.callAll("litmStoryTagsUpdated");
		return report;
	}

	/** Apply deterministic tag scratching caused by a Sacrifice. */
	static async #applySacrificeConsequence(opts) {
		const actor = game.actors.get(opts.actorId);
		const sacrifice = opts.sacrifice;
		if (!actor || !sacrifice?.themeId) return;

		const total = Number(opts._total);
		const outcome =
			opts._outcome ??
			(Number.isFinite(total)
				? total >= 10
					? "miracle"
					: total >= 7
						? "fate"
						: "in-vain"
				: null);
		const shouldScratchOne =
			outcome === "miracle" && sacrifice.level === "painful";
		const shouldScratchAll =
			(sacrifice.level === "painful" && outcome !== "miracle") ||
			(sacrifice.level === "scarring" && outcome === "miracle");
		const shouldCreateStatus =
			sacrifice.level === "grave" && outcome !== "miracle";
		if (shouldCreateStatus) {
			await addOrStackActorStatus(actor, {
				name: sacrifice.statusName,
				flags: {
					["litm-rn"]: {
						type: "status",
						values: [false, false, false, false, false, 6],
						value: 6,
						isScratched: false,
						isHindering: false,
						isCrispy: false,
						isPrivate: false,
					},
				},
			});
			Hooks.callAll("litmActorDataUpdated", actor);
			return;
		}
		if (!shouldScratchOne && !shouldScratchAll) return;

		const themes = foundry.utils.duplicate(actor.system.themes ?? []);
		const theme = themes.find((entry) => entry.id === sacrifice.themeId);
		if (!theme) return;
		const scratchableTags = [
			...(theme.themeTag ? [theme.themeTag] : []),
			...(theme.powerTags ?? []),
		];
		// Weakness tags can never be scratched. Repair values left by older
		// Sacrifice rolls while applying the new consequence.
		for (const tag of theme.weaknessTags ?? []) tag.isScratched = false;

		if (shouldScratchAll) {
			for (const tag of scratchableTags) tag.isScratched = true;
		} else {
			const available = scratchableTags.filter((tag) => !tag.isScratched);
			if (!available.length) {
				ui.notifications.info(t("Litm.ui.sacrifice-all-tags-scratched"));
				return;
			}
			const options = available
				.map(
					(tag) =>
						`<option value="${foundry.utils.escapeHTML(tag.id)}">${foundry.utils.escapeHTML(tag.name)}</option>`,
				)
				.join("");
			const { DialogV2 } = foundry.applications.api;
			const selectedId = await DialogV2.wait({
				window: { title: t("Litm.ui.sacrifice-choose-scratch") },
				position: { width: 380 },
				classes: ["litm", "litm--sacrifice-scratch-dialog"],
				content: `
					<label class="litm--sacrifice-scratch-picker">
						<span>${t("Litm.ui.sacrifice-choose-scratch-hint")}</span>
						<select name="sacrificeScratchTag">${options}</select>
					</label>
				`,
				buttons: [
					{
						action: "cancel",
						label: t("Litm.ui.cancel"),
						callback: () => null,
					},
					{
						action: "scratch",
						label: t("Litm.ui.sacrifice-scratch-selected"),
						default: true,
						callback: (_event, _button, dialog) =>
							dialog.element.querySelector('[name="sacrificeScratchTag"]')
								?.value ?? null,
					},
				],
				rejectClose: false,
			});
			if (!selectedId) return;
			const selected = scratchableTags.find((tag) => tag.id === selectedId);
			if (selected) selected.isScratched = true;
		}

		await actor.update({ "system.themes": themes });
		Hooks.callAll("litmActorDataUpdated", actor);
	}
}
