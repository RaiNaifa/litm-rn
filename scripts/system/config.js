export class LitmConfig {
	journey_types = ["landscape", "occasion", "undertaking"];

	challenge_types = [
		"aggressor",
		"charge",
		"countdown",
		"influence",
		"mystery",
		"obstacle",
		"pursuer",
		"quarry",
		"sapper",
		"support",
		"watcher",
	];

	/**
	 * You can use this to completely override the default roll behavior.
	 * formula: ({ totalPower }) => `${1 + Math.max(Math.abs(totalPower))}d6${totalPower < 1 ? `kl1` : "kh1"}`,
	 * resolver: (roll) => {
	 *    if (roll.dice[0].results.every(d => d.active && d.result === 1)) return { label: "failure", description: "Litm.ui.roll-failure" };
	 * }
	 * @link scripts/apps/roll-dialog.js
	 * @link scripts/apps/roll.js
	 */
	roll = { formula: null, resolver: null };

	theme_levels = {
		origin: [
			"circumstance",
			"devotion",
			"past",
			"people",
			"personality",
			"skill-or-trade",
			"trait",
			"companion",
			"magic",
			"possessions",
		],
		adventure: [
			"duty",
			"influence",
			"knowledge",
			"prodigious-ability",
			"relic",
			"uncanny-being",
			"companion",
			"magic",
			"possessions",
		],
		greatness: [
			"destiny",
			"dominion",
			"mastery",
			"monstrosity",
			"companion",
			"magic",
			"possessions",
		],
	};

	fulfillment = [
		"journeys-end",
		"reforged",
		"quintessence",
		"magic",
		"words-eternal",
		"lost-truths",
	];

	theme_src = {
		origin: "systems/litm-rn/assets/media/origin",
		adventure: "systems/litm-rn/assets/media/adventure",
		greatness: "systems/litm-rn/assets/media/greatness",
	};

	themeicon_src = {
		origin: "systems/litm-rn/assets/media/icons/origin",
		adventure: "systems/litm-rn/assets/media/icons/adventure",
		greatness: "systems/litm-rn/assets/media/icons/greatness",
		variable: "systems/litm-rn/assets/media/icons/variable",
	};

	regexp = {
		mightStringRe: /\[@([oag]) ([^\]]+)\]/giu,
		mightStringReverseRe: /\{(.+)-([0-6])\}/gu,
		mightSctictStringRe: /\[@m ([^\]]+?)[\s\-:]([0-6])\]/giu,
		explicitTagStringRe:
			/\[@(tag|status|limit|lx|ln|t|s|l)\s+([^\[\]\r\n]+?)(?:[\s:-](\d+))?\]/giu,
		tagStringRe:
			/(?!\b|\s)(?:\[|\{)(?!@|(?:true|false|null|-?\d+(?:\.\d+)?)\s*[\]}])([^"\\,\r\n\[\]{}]+?)(?:[\s:-](\d+))?(?:\}|\])/giu,
		sceneLinkRe: /@ActivateScene\[([^\]]+)\](?:\{([^\}]+)\})?/gi,
	};
}
