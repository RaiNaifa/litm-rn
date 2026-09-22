import { TokenTooltip } from "../apps/token-tooltip.js";
import { info } from "../logger.js";
import { dispatch, localize as t } from "../utils.js";
import { EMBEDDED_ONLY } from "./constants.js";
import { DEFAULT_ITEM_ICONS } from "./item-icons.js";
import { createPrivate } from "./private-creation.js";
import { Sockets } from "./sockets.js";
import { StarterContent } from "./starter-content.js";
import { StarterTours } from "./starter-tours.js";
import { ThemeAdvancement } from "./theme-advancement.js";
import {
	getWelcomeChatContent,
	getWelcomeJournalContent,
} from "./welcome-content.js";

const { fromUuidSync } = foundry.utils;

export class LitmHooks {
	static #tokenHudSessionEffects = new Set();

	static register() {
		info("Registering Hooks...");
		LitmHooks.#addImportToActorSidebar();
		LitmHooks.#replaceLoadSpinner();
		LitmHooks.#renderTagShareMessage();
		LitmHooks.#attachChatMessageListeners();
		LitmHooks.#attachContextMenuToRollMessage();
		LitmHooks.#attachGMIndicatorToMessage();
		LitmHooks.#attachRollPortraitToMessage();
		LitmHooks.#prepareCharacterOnCreate();
		LitmHooks.#preventJourneyLimits();
		LitmHooks.#prepareThemeOnCreate();
		LitmHooks.#listenToTagDragTransfer();
		LitmHooks.#addTagDropToSelectedTokens();
		LitmHooks.#customizeDiceSoNice();
		LitmHooks.#addTagManagerToTokenHUD();
		LitmHooks.#popOutCompatiblity();
		LitmHooks.#moveV13PopOutControlToMenu();
		StarterContent.register();
		StarterTours.register();
		LitmHooks.#renderWelcomeScreen();
		LitmHooks.#renderTooltipOnTokenHover();
		LitmHooks.#listenToSettingsUpdate();
		LitmHooks.#maskPrivateTagsInChat();
		LitmHooks.#markMultilineChatFormulas();
		LitmHooks.#reorderDialogTypes();
		LitmHooks.#refreshRollOnEffectUpdate();
		LitmHooks.#normalizeThemeProgress();
	}

	static #normalizeThemeProgress() {
		Hooks.on("preUpdateActor", (actor, changes, options) => {
			if (actor.type !== "character") return;
			const promise = changes["system.promise"] ?? changes.system?.promise;
			if (Number(promise) >= 5) {
				const gained = Math.floor(Number(promise) / 5);
				changes["system.promise"] = Number(promise) % 5;
				changes["system.availableFulfillments"] =
					Number(
						changes["system.availableFulfillments"] ??
							changes.system?.availableFulfillments ??
							actor.system.availableFulfillments ??
							0,
					) + gained;
			}
			const themes = changes["system.themes"] ?? changes.system?.themes;
			if (!Array.isArray(themes)) return;
			const awards = ThemeAdvancement.normalizeImproveTracks(themes);
			if (awards.length) options.litmThemeImprovementAwards = awards;
		});

