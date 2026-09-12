import { dispatch } from "../utils.js";
import {
	STARTER_CHALLENGE_ID,
	buildStarterChallenge,
} from "./starter-challenge.js";

const SYSTEM_ID = "litm-rn";
const HERO_SHEET_BASICS_ID = "hero-sheet-basics";
const FELLOWSHIP_BASICS_ID = "fellowship-basics";
const TAG_MANAGER_BASICS_ID = "tag-manager-basics";
const HINTS_TIPS_ID = "hints-and-tips";
const SHEET_TARGET = "data-litm-hero-sheet-tour";
const TAG_TARGET = "data-litm-hero-sheet-tour-tag";
const ANCHOR_TARGET = "data-litm-hero-sheet-tour-anchor";
const FELLOWSHIP_TARGET = "data-litm-fellowship-tour-target";
const TAG_MANAGER_TARGET = "data-litm-tag-manager-tour-target";
const HINTS_TARGET = "data-litm-hints-tour-target";
const STARTER_TOUR_PROMPT_FLAG = "starterTourPromptedV1";

const STARTER_TOUR_PROMPT_COPY = {
	en: {
		title: "Welcome to Legend in the Mist",
		content:
			"<p>Would you like to take a short guided tour of the system basics?</p>",
		accept: "Start Tour",
		decline: "Not Now",
	},
	ru: {
		title: "Добро пожаловать в Legend in the Mist",
		content: "<p>Хотите пройти короткий экскурс по основам системы?</p>",
		accept: "Начать экскурс",
		decline: "Не сейчас",
	},
};

const COPY = {
	en: {
		title: "Hero Sheet Basics",
		description: "Learn the main areas and controls of a Hero sheet.",
		steps: {
			intro: {
				title: "The Hero Sheet",
				content:
					"<p>A Hero has four character Themes, a Hero Card, a Backpack, a Fellowship Card, and Notes. The sheet keeps all of them together as compact cards.</p>",
			},
			openCards: {
				title: "Open a Full Card",
				content:
					"<p>Select the edit-card button on any mini-card to open its full version. Use the full card to read and edit its complete contents.</p>",
			},
			flipCards: {
				title: "Flip Cards",
				content:
					"<p>Select the flip button to turn a mini-card over. The reverse side holds the card's alternate information without opening another window.</p>",
			},
			tracking: {
				title: "Tracking Cards and Notes",
				content:
					"<p>The leaf at the edge expands or hides Tracking Cards; the side tab does the same for Notes. Active tags and statuses from Tracking Cards also appear in the Tag Manager and when hovering over a token.</p><p>Noticed tags are a convenient reusable tray: drag them from Notes into the Backpack, Tracking Cards, journals, chat, and other supported destinations.</p>",
			},
			selectTag: {
				title: "Add a Tag to a Roll",
				content:
					"<p>Left-click a tag to add it to, or remove it from, the pending roll. When a GM can roll for several participants, the system asks whose roll should receive the tag.</p>",
			},
			contextTag: {
				title: "Manage a Tag",
				content:
					"<p>Right-click a tag to open its context menu. The available commands let you manage that tag without leaving the Hero sheet.</p>",
			},
		},
	},
	ru: {
		title: "Основы листа Героя",
		description: "Основные области и элементы управления листа Героя.",
		steps: {
			intro: {
				title: "Лист Героя",
				content:
					"<p>У Героя есть четыре темы персонажа, Карта героя, Рюкзак, Карта содружества и Заметки. На листе они собраны в виде компактных карточек.</p>",
			},
			openCards: {
				title: "Полная версия карточки",
				content:
					"<p>Кнопка редактирования на мини-карточке открывает её полную версию. В ней можно прочитать и изменить всё содержимое карточки.</p>",
			},
			flipCards: {
				title: "Оборотная сторона",
				content:
					"<p>Кнопка переворота показывает другую сторону мини-карточки. Так можно увидеть дополнительную информацию, не открывая отдельное окно.</p>",
			},
			tracking: {
				title: "Трекинг-карточки и Заметки",
				content:
					"<p>Листок у края листа раскрывает и скрывает трекинг-карточки, а боковая вкладка — Заметки. Активные теги и статусы из трекинг-карточек также видны в Менеджере тегов и при наведении на токен.</p><p>Замеченные теги служат удобным повторно используемым набором: перетаскивайте их из Заметок в Рюкзак, трекинг-карточки, журналы, чат и другие поддерживаемые области.</p>",
			},
			selectTag: {
				title: "Выбор тега в бросок",
				content:
					"<p>ЛКМ по тегу добавляет его в предстоящий бросок или убирает оттуда. Если ГМ может совершить бросок за нескольких участников, система предложит выбрать, кому предназначен тег.</p>",
			},
			contextTag: {
				title: "Управление тегом",
				content:
					"<p>ПКМ по тегу открывает контекстное меню. Доступные в нём команды позволяют управлять тегом прямо с листа Героя.</p>",
			},
		},
	},
};

const FELLOWSHIP_COPY = {
	en: {
		title: "Fellowship Basics",
		description: "Learn how to select a Fellowship and add its members.",
		steps: {
			sheet: {
				title: "The Fellowship",
				content:
					"<p>A Fellowship is a special Theme shared by all of its members. Its tags, weakness, motivation, and Specials belong to the whole adventuring group.</p>",
			},
			manager: {
				title: "Selecting a Fellowship",
				content:
					"<p>A world can contain several Fellowships, which is useful when several groups adventure in the same world. Select the Fellowship you are currently managing in the Tag Manager.</p>",
			},
			members: {
				title: "Adding Members",
				content:
					"<p>Use the plus button to add Heroes to the Fellowship. After adding them, remember to grant ownership of the Fellowship Item to the players assigned to those Heroes.</p>",
			},
			relationships: {
				title: "Relationship Tags",
				content:
					"<p>Once Heroes have joined the Fellowship, their relationship tags can be configured in the Hero Card on each character sheet.</p>",
			},
		},
	},
	ru: {
		title: "Основы Содружества",
		description: "Выбор Содружества и добавление его участников.",
		steps: {
			sheet: {
				title: "Содружество",
				content:
					"<p>Содружество — особая Тема, общая для всех его участников. Его теги, слабость, цель и Особенности принадлежат всей группе героев.</p>",
			},
			manager: {
				title: "Выбор Содружества",
				content:
					"<p>В одном мире можно создать несколько Содружеств — это удобно, если в нём приключаются разные группы. В Менеджере тегов выберите Содружество, с которым работаете сейчас.</p>",
			},
			members: {
				title: "Добавление участников",
				content:
					"<p>Кнопка с плюсом добавляет Героев в Содружество. После добавления не забудьте дать владение Предметом Содружества игрокам, за которыми закреплены вступившие в него персонажи.</p>",
			},
			relationships: {
				title: "Теги отношений",
				content:
					"<p>Когда Герои вступили в Содружество, теги их отношений можно настроить в Карте героя на листе каждого персонажа.</p>",
			},
		},
	},
};

