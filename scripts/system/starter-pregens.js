const SYSTEM_ID = "litm-rn";
const PREGEN_FOLDER_ID = "pregen-heroes";
const PREGEN_VERSION = 3;

const PREGENS = {
	en: [
		{
			id: "apple-picker",
			name: "The Apple Picker",
			heroTitle: "The Apple Picker",
			shortDescription:
				"A mischievous orphan of Ravenhome who always has an apple and a prank ready.",
			portrait: "apple-picker-a.webp",
			token: "litm-demo-token-apple-picker-a.webp",
			backpackChoices: [
				"Fishing Rod & Bait",
				"Empty Sacks",
				"Paring Knife",
				"Jug of Cider",
				"Sling",
				"Hemp Twine",
				"Wooden Whistle",
			],
			themes: [
				[
					"Personality",
					"Rascal",
					["Prankster", "Finders Keepers"],
					["Sneak", "Light-Footed", "Cunning Wit"],
					"Can't Sit Still",
					"It's never a bad time for a prank!",
					"Feeling that life had pulled a ‘prank’ on them, this orphaned Apple Picker feels it's only just to balance the scales. A troublemaker, they find the small mishaps of others entertaining, but their pranks often catch up to them.",
				],
				[
					"People",
					"Ravenhome Raised",
					["Run of the Place", "Seeking Kinship"],
					["Ravenhome Spirit", "Ears to the Grapevine", "Healthy as a Horse"],
					"Belongs Nowhere",
					"It's the backside of no-where, but it's home.",
					"Abandoned in Ravenhome at a young age, the Apple Picker has known nowhere else their entire life. Eating at different dinner tables over the years has taught them that while Ravenhome is their home, it may not be where they truly belong.",
				],
				[
					"Trait",
					"Scrappy",
					["Roll With A Blow", "Unkempt Charm"],
					["Lunge At Them", "Resourceful", "Dig My Heels In"],
					"Never Listens",
					"You're not the boss of me!",
					"Having had to fend for themselves for as long as they can remember, the Apple Picker has learned to roll with life's punches and make ends meet when they have to.",
				],
				[
					"Possessions",
					"Bushel of Apples",
					["Strong Throw", "Deft Hands"],
					["Highly Nutritious", "Low Hanging Fruit", "Orchardist"],
					"Only Goes So Far",
					"Simple solutions work best.",
					"Does the Apple Picker grab fruit off the trees as they walk by? Do they carry a sack of partly-rotting apples? Or hide them in their pocket? Who knows. They always seem to have more of them and use them in the most creative ways!",
				],
			],
		},
		{
			id: "red-marshal",
			name: "The Red Marshal",
			heroTitle: "The Red Marshal",
			shortDescription:
				"Ravenhome's newly appointed scout, sworn to protect the dale despite their self-doubt.",
			portrait: "red-marshal-a.webp",
			token: "litm-demo-token-red-marshal-a.webp",
			backpackChoices: [
				"A Good Sword",
				"Soothing Salve",
				"Forest-Colored Overcloak",
				"Old Seeing Glass",
				"Rope",
				"Whetstone",
				"Bread, eggs, and cheese",
			],
			themes: [
				[
					"Devotion",
					"Protector of the Dale",
					["The Red Armor", "Stand Watch"],
					["Reassuring Presence", "Know These Lands", "Loyal Horse"],
					"Burden of Responsibility",
					"I am sworn to guard this land and its people.",
					"The Red Marshal is the new village scout, burdened with the responsibility of keeping it safe. While the red armor is a constant reminder of who they are, they struggle with self-doubt.",
				],
				[
					"Trade or Skill",
					"Martial Training",
					["Swordsmanship", "Rally Comrades"],
					["Practiced Footwork", "Iron Focus", "Archery"],
					"Experienced Foes",
					"I have been trained for this...",
					"Apprenticeship at the Red Marshals' Barleytown Barracks consists of basic reading and writing, followed by an intense regimen of arms training and battle tactics. This Marshal was no slouch in their studies.",
				],
				[
					"Trait",
					"Athletic",
					["Brute Strength", "Runner's Stamina"],
					["Climbing", "Hardened Physique", "All-Terrain Trekker"],
					"This Is Gonna Hurt Later",
					"I'll race you!",
					"In addition to their natural build, the Marshal has trained their body to be prepared for any challenge, even if everyone tells them they'd be lucky to ever have to tackle down a bandit. Now they often look to put their physique to the test.",
				],
				[
					"Personality",
					"Aspiring Local Hero",
					["Feign Courage", "A Villager's Shield"],
					[
						"Shortcuts To Greatness",
						"Seize Attention",
						"Village Folk's Blessing",
					],
					"Rash",
					"No-one remembers a coward.",
					"The Red Marshal dreams of renown, seeking adventure whenever the opportunity presents itself. While this has earned them the respect of some villagers, others see them as a brash fool obsessed with glory.",
				],
			],
		},
		{
			id: "wise-one",
			name: "The Wise One",
			heroTitle: "The Wise One",
			shortDescription:
				"A gruff herbalist and the last disciple of Ravenhome's ancient Oldways.",
			portrait: "wise-one-a.webp",
			token: "litm-demo-token-wise-one-a.webp",
			backpackChoices: [
				"Herbal Ingredients",
				"A Small Cauldron",
				"Warm Clothes",
				"Dried Fruit and Jerky",
				"Pocket Wind Chimes",
				"A Few Copper Coins",
				"Salt",
			],
			themes: [
				[
					"Trade or Skill",
					"Apothecary",
					["Medicine Bag", "Quick Diagnosis"],
					[
						"Respected Physician",
						"Wondrous Concoctions",
						"Forage For Ingredients",
					],
					"Poor Bedside Manners",
					"Well, I couldn't just leave them sick!",
					"A traditional herbalist, the Wise One is still the primary physician of Ravenhome, despite living in the woods. They know a remedy for just about any ailment, but their gruff attitude is no balm for the soul.",
				],
				[
					"Magic",
					"Oldways Practitioner",
					["Ancient Lore", "Wards and Protections"],
					["Strength in Spirit", "Banishing Rites", "See The Unseen"],
					"Spoken Invocations",
					"These secrets must never be lost.",
					"The Wise One's true passion is to preserve the Oldways, secret rituals that reveal the unseen and protect against all manner of Creatures of Twilight. But this old teaching is all but gone and the Wise One may be its last disciple.",
				],
				[
					"Circumstance",
					"Outland Recluse",
					["Twilight Encounters", "Tough Cookie"],
					["Hideaway", "Self-Sufficient", "Woodland Companions"],
					"Grumpy",
					"I am better out here.",
					"The Wise One has never really liked people; they abandoned Ravenhome for a rustic cabin in the woods. Living alone with the dangers of the woods has tempered them, but the solitude has done little for their disposition.",
				],
				[
					"Past",
					"Seen a Thing or Two",
					["Storyteller", "Can't Fool Me"],
					["Trusty Walking Stick", "Cautious", "Stubborn Rebuff"],
					"Old Bones",
					"It's hard to surprise an old soul.",
					"The Wise One has too little patience to let wear and tear slow them down. Proud of the wisdom and knowledge their years have let them accumulate, they secretly enjoy the admiration it brings them.",
				],
			],
		},
	],
	ru: [
		{
			id: "apple-picker",
			name: "Собиратель яблок",
			heroTitle: "Собиратель яблок",
			shortDescription:
				"Озорной сирота из Рейвенхоума, у которого всегда найдутся яблоко и новая проделка.",
			portrait: "apple-picker-a.webp",
			token: "litm-demo-token-apple-picker-a.webp",
			backpackChoices: [
				"Удочка и наживка",
				"Пустые мешки",
				"Нож для очистки фруктов",
				"Кувшин сидра",
				"Праща",
				"Пеньковая бечёвка",
				"Деревянный свисток",
			],
			themes: [
				[
					"Личность",
					"Плут",
					["Шутник", "Что нашёл - то моё"],
					["Красться", "Лёгкая поступь", "Хитроумие"],
					"Не может усидеть на месте",
					"Для проделки всегда найдётся время!",
					"Жизнь будто сыграла с осиротевшим Собирателем яблок злую шутку, и теперь он считает справедливым сравнять счёт. Этот проказник веселится над мелкими неудачами окружающих, но собственные проделки часто выходят ему боком.",
				],
				[
					"Народ",
					"Вырос в Рейвенхоуме",
					["Знает здесь каждый угол", "Ищет родственную душу"],
					["Дух Рейвенхоума", "Держит ухо востро", "Здоров как лошадь"],
					"Нигде не свой",
					"Захолустье захолустьем, но это мой дом.",
					"Оказавшись в Рейвенхоуме ещё ребёнком, Собиратель яблок за всю жизнь не знал другого дома. За эти годы он обедал за самыми разными столами и понял: пусть Рейвенхоум и стал ему домом, возможно, его настоящее место где-то ещё.",
				],
				[
					"Черта",
					"Живучий",
					["Держит удар", "Неопрятное обаяние"],
					["Бросается в драку", "Находчивость", "Стоит на своём"],
					"Никогда не слушает",
					"Ты мне не указ!",
					"Сколько себя помнит, Собиратель яблок всегда заботился о себе сам. Он научился принимать удары судьбы и сводить концы с концами, когда приходится.",
				],
				[
					"Имущество",
					"Корзина яблок",
					["Сильный бросок", "Ловкие руки"],
					["Очень питательные", "Низко висят", "Садовод"],
					"Запас не бесконечен",
					"Простые решения лучше всего.",
					"Срывает ли Собиратель яблок плоды с деревьев по дороге? Носит ли мешок подпорченных яблок? Или прячет их по карманам? Кто знает. Кажется, яблок у него всегда больше, чем можно ожидать, и применение им находится самое изобретательное!",
				],
			],
		},
		{
			id: "red-marshal",
			name: "Красный маршал",
			heroTitle: "Красный маршал",
			shortDescription:
				"Новый дозорный Рейвенхоума, поклявшийся защищать долину вопреки сомнениям в себе.",
			portrait: "red-marshal-a.webp",
			token: "litm-demo-token-red-marshal-a.webp",
			backpackChoices: [
				"Добрый меч",
				"Целебная мазь",
				"Плащ лесных цветов",
				"Старая подзорная труба",
				"Верёвка",
				"Точильный камень",
				"Хлеб, яйца и сыр",
			],
			themes: [
				[
					"Преданность",
					"Защитник долины",
					["Красные доспехи", "Стоять на страже"],
					["Обнадёживающее присутствие", "Знает эти земли", "Верный конь"],
					"Бремя ответственности",
					"Я поклялся защищать эту землю и её народ.",
					"Красный маршал - новый дозорный деревни, на которого легла ответственность за её безопасность. Красные доспехи постоянно напоминают о долге и звании, но сомнения в себе не дают маршалу покоя.",
				],
				[
					"Ремесло или навык",
					"Боевая подготовка",
					["Владение мечом", "Воодушевить товарищей"],
					[
						"Отточенная работа ног",
						"Железная сосредоточенность",
						"Стрельба из лука",
					],
					"Опытные противники",
					"Меня к этому готовили...",
					"Ученики казарм Красных маршалов в Барлитауне сначала осваивают чтение и письмо, а затем проходят суровую подготовку во владении оружием и боевой тактике. Этот маршал учился не спустя рукава.",
				],
				[
					"Черта",
					"Атлетичный",
					["Грубая сила", "Выносливость бегуна"],
					["Лазание", "Закалённое тело", "Ходок по любой местности"],
					"Потом всё будет болеть",
					"Догони меня!",
					"Маршал не только крепок от природы, но и готовил тело к любым испытаниям, даже когда все вокруг твердили, что едва ли когда-нибудь придётся валить с ног настоящего разбойника. Теперь маршал не упускает случая проверить себя.",
				],
				[
					"Личность",
					"Будущий местный герой",
					["Изображать храбрость", "Щит односельчан"],
					[
						"Короткий путь к величию",
						"Привлечь внимание",
						"Благословение сельчан",
					],
					"Безрассудство",
					"Трусов никто не помнит.",
					"Красный маршал мечтает о славе и ищет приключений при каждом удобном случае. Одни жители уважают маршала за это, а другие видят лишь дерзкого глупца, одержимого славой.",
				],
			],
		},
		{
			id: "wise-one",
			name: "Мудрая",
			heroTitle: "Мудрая",
			shortDescription:
				"Суровая травница и последняя хранительница древних Путей Рейвенхоума.",
			portrait: "wise-one-a.webp",
			token: "litm-demo-token-wise-one-a.webp",
			backpackChoices: [
				"Лекарственные травы",
				"Маленький котёл",
				"Тёплая одежда",
				"Сушёные фрукты и вяленое мясо",
				"Карманные ветряные колокольчики",
				"Несколько медных монет",
				"Соль",
			],
			themes: [
				[
					"Ремесло или навык",
					"Травница",
					["Сумка лекаря", "Быстрая диагностика"],
					[
						"Уважаемый лекарь",
						"Чудодейственные снадобья",
						"Собирает целебные травы",
					],
					"Скверные манеры у постели больного",
					"Не могла же я бросить их больными!",
					"Мудрая - традиционная травница и главный лекарь Рейвенхоума, хотя и живёт в лесу. Она знает средство почти от любого недуга, однако её суровый нрав душу не исцеляет.",
				],
				[
					"Магия",
					"Хранительница Старых путей",
					["Древние знания", "Обереги и защита"],
					["Сила духа", "Обряды изгнания", "Видеть незримое"],
					"Произнесённые заклинания",
					"Эти тайны не должны быть утрачены.",
					"Истинная страсть Мудрой - хранить Старые пути: тайные обряды, открывающие незримое и защищающие от всевозможных Сумеречных созданий. Но древнее учение почти исчезло, и Мудрая, возможно, осталась его последней последовательницей.",
				],
				[
					"Обстоятельство",
					"Лесная затворница",
					["Встречи в Сумерках", "Крепкий орешек"],
					["Убежище", "Самодостаточность", "Лесные спутники"],
					"Ворчунья",
					"В глуши мне лучше.",
					"Мудрая никогда особенно не любила людей и покинула Рейвенхоум ради простой лесной хижины. Жизнь наедине с опасностями леса закалила её, но одиночество ничуть не смягчило характер.",
				],
				[
					"Прошлое",
					"Повидала всякое",
					["Рассказчица", "Меня не проведёшь"],
					["Надёжная трость", "Осторожность", "Упрямый отпор"],
					"Старые кости",
					"Старую душу трудно удивить.",
					"У Мудрой слишком мало терпения, чтобы позволить возрасту и усталости замедлить её. Она гордится накопленными за долгие годы мудростью и знаниями и втайне наслаждается восхищением окружающих.",
				],
			],
		},
	],
};

