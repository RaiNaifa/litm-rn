const DRAG_TYPES = [
	"Special",
	"tag",
	"weaknessTag",
	"status",
	"limit",
	"might",
	"LitmReference",
];

const singleLine = (value) =>
	String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();

/** Convert supported system drag data to enrichable editor text. */
export function formatLitmDropText(data) {
	switch (data.type) {
		case "Special":
			return `[@sp ${singleLine(data.special.name)}: ${singleLine(data.special.description)}]`;
		case "tag":
		case "weaknessTag":
			return `[${data.name}]`;
		case "status": {
			const lastIdx = (data.values || []).reduce(
				(last, value, index) =>
					value != null && value !== false ? index : last,
				-1,
			);
			return lastIdx >= 0 ? `[${data.name}-${lastIdx + 1}]` : `[${data.name}]`;
		}
		case "limit":
			return Number(data.value) > 0
				? `[@l ${data.name}:${Number(data.value)}]`
				: `[@l ${data.name}]`;
		case "might": {
			const letters = { origin: "o", adventure: "a", greatness: "g" };
			const level =
				data.level ||
				{
					0: "origin",
					1: "origin",
					2: "adventure",
					3: "adventure",
					4: "adventure",
					5: "greatness",
					6: "greatness",
				}[data.value] ||
				"adventure";
			return `[@${letters[level]} ${data.name}]`;
		}
		case "LitmReference": {
			const target = String(data.target || "quickRules").replaceAll("]", "");
			const name = String(data.name || "").replaceAll("}", "");
			return `@Reference[${target}]${name ? `{${name}}` : ""}`;
		}
		default:
			return null;
	}
}

export class LitmDropPlugin extends foundry.prosemirror.ProseMirrorPlugin {
	static build(schema, options = {}) {
		const plugin = new this(schema);
		return new foundry.prosemirror.Plugin({
			key: new foundry.prosemirror.PluginKey("litmDropPlugin"),
			props: {
				handleDrop: plugin.#onDrop.bind(plugin),
			},
		});
	}

	#onDrop(view, event, slice, moved) {
		const raw = event.dataTransfer?.getData("text/plain");
		if (!raw) return false;
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return false;
		}
		if (!DRAG_TYPES.includes(data?.type)) return false;
		if (moved && data.type !== "LitmReference") return false;
		const text = formatLitmDropText(data);
		if (!text) return false;
		const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
		if (!pos) return false;
		const tr = view.state.tr.insertText(text, pos.pos);
		view.dispatch(tr);
		event.stopPropagation();
		return true;
	}

	#formatDropText(data) {
		switch (data.type) {
			case "Special":
				return `[@sp ${data.special.name}: ${data.special.description}]`;
			case "tag":
			case "weaknessTag":
				return `[${data.name}]`;
			case "status": {
				// Derive value from the values array — find the last (highest) checked cell
				const lastIdx = (data.values || []).reduce(
					(last, v, i) => (v != null && v !== false ? i : last),
					-1,
				);
				const v = lastIdx !== -1 ? lastIdx + 1 : 0;
				return v > 0 ? `[${data.name}-${v}]` : `[${data.name}]`;
			}
			case "limit": {
				const v = data.value != null ? Number(data.value) : 0;
				return v > 0 ? `[@l ${data.name}:${v}]` : `[@l ${data.name}]`;
			}
			case "might": {
				const letters = { origin: "o", adventure: "a", greatness: "g" };
				const level =
					data.level ||
					{
						0: "origin",
						1: "origin",
						2: "adventure",
						3: "adventure",
						4: "adventure",
						5: "greatness",
						6: "greatness",
					}[data.value] ||
					"adventure";
				return `[@${letters[level]} ${data.name}]`;
			}
			case "LitmReference": {
				const target = String(data.target || "quickRules").replaceAll("]", "");
				const name = String(data.name || "").replaceAll("}", "");
				return `@Reference[${target}]${name ? `{${name}}` : ""}`;
			}
			default:
				return null;
		}
	}
}