const TAG_MANAGER_COPY = {
	en: {
		title: "Tag Manager Basics",
		description: "Learn how to manage, move, and organize tags and statuses.",
		steps: {
			intro: {
				title: "The Tag Manager",
				content:
					"<p>The Tag Manager tracks and manages tags, statuses, Might, and Limits, and provides quick access to the Fellowship and Actors.</p>",
			},
			popout: {
				title: "Opening the Tag Manager",
				content:
					"<p>The Tag Manager can be opened from its sidebar tab or by pressing <kbd>T</kbd>, which toggles this separate pop-out window.</p>",
			},
			manage: {
				title: "Selecting and Managing Tags",
				content:
					"<p>Left-click a tag to select it for a roll. Right-click it to open its management menu.</p>",
			},
			externalDrag: {
				title: "Moving Tags Between Sources",
				content:
					"<p>Drag tags into any Tag Manager block from other supported sources to add them quickly. You can also drag tags out of the Manager into sheets, Notes, journals, chat, and other supported destinations.</p><p>Hold <kbd>Alt</kbd> while adding a tag, status, Might, or Limit to make the new element secret.</p>",
			},
			organize: {
				title: "Organizing a Block",
				content:
					"<p>Tags, statuses, and Might can be reordered within their own block. Drag any of them into a Limit in the same block to group them and include their values in its calculation.</p>",
			},
			scope: {
				title: "Story and Scene",
				content:
					"<p>Story Tags, the selected Fellowship, Story Actors, and Fellowship members remain in the Manager until removed manually. Scene Tags and Scene Actors only reflect the currently viewed Foundry scene.</p>",
			},
		},
	},
	ru: {
		title: "Основы Менеджера тегов",
		description: "Управление, перенос и организация тегов и статусов.",
		steps: {
			intro: {
				title: "Менеджер тегов",
				content:
					"<p>В Менеджере тегов можно отслеживать и управлять тегами, статусами, Могуществом и Лимитами, а также быстро обращаться к Содружеству и Актёрам.</p>",
			},
			popout: {
				title: "Открытие Менеджера тегов",
				content:
					"<p>Менеджер тегов можно открыть во вкладке сайдбара или нажатием <kbd>T</kbd>, которое показывает либо скрывает это отдельное окно.</p>",
			},
			manage: {
				title: "Выбор тегов и управление ими",
				content:
					"<p>ЛКМ по тегу выбирает его в бросок. ПКМ открывает меню управления тегом.</p>",
			},
			externalDrag: {
				title: "Перенос между источниками",
				content:
					"<p>В любой блок Менеджера можно перетащить теги из других поддерживаемых источников для быстрого добавления. Из Менеджера их также можно переносить в листы, Заметки, журналы, чат и другие поддерживаемые области.</p><p>Если при добавлении тега, статуса, Могущества или Лимита удерживать <kbd>Alt</kbd>, новый элемент будет секретным.</p>",
			},
			organize: {
				title: "Организация блока",
				content:
					"<p>Теги, статусы и Могущество можно переставлять внутри своего блока. Любой из этих элементов можно поместить в Лимит того же блока для группировки и учёта его значения при подсчёте.</p>",
			},
			scope: {
				title: "История и сцена",
				content:
					"<p>Теги истории, выбранное Содружество, Актёры истории и участники Содружества хранятся в Менеджере, пока не будут удалены вручную. Теги сцены и Актёры сцены относятся только к текущей сцене Foundry.</p>",
			},
		},
	},
};

const HINTS_COPY = {
	en: {
		title: "Hints & Tips",
		description: "A quick look at useful controls which are easy to miss.",
		steps: {
			tokenHud: {
				title: "Token HUD",
				content:
					"<p>Use the tags button to control whether a token's tags appear in the current scene.</p><p>The status palette can quickly add or manage the same tags and statuses for all selected tokens.</p>",
			},
			reference: {
				title: "Rules Reference",
				content:
					"<p>Open the Rules Reference from the Notes controls or press <kbd>I</kbd>.</p>",
			},
			referenceButton: {
				title: "Custom References",
				content:
					"<p>The GM can customize the Rules Reference and add more pages in the system settings.</p>",
			},
			art: {
				title: "Illustration Settings",
				content:
					"<p>The image control opens illustration settings. Similar controls are available on Hero and Challenge sheets, Themebooks, Theme sheets, and Tropes.</p>",
			},
			progression: {
				title: "Progression Settings",
				content:
					"<p>The progression control configures the track lengths and the number of Improvements awarded for Themes and the Fellowship.</p>",
			},
			keybindings: {
				title: "Keybindings",
				content:
					"<p>You can reassign Legend in the Mist keybindings to combinations which are convenient for you.</p>",
			},
		},
	},
	ru: {
		title: "Советы и подсказки",
		description:
			"Краткий обзор полезных элементов управления, которые легко пропустить.",
		steps: {
			tokenHud: {
				title: "HUD токена",
				content:
					"<p>Кнопка с тегами включает или выключает отображение тегов токена в текущей сцене.</p><p>В «Выборе статуса» можно быстро добавлять и изменять одинаковые теги и статусы у всех выбранных токенов.</p>",
			},
			reference: {
				title: "Памятка",
				content:
					"<p>Памятку можно открыть в управлении Заметками или клавишей <kbd>I</kbd>.</p>",
			},
			referenceButton: {
				title: "Настройка Памятки",
				content:
					"<p>ГМ может настроить Памятку и добавить в неё новые страницы через настройки системы.</p>",
			},
			art: {
				title: "Настройки иллюстрации",
				content:
					"<p>Кнопка с изображением открывает настройки иллюстрации. Аналогичная настройка доступна в листах Героев и Испытаний, Книгах тем, листах Тем и Тематик.</p>",
			},
			progression: {
				title: "Настройка прогрессии",
				content:
					"<p>В настройках прогрессии можно изменить длину треков и количество получаемых улучшений для Тем и Содружества.</p>",
			},
			keybindings: {
				title: "Горячие клавиши",
				content:
					"<p>Горячие клавиши Legend in the Mist можно переназначить на удобные вам сочетания.</p>",
			},
		},
	},
};

/** A stateful Foundry Tour which demonstrates controls on a live Hero sheet. */
class HeroSheetBasicsTour extends foundry.nue.Tour {
	#actor = null;
	#sheet = null;
	#cardsFlipped = false;
	#anchor = null;
	#finishing = false;

	/** The tour can start when the current user can access a character Actor. */
	get canStart() {
		return super.canStart && Boolean(this.#findActor());
	}

	/** Resolve the demonstrated Hero before the tour starts. */
	async start() {
		this.#finishing = false;
		this.#actor = this.#findActor();
		this.#sheet = this.#actor?.sheet ?? null;
		return super.start();
	}

	/** Complete the tour and always close a Hero sheet which the tour opened. */
	async complete() {
		try {
			return await super.complete();
		} finally {
			await this.#cleanup();
		}
	}

	/** Prepare the live sheet and its controls before each step is displayed. */
	async _preStep() {
		await super._preStep();
		await this.#ensureSheet();
		this.#clearEmphasis();
		const stepId = this.currentStep?.id;

		if (stepId === "intro") this.#expandNotes();
		if (stepId === "flip-cards") await this.#setCardsFlipped(true);
		if (["tracking-and-notes", "select-tag", "context-menu"].includes(stepId)) {
			await this.#setCardsFlipped(false);
		}
		if (stepId === "tracking-and-notes") await this.#expandTrackingCards();

		this.#markTag();
		this.#emphasizeStep(stepId);
		this.#updateAnchor();
	}

	/** Remove temporary emphasis when moving away from a step. */
	async _postStep() {
		await super._postStep();
		this.#clearEmphasis();
		if (!this.hasNext) await this.#cleanup();
	}

	/** Clean temporary tour markers when the user exits early. */
	exit() {
		const result = super.exit();
		this.#cleanup();
		return result;
	}

	#findActor() {
		const assigned = game.user.character;
		if (
			assigned?.type === "character" &&
			assigned.visible &&
			this.#hasThemes(assigned)
		) {
			return assigned;
		}

		const characters = game.actors.filter(
			(actor) => actor.type === "character" && actor.visible,
		);
		const owned = characters.filter((actor) =>
			actor.testUserPermission(
				game.user,
				CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
			),
		);
		const ownedRedMarshal = owned.find(
			(actor) =>
				actor.getFlag(SYSTEM_ID, "starterContent")?.id === "red-marshal",
		);
		const visibleRedMarshal = characters.find(
			(actor) =>
				actor.getFlag(SYSTEM_ID, "starterContent")?.id === "red-marshal",
		);
		return (
			ownedRedMarshal ??
			visibleRedMarshal ??
			owned.find((actor) => this.#hasThemes(actor)) ??
			characters.find((actor) => this.#hasThemes(actor)) ??
			assigned ??
			owned[0] ??
			characters[0] ??
			null
		);
	}

	#hasThemes(actor) {
		return actor.system.themes?.some((theme) => !theme.isEmpty) ?? false;
	}

	async #ensureSheet() {
		this.#actor ??= this.#findActor();
		if (!this.#actor)
			throw new Error(
				"Hero Sheet Basics requires an accessible character Actor.",
			);
		this.#sheet = this.#actor.sheet;
		if (!this.#sheet.rendered) this.#sheet.render({ force: true });
		await this.#waitFor(
			() => this.#sheet?.rendered && this.#sheet.element?.isConnected,
		);
		this.#sheet.element.setAttribute(SHEET_TARGET, "");
	}

	async #waitFor(condition, timeout = 3000) {
		const started = performance.now();
		while (!condition()) {
			if (performance.now() - started > timeout) {
				throw new Error("Timed out while preparing the Hero sheet tour.");
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}

	#expandNotes() {
		const button = this.#sheet.element.querySelector(
			'[data-click="toggle-notes-card"]',
		);
		if (button && !button.classList.contains("active")) button.click();
	}