function makeTag(name, type) {
	return { id: foundry.utils.randomID(), name, type, isScratched: false };
}

function buildTheme(source) {
	const [themebook, name, active, draft, weakness, motivation, note] = source;
	const id = foundry.utils.randomID();
	return {
		id,
		theme: {
			id,
			type: "theme",
			isEmpty: false,
			creationMode: "custom",
			name,
			themebook,
			themebookCustom: true,
			level: "origin",
			themeTag: makeTag(name, "themeTag"),
			powerTags: active.map((tag) => makeTag(tag, "powerTag")),
			weaknessTags: [makeTag(weakness, "weaknessTag")],
			draftTags: draft.map((tag) => ({
				id: foundry.utils.randomID(),
				name: tag,
				isWeakness: false,
			})),
			specials: [],
			improve: 0,
			abandon: 0,
			milestone: 0,
			motivation,
			note: `<p>${note}</p>`,
		},
	};
}

function makeEffect(tag, ownerId, isHindering = false) {
	return {
		_id: tag.id,
		name: tag.name,
		disabled: false,
		transfer: false,
		flags: {
			[SYSTEM_ID]: {
				type: "tag",
				values: Array(6).fill(null),
				value: "",
				isScratched: false,
				isHindering,
				isCrispy: false,
				isPrivate: false,
				ownerType: "theme",
				ownerId,
			},
		},
	};
}

