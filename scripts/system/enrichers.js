export class Enrichers {
	static register() {
		Enrichers.#enrichSceneLinks();
		Enrichers.#enrichMights();
		// Note that this one has to go last for now
		Enrichers.#enrichTags();
	}

	static #enrichSceneLinks() {
		const enrichSceneLinks = ([text, sceneId, flavour]) => {
			const id = sceneId.replace(/^Scene./, "");

			const scene = game.scenes.get(id) || game.scenes.getName(id);
			if (!scene) return text;

			const link = $(
				`<a class="content-link" draggable="true" data-uuid="Scene.${
					scene._id
				}" data-id="${
					scene._id
				}" data-type="ActivateScene" data-tooltip="Scene"><i class="far fa-map"></i>${
					flavour || scene.navName
				}</a>`,
			);
			return link[0];
		};
		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.sceneLinkRe,
			enricher: enrichSceneLinks,
		});
	}

	static #enrichTags() {
		const tooltip = game.i18n.localize("Litm.ui.drag-apply");
		const enrichTags = ([_text, tag, status]) => {			
			if (tag.startsWith("-"))
				return $(
					`<mark class="litm--limit">${tag.replace(/^-/, "")}${
						status ? `:${status}` : ""
					}</mark>`,
				)[0];
			if (tag && status) {
				const label = status === "0" ? "" : `-${status}`;
				return $(
					`<mark class="litm--status" draggable="true" data-tooltip="${tooltip}">${tag}${label}</mark>`,
				)[0];
			}
			return $(
				`<mark class="litm--tag" draggable="true" data-tooltip="${tooltip}">${tag}</mark>`,
			)[0];
		};
		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.tagStringRe,
			enricher: enrichTags,
		});
	}

	static #enrichMights() {
		const enrichMight = ([text, type, label]) => {
			const types = {
				o: "origin",
				a: "adventure",
				g: "greatness",
			};

			const might = types[type?.toLowerCase()];
			if (!might) return text;

			const icon_src = `${CONFIG.litm.themeicon_src[might]}-color_litm_icn.svg`;

			return $(`
				<mark class="litm--might litm--${might}" draggable="true">
					<img src="${icon_src}" aria-hidden="true" />
					${label}
				</mark>
			`)[0];
		};

		CONFIG.TextEditor.enrichers.push({
			pattern: CONFIG.litm.mightStringRe,
			enricher: enrichMight,
		});
	}
}