	async #setCardsFlipped(flipped) {
		if (this.#cardsFlipped === flipped) return;
		const buttons = [
			...this.#sheet.element.querySelectorAll('[data-click="toggle-backside"]'),
		];
		for (const button of buttons) button.click();
		this.#cardsFlipped = flipped;
		await this.#settleSheet();
		this.#sheet.element.setAttribute(SHEET_TARGET, "");
	}

	async #expandTrackingCards() {
		let button = this.#sheet.element.querySelector(
			'[data-click="toggle-tracking-cards"]',
		);
		if (button && !button.classList.contains("active")) {
			button.click();
			await this.#waitFor(() => {
				button = this.#sheet.element?.querySelector(
					'[data-click="toggle-tracking-cards"]',
				);
				return button?.classList.contains("active");
			});
			this.#sheet.element.setAttribute(SHEET_TARGET, "");
		}
		this.#expandNotes();
	}

	async #settleSheet() {
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await this.#waitFor(
			() => this.#sheet?.rendered && this.#sheet.element?.isConnected,
		);
	}

	#markTag() {
		this.#sheet.element
			.querySelectorAll(`[${TAG_TARGET}]`)
			.forEach((element) => element.removeAttribute(TAG_TARGET));
		const tag = this.#sheet.element.querySelector(
			'.litm--character-theme [data-click="select"], ' +
				'.litm--character-backpack-card [data-click="select"]',
		);
		tag?.setAttribute(TAG_TARGET, "");
	}

	#emphasizeStep(stepId) {
		const selectors = {
			"open-cards": '[data-click="open-item"]',
			"flip-cards": '[data-click="toggle-backside"]',
			"tracking-and-notes":
				'[data-click="toggle-tracking-cards"], [data-click="toggle-notes-card"]',
			"select-tag": `[${TAG_TARGET}]`,
			"context-menu": `[${TAG_TARGET}]`,
		};
		const selector = selectors[stepId];
		if (!selector) return;
		this.#sheet.element
			.querySelectorAll(selector)
			.forEach((element) => element.classList.add("litm--tour-emphasis"));
	}

	#clearEmphasis() {
		this.#sheet?.element
			?.querySelectorAll(".litm--tour-emphasis")
			.forEach((element) => element.classList.remove("litm--tour-emphasis"));
	}

	async #cleanup() {
		if (this.#finishing) return;
		this.#finishing = true;
		this.#clearEmphasis();
		this.#anchor?.remove();
		this.#anchor = null;
		this.#sheet?.element?.removeAttribute(SHEET_TARGET);
		this.#sheet?.element
			?.querySelectorAll(`[${TAG_TARGET}]`)
			.forEach((element) => element.removeAttribute(TAG_TARGET));
		if (this.#sheet?.rendered) await this.#sheet.close();
		this.#actor = null;
		this.#sheet = null;
		this.#cardsFlipped = false;
	}

	#updateAnchor() {
		this.#anchor ??= document.body.appendChild(document.createElement("div"));
		this.#anchor.setAttribute(ANCHOR_TARGET, "");
		const elements = this.#sheet.element.querySelectorAll(
			[
				":scope",
				".litm--character-portrait-panel",
				".litm--character-hero",
				".litm--character-backpack-card",
				".litm--character-themes",
				".litm--character-story-tags",
			].join(", "),
		);
		const rects = [...elements]
			.map((element) => element.getBoundingClientRect())
			.filter((rect) => rect.width > 0 && rect.height > 0);
		if (!rects.length) return;
		const left = Math.min(...rects.map((rect) => rect.left));
		const top = Math.min(...rects.map((rect) => rect.top));
		const right = Math.max(...rects.map((rect) => rect.right));
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		Object.assign(this.#anchor.style, {
			position: "fixed",
			left: `${left}px`,
			top: `${top}px`,
			width: `${right - left}px`,
			height: `${bottom - top}px`,
			pointerEvents: "none",
		});
	}
}

/** A GM-only tour covering the minimum setup required to use a Fellowship. */
class FellowshipBasicsTour extends foundry.nue.Tour {
	#fellowship = null;
	#sheet = null;
	#sheetWasOpen = null;
	#initialSidebarTab = null;
	#initialSidebarExpanded = false;
	#sidebarCaptured = false;
	#dialog = null;
	#anchor = null;
	#managerSectionWasCollapsed = false;
	#finishing = false;

	/** The tour is available only to GMs who can access a Fellowship. */
	get canStart() {
		return super.canStart && game.user.isGM && Boolean(this.#findFellowship());
	}

	/** Capture the user's sidebar state before the first tour action. */
	async start() {
		this.#finishing = false;
		this.#sidebarCaptured = false;
		this.#sheetWasOpen = null;
		this.#fellowship = null;
		this.#sheet = null;
		this.#captureSidebar();
		return super.start();
	}

	/** Complete the tour and always restore its temporary interface state. */
	async complete() {
		try {
			return await super.complete();
		} finally {
			await this.#finish();
		}
	}

	/** Prepare the requested sidebar, sheet, or member picker. */
	async _preStep() {
		await super._preStep();
		document.body.classList.remove("litm--tour-unfocused");
		this.#clearTargets();
		const stepId = this.currentStep?.id;
		if (stepId === "fellowship-sheet") await this.#showFellowshipSheet();
		else if (stepId === "tag-manager") await this.#showTagManager();
		else if (stepId === "add-members") await this.#showMemberPicker();
		else if (stepId === "relationships") await this.#showRelationshipsHint();
	}

	/** Allow Foundry to clean the current step before removing custom markers. */
	async _postStep() {
		await super._postStep();
		this.#clearEmphasis();
		if (!this.hasNext) await this.#finish();
	}

	/** Restore temporary UI state if the tour is closed early. */
	exit() {
		const result = super.exit();
		this.#finish();
		return result;
	}

	#findFellowship() {
		const selectedId = game.settings.get(SYSTEM_ID, "selectedFellowship");
		const selected = selectedId ? game.items.get(selectedId) : null;
		if (selected?.type === "fellowship" && selected.visible) return selected;
		return (
			game.items.find(
				(item) =>
					item.type === "fellowship" &&
					item.visible &&
					item.getFlag(SYSTEM_ID, "starterContent")?.id ===
						"starter-fellowship",
			) ??
			game.items.find((item) => item.type === "fellowship" && item.visible) ??
			null
		);
	}