/** Build localized Foundry Actor source data for the bundled pregenerated heroes. */
export function buildPregenActors(locale, folderId) {
	const language = locale === "ru" ? "ru" : "en";
	return PREGENS[language].map((source) => {
		const builtThemes = source.themes.map(buildTheme);
		const themes = builtThemes.map((entry) => entry.theme);
		const effects = builtThemes.flatMap(({ id, theme }) => [
			makeEffect(theme.themeTag, id),
			...theme.powerTags.map((tag) => makeEffect(tag, id)),
			...theme.weaknessTags.map((tag) => makeEffect(tag, id, true)),
		]);
		return {
			name: source.name,
			type: "character",
			folder: folderId,
			img: `systems/${SYSTEM_ID}/assets/media/portraits/${source.portrait}`,
			prototypeToken: {
				name: source.name,
				actorLink: true,
				disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
				displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
				sight: { enabled: true },
				texture: {
					src: `systems/${SYSTEM_ID}/assets/media/tokens/${source.token}`,
				},
			},
			system: {
				note: "",
				bio: "",
				shortDescription: source.shortDescription,
				heroTitle: source.heroTitle,
				backpackTags: [],
				backpackDraftTags: source.backpackChoices.map((name) => ({
					id: foundry.utils.randomID(),
					name,
				})),
				characterOptions: {
					enableBackpackDrafts: true,
					showDraftTags: true,
				},
				themes,
			},
			effects,
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
			flags: {
				[SYSTEM_ID]: {
					starterContent: {
						id: source.id,
						version: PREGEN_VERSION,
						locale: language,
					},
				},
			},
		};
	});
}

export const PREGEN_FOLDER_NAMES = {
	en: "Pregen Heroes",
	ru: "Готовые герои",
};

export { PREGEN_FOLDER_ID, PREGEN_VERSION };
