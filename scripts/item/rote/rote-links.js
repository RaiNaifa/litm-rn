const FLAG_SCOPE = "litm-rn";
const FLAG_KEY = "roteLink";
const WORLD_LINKS_KEY = "roteLinks";
const pendingRoteCreates = new Set();

const isWorldStory = (owner) =>
	owner?.type === "story" && owner.parent?.documentName !== "Actor";

const findTag = (owner, tagId) => {
	const tags =
		owner.documentName === "Actor"
			? (owner.system.themes ?? []).flatMap((theme) => [
					theme.themeTag,
					...(theme.powerTags ?? []),
				])
			: [owner.system.themeTag, ...(owner.system.powerTags ?? [])];
	return tags.find((tag) => tag?.id === tagId) ?? null;
};

const makeLinkedRoteData = (source, ownerUuid, tagId, name) => {
	const data = source?.toObject() ?? { type: "rote" };
	delete data._id;
	delete data.id;
	delete data._stats;
	delete data.folder;
	delete data.ownership;
	if (data.flags?.core) {
		delete data.flags.core.sourceId;
		if (!Object.keys(data.flags.core).length) delete data.flags.core;
	}
	data.name = name;
	data.flags = {
		...(data.flags ?? {}),
		[FLAG_SCOPE]: {
			...(data.flags?.[FLAG_SCOPE] ?? {}),
			[FLAG_KEY]: { ownerUuid, tagId },
		},
	};
	return data;
};

/** Return Rotes owned by a character or an embedded Story Theme's actor. */
export function getRoteCollection(owner) {
	const actor = owner.documentName === "Actor" ? owner : owner.parent;
	return actor?.documentName === "Actor" ? actor.items : [];
}

/** Get a world Story Theme's reference to a world or compendium Rote. */
export function getWorldRoteLink(owner, tagId) {
	if (!isWorldStory(owner) || !tagId) return null;
	return owner.getFlag(FLAG_SCOPE, WORLD_LINKS_KEY)?.[tagId] ?? null;
}

async function setWorldRoteLink(owner, tagId, uuid) {
	const links = { ...(owner.getFlag(FLAG_SCOPE, WORLD_LINKS_KEY) ?? {}) };
	links[tagId] = uuid;
	await owner.setFlag(FLAG_SCOPE, WORLD_LINKS_KEY, links);
}

async function removeWorldRoteLink(owner, tagId) {
	const links = { ...(owner.getFlag(FLAG_SCOPE, WORLD_LINKS_KEY) ?? {}) };
	if (!links[tagId]) return;
	delete links[tagId];
	if (Object.keys(links).length)
		await owner.setFlag(FLAG_SCOPE, WORLD_LINKS_KEY, links);
	else await owner.unsetFlag(FLAG_SCOPE, WORLD_LINKS_KEY);
}

/** Find the Rote attached to a tag on an actor or Story Theme. */
export function getLinkedRote(owner, tagId) {
	if (!owner?.uuid || !tagId) return null;
	return (
		getRoteCollection(owner).find((item) => {
			if (item.type !== "rote") return false;
			const link = item.getFlag(FLAG_SCOPE, FLAG_KEY);
			return link?.ownerUuid === owner.uuid && link.tagId === tagId;
		}) ?? null
	);
}

/** Return the IDs of tags with active linked Rotes. */
export function getActiveRoteTagIds(owner) {
	const ids = new Set();
	for (const item of getRoteCollection(owner)) {
		if (item.type !== "rote" || item.system.isActive !== true) continue;
		const link = item.getFlag(FLAG_SCOPE, FLAG_KEY);
		if (link?.ownerUuid === owner.uuid && link.tagId) ids.add(link.tagId);
	}
	return ids;
}

/** Confirm removal of a tag that has a linked Rote. */
export async function confirmTagRoteRemoval(owner, tag) {
	if (getWorldRoteLink(owner, tag?.id)) {
		return foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("Litm.rote.unlink-source") },
			content: game.i18n.format("Litm.rote.delete-world-tag-confirm", {
				tag: Handlebars.escapeExpression(tag.name),
			}),
			rejectClose: false,
		});
	}
	const rote = getLinkedRote(owner, tag?.id);
	if (!rote) return true;
	return foundry.applications.api.DialogV2.confirm({
		window: { title: game.i18n.localize("Litm.rote.delete-linked") },
		content: game.i18n.format("Litm.rote.delete-with-tag-confirm", {
			tag: Handlebars.escapeExpression(tag.name),
			rote: Handlebars.escapeExpression(rote.name),
		}),
		rejectClose: false,
	});
}

