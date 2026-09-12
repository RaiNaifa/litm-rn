import {
	STARTER_CHALLENGE_FOLDER_ID,
	STARTER_CHALLENGE_FOLDER_NAMES,
	STARTER_CHALLENGE_ID,
	buildStarterChallenge,
} from "./starter-challenge.js";
import {
	PREGEN_FOLDER_ID,
	PREGEN_FOLDER_NAMES,
	PREGEN_VERSION,
	buildPregenActors,
} from "./starter-pregens.js";

const SYSTEM_ID = "litm-rn";
const LANDING_SCENE_ID = "landing-scene";
const FELLOWSHIP_ID = "starter-fellowship";
const FELLOWSHIP_VERSION = 2;

/** Create the initial world content independently from legacy onboarding. */
export class StarterContent {
	/** Register the first-ready bootstrap for the active GM. */
	static register() {
		Hooks.once("ready", async () => {
			const activeGM = game.users.activeGM;
			if (!game.user.isGM || (activeGM && activeGM.id !== game.user.id)) return;
			if (game.settings.get(SYSTEM_ID, "starterContentInitialized")) return;

			const isNewWorld =
				game.scenes.size === 0 &&
				game.actors.size === 0 &&
				game.items.size === 0 &&
				!game.settings.get(SYSTEM_ID, "welcomed");
			await game.settings.set(SYSTEM_ID, "starterContentInitialized", true);
			if (!isNewWorld) return;

			const scene = await this.ensureLandingScene();
			if (!scene) return;
			await this.ensurePregenHeroes(scene);
			await this.ensureStarterChallenge(scene);
			await this.ensureFellowship(scene);
		});
	}

	/**
	 * Create and activate the landing scene when the world has no scenes yet.
	 * @returns {Promise<Scene|null>} The existing or newly created landing scene.
	 */
	static async ensureLandingScene() {
		let scene = game.scenes.find(
			(entry) =>
				entry.getFlag(SYSTEM_ID, "starterContent")?.id === LANDING_SCENE_ID,
		);
		if (scene) return scene;
		if (game.scenes.size > 0) return null;

		scene = await CONFIG.Scene.documentClass.create({
			name: "Legend in the Mist",
			navigation: true,
			navName: "Legend in the Mist",
			background: {
				src: "systems/litm-rn/assets/media/litm-custom-logo.webp",
			},
			width: 1920,
			height: 1080,
			padding: 0.25,
			initial: {
				x: 1450,
				y: 850,
				scale: 0.9,
			},
			backgroundColor: "#121212",
			grid: {
				type: CONST.GRID_TYPES.GRIDLESS,
				size: 100,
			},
			tokenVision: false,
			fog: {
				exploration: false,
			},
			environment: {
				globalLight: {
					enabled: true,
				},
			},
			ownership: {
				default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
			},
			flags: {
				[SYSTEM_ID]: {
					starterContent: {
						id: LANDING_SCENE_ID,
						version: 1,
					},
				},
			},
		});

		const { thumb } = await scene.createThumbnail();
		await scene.update({ thumb });
		await scene.activate();
		return scene;
	}

