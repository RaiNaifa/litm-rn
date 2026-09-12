import { info } from "../logger.js";

export class HandlebarsHelpers {
	static register() {
		info("Registering Handlebars Helpers...");

		Handlebars.registerHelper("add", (...args) => {
			args.pop();
			return args.reduce((acc, val) => acc + val, 0);
		});

		Handlebars.registerHelper("loop", (count) =>
			Array.from({ length: count }, (_, i) => i + 1),
		);

		Handlebars.registerHelper("alphaIndex", (index) => {
			let value = Number(index) + 1;
			let label = "";
			while (value > 0) {
				value -= 1;
				label = String.fromCharCode(65 + (value % 26)) + label;
				value = Math.floor(value / 26);
			}
			return label;
		});

		Handlebars.registerHelper("includes", (array, value, path) =>
			Array.isArray(array)
				? (path && array.some((i) => i[path] === value)) ||
					array.includes(value)
				: false,
		);

		Handlebars.registerHelper(
			"progress-buttons",
			function (current, max, block) {
				let acc = "";
				for (let i = 0; i < max; ++i) {
					block.data.index = i;
					block.data.checked = i < current;
					acc += block.fn(this);
				}
				return acc;
			},
		);

		Handlebars.registerHelper(
			"titlecase",
			(string) => string.charAt(0).toUpperCase() + string.slice(1),
		);

		Handlebars.registerHelper("tagScratchedString", (tag, readonly) =>
			tag.isScratched
				? "Litm.tags.isScratched"
				: readonly
					? "Litm.tags.isInactive"
					: "Litm.tags.activate",
		);
	}
}

export class HandlebarsPartials {
	static partials = [
		"systems/litm-rn/templates/apps/roll-dialog.html",
		"systems/litm-rn/templates/chat/message.html",
		"systems/litm-rn/templates/chat/message-tooltip.html",
		"systems/litm-rn/templates/chat/moderation.html",
		"systems/litm-rn/templates/partials/crispy-power-tag.html",
		"systems/litm-rn/templates/partials/new-tag.html",
		"systems/litm-rn/templates/partials/tag.html",
		"systems/litm-rn/templates/partials/special.html",
		"systems/litm-rn/templates/partials/relationship.html",
		"systems/litm-rn/templates/apps/parts/reference-image-setting.html",
		"systems/litm-rn/templates/apps/parts/reference-color-setting.html",
	];

	static register() {
		info("Registering Handlebars Partials...");
		foundry.applications.handlebars.loadTemplates(HandlebarsPartials.partials);
	}
}