	#captureSidebar() {
		if (this.#sidebarCaptured) return;
		this.#sidebarCaptured = true;
		this.#initialSidebarExpanded = ui.sidebar.expanded;
		this.#initialSidebarTab =
			[
				"chat",
				"combat",
				"scenes",
				"actors",
				"items",
				"journal",
				"tables",
				"cards",
				"playlists",
				"compendium",
				"settings",
			].find((name) => ui[name]?.active) ?? null;
	}

	async #ensureSheet() {
		this.#fellowship ??= this.#findFellowship();
		if (!this.#fellowship)
			throw new Error("Fellowship Basics requires a visible Fellowship.");
		this.#sheet = this.#fellowship.sheet;
		this.#sheetWasOpen ??= this.#sheet.rendered;
		if (!this.#sheet.rendered) await this.#sheet.render({ force: true });
		await this.#waitFor(() => this.#sheet?.element?.isConnected);
	}

	async #showFellowshipSheet() {
		ui.sidebar.expand();
		ui.items.activate();
		await this.#ensureSheet();
		const entry = ui.items.element?.querySelector(
			`[data-entry-id="${this.#fellowship.id}"]`,
		);
		entry?.classList.add("litm--tour-emphasis");
		this.#updateAnchor([this.#sheet.element, entry].filter(Boolean));
	}

