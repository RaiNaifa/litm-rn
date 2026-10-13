function nodeKey(node) {
	if (node.nodeType !== 1) return null;
	const data = node.dataset;
	return data.applicationPart
		? `part:${data.applicationPart}`
		: node.id
			? `id:${node.id}`
			: data.backpackTagEditor
				? `backpack:${data.backpackTagEditor}`
				: data.noticedTagEditor
					? `noticed:${data.noticedTagEditor}`
					: data.id
						? `${node.tagName}:${node.classList[0]}:${data.id}`
						: node.getAttribute("name")
							? `field:${node.getAttribute("name")}`
							: null;
}

/** Update changed DOM nodes while keeping live editors and their ancestors connected. */
export function reconcileLiveDOM(current, next, protectedEditors = null) {
	const protectedNodes =
		protectedEditors ??
		new Set(current.querySelectorAll('[contenteditable="true"]'));
	if (!protectedEditors) {
		const focus = current.ownerDocument.activeElement;
		if (
			current.contains(focus) &&
			focus.matches('input, textarea, select, [contenteditable="true"]')
		)
			protectedNodes.add(focus);
	}
	if (protectedNodes.has(current)) {
		if (current.getAttribute?.("contenteditable") === "true") {
			if (next.getAttribute("contenteditable") === "true") return;
			protectedNodes.delete(current);
		} else return;
	}
	if (current.nodeType !== 1) {
		if (current.nodeValue !== next.nodeValue)
			current.nodeValue = next.nodeValue;
		return;
	}
	for (const attribute of [...current.attributes])
		if (!next.hasAttribute(attribute.name))
			current.removeAttribute(attribute.name);
	for (const attribute of next.attributes)
		if (current.getAttribute(attribute.name) !== attribute.value)
			current.setAttribute(attribute.name, attribute.value);
	if (current.matches("input, textarea, select")) {
		current.value = next.value;
		if (current.matches('input[type="checkbox"], input[type="radio"]'))
			current.checked = next.checked;
	}
	const prior = [...current.childNodes];
	const retained = new Set();
	let cursor = current.firstChild;
	for (const desired of [...next.childNodes]) {
		const key = nodeKey(desired);
		let match = prior.find((node) => {
			if (retained.has(node) || node.nodeType !== desired.nodeType)
				return false;
			const previousKey = nodeKey(node);
			if (key || previousKey) return key === previousKey;
			return (
				node.nodeType !== 1 ||
				(node.tagName === desired.tagName &&
					node.classList[0] === desired.classList[0])
			);
		});
		if (!match) match = desired.cloneNode(true);
		retained.add(match);
		if (match !== cursor) {
			if ([...protectedNodes].some((editor) => match.contains?.(editor))) {
				while (cursor && cursor !== match) {
					const sibling = cursor.nextSibling;
					current.insertBefore(cursor, match.nextSibling);
					cursor = sibling;
				}
			} else current.insertBefore(match, cursor);
		}
		reconcileLiveDOM(match, desired, protectedNodes);
		cursor = match.nextSibling;
	}
	for (const node of prior) if (!retained.has(node)) node.remove();
}
