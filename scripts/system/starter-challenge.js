const SYSTEM_ID = "litm-rn";
const STARTER_CHALLENGE_ID = "awaken-sentry";
const STARTER_CHALLENGE_FOLDER_ID = "pregen-challenges";
const STARTER_CHALLENGE_VERSION = 1;

const CHALLENGE = {
	en: {
		name: "AWAKEN SENTRY",
		category: "Aggressor",
		note: "<p>This mindless shambling bog corpse of an ancient guard has been preserved in its waterlogged resting place and reanimated by a foul poison that had seeped into the water. Wearing the decrepit remains of its old armor, it now roams Raven's Dale, seeking to ruin and snuff out all living things. The dark ooze itself is infused with a malign spirit or force that can be banished, and the body can be broken beyond use. It's impractical to light this creature on fire, unless it is somehow dried out first.</p>",
		limits: [
			{ name: "Harm", value: 2 },
			{ name: "Banish", value: 2 },
			{ name: "Burn", value: null },
		],
		tags: ["shambling", "dead flesh"],
		threats: [
			{
				name: "Lumber forwards threateningly",
				consequences: [
					"Swing at the nearest person with a rusty sword (slashed-2)",
				],
			},
			{
				name: "Squelch and ooze putrid water as it moves",
				consequences: [
					"Horrify onlookers (terrified-3 or nauseated-3)",
					"Infect someone with the cursed miasma (poisoned-1)",
				],
			},
			{
				name: "Stop suddenly and gaze at its sword, as if recalling its old days",
				consequences: [
					"Remember how to parry or feign (give itself parry or feign)",
				],
			},
		],
	},
	ru: {
		name: "ПРОБУЖДЁННЫЙ СТРАЖ",
		category: "Агрессор",
		note: "<p>Бездумный, ковыляющий труп древнего стража сохранился в затопленной болотом могиле и был оживлён мерзким ядом, просочившимся в воду. Облачённый в истлевшие остатки старых доспехов, он бродит по долине Рейвен, стремясь погубить и уничтожить всё живое. Тёмная жижа пропитана злобным духом или силой, которую можно изгнать, а тело можно разбить так, что оно станет бесполезным. Поджечь это существо почти невозможно, если сначала каким-то образом его не высушить.</p>",
		limits: [
			{ name: "Вред", value: 2 },
			{ name: "Изгнание", value: 2 },
			{ name: "Огонь", value: null },
		],
		tags: ["ковыляющий", "мёртвая плоть"],
		threats: [
			{
				name: "Угрожающе надвигаться",
				consequences: [
					"Замахнуться ржавым мечом на ближайшего человека (порез-2)",
				],
			},
			{
				name: "Источать гнилую воду",
				consequences: [
					"Ужаснуть очевидцев (напуган-3 или тошнота-3)",
					"Заразить кого-нибудь проклятыми испарениями (отравлен-1)",
				],
			},
			{
				name: "Внезапно остановиться",
				consequences: [
					"Вспомнить, как парировать или делать финт (получает парирование или финт)",
				],
			},
		],
	},
};

function makeTagEffect(name) {
	return {
		name,
		disabled: false,
		transfer: false,
		flags: {
			[SYSTEM_ID]: {
				type: "tag",
				values: Array(6).fill(null),
				value: "",
				isScratched: false,
				isHindering: false,
				isCrispy: false,
				isPrivate: false,
			},
		},
	};
}

/** Build localized Foundry Actor source data for the bundled starter Challenge. */
export function buildStarterChallenge(locale, folderId) {
	const language = locale === "ru" ? "ru" : "en";
	const source = CHALLENGE[language];
	return {
		name: source.name,
		type: "challenge",
		folder: folderId,
		img: `systems/${SYSTEM_ID}/assets/media/portraits/wakened-sentry.webp`,
		prototypeToken: {
			name: source.name,
			actorLink: true,
			disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
			displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
			texture: {
				src: `systems/${SYSTEM_ID}/assets/media/tokens/litm-demo-token-waken.webp`,
			},
		},
		system: {
			category: source.category,
			rating: 2,
			note: source.note,
			specials: [],
			secrets: [],
			limits: source.limits.map((limit) => ({
				...limit,
				consequence: "",
				isPrivate: false,
				statusIds: [],
			})),
		},
		items: source.threats.map((threat) => ({
			name: threat.name,
			type: "threat",
			system: {
				threat: threat.name,
				consequences: threat.consequences,
				category: "",
			},
		})),
		effects: source.tags.map(makeTagEffect),
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
		flags: {
			[SYSTEM_ID]: {
				starterContent: {
					id: STARTER_CHALLENGE_ID,
					version: STARTER_CHALLENGE_VERSION,
					locale: language,
				},
			},
		},
	};
}

export const STARTER_CHALLENGE_FOLDER_NAMES = {
	en: "Pregen Challenges",
	ru: "Готовые испытания",
};

export {
	STARTER_CHALLENGE_FOLDER_ID,
	STARTER_CHALLENGE_ID,
	STARTER_CHALLENGE_VERSION,
};
