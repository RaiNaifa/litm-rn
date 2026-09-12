export const DRAG_TYPE = "Special";

/**
 * Convert a Special field to a single line safe for an enricher token.
 * @param {unknown} value Field value.
 * @returns {string} Normalized single-line text.
 */
export function normalizeSpecialText(value) {
	return String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Create drag data payload for a special.
 * @param {object} special — special data object with at least `id`, `name`, `description`
 * @param {string} sourceUuid — UUID of the source document (actor or item)
 * @param {string} containerPath — path within the document's system data (e.g. "system.quintessences")
 * @returns {{ type: string, uuid: string, special: object, source: { uuid: string, containerPath: string, specialId: string } }}
 */
export function makeSpecialDragData(special, sourceUuid, containerPath) {
	const data = {
		type: DRAG_TYPE,
		uuid: `Special.${sourceUuid}.${containerPath}.${special.id}`,
		special: {
			id: special.id,
			name: normalizeSpecialText(special.name),
			description: normalizeSpecialText(special.description),
		},
		source: { uuid: sourceUuid, containerPath, specialId: special.id },
	};
	return data;
}

/**
 * Read drag data from a drop event.
 * Returns null if the drag data is not a Special.
 * @param {DragEvent} event
 * @returns {{ type: string, uuid: string, special: object, source: { uuid: string, containerPath: string, specialId: string } } | null}
 */
export function readSpecialDragData(event) {
	const raw = event.dataTransfer?.getData("text/plain");
	if (!raw) return null;
	let data;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (data?.type !== DRAG_TYPE) return null;
	return data;
}

/**
 * Add a special to a document's container array.
 * Performs a deep clone of the special to avoid reference issues.
 * @param {foundry.abstract.Document} doc — the document to update (actor or item)
 * @param {string} containerPath — path in system data (e.g. "system.quintessences")
 * @param {object} specialData — special data to add (must have `id`, `name`, `description`)
 * @returns {Promise<void>}
 */
export async function addSpecialToContainer(doc, containerPath, specialData) {
	const info = parseIndexedPath(containerPath);
	const newSpecial = { ...specialData, id: foundry.utils.randomID() };

	if (info) {
		const parent = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), info.parentPath) || [],
		);
		const arr = parent[info.index]?.[info.field] || [];
		parent[info.index][info.field] = [...arr, newSpecial];
		try {
			await doc.update({ [info.parentPath]: parent }, { validate: false });
		} catch (err) {
			console.warn("addSpecialToContainer failed", err);
		}
	} else {
		const current = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), containerPath) || [],
		);
		current.push(newSpecial);
		try {
			await doc.update({ [containerPath]: current }, { validate: false });
		} catch (err) {
			console.warn("addSpecialToContainer failed", err);
		}
	}
}

/**
 * Remove a special from a document's container array by id.
 * @param {foundry.abstract.Document} doc — the document to update (actor or item)
 * @param {string} containerPath — path in system data (e.g. "system.quintessences")
 * @param {string} specialId — id of the special to remove
 * @returns {Promise<void>}
 */
export async function removeSpecialFromContainer(
	doc,
	containerPath,
	specialId,
) {
	const info = parseIndexedPath(containerPath);

	if (info) {
		const parent = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), info.parentPath) || [],
		);
		const arr = parent[info.index]?.[info.field] || [];
		parent[info.index][info.field] = arr.filter((s) => s.id !== specialId);
		try {
			await doc.update({ [info.parentPath]: parent }, { validate: false });
		} catch (err) {
			console.warn("removeSpecialFromContainer failed", err);
		}
	} else {
		const current = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), containerPath) || [],
		);
		const filtered = current.filter((s) => s.id !== specialId);
		try {
			await doc.update({ [containerPath]: filtered }, { validate: false });
		} catch (err) {
			console.warn("removeSpecialFromContainer failed", err);
		}
	}
}

/**
 * Helper: check if a path contains a numeric index segment (e.g. "system.themes.0.specials").
 * @param {string} path
 * @returns {{ parentPath: string, index: number, field: string } | null}
 */
function parseIndexedPath(path) {
	const m = path.match(/^(.*)\.(\d+)\.(.*)$/);
	if (m) return { parentPath: m[1], index: Number.parseInt(m[2]), field: m[3] };
	return null;
}

/**
 * Copy a special from one container to another within the same document.
 * Removes from source and adds (with new id) to target.
 * Handles nested indexed paths (e.g. "system.themes.0.specials") by updating the full parent array.
 * @param {foundry.abstract.Document} doc — the document to update
 * @param {string} sourcePath — source container path
 * @param {string} targetPath — target container path
 * @param {string} specialId — id of the special to move
 * @returns {Promise<void>}
 */
export async function moveSpecialWithinDocument(
	doc,
	sourcePath,
	targetPath,
	specialId,
) {
	const src = parseIndexedPath(sourcePath);
	const tgt = parseIndexedPath(targetPath);

	// Same parent array — single update of the full parent
	if (src && tgt && src.parentPath === tgt.parentPath) {
		const parent = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), src.parentPath) || [],
		);
		const srcArr = parent[src.index]?.[src.field] || [];
		const special = srcArr.find((s) => s.id === specialId);
		if (!special) return;
		parent[src.index][src.field] = srcArr.filter((s) => s.id !== specialId);
		const tgtArr = parent[tgt.index]?.[tgt.field] || [];
		parent[tgt.index][tgt.field] = [
			...tgtArr,
			{ ...special, id: foundry.utils.randomID() },
		];
		try {
			await doc.update({ [src.parentPath]: parent }, { validate: false });
		} catch (err) {
			console.warn("moveSpecialWithinDocument failed", err);
		}
		return;
	}

	// Different or mixed paths — handle source and target independently
	let special;
	const updates = {};

	if (src) {
		const parent = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), src.parentPath) || [],
		);
		const srcArr = parent[src.index]?.[src.field] || [];
		special = srcArr.find((s) => s.id === specialId);
		if (!special) return;
		parent[src.index][src.field] = srcArr.filter((s) => s.id !== specialId);
		updates[src.parentPath] = parent;
	} else {
		const current = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), sourcePath) || [],
		);
		special = current.find((s) => s.id === specialId);
		if (!special) return;
		updates[sourcePath] = current.filter((s) => s.id !== specialId);
	}

	if (tgt) {
		const parent = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), tgt.parentPath) || [],
		);
		const toAdd = { ...special, id: foundry.utils.randomID() };
		parent[tgt.index][tgt.field] = [
			...(parent[tgt.index][tgt.field] || []),
			toAdd,
		];
		updates[tgt.parentPath] = parent;
	} else {
		const toAdd = { ...special, id: foundry.utils.randomID() };
		const target = foundry.utils.deepClone(
			foundry.utils.getProperty(doc.toObject(), targetPath) || [],
		);
		target.push(toAdd);
		updates[targetPath] = target;
	}

	try {
		await doc.update(updates, { validate: false });
	} catch (err) {
		console.warn("moveSpecialWithinDocument failed", err);
	}
}
