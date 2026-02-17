import { info } from "../logger.js";

export class Fonts {
	static register() {
		info("Registering Fonts...");
		foundry.applications.settings.menus.FontConfig.loadFont("LitM Dice", {
			fonts: [
				{
					name: "LitM Dice",
					urls: ["systems/litm-rn/assets/fonts/litm-dice.otf"],
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("CaslonAntique", {
			editor: true,
			fonts: [
				{
					name: "CaslonAntique",
					urls: ["systems/litm-rn/assets/fonts/caslon.ttf"],
					sizeAdjust: "110%",
				},
				{
					name: "CaslonAntique",
					urls: ["systems/litm-rn/assets/fonts/caslon-b.ttf"],
					weight: "bold",
					sizeAdjust: "110%",
				},
				{
					name: "CaslonAntique",
					urls: ["systems/litm-rn/assets/fonts/caslon-i.ttf"],
					style: "italic",
					sizeAdjust: "110%",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("Fraunces", {
			editor: true,
			fonts: [
				{
					name: "Fraunces",
					urls: ["systems/litm-rn/assets/fonts/fraunces.ttf"],
					weight: "300 800",
				},
				{
					name: "Fraunces",
					urls: ["systems/litm-rn/assets/fonts/fraunces-i.ttf"],
					style: "italic",
					weight: "300 800",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("AlchemyItalic", {
			editor: true,
			fonts: [
				{
					name: "AlchemyItalic",
					urls: ["systems/litm-rn/assets/fonts/alchemy-i.ttf"],
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("PackardAntique", {
			editor: true,
			fonts: [
				{
					name: "PackardAntique",
					urls: ["systems/litm-rn/assets/fonts/packard.ttf"],
				},
				{
					name: "PackardAntique",
					urls: ["systems/litm-rn/assets/fonts/packard-b.ttf"],
					weight: "bold",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("PowellAntique", {
			editor: true,
			fonts: [
				{
					name: "PowellAntique",
					urls: ["systems/litm-rn/assets/fonts/powell.ttf"],
				},
				{
					name: "PowellAntique",
					urls: ["systems/litm-rn/assets/fonts/powell-b.ttf"],
					weight: "bold",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("AubreyPro", {
			editor: true,
			fonts: [
				{
					name: "AubreyPro",
					urls: ["systems/litm-rn/assets/fonts/aubrey-pro.otf"],
					weight: "300 800",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("Dudka", {
			editor: true,
			fonts: [
				{
					name: "Dudka",
					urls: ["systems/litm-rn/assets/fonts/dudka.ttf"],
				},
				{
					name: "Dudka",
					urls: ["systems/litm-rn/assets/fonts/dudka-i.ttf"],
					style: "italic",
				},
				{
					name: "Dudka",
					urls: ["systems/litm-rn/assets/fonts/dudka-b.ttf"],
					weight: "bold",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("Dudka Italic", {
			editor: true,
			fonts: [
				{
					name: "Dudka Italic",
					urls: ["systems/litm-rn/assets/fonts/dudka-i.ttf"],
					style: "italic",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("TagesschriftCyrillic", {
			editor: true,
			fonts: [
				{
					name: "TagesschriftCyrillic",
					urls: ["systems/litm-rn/assets/fonts/tagesschrift-cyrillic.ttf"],
					weight: "300 800",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("TagesschriftCyrillicSC", {
			editor: true,
			fonts: [
				{
					name: "TagesschriftCyrillicSC",
					urls: ["systems/litm-rn/assets/fonts/tagesschrift-cyrillic.ttf"],
					weight: "300 800",
					sizeAdjust: "110%",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("TorukSC", {
			editor: true,
			fonts: [
				{
					name: "TorukSC",
					urls: ["systems/litm-rn/assets/fonts/toruksc.ttf"],
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("TorukSC Primary", {
			editor: true,
			fonts: [
				{
					name: "TorukSC Primary",
					urls: ["systems/litm-rn/assets/fonts/toruksc.ttf"],
					sizeAdjust: "95%",
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("GentiumPlus", {
			editor: true,
			fonts: [
				{
					name: "GentiumPlus",
					urls: ["systems/litm-rn/assets/fonts/gentium-plus.ttf"],
				},
			],
		});
		foundry.applications.settings.menus.FontConfig.loadFont("GentiumBookPlus", {
			editor: true,
			fonts: [
				{
					name: "GentiumBookPlus",
					urls: ["systems/litm-rn/assets/fonts/gentium-book-plus.ttf"],
				},
			],
		});
	}
}