		Hooks.on("updateActor", async (actor, _changes, options, userId) => {
			if (userId !== game.user.id) return;
			for (const award of options.litmThemeImprovementAwards ?? []) {
				const theme = actor.system.themes?.[award.themeIndex];
				if (theme) {
					await ThemeAdvancement.notify(
						actor,
						theme,
						"improve",
						theme.availableImprovements,
					);
				}
			}
		});
	}

	static #addImportToActorSidebar() {
		Hooks.on("renderSidebarTab", (app, html) => {
			if (app.id !== "actors") return;
			const button = document.createElement("button");
			button.className = "litm--import-actor";
			button.dataset.tooltip = t("Litm.ui.import-actor");
			button.setAttribute("aria-label", t("Litm.ui.import-actor"));
			button.innerHTML = '<i class="fas fa-file-import"></i>';

			button.addEventListener("click", () => {
				const input = document.createElement("input");
				input.type = "file";
				input.accept = ".json";
				input.onchange = async (event) => {
					const file = event.target.files[0];
					const data = await file.text();
					const actorData = JSON.parse(data);
					await game.litm.importCharacter(actorData);
				};
				input.click();
			});
			html.querySelector(".directory-footer")?.appendChild(button);
		});
	}

	static #replaceLoadSpinner() {
		Hooks.on("renderPause", (_, html) => {
			const img = html.querySelector("img");
			if (img) {
				img.src = "systems/litm-rn/assets/media/marshal-crest.webp";
				img.removeAttribute("class");
			}
		});
		Hooks.on("renderGamePause", (_, html) => {
			const img = html.querySelector("img");
			if (!img) return;
			img.src = "systems/litm-rn/assets/media/marshal-crest.webp";
			img.classList.remove("fa-spin");
		});
	}

	static #maskPrivateTagsInChat() {
		Hooks.on("renderChatMessageHTML", (_message, html) => {
			if (game.user.isGM) return;

			html
				.querySelectorAll('.part-formula[data-private="true"]')
				.forEach((el) => {
					const ref = el.dataset.actorRef || el.dataset.actorId;
					const maskName = "???";
					if (!ref) {
						el.textContent = maskName;
						return;
					}
					if (LitmHooks.#canSeePrivateTag(ref)) return;
					el.textContent = maskName;
				});
		});
	}

	static #markMultilineChatFormulas() {
		Hooks.on("renderChatMessageHTML", (_message, html) => {
			requestAnimationFrame(() => {
				html.querySelectorAll(".part-formula").forEach((element) => {
					element.classList.remove("litm--multiline");
					const range = element.ownerDocument.createRange();
					range.selectNodeContents(element);
					const lineTops = new Set(
						[...range.getClientRects()].map((rect) => Math.round(rect.top)),
					);
					element.classList.toggle("litm--multiline", lineTops.size > 1);
				});
			});
		});
	}

	static #reorderDialogTypes() {
		Hooks.on("renderDialogV2", (app, element) => {
			const select = element.querySelector('[name="type"]');
			if (!select || select.options.length < 2) return;

			const values = [...select.options].map((o) => o.value);

			// Item create dialog
			if (values.every((v) => game.documentTypes.Item.includes(v))) {
				const filteredTypes = game.documentTypes.Item.filter(
					(t) => !EMBEDDED_ONLY.includes(t),
				);
				const saved = game.settings.get("litm-rn", "defaultItemType");
				const first =
					saved === "auto"
						? "story"
						: filteredTypes.includes(saved)
							? saved
							: filteredTypes[0];
				const sortedTypes = [...filteredTypes].sort((a, b) => {
					if (a === first) return -1;
					if (b === first) return 1;
					return a.localeCompare(b);
				});

				sortedTypes.forEach((type) => {
					const opt = select.querySelector(`option[value="${type}"]`);
					if (opt) select.appendChild(opt);
				});

				select.value = sortedTypes[0];
				select.dispatchEvent(new Event("change", { bubbles: true }));
				return;
			}

			// Actor create dialog
			if (values.every((v) => game.documentTypes.Actor.includes(v))) {
				const saved = game.settings.get("litm-rn", "defaultActorType");
				const first =
					saved === "auto"
						? game.user.isGM
							? "challenge"
							: "character"
						: saved;
				const sortedTypes = [...game.documentTypes.Actor].sort((a, b) => {
					if (a === first) return -1;
					if (b === first) return 1;
					return a.localeCompare(b);
				});

				sortedTypes.forEach((type) => {
					const opt = select.querySelector(`option[value="${type}"]`);
					if (opt) select.appendChild(opt);
				});

				select.value = sortedTypes[0];
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
	}

	static #canSeePrivateTag(ref) {
		if (!ref) return false;

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

		return actor?.isOwner ?? false;
	}

	static #attachChatMessageListeners() {
		Hooks.on("renderChatMessageHTML", (app, html) => {
			const clickTargets = html.querySelectorAll("[data-click]");
			for (const target of clickTargets) {
				target.addEventListener("click", async (event) => {
					event.stopPropagation();
					event.preventDefault();

					const { click } = target.dataset;

					switch (click) {
						case "accept-tag-share":
						case "decline-tag-share": {
							const share = app.getFlag("litm-rn", "tagShare");
							if (!share || share.status !== "pending") break;
							if (!game.user.isGM && game.user.id !== share.targetUserId) break;
							const decision =
								click === "accept-tag-share" ? "accepted" : "declined";
							target
								.closest("[data-tag-share-actions]")
								?.querySelectorAll("button")
								.forEach((button) => {
									button.disabled = true;
								});
							if (game.user.isGM) {
								await game.litm?.resolveTagShare?.(
									app.id,
									decision,
									game.user.id,
								);
							} else {
								const activeGM =
									game.users.activeGM ??
									game.users.find((user) => user.isGM && user.active);
								if (!activeGM) {
									ui.notifications.warn(t("Litm.ui.tag-share-no-active-gm"));
									target
										.closest("[data-tag-share-actions]")
										?.querySelectorAll("button")
										.forEach((button) => {
											button.disabled = false;
										});
									break;
								}
								Sockets.dispatch("resolveTagShare", {
									messageId: app.id,
									decision,
								});
							}
							break;
						}
						// biome-ignore lint/suspicious/noFallthroughSwitchClause: Intentional fallthrough
						case "skip-moderation":
							Sockets.dispatch("skipModeration", {
								name: game.user.name,
							});
						case "approve-moderation": {
							const data = await app.getFlag("litm-rn", "data");
							const userId = await app.getFlag("litm-rn", "userId");

							// Delete Message
							app.delete();

							// Roll
							if (userId === game.userId) game.litm.LitmRollDialog.roll(data);
							else
								Sockets.dispatch("rollDice", {
									userId,
									data,
								});

							// Dispatch order to reset Roll Dialog
							Sockets.dispatch("resetRollDialog", {
								actorId: data.actorId,
							});
							break;
						}
						case "reject-moderation": {
							const data = await app.getFlag("litm-rn", "data");
							// Delete Message
							app.delete();
							// Reopen Roll Dialog
							const actor = game.actors.get(data.actorId);
							actor.sheet.renderRollDialog();
							ui.notifications.warn(
								game.i18n.format("Litm.ui.roll-rejected", { name: t("You") }),
							);
							const actorId = data.actorId;
							const userId =
								game.users.find((u) => u.character?.id === actorId && !u.isGM)
									?.id || null;
							// Dispatch order to reopen
							Sockets.dispatch("rejectRoll", {
								name: game.user.name,
								actorId,
								userId,
							});
							break;
						}
					}
				});
			}
		});
	}

	static #renderTagShareMessage() {
		Hooks.on("renderChatMessageHTML", (message, html) => {
			const root = html.querySelector("[data-tag-share]");
			if (!root) return;
			const share = message.getFlag("litm-rn", "tagShare");
			if (!share) return;

			const senderActor = game.actors.get(share.senderActorId);
			const canSeeTag =
				game.user.isGM || senderActor?.isOwner || !share.tag?.isPrivate;
			const tagElement = root.querySelector("[data-tag-share-tag]");
			if (tagElement && !canSeeTag) {
				tagElement.innerHTML = '<mark class="litm--tag">???</mark>';
			}

			const canRespond = game.user.isGM || game.user.id === share.targetUserId;
			const actions = root.querySelector("[data-tag-share-actions]");
			if (actions) actions.hidden = share.status !== "pending" || !canRespond;
			root.querySelectorAll("[data-tag-share-result]").forEach((result) => {
				result.hidden = result.dataset.tagShareResult !== share.status;
			});
		});
	}

	static #attachGMIndicatorToMessage() {
		Hooks.on("renderChatMessageHTML", (_, html) => {
			html.setAttribute("data-user", game.user.isGM ? "gm" : "player");
		});
	}

	static #attachContextMenuToRollMessage() {
		const callback = (_, options) => {
			// Add context menu option to change roll types
			const createTypeChange = (type) => ({
				name: `${t("Litm.ui.change-roll-type")}: ${t(`Litm.ui.roll-${type}`)}`,
				icon: '<i class="fas fa-dice"></i>',
				condition: (li) => {
					const message = game.messages.get(li.dataset.messageId);
					const isCampAction =
						!!message?.getFlag("litm-rn", "campAction") ||
						message?.rolls?.some((roll) => roll.options?.isCampAction);
					return (
						!isCampAction &&
						!!li.querySelector(".litm.dice-roll[data-type]") &&
						!li.querySelector(".litm.dice-roll[data-type='sacrifice']") &&
						!li.querySelector(`[data-type='${type}']`)
					);
				},
				callback: async (li) => {
					const data = li.dataset.messageId;
					const message = game.messages.get(data);
					const roll = message?.rolls?.[0];
					if (
						!roll ||
						message.getFlag("litm-rn", "campAction") ||
						roll.options.isCampAction ||
						roll.options.type === "sacrifice"
					)
						return;
					const rollTypeLabel = t(`Litm.ui.roll-${type}`);
					const isGroup =
						roll.options.isGroup === true ||
						Array.isArray(roll.options.participants);
					const messageLabel = isGroup
						? `${t("Litm.ui.roll-group")} (${rollTypeLabel})`
						: rollTypeLabel;
					roll.options.type = type;
					roll.options.rollTypeLabel = messageLabel;
					roll.options.title = messageLabel;
					const content = await roll.render();
					await message.update({
						rolls: [roll],
						content,
						flavor: messageLabel,
					});
				},
			});

			options.unshift(
				...["quick", "tracked", "reaction"].map(createTypeChange),
			);
		};
		Hooks.on("getChatLogEntryContext", callback);
		Hooks.on("getChatMessageContextOptions", callback);
	}

	static #prepareCharacterOnCreate() {
		Hooks.on("preCreateActor", (actor, data) => {
			const actorType = data.type || actor.type;
			const isCharacter = actorType === "character";
			const hasImage =
				typeof actor.img === "string" &&
				actor.img !== "icons/svg/mystery-man.svg" &&
				/\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(actor.img);

			const base = "icons/svg/";
			let img = base;
			switch (true) {
				case hasImage:
					img = actor.img;
					break;
				case !hasImage && isCharacter:
					img = "icons/svg/mystery-man.svg";
					break;
				case !hasImage && actorType === "challenge":
					img += "skull.svg";
					break;
				case !hasImage && actorType === "journey":
					img = "systems/litm-rn/assets/media/icons/treasure-map.svg";
					break;
				default:
					img = "icons/svg/mystery-man.svg";
			}

			const tokenImg = actor.prototypeToken?.texture?.src;
			const sourceUpdate = isCharacter
				? {
						prototypeToken: {
							name: actor.prototypeToken?.name || actor.name,
							sight: { enabled: true },
							actorLink: true,
							disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
							displayName:
								actor.prototypeToken?.displayName ??
								CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
							texture: { src: tokenImg || img },
						},
						img,
					}
				: { img };
			actor.updateSource(sourceUpdate);
		});

		Hooks.on("createActor", async (actor) => {
			if (actor.type !== "character") return;

			const hasPreparedThemes = actor.system.themes?.some(
				(theme) => !theme.isEmpty,
			);
			const themes = Array.from({ length: 4 }, (_, i) => ({
				id: foundry.utils.randomID(),
				type: "theme",
				isEmpty: true,
				creationMode: "custom",
				name: `${t("TYPES.Item.theme")} ${i + 1}`,
				themebook: "",
				themebookUuid: "",
				themebookCustom: true,
				themekitUuid: "",
				themekitName: "",
				level: Object.keys(CONFIG.litm.theme_levels)[0],
				themeTag: {
					id: foundry.utils.randomID(),
					name: `${t("TYPES.Item.theme")} ${i + 1}`,
					type: "themeTag",
					isScratched: false,
				},
				powerTags: [],
				weaknessTags: [],
				draftTags: [],
				specials: [],
				improve: 0,
				abandon: 0,
				milestone: 0,
				motivation: "",
				note: "",
			}));
			if (!hasPreparedThemes) await actor.update({ "system.themes": themes });
		});
	}

	/** Reject Limit ActiveEffects on Journey actors at the document layer. */
	static #preventJourneyLimits() {
		const isJourneyLimit = (effect, data) => {
			const type =
				data.flags?.["litm-rn"]?.type ??
				data["flags.litm-rn.type"] ??
				effect.flags?.["litm-rn"]?.type;
			return effect.parent?.type === "journey" && type === "limit";
		};

		Hooks.on("preCreateActiveEffect", (effect, data) => {
			if (isJourneyLimit(effect, data)) return false;
		});
		Hooks.on("preUpdateActiveEffect", (effect, changes) => {
			if (isJourneyLimit(effect, changes)) return false;
		});
	}

	static #prepareThemeOnCreate() {
		Hooks.on("preCreateItem", (item, data) => {
			if (item.img !== "icons/svg/item-bag.svg") return;

			const img = DEFAULT_ITEM_ICONS[data.type];
			if (img) item.updateSource({ img });
		});

		Hooks.on("preCreateItem", (item, data) => {
			if (EMBEDDED_ONLY.includes(data.type)) {
				ui.notifications.warn(
					"Litm: obsolete legacy item types cannot be created",
				);
				return false;
			}
		});
	}

	static #renderTooltipOnTokenHover() {
		let tokenTagsTooltip;

		Hooks.once("ready", () => {
			tokenTagsTooltip = new TokenTooltip();
		});
	}

	static #listenToSettingsUpdate() {
		Hooks.on("updateSetting", (setting) => {
			if (setting.key === "litm-rn.storytags") {
				Hooks.callAll("litmStoryTagsUpdated");
			}
			if (setting.key === "litm-rn.themeSources") {
				Hooks.callAll("litmThemeSourcesUpdated");
				game.litm?.themeSources?.migrateCharacterThemes().catch(console.error);
			}
		});
	}

	static #refreshRollOnEffectUpdate() {
		Hooks.on("updateActiveEffect", () => {
			game.litm?.refreshRollSelectionUI?.();
		});
		Hooks.on("createActiveEffect", () => {
			game.litm?.refreshRollSelectionUI?.();
		});
		Hooks.on("deleteActiveEffect", () => {
			game.litm?.refreshRollSelectionUI?.();
		});
	}

	static #listenToTagDragTransfer() {
		Hooks.on("ready", () => {
			document.addEventListener("dragstart", (event) => {
				const target = event.target;
				const specialLinkName = target.closest(".litm--special-link-name");
				if (specialLinkName) {
					const data = {
						type: "Special",
						special: {
							id: foundry.utils.randomID(),
							name: specialLinkName.dataset.specialLinkName || "",
							description: specialLinkName.dataset.specialLinkDescription || "",
						},
					};
					event.dataTransfer.setData("text/plain", JSON.stringify(data));
					return;
				}
				if (!target.closest(".litm--tag, .litm--status, .litm--might")) return;
				const text = target.textContent.replaceAll("\u2060", "");
				const journeyRoot = target.closest("[data-journey-actor-uuid]");
				const journeyBlock = target.closest("[data-journey-drop-block]");
				const journeySource =
					journeyRoot && journeyBlock
						? {
								sourceActorUuid: journeyRoot.dataset.journeyActorUuid,
								sourceJourneyBlock: journeyBlock.dataset.journeyDropBlock,
							}
						: {};

				if (
					target.classList.contains("litm--tag") ||
					target.classList.contains("litm--status")
				) {
					const matches = `{${text}}`.matchAll(CONFIG.litm.regexp.tagStringRe);
					const match = [...matches][0];
					if (!match) return;

					if (target.classList.contains("litm--tag")) {
						const [, tag] = match;
						const isWeakness = target.dataset.enrichedTagType === "weaknessTag";
						const data = {
							id: foundry.utils.randomID(),
							name: tag,
							type: isWeakness ? "weaknessTag" : "tag",
							isScratched: false,
							isHindering: isWeakness,
							...journeySource,
						};
						event.dataTransfer.setData("text/plain", JSON.stringify(data));
					} else {
						const [, tag, status] = match;
						const data = {
							id: foundry.utils.randomID(),
							name: tag,
							type: "status",
							values: Array(6)
								.fill(null)
								.map((_, i) =>
									Number.parseInt(status) === i + 1 ? status : null,
								),
							isScratched: false,
							value: status || 0,
							...journeySource,
						};
						event.dataTransfer.setData("text/plain", JSON.stringify(data));
					}
				} else if (target.classList.contains("litm--might")) {
					const matches = `{${text}}`.matchAll(
						CONFIG.litm.regexp.mightStringReverseRe,
					);
					const match = [...matches][0];
					let level = null;
					if (target.classList.contains("litm--origin")) level = "origin";
					else if (target.classList.contains("litm--adventure"))
						level = "adventure";
					else if (target.classList.contains("litm--greatness"))
						level = "greatness";
					const data = {
						id: foundry.utils.randomID(),
						type: "might",
						level,
						...journeySource,
					};

					if (match) {
						const [, name, scale] = match;
						const valuesMap = [0, 0, 3, 3, 3, 6, 6];
						data.name = name;
						data.values = [0, 3, 6];
						data.value = valuesMap[scale];
					} else {
						const scales = { origin: 0, adventure: 3, greatness: 6 };
						const scale = scales[level];
						data.name = text;
						data.values = [0, 3, 6];
						data.value = scale;
					}

					event.dataTransfer.setData("text/plain", JSON.stringify(data));
				}
			});
		});
	}

	static #customizeDiceSoNice() {
		Hooks.on("diceSoNiceReady", (dice3d) => {
			dice3d.addSystem(
				{ id: "litm-rn", name: "Legend in the Mist" },
				"preferred",
			);
			dice3d.addDicePreset(
				{
					type: "d6",
					labels: ["1", "2", "3", "4", "5", "F", "1", "2", "3", "4", "5", "F"],
					font: "LitM Dice",
					system: "litm-rn",
				},
				"d12",
			);

			dice3d.addColorset(
				{
					name: "litm-rn",
					description: "Legend in the Mist Default",
					category: "Legend in the Mist",
					foreground: ["#c9c9c9", "#c9c9c9", "#433a28", "#433a28", "#433a28"],
					background: ["#877376", "#446674", "#708768", "#A8A7A3", "#ac9e77"],
					outline: ["#433a28", "#433a28", undefined, undefined, undefined],
					texture: "stone",
					material: "stone",
					font: "Georgia",
					visibility: "visible",
				},
				"preferred",
			);
		});
	}

	static #getTokenHudActors(token) {
		const selectedActors = canvas.tokens.controlled
			.map((selected) => selected.actor)
			.filter((actor) => actor?.isOwner);
		if (selectedActors.length) {
			return [
				...new Map(
					[token.actor, ...selectedActors]
						.filter((actor) => actor?.isOwner)
						.map((actor) => [actor.uuid, actor]),
				).values(),
			];
		}
		return token.actor?.isOwner ? [token.actor] : [];
	}

	static #attachRollPortraitToMessage() {
		Hooks.on("renderChatMessageHTML", (message, html) => {
			if (!html.querySelector(".litm.dice-roll")) return;
			const header = html.querySelector(".message-header");
			if (!header || header.querySelector(".litm--chat-roll-portrait")) return;

			const actorId =
				message.rolls?.[0]?.options?.actorId ??
				message.getFlag("litm-rn", "data")?.actorId ??
				message.speaker?.actor;
			const actor =
				game.actors.get(actorId) ?? message.actor ?? message.rolls?.[0]?.actor;
			if (!actor?.img) return;

			const portrait = html.ownerDocument.createElement("span");
			portrait.className = "litm--chat-roll-portrait";
			const image = html.ownerDocument.createElement("img");
			image.src = actor.img;
			image.alt = actor.name;
			image.draggable = false;
			portrait.append(image);
			header.prepend(portrait);
			const sender = header.querySelector(".message-sender");
			if (sender && !sender.title) sender.title = sender.textContent.trim();
		});
	}

	static #parseTokenHudEffect(rawValue) {
		const text = rawValue.trim();
		if (!text) return null;
		const match = text.match(/^(.+?)[\s:-]([0-6])$/u);
		if (!match) return { name: text, type: "tag", value: null };
		const name = match[1].trim();
		if (!name) return null;
		return { name, type: "status", value: Number(match[2]) };
	}

	static #parseTokenHudDrop(dataTransfer) {
		const rawData = dataTransfer?.getData("text/plain");
		if (!rawData) return null;
		let data;
		try {
			data = JSON.parse(rawData);
		} catch {
			return null;
		}
		return LitmHooks.#parseTokenEffectData(data);
	}

	static #parseTokenEffectData(data) {
		const name = typeof data?.name === "string" ? data.name.trim() : "";
		if (!name) return null;
		if (data.type === "status") {
			const values = Array.isArray(data.values) ? data.values : [];
			const valuesLevel = values.findLastIndex(Boolean) + 1;
			const hasExplicitValue =
				data.value !== null && data.value !== undefined && data.value !== "";
			const rawValue = hasExplicitValue ? Number(data.value) : Number.NaN;
			const value =
				valuesLevel > 0 || !Number.isFinite(rawValue)
					? valuesLevel
					: Math.max(0, Math.min(6, Math.trunc(rawValue)));
			return { name, type: "status", value };
		}
		if (["tag", "weaknessTag", "powerTag", "themeTag"].includes(data.type)) {
			return { name, type: "tag", value: null };
		}
		return null;
	}

	static #addTagDropToSelectedTokens() {
		Hooks.on("dropCanvasData", async (_canvas, data, event) => {
			const parsed = LitmHooks.#parseTokenEffectData(data);
			if (!parsed) return;

			const selectedTokens = [...(canvas.tokens?.controlled ?? [])];
			const x = Number(data?.x);
			const y = Number(data?.y);
			if (!Number.isFinite(x) || !Number.isFinite(y)) return;
			if (!selectedTokens.some((token) => token.bounds?.contains(x, y))) return;

			const actors = [
				...new Map(
					selectedTokens
						.map((token) => token.actor)
						.filter((actor) => actor?.isOwner)
						.map((actor) => [actor.uuid, actor]),
				).values(),
			];
			if (!actors.length) return;

			for (const actor of actors)
				await LitmHooks.#addTokenHudEffect(actor, parsed, event);
			Hooks.callAll("litmStoryTagsUpdated", { source: "canvasTokenDrop" });
		});
	}

	static #tokenHudEffectValue(effect) {
		const flags = effect.flags?.["litm-rn"] ?? {};
		const values = Array.isArray(flags.values) ? flags.values : [];
		return values.findLastIndex(Boolean) + 1;
	}

	static #findTokenHudEffect(actor, type, name) {
		const normalizedName = name.trim().toLocaleLowerCase();
		return actor.effects.find((effect) => {
			const flags = effect.flags?.["litm-rn"];
			return (
				!effect.disabled &&
				!flags?.ownerType &&
				flags?.type === type &&
				effect.name.trim().toLocaleLowerCase() === normalizedName
			);
		});
	}

	static #makeTokenHudStatusValues(value) {
		return Array.from({ length: 6 }, (_, index) =>
			index + 1 === value ? index + 1 : null,
		);
	}

	static async #addTokenHudEffect(actor, parsed, event) {
		const existing = LitmHooks.#findTokenHudEffect(
			actor,
			parsed.type,
			parsed.name,
		);
		if (parsed.type === "status" && existing) {
			const current = [...(existing.flags?.["litm-rn"]?.values ?? [])];
			const values = Array.from({ length: 6 }, (_, index) =>
				current[index] ? index + 1 : null,
			);
			const startIndex = Math.max(0, parsed.value - 1);
			const freeIndex = values.findIndex(
				(value, index) => index >= startIndex && !value,
			);
			if (parsed.value > 0 && freeIndex !== -1)
				values[freeIndex] = freeIndex + 1;
			const value = values.findLastIndex(Boolean) + 1;
			await actor.updateEmbeddedDocuments(
				"ActiveEffect",
				[
					{
						_id: existing.id,
						"flags.litm-rn.value": value,
						"flags.litm-rn.values": values,
					},
				],
				{ render: false },
			);
			return;
		}
		await actor.createEmbeddedDocuments(
			"ActiveEffect",
			[
				{
					name: parsed.name,
					flags: {
						["litm-rn"]: {
							type: parsed.type,
							value: parsed.type === "status" ? parsed.value : undefined,
							values:
								parsed.type === "status"
									? LitmHooks.#makeTokenHudStatusValues(parsed.value)
									: undefined,
							isScratched: false,
							isHindering: false,
							isCrispy: false,
							isPrivate: createPrivate(event),
						},
					},
				},
			],
			{ render: false },
		);
	}

	static #getCommonTokenHudEffects(actors) {
		if (!actors.length) return [];
		const firstEffects = actors[0].effects.filter(
			(effect) =>
				!effect.disabled &&
				!effect.flags?.["litm-rn"]?.ownerType &&
				["tag", "status"].includes(effect.flags?.["litm-rn"]?.type),
		);
		return firstEffects
			.flatMap((effect) => {
				const type = effect.flags["litm-rn"].type;
				const name = effect.name;
				const effects = actors.map((actor) =>
					LitmHooks.#findTokenHudEffect(actor, type, name),
				);
				if (effects.some((match) => !match)) return [];
				return [{ type, name, effects }];
			})
			.sort(
				(first, second) =>
					Number(second.type === "status") - Number(first.type === "status"),
			);
	}

	static async #decreaseTokenHudStatus(actors, name) {
		for (const actor of actors) {
			const effect = LitmHooks.#findTokenHudEffect(actor, "status", name);
			if (!effect) continue;
			const current = [...(effect.flags?.["litm-rn"]?.values ?? [])];
			if (!current.some(Boolean) || !current.slice(1).some(Boolean)) {
				game.litm?.removeTagFromAllRolls?.(effect.id);
				await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id], {
					render: false,
				});
				continue;
			}
			const values = Array.from({ length: 6 }, (_, index) =>
				current[index + 1] ? index + 1 : null,
			);
			const value = values.findLastIndex(Boolean) + 1;
			await actor.updateEmbeddedDocuments(
				"ActiveEffect",
				[
					{
						_id: effect.id,
						"flags.litm-rn.value": value,
						"flags.litm-rn.values": values,
					},
				],
				{ render: false },
			);
		}
	}

	static #syncTokenHudFoundryEffects(effectsPalette, token) {
		effectsPalette.addEventListener(
			"click",
			async (event) => {
				const control = event.target.closest(".effect-control[data-status-id]");
				if (!control) return;
				event.preventDefault();
				event.stopImmediatePropagation();

				const statusId = control.dataset.statusId;
				const selected = [...canvas.tokens.controlled];
				const active = !token.actor.statuses.has(statusId);
				const actors = [
					...new Map(
						[token.actor, ...selected.map((target) => target.actor)]
							.filter((actor) => actor?.isOwner)
							.map((actor) => [actor.uuid, actor]),
					).values(),
				];

				for (const actor of actors) {
					if (actor.statuses.has(statusId) === active) continue;
					await actor.toggleStatusEffect(statusId, { active });
				}
			},
			true,
		);
	}

	static #getTokenHudTokens(token) {
		const selected = [...canvas.tokens.controlled];
		return [
			...new Map(
				[token, ...selected]
					.filter((target) => target?.document?.isOwner)
					.map((target) => [target.document.uuid, target]),
			).values(),
		];
	}

	static #syncTokenHudControls(el, token) {
		el.addEventListener(
			"change",
			async (event) => {
				const input = event.target.closest('input[name="elevation"]');
				if (!input) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				const elevation = Number(input.value);
				if (!Number.isFinite(elevation)) return;
				for (const target of LitmHooks.#getTokenHudTokens(token)) {
					if (target.document.elevation === elevation) continue;
					await target.document.update({ elevation }, { render: false });
				}
			},
			true,
		);

		el.addEventListener(
			"click",
			async (event) => {
				const targetButton = event.target.closest('[data-action="target"]');
				if (targetButton) {
					event.preventDefault();
					event.stopImmediatePropagation();
					const targeted = !token.isTargeted;
					for (const target of LitmHooks.#getTokenHudTokens(token)) {
						target.setTarget(targeted, { releaseOthers: false });
					}
					return;
				}

				const movementButton = event.target.closest(
					'[data-action="movementAction"]',
				);
				if (!movementButton) return;
				const movementAction =
					movementButton.dataset.movementAction ??
					movementButton.dataset.actionId ??
					movementButton.value;
				if (movementAction === undefined || movementAction === null) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				for (const target of LitmHooks.#getTokenHudTokens(token)) {
					if (target.document.movementAction === movementAction) continue;
					await target.document.update({ movementAction }, { render: false });
				}
			},
			true,
		);
	}

	static async #deleteTokenHudEffect(actors, type, name) {
		for (const actor of actors) {
			const effect = LitmHooks.#findTokenHudEffect(actor, type, name);
			if (!effect) continue;
			game.litm?.removeTagFromAllRolls?.(effect.id);
			await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id], {
				render: false,
			});
		}
	}

	static #addTagManagerToTokenHUD() {
		Hooks.on("closeTokenHUD", () => {
			LitmHooks.#tokenHudSessionEffects.clear();
		});

		Hooks.on("renderTokenHUD", (app, html) => {
			const el = html;
			if (!el?.querySelector) return;

			const token = app.object;
			if (!token?.actor) return;
			const scene = canvas.scene;
			if (!scene) return;

			const config = scene.getFlag("litm-rn", "scenetags") || {
				tags: [],
				actors: [],
			};
			const isInScene =
				(config.actors || []).some((a) => a.ref === token.actor.uuid) ||
				(config.tokenTagVisibility || []).includes(token.actor.uuid);

			if (!game.user.isGM && !token.actor.isOwner) return;
			LitmHooks.#syncTokenHudControls(el, token);

			const effectsPalette = el.querySelector(".status-effects");
			if (effectsPalette) {
				LitmHooks.#syncTokenHudFoundryEffects(effectsPalette, token);
				const controls = document.createElement("div");
				controls.className = "litm--token-hud-effects";

				const input = document.createElement("input");
				input.type = "text";
				input.placeholder = t("Litm.ui.token-hud-effect-placeholder");
				input.className = "litm--token-hud-effect-input";
				input.setAttribute("aria-label", input.placeholder);

				const list = document.createElement("div");
				list.className = "litm--token-hud-effect-list";
				controls.append(input, list);
				effectsPalette.appendChild(controls);

				const renderEffects = () => {
					const actors = LitmHooks.#getTokenHudActors(token);
					const effects = LitmHooks.#getCommonTokenHudEffects(actors);
					list.replaceChildren();
					for (const effect of effects) {
						const row = document.createElement("div");
						row.className = "litm--token-hud-effect-row";

						const mark = document.createElement("mark");
						mark.className =
							effect.type === "status" ? "litm--status" : "litm--tag";
						const values = effect.effects.map((match) =>
							LitmHooks.#tokenHudEffectValue(match),
						);
						const valueLabel =
							effect.type === "status"
								? new Set(values).size === 1
									? `-${values[0]}`
									: `-${values.join("/")}`
								: "";
						mark.textContent = `${effect.name}${valueLabel}`;
						row.appendChild(mark);

						if (effect.type === "status") {
							const decrease = document.createElement("button");
							decrease.type = "button";
							decrease.className = "litm--token-hud-effect-action";
							decrease.dataset.tooltip = "Litm.ui.decrease-status";
							decrease.innerHTML = '<i class="fas fa-arrow-left"></i>';
							decrease.addEventListener("click", async (event) => {
								event.preventDefault();
								await LitmHooks.#decreaseTokenHudStatus(
									LitmHooks.#getTokenHudActors(token),
									effect.name,
								);
								renderEffects();
								app.render();
							});
							row.appendChild(decrease);
						}

						const remove = document.createElement("button");
						remove.type = "button";
						remove.className = "litm--token-hud-effect-action";
						remove.dataset.tooltip = "Litm.ui.remove";
						remove.innerHTML = '<i class="fas fa-times"></i>';
						remove.addEventListener("click", async (event) => {
							event.preventDefault();
							await LitmHooks.#deleteTokenHudEffect(
								LitmHooks.#getTokenHudActors(token),
								effect.type,
								effect.name,
							);
							LitmHooks.#tokenHudSessionEffects.delete(
								`${effect.type}:${effect.name.toLocaleLowerCase()}`,
							);
							renderEffects();
							app.render();
						});
						row.appendChild(remove);
						list.appendChild(row);
					}
				};

				input.addEventListener("keydown", async (event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					event.stopPropagation();
					const parsed = LitmHooks.#parseTokenHudEffect(input.value);
					if (!parsed) return;
					const actors = LitmHooks.#getTokenHudActors(token);
					if (!actors.length) return;
					input.disabled = true;
					try {
						LitmHooks.#tokenHudSessionEffects.add(
							`${parsed.type}:${parsed.name.toLocaleLowerCase()}`,
						);
						for (const actor of actors)
							await LitmHooks.#addTokenHudEffect(actor, parsed, event);
						input.value = "";
						renderEffects();
						Hooks.callAll("litmStoryTagsUpdated", { sourceAppId: app.appId });
						app.render();
					} finally {
						input.disabled = false;
						input.focus();
					}
				});

				effectsPalette.addEventListener("dragover", (event) => {
					if (
						!Array.from(event.dataTransfer?.types ?? []).includes("text/plain")
					)
						return;
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect = "copy";
					effectsPalette.classList.add("litm--token-hud-drop-target");
				});
				effectsPalette.addEventListener("dragleave", (event) => {
					if (effectsPalette.contains(event.relatedTarget)) return;
					effectsPalette.classList.remove("litm--token-hud-drop-target");
				});
				effectsPalette.addEventListener("drop", async (event) => {
					effectsPalette.classList.remove("litm--token-hud-drop-target");
					const parsed = LitmHooks.#parseTokenHudDrop(event.dataTransfer);
					if (!parsed) return;
					event.preventDefault();
					event.stopImmediatePropagation();
					const actors = LitmHooks.#getTokenHudActors(token);
					if (!actors.length) return;
					LitmHooks.#tokenHudSessionEffects.add(
						`${parsed.type}:${parsed.name.toLocaleLowerCase()}`,
					);
					for (const actor of actors)
						await LitmHooks.#addTokenHudEffect(actor, parsed, event);
					renderEffects();
					Hooks.callAll("litmStoryTagsUpdated", { sourceAppId: app.appId });
					app.render();
				});

				renderEffects();
			}

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `control-icon ${isInScene ? "active" : ""}`;
			btn.dataset.tooltip = "Litm.ui.tag-visibility";
			btn.innerHTML = `<i class="fas fa-tags"></i>`;
			btn.addEventListener("click", async () => {
				const currentConfig = canvas.scene.getFlag("litm-rn", "scenetags") || {
					tags: [],
					actors: [],
				};
				const currentRefs = new Set([
					...(currentConfig.actors || []).map((a) => a.ref),
					...(currentConfig.tokenTagVisibility || []),
				]);
				const hudTokenInScene = currentRefs.has(token.actor.uuid);

				const selected = canvas.tokens.controlled;
				const actorEntries = selected
					.filter((target) => !!target.actor?.uuid)
					.map((target) => ({
						uuid: target.actor.uuid,
						hidden: !!target.document.hidden,
					}));
				if (!actorEntries.length) return;

				if (game.user.isGM) {
					if (hudTokenInScene) {
						for (const { uuid, hidden } of actorEntries) {
							if (currentRefs.has(uuid)) {
								await game.litm.TagManager.toggleSceneActor(uuid, { hidden });
							}
						}
					} else {
						for (const { uuid, hidden } of actorEntries) {
							if (!currentRefs.has(uuid)) {
								await game.litm.TagManager.toggleSceneActor(uuid, { hidden });
							}
						}
					}
				} else {
					dispatch({
						app: "tag-manager",
						type: "story-scene-crud",
						operation: "toggle-scene-actor",
						actorEntries,
						makeActive: !hudTokenInScene,
					});
				}

				btn.classList.toggle("active", !hudTokenInScene);
			});

			const combatBtn = el.querySelector('[data-action="combat"]');
			if (combatBtn) {
				combatBtn.replaceWith(btn);
			} else {
				const container =
					el.querySelector(".col.right") || el.querySelector(".col") || el;
				container.appendChild(btn);
			}
		});
	}

	static #popOutCompatiblity() {
		Hooks.on("PopOut:loaded", (app) => {
			const el = app.element;
			el.classList.add("litm--popout");
		});

		Hooks.on("PopOut:popin", (app) => {
			const el = app.element;
			el.classList.remove("litm--popout");
		});
	}

	/** Move PopOut!'s v13 AppV2 header button into Foundry's controls menu. */
	static #moveV13PopOutControlToMenu() {
		Hooks.once("ready", () => {
			if (game.release.generation !== 13) return;
			if (!game.modules.get("popout")?.active) return;

			const moveControl = (button) => {
				if (!(button instanceof HTMLElement)) return;
				const app = button.closest(".application.litm, .app.litm");
				const application = app
					? foundry.applications.instances.get(app.id)
					: null;
				const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;
				if (
					!(application instanceof ActorSheetV2) &&
					!(application instanceof ItemSheetV2)
				) {
					return;
				}
				const menu = app?.querySelector(".controls-dropdown");
				if (!menu || button.parentElement === menu) return;

				button.classList.remove("icon");
				const label =
					button.dataset.tooltip || game.i18n.localize("POPOUT.PopOut");
				if (!button.querySelector("span")) {
					const text = document.createElement("span");
					text.textContent = label;
					button.appendChild(text);
				}
				menu.appendChild(button);
			};

			const moveControlsWithin = (node) => {
				if (!(node instanceof HTMLElement)) return;
				if (node.matches(".popout-module-button")) moveControl(node);
				node.querySelectorAll(".popout-module-button").forEach(moveControl);
			};

			document.querySelectorAll(".popout-module-button").forEach(moveControl);
			new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					mutation.addedNodes.forEach(moveControlsWithin);
				}
			}).observe(document.body, { childList: true, subtree: true });
		});
	}

	static #renderWelcomeScreen() {
		Hooks.once("ready", async () => {
			if (game.settings.get("litm-rn", "welcomed")) return;
			if (!game.user.isGM) return;

			const language = game.i18n.lang;
			const welcomeContent = getWelcomeJournalContent(language);
			const entry = await CONFIG.JournalEntry.documentClass.create({
				name: "Legend in the Mist",
				ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
				pages: [
					{
						name: welcomeContent.pageName,
						text: { content: welcomeContent.journalContent },
					},
				],
			});

			await CONFIG.ChatMessage.documentClass.create({
				content: getWelcomeChatContent(language, entry.uuid, entry.id),
			});

			await game.settings.set("litm-rn", "welcomed", true);
		});
	}
}