	/**
	 * Create the localized pregenerated heroes belonging to the starter scene.
	 * Existing documents are identified by flags and are never overwritten.
	 * @param {Scene} scene The system-created landing scene.
	 * @returns {Promise<Actor[]>} Existing and newly created pregen Actors.
	 */
	static async ensurePregenHeroes(scene) {
		const starterFlag = scene.getFlag(SYSTEM_ID, "starterContent");
		if (starterFlag?.id !== LANDING_SCENE_ID) return [];

		const locale =
			starterFlag.locale || (game.i18n.lang === "ru" ? "ru" : "en");
		if (!starterFlag.locale) {
			await scene.setFlag(SYSTEM_ID, "starterContent", {
				...starterFlag,
				locale,
			});
		}

		let folder = game.folders.find(
			(entry) =>
				entry.type === "Actor" &&
				entry.getFlag(SYSTEM_ID, "starterContent")?.id === PREGEN_FOLDER_ID,
		);
		if (!folder) {
			folder = await CONFIG.Folder.documentClass.create({
				name: PREGEN_FOLDER_NAMES[locale],
				type: "Actor",
				flags: {
					[SYSTEM_ID]: {
						starterContent: {
							id: PREGEN_FOLDER_ID,
							version: PREGEN_VERSION,
							locale,
						},
					},
				},
			});
		}

		const allSources = buildPregenActors(locale, folder.id);
		const existingIds = new Set(
			game.actors
				.map((actor) => actor.getFlag(SYSTEM_ID, "starterContent")?.id)
				.filter(Boolean),
		);
		const sources = allSources.filter(
			(source) => !existingIds.has(source.flags[SYSTEM_ID].starterContent.id),
		);
		if (sources.length)
			await CONFIG.Actor.documentClass.createDocuments(sources, {
				renderSheet: false,
			});
		return game.actors.filter((actor) =>
			["apple-picker", "red-marshal", "wise-one"].includes(
				actor.getFlag(SYSTEM_ID, "starterContent")?.id,
			),
		);
	}

	/**
	 * Create the localized starter Challenge next to the pregenerated heroes.
	 * @param {Scene} scene The system-created landing scene.
	 * @returns {Promise<Actor|null>} The existing or newly created Challenge.
	 */
	static async ensureStarterChallenge(scene) {
		const starterFlag = scene.getFlag(SYSTEM_ID, "starterContent");
		if (starterFlag?.id !== LANDING_SCENE_ID) return null;
		const existing = game.actors.find(
			(actor) =>
				actor.getFlag(SYSTEM_ID, "starterContent")?.id ===
					STARTER_CHALLENGE_ID &&
				!actor.getFlag(SYSTEM_ID, "starterTourTemporary"),
		);
		if (existing) return existing;

		const locale = starterFlag.locale === "ru" ? "ru" : "en";
		let folder = game.folders.find(
			(entry) =>
				entry.type === "Actor" &&
				entry.getFlag(SYSTEM_ID, "starterContent")?.id ===
					STARTER_CHALLENGE_FOLDER_ID,
		);
		if (!folder) {
			folder = await CONFIG.Folder.documentClass.create({
				name: STARTER_CHALLENGE_FOLDER_NAMES[locale],
				type: "Actor",
				flags: {
					[SYSTEM_ID]: {
						starterContent: { id: STARTER_CHALLENGE_FOLDER_ID, locale },
					},
				},
			});
		}
		return CONFIG.Actor.documentClass.create(
			buildStarterChallenge(locale, folder.id),
			{ renderSheet: false },
		);
	}

	/**
	 * Create the localized empty Fellowship used by starter-world tours.
	 * @param {Scene} scene The system-created landing scene.
	 * @returns {Promise<Item|null>} The existing or newly created Fellowship.
	 */
	static async ensureFellowship(scene) {
		const starterFlag = scene.getFlag(SYSTEM_ID, "starterContent");
		if (starterFlag?.id !== LANDING_SCENE_ID) return null;
		const existing = game.items.find(
			(item) =>
				item.type === "fellowship" &&
				item.getFlag(SYSTEM_ID, "starterContent")?.id === FELLOWSHIP_ID,
		);
		if (existing) return existing;

		const locale = starterFlag.locale === "ru" ? "ru" : "en";
		return CONFIG.Item.documentClass.create(
			{
				name: locale === "ru" ? "Содружество" : "Fellowship",
				type: "fellowship",
				system: {
					members: [],
					draftTags: [],
					specials: [],
				},
				ownership: {
					default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
				},
				flags: {
					[SYSTEM_ID]: {
						starterContent: {
							id: FELLOWSHIP_ID,
							version: FELLOWSHIP_VERSION,
							locale,
						},
					},
				},
			},
			{ renderSheet: false },
		);
	}
}
