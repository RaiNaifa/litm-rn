import { ChallengeData } from "./scripts/actor/challenge/challenge-data.js";
import { ChallengeSheet } from "./scripts/actor/challenge/challenge-sheet.js";
import { CharacterData } from "./scripts/actor/character/character-data.js";
import { CharacterSheet } from "./scripts/actor/character/character-sheet.js";
import { DENOMINATION, DoubleSix } from "./scripts/apps/dice.js";
import { importCharacter } from "./scripts/apps/import-character.js";
import { FellowshipThemeData } from "./scripts/item/fellowship/fellowship-data.js";
import { FellowshipThemeSheet } from "./scripts/item/fellowship/fellowship-sheet.js";
import { LitmRollDialog } from "./scripts/apps/roll-dialog.js";
import { LitmRoll } from "./scripts/apps/roll.js";
import { StoryTagApp } from "./scripts/apps/story-tags.js";
import { SuperCheckbox } from "./scripts/components/super-checkbox.js";
import { ToggledInput } from "./scripts/components/toggled-input.js";
import { TagData } from "./scripts/data/abstract.js";
import { RelationshipData } from "./scripts/data/abstract.js";
import { SpecialData } from "./scripts/data/abstract.js";
import { BackpackData } from "./scripts/item/backpack/backpack-data.js";
import { BackpackSheet } from "./scripts/item/backpack/backpack-sheet.js";
import { HeroData } from "./scripts/item/hero/hero-data.js";
import { HeroSheet } from "./scripts/item/hero/hero-sheet.js";
import { ThemeData } from "./scripts/item/theme/theme-data.js";
import { ThemeSheet } from "./scripts/item/theme/theme-sheet.js";
import { ThreatData } from "./scripts/item/threat/threat-data.js";
import { ThreatSheet } from "./scripts/item/threat/threat-sheet.js";
import { info, success } from "./scripts/logger.js";
import { LitmConfig } from "./scripts/system/config.js";
import { Enrichers } from "./scripts/system/enrichers.js";
import { Fonts } from "./scripts/system/fonts.js";
import {
	HandlebarsHelpers,
	HandlebarsPartials,
} from "./scripts/system/handlebars.js";
import { LitmHooks } from "./scripts/system/hooks.js";
import { KeyBindings } from "./scripts/system/keybindings.js";
import { LitmSettings } from "./scripts/system/settings.js";
import { Sockets } from "./scripts/system/sockets.js";

// Set the logo to the LitM logo
$("#logo").attr("src", "systems/litm-rn/assets/media/logo.webp");

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
		StoryTagApp,
	};

	info("Initializing Config...");
	CONFIG.Actor.dataModels.character = CharacterData;
	CONFIG.Actor.dataModels.challenge = ChallengeData;
	CONFIG.Actor.trackableAttributes.character =
	CharacterData.getTrackableAttributes();
	CONFIG.Dice.terms[DENOMINATION] = DoubleSix;
	CONFIG.Dice.rolls.push(LitmRoll);
	CONFIG.Item.dataModels.backpack = BackpackData;
	CONFIG.Item.dataModels.fellowship = FellowshipThemeData;
	CONFIG.Item.dataModels.hero = HeroData;
	CONFIG.Item.dataModels.theme = ThemeData;
	CONFIG.Item.dataModels.threat = ThreatData;
	CONFIG.litm = new LitmConfig();

	info("Registering Sheets...");
	// Unregister the default sheets
	foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
	foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
	// Register the new sheets
	foundry.documents.collections.Actors.registerSheet("litm-rn", CharacterSheet, {
		types: ["character"],
		makeDefault: true,
	});
	foundry.documents.collections.Actors.registerSheet("litm-rn", ChallengeSheet, {
		types: ["challenge"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litm-rn", BackpackSheet, {
		types: ["backpack"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litm-rn", FellowshipThemeSheet, {
		types: ["fellowship"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litm-rn", HeroSheet, {
		types: ["hero"],
		makeDefault: true,
	});
	// Items.registerSheet("litm-rn", StoryThemeSheet, {
	// 	types: ["storytheme"],
	// 	makeDefault: true,
	// });
	foundry.documents.collections.Items.registerSheet("litm-rn", ThemeSheet, {
		types: ["theme"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litm-rn", ThreatSheet, {
		types: ["threat"],
		makeDefault: true,
	});

	HandlebarsHelpers.register();
	HandlebarsPartials.register();
	Enrichers.register();
	Fonts.register();
	KeyBindings.register();
	LitmSettings.register();
	LitmHooks.register();
	Sockets.registerListeners();

	success("Successfully initialized Legend in the Mist!");
});