/** Create a new actor-owned Rote for a tag, optionally copying a source Rote. */
export async function createLinkedRote(owner, tag, source = null) {
	if (!owner?.uuid || !tag?.id) return null;
	if (!findTag(owner, tag.id)) return null;
	if (source && source.type !== "rote") return null;
	const actor = owner.documentName === "Actor" ? owner : owner.parent;
	if (actor?.documentName !== "Actor") return null;
	const linkKey = `${owner.uuid}:${tag.id}`;
	if (pendingRoteCreates.has(linkKey)) return null;
	pendingRoteCreates.add(linkKey);
	try {
		if (getLinkedRote(owner, tag.id) || !findTag(owner, tag.id)) return null;
		const data = makeLinkedRoteData(source, owner.uuid, tag.id, tag.name);
		const [rote] = await actor.createEmbeddedDocuments("Item", [data]);
		if (rote && !findTag(owner, tag.id)) {
			await rote.delete();
			return null;
		}
		return rote ?? null;
	} finally {
		pendingRoteCreates.delete(linkKey);
	}
}

/** Open a tag's Rote, or choose whether to create or attach one. */
export async function configureTagRote(owner, tag, renameTag) {
	if (!tag?.id || !findTag(owner, tag.id)) return null;
	const worldStory = isWorldStory(owner);
	const worldLink = getWorldRoteLink(owner, tag.id);
	if (worldLink) {
		let source = null;
		try {
			source = await fromUuid(worldLink);
		} catch (_error) {
			// A broken UUID can be replaced through the same picker.
		}
		if (source?.type === "rote") {
			source.sheet.render({ force: true });
			return source;
		}
		ui.notifications.warn(game.i18n.localize("Litm.rote.missing-source"));
	}
	const linked = getLinkedRote(owner, tag.id);
	if (linked) {
		linked.sheet.render({ force: true });
		return linked;
	}
	const canUse = (item) =>
		item.type === "rote" &&
		(!worldStory || item.parent?.documentName !== "Actor") &&
		item.testUserPermission(
			game.user,
			CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
		);
	const { DialogV2 } = foundry.applications.api;
	const result = await new Promise((resolve) => {
		let selectedSource = null;
		class AddRoteDialog extends DialogV2 {
			/** Resolve the picker when it is closed without choosing an action. */
			async close(options) {
				resolve(null);
				return super.close(options);
			}
		}
		const dialog = new AddRoteDialog({
			window: {
				title: game.i18n.localize(
					worldStory ? "Litm.rote.link-source" : "Litm.rote.add-window",
				),
			},
			position: { width: 420 },
			classes: ["litm", "litm--rote-add-dialog"],
			content: `<div class="litm--rote-add">
				<p class="litm--rote-add-hint"><strong>${Handlebars.escapeExpression(tag.name)}</strong>: ${game.i18n.localize(worldStory ? "Litm.rote.link-hint" : "Litm.rote.add-hint")}</p>
				<div class="litm--rote-add-dropzone" role="group" aria-label="${game.i18n.localize("Litm.rote.drop-hint")}">
					<span class="litm--rote-add-drop-hint">${game.i18n.localize("Litm.rote.drop-hint")}</span>
				</div>
			</div>`,
			buttons: [
				{
					action: "cancel",
					label: game.i18n.localize("Litm.ui.cancel"),
					callback: () => resolve(null),
				},
				...(!worldStory
					? [
							{
								action: "create",
								label: game.i18n.localize("Litm.rote.create"),
								callback: () => resolve({ action: "create" }),
							},
						]
					: []),
				{
					action: "attach",
					label: game.i18n.localize("Litm.rote.attach"),
					disabled: true,
					callback: () =>
						resolve(
							selectedSource
								? { action: "attach", source: selectedSource }
								: null,
						),
				},
			],
			rejectClose: false,
		});
		dialog.render(true);
		requestAnimationFrame(() => {
			const element = dialog.element;
			const dropZone = element?.querySelector(".litm--rote-add-dropzone");
			const attachButton =
				element?.querySelector('.form-footer button[data-action="attach"]') ??
				element?.querySelector(".form-footer button:last-of-type");
			if (!dropZone || !attachButton) return;
			attachButton.disabled = true;
			dropZone.addEventListener("dragover", (event) => {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				dropZone.classList.add("hover");
			});
			dropZone.addEventListener("dragleave", (event) => {
				if (!dropZone.contains(event.relatedTarget))
					dropZone.classList.remove("hover");
			});
			dropZone.addEventListener("drop", async (event) => {
				event.preventDefault();
				dropZone.classList.remove("hover");
				let source;
				try {
					const data = JSON.parse(event.dataTransfer.getData("text/plain"));
					source = await CONFIG.Item.documentClass.fromDropData(data);
				} catch (_error) {
					// Ignore malformed or unsupported drag data.
				}
				if (!source || !canUse(source)) {
					ui.notifications.warn(game.i18n.localize("Litm.rote.invalid-drop"));
					return;
				}
				selectedSource = source;
				const img = document.createElement("img");
				img.src = source.img || "icons/svg/item-bag.svg";
				img.alt = "";
				const name = document.createElement("span");
				name.textContent = source.name;
				dropZone.replaceChildren(img, name);
				dropZone.classList.add("selected");
				attachButton.disabled = false;
			});
		});
	});
	if (result?.action !== "create" && result?.action !== "attach") return null;
	if (!findTag(owner, tag.id)) return null;
	let source = null;
	let name = tag.name;
	if (result.action === "attach") {
		source = result.source;
		if (!source || !canUse(source)) return null;
		if (source.name !== name) {
			const choice = await DialogV2.wait({
				window: { title: game.i18n.localize("Litm.rote.name-conflict") },
				classes: ["litm", "litm--rote-name-dialog"],
				content: `<p>${game.i18n.localize("Litm.rote.name-conflict-hint")}</p>`,
				buttons: [
					{ action: "cancel", label: game.i18n.localize("Litm.ui.cancel") },
					{
						action: "tag",
						label: game.i18n.localize("Litm.rote.keep-tag-name"),
						disabled: worldStory,
						tooltip: worldStory
							? game.i18n.localize("Litm.rote.keep-tag-disabled")
							: undefined,
						callback: () => "tag",
					},
					{
						action: "rote",
						label: game.i18n.localize("Litm.rote.keep-rote-name"),
						callback: () => "rote",
					},
				],
				render: (_event, dialog) => {
					if (!worldStory) return;
					const button =
						dialog.element?.querySelector(
							'.form-footer button[data-action="tag"]',
						) ?? dialog.element?.querySelectorAll(".form-footer button")[1];
					if (!button) return;
					const wrapper = document.createElement("span");
					wrapper.className = "litm--rote-disabled-choice";
					wrapper.dataset.tooltip = game.i18n.localize(
						"Litm.rote.keep-tag-disabled",
					);
					wrapper.dataset.tooltipDirection = "LEFT";
					button.replaceWith(wrapper);
					wrapper.append(button);
				},
				rejectClose: false,
			});
			if (choice !== "rote" && (choice !== "tag" || worldStory)) return null;
			if (choice === "rote") {
				name = source.name;
				await renameTag(name);
			}
		}
	}
	if (worldStory) {
		await setWorldRoteLink(owner, tag.id, source.uuid);
		if (!findTag(owner, tag.id)) {
			await removeWorldRoteLink(owner, tag.id);
			return null;
		}
		return source;
	}
	const rote = await createLinkedRote(owner, { id: tag.id, name }, source);
	rote?.sheet.render({ force: true });
	return rote;
}

