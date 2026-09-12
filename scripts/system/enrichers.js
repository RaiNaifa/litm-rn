export class Enrichers {
	static register() {
		// Specials must be registered first to parse full raw text including inner brackets.
		Enrichers.#enrichSpecials();
		Enrichers.#enrichSceneLinks();
		Enrichers.#enrichMightsStrict();
		Enrichers.#enrichMights();
		Enrichers.#enrichWeaknessTags();
		Enrichers.#enrichTags();
	}

	static #enrichSceneLinks() {
		const enrichSceneLinks = ([text, sceneId, flavour]) => {
			const id = sceneId.replace(/^Scene./, "");

			const scene = game.scenes.get(id) || game.scenes.getName(id);
			if (!scene) return text;

			const link = document.createElement("a");
			link.className = "content-link";
			link.draggable = true;
			link.dataset.uuid = `Scene.${scene._id}`;
			link.dataset.id = scene._id;
			link.dataset.type = "ActivateScene";
			link.dataset.tooltip = "Scene";
			link.innerHTML = `<i class="far fa-map"></i>${flavour || scene.navName}`;
			return link;
		};
		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.regexp.sceneLinkRe,
			enricher: enrichSceneLinks,
		});
	}

	static #enrichSpecials() {
		const enrichSpecial = ([_text, body]) => {
			const colonIdx = body.indexOf(": ");
			const name = colonIdx !== -1 ? body.slice(0, colonIdx) : body;
			const description = colonIdx !== -1 ? body.slice(colonIdx + 2) : "";

			const el = document.createElement("span");
			el.className = "litm--special-link";

			const bold = document.createElement("b");
			bold.className = "litm--special-link-name";
			bold.draggable = true;
			bold.dataset.tooltip = game.i18n.localize("Litm.ui.drag-apply");
			bold.dataset.specialLinkName = name;
			bold.dataset.specialLinkDescription = description;
			bold.textContent = name;
			el.appendChild(bold);

			if (description) {
				el.append(document.createTextNode(": "));

				let contentNodes = [document.createTextNode(description)];
				const otherEnrichers = CONFIG.TextEditor.enrichers.filter(
					(e) => e.enricher !== enrichSpecial,
				);

				for (const enricherObj of otherEnrichers) {
					const newNodes = [];

					for (const node of contentNodes) {
						if (node.nodeType !== Node.TEXT_NODE) {
							newNodes.push(node);
							continue;
						}

						const textContent = node.textContent;
						let lastIdx = 0;

						const regex = new RegExp(
							enricherObj.pattern.source,
							enricherObj.pattern.flags.includes("g")
								? enricherObj.pattern.flags
								: `${enricherObj.pattern.flags}g`,
						);

						let match = regex.exec(textContent);
						while (match !== null) {
							if (match.index > lastIdx) {
								newNodes.push(
									document.createTextNode(
										textContent.slice(lastIdx, match.index),
									),
								);
							}

							const resultEl = enricherObj.enricher(match);
							if (resultEl instanceof HTMLElement) {
								newNodes.push(resultEl);
							} else {
								newNodes.push(document.createTextNode(String(resultEl)));
							}
							lastIdx = regex.lastIndex;
							match = regex.exec(textContent);
						}

						if (lastIdx < textContent.length) {
							newNodes.push(
								document.createTextNode(textContent.slice(lastIdx)),
							);
						}
					}
					contentNodes = newNodes;
				}

				for (const finalNode of contentNodes) {
					el.appendChild(finalNode);
				}
			}
			return el;
		};

		CONFIG.TextEditor.enrichers.push({
			pattern: /\[@(?:sp|special) ((?:[^\[\]]|\[[^\]]*\])*)\]/gi,
			enricher: enrichSpecial,
		});
	}

	static #enrichTags() {
		const tooltip = game.i18n.localize("Litm.ui.drag-apply");
		const appendLimitValue = (el, status) => {
			const label = status || "~";
			const value = document.createElement("span");
			value.className = "litm--enriched-limit-value";
			value.setAttribute("aria-label", label);

			const icon = document.createElement("img");
			icon.className = "litm--enriched-limit-icon";
			icon.src = "systems/litm-rn/assets/media/icons/limit.svg";
			icon.alt = "";
			icon.setAttribute("aria-hidden", "true");

			const text = document.createElement("span");
			text.className = "litm--enriched-limit-label";
			text.textContent = label;
			value.append(icon, text);
			el.append(value);
		};
		const makeTagElement = (
			tag,
			status,
			forceStatus = false,
			limitMode = "value",
		) => {
			if (tag.startsWith("-")) {
				const el = document.createElement("mark");
				el.className = "litm--limit";
				el.append(document.createTextNode(tag.replace(/^-/, "")));
				if (limitMode === "none") el.classList.add("litm--limit-no-value");
				else appendLimitValue(el, limitMode === "x" ? "x" : status);

				return el;
			}
			if (tag && (status || forceStatus)) {
				const normalizedStatus = status ?? "0";
				const label = normalizedStatus === "0" ? "" : `-${normalizedStatus}`;
				const el = document.createElement("mark");
				el.className = "litm--status";
				el.draggable = true;
				el.dataset.tooltip = tooltip;
				el.textContent = `${tag}${label}`;

				return el;
			}
			const el = document.createElement("mark");
			el.className = "litm--tag";
			el.draggable = true;
			el.dataset.tooltip = tooltip;
			el.textContent = tag;

			return el;
		};
		const enrichExplicitTag = ([_text, kind, tag, status]) => {
			const normalizedKind = kind.toLowerCase();
			const isStatus = normalizedKind === "s" || normalizedKind === "status";
			const isLimit = ["l", "limit", "lx", "ln"].includes(normalizedKind);
			if (isStatus) return makeTagElement(tag, status, true);
			if (isLimit) {
				const limitMode =
					normalizedKind === "lx"
						? "x"
						: normalizedKind === "ln"
							? "none"
							: "value";
				return makeTagElement(`-${tag}`, status, false, limitMode);
			}
			return makeTagElement(status ? `${tag}-${status}` : tag);
		};
		const enrichLegacyTag = ([_text, tag, status]) =>
			makeTagElement(tag, status);

		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.regexp.explicitTagStringRe,
			enricher: enrichExplicitTag,
		});
		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.regexp.tagStringRe,
			enricher: enrichLegacyTag,
		});
	}

	static #enrichWeaknessTags() {
		const tooltip = game.i18n.localize("Litm.ui.drag-apply");
		const enrichWeaknessTag = ([_text, tag]) => {
			const el = document.createElement("mark");
			el.className = "litm--tag litm--weakness-enriched";
			el.draggable = true;
			el.dataset.tooltip = tooltip;
			el.dataset.enrichedTagType = "weaknessTag";

			const icon = document.createElement("img");
			icon.src =
				"systems/litm-rn/assets/media/icons/weakness-marker-litm_active.svg";
			icon.alt = "";
			icon.setAttribute("aria-hidden", "true");
			el.append(icon, document.createTextNode(`\u2060${tag}`));
			return el;
		};

		CONFIG.TextEditor.enrichers.push({
			pattern: /\[@tw\s+([^\[\]\r\n]+?)\]/giu,
			enricher: enrichWeaknessTag,
		});
	}

	static #enrichMights() {
		const tooltip = game.i18n.localize("Litm.ui.drag-apply");
		const enrichMight = ([text, level, label]) => {
			const levels = {
				o: "origin",
				a: "adventure",
				g: "greatness",
			};

			const might = levels[level?.toLowerCase()];
			if (!might) return text;

			const icon_src = `${CONFIG.litm.themeicon_src[might]}-color_litm_icn.svg`;

			const el = document.createElement("mark");
			el.className = `litm--might litm--${might}`;
			el.draggable = true;
			el.dataset.tooltip = tooltip;
			const icon = document.createElement("img");
			icon.src = icon_src;
			icon.alt = "";
			icon.setAttribute("aria-hidden", "true");
			el.append(document.createTextNode(`${label}\u2060`), icon);
			return el;
		};

		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.regexp.mightStringRe,
			enricher: enrichMight,
		});
	}

	static #enrichMightsStrict() {
		const tooltip = game.i18n.localize("Litm.ui.drag-apply");
		const enrichMight = ([text, label, scale]) => {
			const levels = {
				["0"]: "origin",
				["1"]: "origin",
				["2"]: "adventure",
				["3"]: "adventure",
				["4"]: "adventure",
				["5"]: "greatness",
				["6"]: "greatness",
			};

			const might = levels[scale?.toLowerCase()];
			if (!might) return text;

			const icon_src = `${CONFIG.litm.themeicon_src[might]}-color_litm_icn.svg`;

			const el = document.createElement("mark");
			el.className = `litm--might litm--${might}`;
			el.draggable = true;
			el.dataset.tooltip = tooltip;
			const icon = document.createElement("img");
			icon.src = icon_src;
			icon.alt = "";
			icon.setAttribute("aria-hidden", "true");
			el.append(document.createTextNode(`${label}-${scale}\u2060`), icon);
			return el;
		};

		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.regexp.mightSctictStringRe,
			enricher: enrichMight,
		});
	}
}
