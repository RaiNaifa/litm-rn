import {
	ReferenceHandbook,
	ReferenceHandbookSettings,
} from "../apps/reference-handbook.js";
import { StoryProfileSettings } from "../apps/story-profile-settings.js";
import { ThemeSourceSettings } from "../apps/theme-source-settings.js";

export class LitmSettings {
	static register() {
		game.settings.register("litm-rn", "dataSchemaVersion", {
			scope: "world",
			config: false,
			type: Number,
			default: 0,
		});
		game.settings.register("litm-rn", "referenceHandbook", {
			scope: "world",
			config: false,
			type: Object,
			default: {
				version: 8,
				order: [],
				pages: [],
				overrides: {},
				appearance: {},
				pageAppearance: {},
			},
			onChange: () => ReferenceHandbook.refreshOpen(),
		});
		game.settings.registerMenu("litm-rn", "referenceHandbookMenu", {
			name: "Litm.reference.title",
			label: "Litm.reference.manage",
			hint: "Litm.reference.manage-hint",
			icon: "fas fa-clipboard-question",
			type: ReferenceHandbookSettings,
			restricted: true,
		});
		game.settings.register("litm-rn", "welcomed", {
			name: "Welcome Screen",
			hint: "Welcome Scene, Message, and Journal Entry has been created and displayed.",
			scope: "world",
			config: false,
			type: Boolean,
			default: false,
		});
		game.settings.register("litm-rn", "starterContentInitialized", {
			scope: "world",
			config: false,
			type: Boolean,
			default: false,
		});
		game.settings.register("litm-rn", "storytags", {
			name: "Story Tags",
			hint: "Tags that are shared between all users.",
			scope: "world",
			config: false,
			type: Object,
			default: {
				tags: [],
				actors: [],
				helpingTags: [],
			},
			onChange: (value) => {
				StoryProfileSettings.syncActiveProfile(value).catch(() => {});
			},
		});
		game.settings.register("litm-rn", "storyProfiles", {
			scope: "world",
			config: false,
			type: Object,
			default: {
				version: 1,
				activeId: "",
				profiles: [],
			},
		});
		game.settings.registerMenu("litm-rn", "storyProfilesMenu", {
			name: "Litm.settings.story-profiles",
			label: "Litm.settings.manage-story-profiles",
			hint: "Litm.settings.story-profiles-hint",
			icon: "fas fa-book",
			type: StoryProfileSettings,
			restricted: true,
		});
		game.settings.register("litm-rn", "selectedFellowship", {
			name: "Selected Fellowship",
			hint: "Fellowship selected by GM for the Tag Manager.",
			scope: "world",
			config: false,
			type: String,
			default: "",
		});
		game.settings.register("litm-rn", "campSessions", {
			scope: "world",
			config: false,
			type: Object,
			default: { version: 1, active: {} },
			onChange: () => game.litm?.CampDialog?.refreshAll?.(),
		});
		game.settings.register("litm-rn", "themeSources", {
			scope: "world",
			config: false,
			type: Object,
			default: {
				includeWorld: true,
				packs: [],
			},
		});
		game.settings.registerMenu("litm-rn", "themeSourcesMenu", {
			name: "Litm.settings.theme-sources",
			label: "Litm.settings.manage-theme-sources",
			hint: "Litm.settings.theme-sources-hint",
			icon: "fas fa-books",
			type: ThemeSourceSettings,
			restricted: true,
		});
		game.settings.register("litm-rn", "portraitMode-character", {
			name: "Litm.settings.portrait-mode-character",
			hint: "Litm.settings.portrait-mode-character-hint",
			scope: "world",
			config: true,
			type: String,
			default: "portrait",
			choices: {
				portrait: "Litm.settings.portrait",
				token: "Litm.settings.token",
			},
		});
		game.settings.register("litm-rn", "portraitMode-challenge", {
			name: "Litm.settings.portrait-mode-challenge",
			hint: "Litm.settings.portrait-mode-challenge-hint",
			scope: "world",
			config: true,
			type: String,
			default: "token",
			choices: {
				portrait: "Litm.settings.portrait",
				token: "Litm.settings.token",
			},
		});
		game.settings.register("litm-rn", "challengeDefaultLayout", {
			name: "Litm.settings.challenge-default-layout",
			hint: "Litm.settings.challenge-default-layout-hint",
			scope: "world",
			config: true,
			type: String,
			default: "wide",
			choices: {
				compact: "Litm.ui.challenge-layout-compact",
				wide: "Litm.ui.challenge-layout-wide",
			},
		});
		game.settings.register("litm-rn", "fellowship_relationship_as_weakness", {
			name: "Litm.settings.fellowship-relationship-as-weakness",
			hint: "Litm.settings.fellowship-relationship-as-weakness-hint",
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
		});
		game.settings.register("litm-rn", "block_rolls_until_moderated", {
			name: "Litm.settings.block-rolls-until-moderated",
			hint: "Litm.settings.block-rolls-until-moderated-hint",
			scope: "world",
			config: true,
			type: Boolean,
			default: false,
		});

		game.settings.register("litm-rn", "defaultActorType", {
			name: "Litm.settings.default-actor-type",
			hint: "Litm.settings.default-actor-type-hint",
			scope: "client",
			config: true,
			type: String,
			default: "auto",
			choices: {
				auto: "Litm.settings.default-actor-type-auto",
				character: "TYPES.Actor.character",
				challenge: "TYPES.Actor.challenge",
			},
		});

		game.settings.register("litm-rn", "defaultItemType", {
			name: "Litm.settings.default-item-type",
			hint: "Litm.settings.default-item-type-hint",
			scope: "client",
			config: true,
			type: String,
			default: "auto",
			choices: {
				auto: "Litm.settings.default-item-type-auto",
				story: "TYPES.Item.story",
				fellowship: "TYPES.Item.fellowship",
				theme: "TYPES.Item.theme",
				themebook: "TYPES.Item.themebook",
				themekit: "TYPES.Item.themekit",
				threat: "TYPES.Item.threat",
			},
		});

		game.settings.register("litm-rn", "rollSelections", {
			scope: "client",
			config: false,
			type: Object,
			default: {},
		});

		game.settings.register("litm-rn", "gmRollSelections", {
			scope: "client",
			config: false,
			type: Object,
			default: {},
		});
	}
}