/** Delete an actor-owned Rote or remove a world Story Theme's source link. */
export async function deleteTagRote(owner, tagId) {
	if (getWorldRoteLink(owner, tagId)) {
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: game.i18n.localize("Litm.rote.unlink-source") },
			content: `<p>${game.i18n.localize("Litm.rote.unlink-source-hint")}</p>`,
			rejectClose: false,
		});
		if (!confirmed) return false;
		await removeWorldRoteLink(owner, tagId);
		return true;
	}
	const rote = getLinkedRote(owner, tagId);
	if (!rote) return false;
	const confirmed = await foundry.applications.api.DialogV2.wait({
		window: { title: game.i18n.localize("Litm.rote.delete-linked") },
		classes: ["litm"],
		content: `<p>${game.i18n.format("Litm.rote.delete-linked-confirm", {
			name: Handlebars.escapeExpression(rote.name),
		})}</p>`,
		buttons: [
			{ action: "cancel", label: game.i18n.localize("Litm.ui.cancel") },
			{
				action: "delete",
				label: game.i18n.localize("Litm.rote.delete-linked"),
				callback: () => true,
			},
		],
		rejectClose: false,
	});
	if (confirmed !== true) return false;
	await rote.delete();
	return true;
}

/** Copy a Story Theme's linked Rotes when that theme is copied to an actor. */
export async function cloneStoryRotes(source, copy, tagIds) {
	if (!copy?.parent || !tagIds?.size) return;
	const data = [];
	const copiedTagName = (tagId) =>
		copy.system.themeTag?.id === tagId
			? copy.system.themeTag.name
			: copy.system.powerTags?.find((tag) => tag.id === tagId)?.name;
	if (isWorldStory(source)) {
		const links = source.getFlag(FLAG_SCOPE, WORLD_LINKS_KEY) ?? {};
		for (const [oldTagId, uuid] of Object.entries(links)) {
			const tagId = tagIds.get(oldTagId);
			if (!tagId) continue;
			let rote = null;
			try {
				rote = await fromUuid(uuid);
			} catch (_error) {
				// Report this as an unavailable source below.
			}
			if (rote?.type !== "rote") {
				throw new Error(
					game.i18n.format("Litm.rote.missing-source-detail", { uuid }),
				);
			}
			data.push(
				makeLinkedRoteData(
					rote,
					copy.uuid,
					tagId,
					copiedTagName(tagId) ?? rote.name,
				),
			);
		}
	} else {
		for (const rote of getRoteCollection(source)) {
			if (rote.type !== "rote") continue;
			const link = rote.getFlag(FLAG_SCOPE, FLAG_KEY);
			const copiedTagId =
				link?.ownerUuid === source.uuid ? tagIds.get(link.tagId) : null;
			if (!copiedTagId) continue;
			data.push(
				makeLinkedRoteData(
					rote,
					copy.uuid,
					copiedTagId,
					copiedTagName(copiedTagId) ?? rote.name,
				),
			);
		}
	}
	if (data.length) await copy.parent.createEmbeddedDocuments("Item", data);
}