	async #showTagManager() {
		this.#closeMemberPicker();
		ui.sidebar.expand();
		ui.combat.activate();
		await this.#waitFor(() => ui.combat?.element?.isConnected);
		let target = ui.combat.element.querySelector(
			".litm--tm-fellowship-header, .litm--tm-fellowship-select-row",
		);
		if (!target) {
			const header = ui.combat.element.querySelector(
				'[data-section="fellowship"] > [data-action="toggle-collapse"]',
			);
			if (header) {
				this.#managerSectionWasCollapsed = true;
				header.click();
				await this.#waitFor(() =>
					ui.combat.element.querySelector(
						".litm--tm-fellowship-header, .litm--tm-fellowship-select-row",
					),
				);
				target = ui.combat.element.querySelector(
					".litm--tm-fellowship-header, .litm--tm-fellowship-select-row",
				);
			}
		}
		target?.setAttribute(FELLOWSHIP_TARGET, "");
		target?.classList.add("litm--tour-emphasis");
	}

	async #showMemberPicker() {
		this.#restoreManagerSection();
		this.#restoreSidebar();
		await this.#ensureSheet();
		const add = this.#sheet.element.querySelector(
			'[data-click="add-fellowship-member"]',
		);
		add?.classList.add("litm--tour-emphasis");
		if (!document.querySelector(".litm--fc-member-pick") && add) add.click();
		await this.#waitFor(() => document.querySelector(".litm--fc-member-pick"));
		this.#dialog =
			document
				.querySelector(".litm--fc-member-pick")
				?.closest(".application") ?? null;
		this.#updateAnchor([add, this.#dialog].filter(Boolean));
	}

	async #showRelationshipsHint() {
		this.#closeMemberPicker();
		this.#restoreSidebar();
		await this.#ensureSheet();
		document.body.classList.add("litm--tour-unfocused");
	}

	#restoreSidebar() {
		if (this.#initialSidebarTab) ui[this.#initialSidebarTab]?.activate();
		ui.sidebar.toggleExpanded(this.#initialSidebarExpanded);
	}

	#restoreManagerSection() {
		if (!this.#managerSectionWasCollapsed) return;
		this.#managerSectionWasCollapsed = false;
		ui.combat?.element
			?.querySelector(
				'[data-section="fellowship"] > [data-action="toggle-collapse"]',
			)
			?.click();
	}

	#closeMemberPicker() {
		if (!this.#dialog?.isConnected) {
			this.#dialog = null;
			return;
		}
		const cancel = this.#dialog.querySelector('[data-action="cancel"]');
		const close = this.#dialog.querySelector('[data-action="close"]');
		(cancel ?? close)?.click();
		this.#dialog = null;
	}

	#updateAnchor(elements) {
		const rects = elements
			.map((element) => element?.getBoundingClientRect())
			.filter((rect) => rect?.width > 0 && rect?.height > 0);
		if (!rects.length) return;
		this.#anchor ??= document.body.appendChild(document.createElement("div"));
		this.#anchor.setAttribute(FELLOWSHIP_TARGET, "");
		const left = Math.min(...rects.map((rect) => rect.left));
		const top = Math.min(...rects.map((rect) => rect.top));
		const right = Math.max(...rects.map((rect) => rect.right));
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		Object.assign(this.#anchor.style, {
			position: "fixed",
			left: `${left}px`,
			top: `${top}px`,
			width: `${right - left}px`,
			height: `${bottom - top}px`,
			pointerEvents: "none",
		});
	}

	#clearTargets() {
		this.#clearEmphasis();
		document
			.querySelectorAll(`[${FELLOWSHIP_TARGET}]`)
			.forEach((element) => element.removeAttribute(FELLOWSHIP_TARGET));
		this.#anchor?.remove();
		this.#anchor = null;
	}

	#clearEmphasis() {
		document
			.querySelectorAll(".litm--tour-emphasis")
			.forEach((element) => element.classList.remove("litm--tour-emphasis"));
	}

	async #finish() {
		if (this.#finishing) return;
		this.#finishing = true;
		document.body.classList.remove("litm--tour-unfocused");
		this.#closeMemberPicker();
		this.#restoreManagerSection();
		this.#restoreSidebar();
		this.#clearTargets();
		if (this.#sheet?.rendered && !this.#sheetWasOpen) await this.#sheet.close();
		this.#fellowship = null;
		this.#sheet = null;
		this.#sheetWasOpen = null;
		this.#sidebarCaptured = false;
	}

	async #waitFor(condition, timeout = 3000) {
		const started = performance.now();
		while (!condition()) {
			if (performance.now() - started > timeout) {
				throw new Error("Timed out while preparing the Fellowship tour.");
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

/** A tour of the Tag Manager's common controls and drag-and-drop workflow. */
class TagManagerBasicsTour extends foundry.nue.Tour {
	#initialSidebarTab = null;
	#initialSidebarExpanded = false;
	#sidebarCaptured = false;
	#popout = null;
	#popoutWasOpen = false;
	#temporaryTagId = null;
	#anchor = null;
	#finishing = false;

	/** The tour is available whenever the Tag Manager sidebar exists. */
	get canStart() {
		return super.canStart && Boolean(ui.combat);
	}

	/** Capture the user's UI before opening the Tag Manager views. */
	async start() {
		this.#finishing = false;
		this.#temporaryTagId = null;
		this.#captureSidebar();
		this.#popoutWasOpen = Boolean(ui.combat.popout?.rendered);
		await this.#removeStaleTemporaryTags();
		return super.start();
	}

	/** Complete the tour and always restore the interface and temporary data. */
	async complete() {
		try {
			return await super.complete();
		} finally {
			await this.#finish();
		}
	}

	/** Prepare the relevant Tag Manager controls before Foundry renders each step. */
	async _preStep() {
		try {
			this.#clearTarget();
			await this.#ensureSidebarManager();
			const stepId = this.currentStep?.id;
			if (stepId === "intro") this.#targetElements([ui.combat.element]);
			else {
				await this.#ensurePopoutManager();
				if (stepId === "popout") this.#targetElements([this.#popout.element]);
				else if (stepId === "manage-tag") await this.#showTagMenu();
				else if (stepId === "external-drag")
					this.#targetElements([
						...this.#popout.element.querySelectorAll(".litm--tm-column"),
					]);
				else if (stepId === "organize")
					this.#targetElements([
						...this.#popout.element.querySelectorAll(
							".litm--tm-tag-list, .litm--tm-limit-wrapper",
						),
					]);
				else if (stepId === "scope")
					this.#targetElements([
						...this.#popout.element.querySelectorAll(
							'[data-section="story"], [data-section="scene"]',
						),
					]);
			}
			await super._preStep();
		} catch (error) {
			await this.#finish();
			throw error;
		}
	}

	/** Remove temporary UI and data after the final step. */
	async _postStep() {
		await super._postStep();
		this.#closeContextMenu();
		if (!this.hasNext) await this.#finish();
	}

	/** Restore temporary UI and data when the tour is closed early. */
	exit() {
		const result = super.exit();
		this.#finish();
		return result;
	}

	#captureSidebar() {
		if (this.#sidebarCaptured) return;
		this.#sidebarCaptured = true;
		this.#initialSidebarExpanded = ui.sidebar.expanded;
		this.#initialSidebarTab =
			[
				"chat",
				"combat",
				"scenes",
				"actors",
				"items",
				"journal",
				"tables",
				"cards",
				"playlists",
				"compendium",
				"settings",
			].find((name) => ui[name]?.active) ?? null;
	}

	async #ensureSidebarManager() {
		ui.sidebar.expand();
		ui.combat.activate();
		await this.#waitFor(() => ui.combat.element?.isConnected);
	}

	async #ensurePopoutManager() {
		this.#popout = ui.combat.popout?.rendered
			? ui.combat.popout
			: await ui.combat.renderPopout();
		this.#popout ??= game.litm?._tmPopOut ?? ui.combat.popout;
		await this.#waitFor(() => this.#popout?.element?.isConnected);
	}

	async #showTagMenu() {
		let tag = this.#findManageableTag();
		if (!tag) {
			await this.#createTemporaryTag();
			tag = this.#findManageableTag();
		}
		if (!tag)
			throw new Error("Tag Manager Basics could not prepare a manageable tag.");
		tag.classList.add("litm--tour-emphasis");
		const rect = tag.getBoundingClientRect();
		tag.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: rect.right,
				clientY: rect.top,
			}),
		);
		await this.#waitFor(() =>
			document.querySelector(".litm--character-tag-menu"),
		);
		this.#targetElements([
			tag,
			document.querySelector(".litm--character-tag-menu"),
		]);
	}

	#findManageableTag() {
		return (
			this.#popout?.element?.querySelector(
				'[data-context-tag]:not([data-readonly="true"])[data-tag-id]',
			) ?? null
		);
	}

	async #createTemporaryTag() {
		const tagData = {
			id: foundry.utils.randomID(),
			name: game.i18n.localize("Litm.ui.name-tag"),
			type: "tag",
			isScratched: false,
			isHindering: false,
			isPrivate: false,
			isCrispy: false,
			isPermanent: false,
			_litmTourTemporary: true,
		};
		this.#temporaryTagId = tagData.id;
		if (game.user.isGM) {
			const config = game.settings.get(SYSTEM_ID, "storytags") ?? {};
			await game.settings.set(SYSTEM_ID, "storytags", {
				...config,
				tags: [...(config.tags ?? []), tagData],
			});
		} else {
			dispatch({
				app: "tag-manager",
				type: "story-scene-crud",
				section: "story",
				operation: "add-tag",
				tagData,
			});
		}
		await this.#waitFor(
			() =>
				this.#popout.element.querySelector(
					`[data-ref="story"][data-tag-id="${tagData.id}"]`,
				),
			10000,
		);
	}

	async #removeStaleTemporaryTags() {
		const config = game.settings.get(SYSTEM_ID, "storytags") ?? {};
		const staleIds = (config.tags ?? [])
			.filter((tag) => tag._litmTourTemporary)
			.map((tag) => tag.id);
		if (!staleIds.length) return;
		if (game.user.isGM) {
			await game.settings.set(SYSTEM_ID, "storytags", {
				...config,
				tags: (config.tags ?? []).filter((tag) => !tag._litmTourTemporary),
			});
			return;
		}
		for (const tagId of staleIds) {
			dispatch({
				app: "tag-manager",
				type: "story-scene-crud",
				section: "story",
				operation: "remove-tag",
				tagId,
			});
		}
	}

	#targetElements(elements) {
		const visible = elements.filter((element) => element?.isConnected);
		if (!visible.length) return;
		if (visible.length === 1) {
			visible[0].setAttribute(TAG_MANAGER_TARGET, "");
			return;
		}
		const rects = visible
			.map((element) => element.getBoundingClientRect())
			.filter((rect) => rect.width > 0 && rect.height > 0);
		if (!rects.length) return;
		this.#anchor ??= document.body.appendChild(document.createElement("div"));
		this.#anchor.setAttribute(TAG_MANAGER_TARGET, "");
		const left = Math.min(...rects.map((rect) => rect.left));
		const top = Math.min(...rects.map((rect) => rect.top));
		const right = Math.max(...rects.map((rect) => rect.right));
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		Object.assign(this.#anchor.style, {
			position: "fixed",
			left: `${left}px`,
			top: `${top}px`,
			width: `${right - left}px`,
			height: `${bottom - top}px`,
			pointerEvents: "none",
		});
	}

	#closeContextMenu() {
		document
			.querySelectorAll(".litm--character-tag-menu")
			.forEach((menu) => menu.remove());
	}

	#clearTarget() {
		document.querySelectorAll(`[${TAG_MANAGER_TARGET}]`).forEach((element) => {
			element.removeAttribute(TAG_MANAGER_TARGET);
			element.classList.remove("litm--tour-emphasis");
		});
		this.#anchor?.remove();
		this.#anchor = null;
	}

	async #removeTemporaryTag() {
		if (!this.#temporaryTagId) return;
		const id = this.#temporaryTagId;
		this.#temporaryTagId = null;
		if (game.user.isGM) {
			const config = game.settings.get(SYSTEM_ID, "storytags") ?? {};
			const tags = (config.tags ?? []).filter((tag) => tag.id !== id);
			await game.settings.set(SYSTEM_ID, "storytags", { ...config, tags });
			return;
		}
		dispatch({
			app: "tag-manager",
			type: "story-scene-crud",
			section: "story",
			operation: "remove-tag",
			tagId: id,
		});
	}

	async #finish() {
		if (this.#finishing) return;
		this.#finishing = true;
		this.#closeContextMenu();
		this.#clearTarget();
		await this.#removeTemporaryTag();
		if (!this.#popoutWasOpen && this.#popout?.rendered)
			await this.#popout.close();
		if (this.#initialSidebarTab) ui[this.#initialSidebarTab]?.activate();
		ui.sidebar.toggleExpanded(this.#initialSidebarExpanded);
		this.#popout = null;
		this.#sidebarCaptured = false;
	}

	async #waitFor(condition, timeout = 3000) {
		const started = performance.now();
		while (!condition()) {
			if (performance.now() - started > timeout) {
				throw new Error("Timed out while preparing the Tag Manager tour.");
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

/** A compact tour of useful controls which are easy to overlook. */
class HintsAndTipsTour extends foundry.nue.Tour {
	#targetAnchor = null;
	#openedApps = new Set();
	#controlledTokenIds = [];
	#tokenSelectionCaptured = false;
	#finishing = false;
	#controlsConfig = null;
	#temporaryActorId = null;
	#temporaryTokenId = null;
	#temporaryTokenSceneId = null;
	#temporaryMarker = null;

	/** Reset per-run state before showing the first hint. */
	async start() {
		this.#finishing = false;
		this.#controlledTokenIds = [];
		this.#tokenSelectionCaptured = false;
		this.#temporaryActorId = null;
		this.#temporaryTokenId = null;
		this.#temporaryTokenSceneId = null;
		this.#temporaryMarker = foundry.utils.randomID();
		return super.start();
	}

	/** Complete the tour and always close every application opened for its demonstrations. */
	async complete() {
		try {
			return await super.complete();
		} finally {
			await this.#finish();
		}
	}

	/** Prepare the interface demonstrated by the current hint. */
	async _preStep() {
		try {
			this.#clearTarget();
			const stepId = this.currentStep?.id;
			if (stepId === "token-hud") await this.#showTokenHud();
			else if (stepId === "reference") await this.#showReference();
			else if (stepId === "reference-button") await this.#showReferenceButton();
			else if (stepId === "art-settings") await this.#showArtSettings();
			else if (stepId === "progression-settings")
				await this.#showProgressionSettings();
			else if (stepId === "keybindings") await this.#showKeybindings();
			await super._preStep();
		} catch (error) {
			await this.#finish();
			throw error;
		}
	}

	/** Open the Token HUD palette after Foundry has installed the step overlay. */
	async _renderStep() {
		await super._renderStep();
		if (this.currentStep?.id !== "token-hud") return;
		const hud = document.querySelector("#token-hud");
		const effects = hud?.querySelector(
			'[data-action="togglePalette"][data-palette="effects"]',
		);
		const palette = hud?.querySelector(
			'.palette.status-effects[data-palette="effects"]',
		);
		if (!effects || !palette?.classList.contains("active")) effects?.click();
		await this.#settle();
		this.#focusTokenHudControls(hud);
	}

	/** Restore temporary interface state after the final step. */
	async _postStep() {
		const completedStepId = this.currentStep?.id;
		await super._postStep();
		if (completedStepId === "token-hud") {
			try {
				await this.#removeTemporaryToken();
			} finally {
				await this.#removeTemporaryActor();
			}
			this.#restoreTokenSelection();
		}
		if (completedStepId === "keybindings") await this.#closeControlsConfig();
		if (!this.hasNext) await this.#finish();
	}

	/** Restore temporary interface state when the tour is closed early. */
	exit() {
		const result = super.exit();
		this.#finish();
		return result;
	}

	async #showTokenHud() {
		await this.#closeFloatingApplications();
		let token =
			canvas?.tokens?.controlled?.[0] ??
			canvas?.tokens?.placeables?.find(
				(placeable) =>
					placeable.actor && (game.user.isGM || placeable.actor.isOwner),
			);
		if (!token) token = await this.#createTemporaryAwakenToken();
		if (!token) {
			document.body.classList.add("litm--tour-unfocused");
			this.#targetViewport();
			return;
		}
		if (!this.#tokenSelectionCaptured) {
			this.#tokenSelectionCaptured = true;
			this.#controlledTokenIds = canvas.tokens.controlled.map(
				(placeable) => placeable.id,
			);
		}
		if (!token.controlled) token.control({ releaseOthers: false });
		canvas.tokens.hud.bind(token);
		await this.#waitFor(() => document.querySelector("#token-hud"));
		const hud = document.querySelector("#token-hud");
		const effects = hud.querySelector(
			'[data-action="togglePalette"][data-palette="effects"]',
		);
		const palette = hud.querySelector(
			'.palette.status-effects[data-palette="effects"]',
		);
		if (!palette?.classList.contains("active")) effects?.click();
		await this.#settle();
		this.#focusTokenHudControls(hud);
	}

	async #createTemporaryAwakenToken() {
		const scene = canvas?.scene;
		if (!scene || !game.user.isGM) return null;
		let actor =
			game.actors.find(
				(entry) =>
					entry.getFlag(SYSTEM_ID, "starterContent")?.id ===
					STARTER_CHALLENGE_ID,
			) ??
			game.actors.find(
				(entry) =>
					entry.type === "challenge" &&
					["AWAKEN SENTRY", "ПРОБУЖДЁННЫЙ СТРАЖ"].includes(entry.name),
			);
		if (!actor) {
			const source = buildStarterChallenge(game.i18n.lang, null);
			delete source.flags[SYSTEM_ID].starterContent;
			source.flags[SYSTEM_ID].starterTourTemporary = this.#temporaryMarker;
			actor = await CONFIG.Actor.documentClass.create(source, {
				renderSheet: false,
			});
			this.#temporaryActorId = actor?.id ?? null;
		}
		if (!actor) return null;

		const sceneRect = canvas.dimensions?.sceneRect ?? {
			x: 0,
			y: 0,
			width: canvas.dimensions?.width ?? 0,
			height: canvas.dimensions?.height ?? 0,
		};
		const gridSize = canvas.dimensions?.size ?? 100;
		const x = sceneRect.x + sceneRect.width / 2 - gridSize / 2;
		const y = sceneRect.y + sceneRect.height / 2 - gridSize / 2;
		const tokenDocument = await actor.getTokenDocument({ x, y, hidden: false });
		const tokenSource = tokenDocument.toObject();
		tokenSource.flags ??= {};
		tokenSource.flags[SYSTEM_ID] = {
			...(tokenSource.flags[SYSTEM_ID] ?? {}),
			starterTourTemporary: this.#temporaryMarker,
		};
		const [created] = await scene.createEmbeddedDocuments("Token", [
			tokenSource,
		]);
		if (!created) return null;
		this.#temporaryTokenId = created.id;
		this.#temporaryTokenSceneId = scene.id;
		await this.#waitFor(() => canvas.tokens.get(created.id));
		const placeable = canvas.tokens.get(created.id);
		await canvas.animatePan({
			x: placeable.center.x,
			y: placeable.center.y,
			scale: 1,
		});
		return placeable;
	}

	async #closeFloatingApplications() {
		const applications = [...foundry.applications.instances.values()].filter(
			(app) =>
				app?.rendered &&
				typeof app.close === "function" &&
				app.element?.querySelector(".window-header"),
		);
		for (const app of applications) {
			try {
				await app.close();
			} catch (error) {
				console.warn(
					"Legend in the Mist | Could not close an application before the Token HUD tour step.",
					error,
				);
			}
		}
	}

	#focusTokenHudControls(hud) {
		if (!hud) return;
		const visibility = hud.querySelector(
			'[data-tooltip="Litm.ui.tag-visibility"]',
		);
		const effects = hud.querySelector(
			'[data-action="togglePalette"][data-palette="effects"]',
		);
		const palette = hud.querySelector(
			'.palette.status-effects[data-palette="effects"]',
		);
		visibility?.classList.add("litm--tour-emphasis");
		effects?.classList.add("litm--tour-emphasis");
		palette?.classList.add("litm--tour-emphasis");
		this.#targetElements([visibility, effects, palette].filter(Boolean));
	}

	async #showReference() {
		canvas?.tokens?.hud?.close();
		const app = await game.litm.reference.open("quickRules");
		if (app) this.#openedApps.add(app);
		await this.#waitFor(() => document.querySelector(".litm--reference-shell"));
		const root =
			document
				.querySelector(".litm--reference-shell")
				?.closest(".application") ??
			document.querySelector(".litm--reference-shell");
		this.#targetElements([root]);
	}

	async #showReferenceButton() {
		await this.#closeOpenedApps();
		document.querySelector('[data-control="notes"]')?.click();
		await this.#settle();
		const button = document.querySelector(
			'[data-tool="litmReference"], [data-tool="litm-reference"]',
		);
		if (button) {
			button.classList.add("litm--tour-emphasis");
			const column =
				document.querySelector("#ui-left-column-1") ??
				button.closest("#scene-controls") ??
				button.parentElement ??
				button;
			(document.querySelector("#scene-controls") ?? column).classList.add(
				"litm--tour-opaque-controls",
			);
			this.#targetElements([column, button]);
		} else {
			document.body.classList.add("litm--tour-unfocused");
			this.#targetViewport();
		}
	}

	async #showArtSettings() {
		const actor = this.#findCharacter();
		if (!actor) return this.#showUnfocusedStep();
		const sheet = actor.sheet;
		if (!sheet.rendered) await sheet.render({ force: true });
		this.#openedApps.add(sheet);
		await this.#waitFor(() => sheet.element?.isConnected);
		const button = await this.#openHeaderControl(
			sheet,
			"configureAvatarPosition",
		);
		button?.click();
		await this.#waitFor(() => document.querySelector(".litm--avatar-position"));
		const settingsContent = document.querySelector(".litm--avatar-position");
		const settings =
			settingsContent?.closest(".application") ?? settingsContent;
		this.#placeBelowControl(settings, button);
		this.#openedApps.add(settings?.application ?? settings);
		const visibleButton = await this.#reopenHeaderControl(
			sheet,
			"configureAvatarPosition",
		);
		visibleButton?.classList.add("litm--tour-emphasis");
		this.#targetElements([settings, visibleButton].filter(Boolean));
	}

	async #showProgressionSettings() {
		await this.#closeOpenedApps();
		const fellowship = game.items.find(
			(item) => item.type === "fellowship" && item.visible,
		);
		if (!fellowship) return this.#showUnfocusedStep();
		const sheet = fellowship.sheet;
		if (!sheet.rendered) await sheet.render({ force: true });
		this.#openedApps.add(sheet);
		await this.#waitFor(() => sheet.element?.isConnected);
		const button = await this.#openHeaderControl(sheet, "configureProgression");
		button?.click();
		await this.#waitFor(() =>
			document.querySelector(".litm--progression-settings"),
		);
		const settingsContent = document.querySelector(
			".litm--progression-settings",
		);
		const settings =
			settingsContent?.closest(".application") ?? settingsContent;
		this.#placeBelowControl(settings, button);
		this.#openedApps.add(settings?.application ?? settings);
		const visibleButton = await this.#reopenHeaderControl(
			sheet,
			"configureProgression",
		);
		visibleButton?.classList.add("litm--tour-emphasis");
		this.#targetElements([settings, visibleButton].filter(Boolean));
	}

	async #showKeybindings() {
		await this.#closeOpenedApps();
		const ControlsConfig = foundry.applications.sidebar.apps.ControlsConfig;
		const controls = new ControlsConfig();
		this.#controlsConfig = controls;
		await controls.render({ force: true });
		await this.#waitFor(() => controls.element?.isConnected);
		this.#openedApps.add(controls);
		const category = controls.element.querySelector(
			'[data-action="tab"][data-group="categories"][data-tab="system"]',
		);
		category?.click();
		await this.#settle();
		this.#targetElements([controls.element]);
	}

	#findCharacter() {
		const assigned = game.user.character;
		if (assigned?.type === "character" && assigned.visible) return assigned;
		return (
			game.actors.find(
				(actor) => actor.type === "character" && actor.visible && actor.isOwner,
			) ??
			game.actors.find(
				(actor) => actor.type === "character" && actor.visible,
			) ??
			null
		);
	}

	async #openHeaderControl(app, action) {
		let control = app.element.querySelector(`[data-action="${action}"]`);
		if (control && this.#isVisible(control)) return control;
		const toggle = app.element.querySelector('[data-action="toggleControls"]');
		toggle?.click();
		await this.#waitFor(() => {
			const candidate = app.element.querySelector(`[data-action="${action}"]`);
			return candidate && this.#isVisible(candidate);
		}).catch(() => {});
		control = app.element.querySelector(`[data-action="${action}"]`);
		return control && this.#isVisible(control) ? control : null;
	}

	async #reopenHeaderControl(app, action) {
		const toggle = app.element.querySelector('[data-action="toggleControls"]');
		toggle?.click();
		await this.#waitFor(() => {
			const control = app.element.querySelector(`[data-action="${action}"]`);
			return control && this.#isVisible(control);
		}).catch(() => {});
		return app.element.querySelector(`[data-action="${action}"]`);
	}

	#isVisible(element) {
		if (!element?.isConnected) return false;
		if (
			typeof element.checkVisibility === "function" &&
			!element.checkVisibility({
				checkOpacity: true,
				checkVisibilityCSS: true,
			})
		)
			return false;
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return (
			rect.width > 0 &&
			rect.height > 0 &&
			style.display !== "none" &&
			style.visibility !== "hidden" &&
			style.opacity !== "0"
		);
	}

	#placeBelowControl(application, control) {
		if (!application || !control) return;
		const controlRect = control.getBoundingClientRect();
		application.style.top = `${Math.max(8, controlRect.bottom + 12)}px`;
	}

	#showUnfocusedStep() {
		document.body.classList.add("litm--tour-unfocused");
		this.#targetViewport();
	}

	#targetViewport() {
		this.#targetAnchor ??= document.body.appendChild(
			document.createElement("div"),
		);
		this.#targetAnchor.setAttribute(HINTS_TARGET, "");
		Object.assign(this.#targetAnchor.style, {
			position: "fixed",
			inset: "0",
			pointerEvents: "none",
		});
	}

	#targetElements(elements) {
		const visible = elements.filter((element) => element?.isConnected);
		if (!visible.length) return this.#showUnfocusedStep();
		if (visible.length === 1) {
			visible[0].setAttribute(HINTS_TARGET, "");
			return;
		}
		const rects = visible
			.map((element) => element.getBoundingClientRect())
			.filter((rect) => rect.width > 0 && rect.height > 0);
		if (!rects.length) return this.#showUnfocusedStep();
		this.#targetAnchor ??= document.body.appendChild(
			document.createElement("div"),
		);
		this.#targetAnchor.setAttribute(HINTS_TARGET, "");
		const left = Math.min(...rects.map((rect) => rect.left));
		const top = Math.min(...rects.map((rect) => rect.top));
		const right = Math.max(...rects.map((rect) => rect.right));
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		Object.assign(this.#targetAnchor.style, {
			position: "fixed",
			left: `${left}px`,
			top: `${top}px`,
			width: `${right - left}px`,
			height: `${bottom - top}px`,
			pointerEvents: "none",
		});
	}

	#clearTarget() {
		document.body.classList.remove("litm--tour-unfocused");
		document
			.querySelectorAll(`[${HINTS_TARGET}]`)
			.forEach((element) => element.removeAttribute(HINTS_TARGET));
		document
			.querySelectorAll(".litm--tour-emphasis")
			.forEach((element) => element.classList.remove("litm--tour-emphasis"));
		document
			.querySelectorAll(".litm--tour-opaque-controls")
			.forEach((element) =>
				element.classList.remove("litm--tour-opaque-controls"),
			);
		this.#targetAnchor?.remove();
		this.#targetAnchor = null;
	}

	async #closeOpenedApps() {
		for (const app of this.#openedApps) {
			if (app?.rendered && typeof app.close === "function") await app.close();
			else if (app instanceof HTMLElement)
				app.querySelector('[data-action="close"]')?.click();
		}
		this.#openedApps.clear();
	}

	async #closeControlsConfig() {
		const controls = this.#controlsConfig;
		this.#controlsConfig = null;
		if (!controls) return;
		this.#openedApps.delete(controls);
		if (controls.rendered) await controls.close();
	}

	async #finish() {
		if (this.#finishing) return;
		this.#finishing = true;
		this.#clearTarget();
		canvas?.tokens?.hud?.close();
		try {
			await this.#removeTemporaryToken();
		} finally {
			await this.#removeTemporaryActor();
		}
		await this.#closeControlsConfig();
		await this.#closeOpenedApps();
		this.#restoreTokenSelection();
	}

	async #removeTemporaryToken() {
		const id = this.#temporaryTokenId;
		const sceneId = this.#temporaryTokenSceneId;
		this.#temporaryTokenId = null;
		this.#temporaryTokenSceneId = null;
		if (!id || !sceneId) return;
		const scene = game.scenes.get(sceneId);
		const token = scene?.tokens.get(id);
		if (
			token?.getFlag(SYSTEM_ID, "starterTourTemporary") !==
			this.#temporaryMarker
		)
			return;
		await scene.deleteEmbeddedDocuments("Token", [id]);
	}

	async #removeTemporaryActor() {
		const id = this.#temporaryActorId;
		this.#temporaryActorId = null;
		if (!id) return;
		const actor = game.actors.get(id);
		if (
			actor?.getFlag(SYSTEM_ID, "starterTourTemporary") !==
			this.#temporaryMarker
		)
			return;
		await actor.delete({ render: false });
	}

	#restoreTokenSelection() {
		if (!this.#tokenSelectionCaptured || !canvas?.tokens) return;
		canvas.tokens.releaseAll();
		for (const id of this.#controlledTokenIds)
			canvas.tokens.get(id)?.control({ releaseOthers: false });
		this.#tokenSelectionCaptured = false;
		this.#controlledTokenIds = [];
	}

	async #settle() {
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		await new Promise((resolve) => setTimeout(resolve, 75));
	}

	async #waitFor(condition, timeout = 3000) {
		const started = performance.now();
		while (!condition()) {
			if (performance.now() - started > timeout)
				throw new Error("Timed out while preparing Hints & Tips.");
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

/** Register the system's guided tours for the current Foundry user. */
export class StarterTours {
	/** Register tours and offer the first one when this user enters the world for the first time. */
	static register() {
		Hooks.once("ready", async () => {
			const copy = game.i18n.lang === "ru" ? COPY.ru : COPY.en;
			const steps = [
				["intro", copy.steps.intro, `[${ANCHOR_TARGET}]`],
				["open-cards", copy.steps.openCards, `[${ANCHOR_TARGET}]`],
				["flip-cards", copy.steps.flipCards, `[${ANCHOR_TARGET}]`],
				["tracking-and-notes", copy.steps.tracking, `[${ANCHOR_TARGET}]`],
				["select-tag", copy.steps.selectTag, `[${TAG_TARGET}]`],
				["context-menu", copy.steps.contextTag, `[${TAG_TARGET}]`],
			].map(([id, text, selector]) => ({
				id,
				selector,
				title: text.title,
				content: text.content,
			}));
			const tour = new HeroSheetBasicsTour({
				id: HERO_SHEET_BASICS_ID,
				namespace: SYSTEM_ID,
				title: copy.title,
				description: copy.description,
				display: true,
				canBeResumed: false,
				suggestedNextTours: game.user.isGM
					? [
							`${SYSTEM_ID}.${FELLOWSHIP_BASICS_ID}`,
							`${SYSTEM_ID}.${TAG_MANAGER_BASICS_ID}`,
							`${SYSTEM_ID}.${HINTS_TIPS_ID}`,
						]
					: [
							`${SYSTEM_ID}.${TAG_MANAGER_BASICS_ID}`,
							`${SYSTEM_ID}.${HINTS_TIPS_ID}`,
						],
				steps,
			});
			game.tours.register(SYSTEM_ID, HERO_SHEET_BASICS_ID, tour);

			const fellowshipCopy =
				game.i18n.lang === "ru" ? FELLOWSHIP_COPY.ru : FELLOWSHIP_COPY.en;
			const fellowshipSteps = [
				[
					"fellowship-sheet",
					fellowshipCopy.steps.sheet,
					`[${FELLOWSHIP_TARGET}]`,
				],
				["tag-manager", fellowshipCopy.steps.manager, `[${FELLOWSHIP_TARGET}]`],
				["add-members", fellowshipCopy.steps.members, `[${FELLOWSHIP_TARGET}]`],
				["relationships", fellowshipCopy.steps.relationships, null],
			].map(([id, text, selector]) => ({
				id,
				...(selector ? { selector } : {}),
				title: text.title,
				content: text.content,
			}));
			const fellowshipTour = new FellowshipBasicsTour({
				id: FELLOWSHIP_BASICS_ID,
				namespace: SYSTEM_ID,
				title: fellowshipCopy.title,
				description: fellowshipCopy.description,
				display: true,
				canBeResumed: false,
				restricted: true,
				suggestedNextTours: [
					`${SYSTEM_ID}.${TAG_MANAGER_BASICS_ID}`,
					`${SYSTEM_ID}.${HINTS_TIPS_ID}`,
				],
				steps: fellowshipSteps,
			});
			game.tours.register(SYSTEM_ID, FELLOWSHIP_BASICS_ID, fellowshipTour);

			const tagManagerCopy =
				game.i18n.lang === "ru" ? TAG_MANAGER_COPY.ru : TAG_MANAGER_COPY.en;
			const tagManagerSteps = [
				["intro", tagManagerCopy.steps.intro, "LEFT"],
				["popout", tagManagerCopy.steps.popout],
				["manage-tag", tagManagerCopy.steps.manage],
				["external-drag", tagManagerCopy.steps.externalDrag],
				["organize", tagManagerCopy.steps.organize],
				["scope", tagManagerCopy.steps.scope],
			].map(([id, text, tooltipDirection]) => ({
				id,
				selector: `[${TAG_MANAGER_TARGET}]`,
				...(tooltipDirection ? { tooltipDirection } : {}),
				title: text.title,
				content: text.content,
			}));
			const tagManagerTour = new TagManagerBasicsTour({
				id: TAG_MANAGER_BASICS_ID,
				namespace: SYSTEM_ID,
				title: tagManagerCopy.title,
				description: tagManagerCopy.description,
				display: true,
				canBeResumed: false,
				suggestedNextTours: [`${SYSTEM_ID}.${HINTS_TIPS_ID}`],
				steps: tagManagerSteps,
			});
			game.tours.register(SYSTEM_ID, TAG_MANAGER_BASICS_ID, tagManagerTour);

			const hintsCopy = game.i18n.lang === "ru" ? HINTS_COPY.ru : HINTS_COPY.en;
			const hintsSteps = [
				["token-hud", hintsCopy.steps.tokenHud],
				["reference", hintsCopy.steps.reference],
				["reference-button", hintsCopy.steps.referenceButton],
				["art-settings", hintsCopy.steps.art],
				["progression-settings", hintsCopy.steps.progression],
				["keybindings", hintsCopy.steps.keybindings],
			].map(([id, text]) => ({
				id,
				selector: `[${HINTS_TARGET}]`,
				title: text.title,
				content: text.content,
			}));
			const hintsTour = new HintsAndTipsTour({
				id: HINTS_TIPS_ID,
				namespace: SYSTEM_ID,
				title: hintsCopy.title,
				description: hintsCopy.description,
				display: true,
				canBeResumed: false,
				steps: hintsSteps,
			});
			game.tours.register(SYSTEM_ID, HINTS_TIPS_ID, hintsTour);

			await StarterTours.#offerFirstTour(tour);
		});
	}

	static async #offerFirstTour(tour) {
		if (game.user.getFlag(SYSTEM_ID, STARTER_TOUR_PROMPT_FLAG)) return;

		// The first-world journal is created by another ready hook. Give it time to
		// open so the invitation is rendered above it instead of being covered by it.
		if (game.user.isGM && !game.settings.get(SYSTEM_ID, "welcomed")) {
			const started = performance.now();
			while (
				!game.settings.get(SYSTEM_ID, "welcomed") &&
				performance.now() - started < 3000
			) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);

		try {
			await game.user.setFlag(SYSTEM_ID, STARTER_TOUR_PROMPT_FLAG, true);
		} catch (error) {
			console.warn(
				"Legend in the Mist | Could not remember the starter-tour invitation.",
				error,
			);
		}

		const promptCopy =
			game.i18n.lang === "ru"
				? STARTER_TOUR_PROMPT_COPY.ru
				: STARTER_TOUR_PROMPT_COPY.en;
		const accepted = await foundry.applications.api.DialogV2.wait({
			window: { title: promptCopy.title },
			content: promptCopy.content,
			buttons: [
				{
					action: "accept",
					label: promptCopy.accept,
					icon: "fa-solid fa-check",
					default: true,
					callback: () => true,
				},
				{
					action: "decline",
					label: promptCopy.decline,
					icon: "fa-solid fa-xmark",
					callback: () => false,
				},
			],
			rejectClose: false,
		});
		if (!accepted) return;

		await tour.reset();
		tour.start();
	}
}