/** Keep linked Rote names in step with names of the owner's power tags. */
export async function syncLinkedRoteNames(owner) {
	if (isWorldStory(owner)) {
		const links = owner.getFlag(FLAG_SCOPE, WORLD_LINKS_KEY) ?? {};
		const ids = new Set([
			owner.system.themeTag?.id,
			...(owner.system.powerTags ?? []).map((tag) => tag.id),
		]);
		const kept = Object.fromEntries(
			Object.entries(links).filter(([tagId]) => ids.has(tagId)),
		);
		if (Object.keys(kept).length === Object.keys(links).length) return;
		if (Object.keys(kept).length)
			await owner.setFlag(FLAG_SCOPE, WORLD_LINKS_KEY, kept);
		else await owner.unsetFlag(FLAG_SCOPE, WORLD_LINKS_KEY);
		return;
	}
	const tags =
		owner.documentName === "Actor"
			? (owner.system.themes ?? []).flatMap((theme) => [
					theme.themeTag,
					...(theme.powerTags ?? []),
				])
			: [owner.system.themeTag, ...(owner.system.powerTags ?? [])];
	const names = new Map(
		tags.filter((tag) => tag?.id).map((tag) => [tag.id, tag.name]),
	);
	for (const item of [...getRoteCollection(owner)]) {
		if (item.type !== "rote") continue;
		const link = item.getFlag(FLAG_SCOPE, FLAG_KEY);
		if (link?.ownerUuid !== owner.uuid) continue;
		const name = names.get(link.tagId);
		if (name === undefined) {
			await item.delete();
		} else if (name !== item.name) {
			await item.update({ name });
		}
	}
}

/** Delete a Story Theme's linked Rotes when the theme is deleted. */
export async function deleteOwnerRotes(owner) {
	for (const item of [...getRoteCollection(owner)]) {
		if (item.type !== "rote") continue;
		if (item.getFlag(FLAG_SCOPE, FLAG_KEY)?.ownerUuid === owner.uuid)
			await item.delete();
	}
}

/** Rename the linked power tag after a Rote is renamed. */
export async function syncTagNameFromRote(rote) {
	if (rote.type !== "rote") return;
	const link = rote.getFlag(FLAG_SCOPE, FLAG_KEY);
	if (!link?.ownerUuid || !link.tagId) return;
	const owner = await fromUuid(link.ownerUuid);
	if (!owner) return;
	if (owner.documentName === "Actor") {
		const themes = foundry.utils.deepClone(owner.system.themes ?? []);
		for (const theme of themes) {
			const tag =
				theme.themeTag?.id === link.tagId
					? theme.themeTag
					: theme.powerTags?.find((entry) => entry.id === link.tagId);
			if (!tag) continue;
			if (tag.name !== rote.name) {
				tag.name = rote.name;
				await owner.update({ "system.themes": themes }, { validate: false });
			}
			return;
		}
		return;
	}
	if (owner.type !== "story") return;
	if (owner.system.themeTag?.id === link.tagId) {
		if (owner.system.themeTag.name !== rote.name)
			await owner.update({ "system.themeTag.name": rote.name });
		return;
	}
	const tags = foundry.utils.deepClone(owner.system.powerTags ?? []);
	const tag = tags.find((entry) => entry.id === link.tagId);
	if (tag && tag.name !== rote.name) {
		tag.name = rote.name;
		await owner.update({ "system.powerTags": tags });
	}
}
