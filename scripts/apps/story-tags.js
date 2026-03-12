import { SheetMixin } from "../mixins/sheet-mixin.js";
import { confirmDelete, dispatch, localize as t } from "../utils.js";

export class StoryTagApp extends SheetMixin(FormApplication) {
	#contextmenu = null;
	#isLocked = true;
	#socketRegistered = false;
	#resizeRegistered = false;
	#renderDebounceTimer = null;

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["litm", "litm--story-tags"],
			template: "systems/litm-rn/templates/apps/story-tags.html",
			title: t("Litm.ui.manage-tags"),
			id: "litm-story-tags",
			left: 120,
			top: 130,
			width: 360,
			height: 500,
			resizable: true,
			submitOnChange: true,
			submitOnClose: true,
			closeOnSubmit: false,
			dragDrop: [{ dropSelector: "form" }],
		});
	}

	async _render(force, options) {
		const form = this.element?.[0]?.querySelector("form");
		const savedScroll = form?.scrollTop ?? 0;

		await super._render(force, options);

		const newForm = this.element?.[0]?.querySelector("form");
		if (newForm) newForm.scrollTop = savedScroll;
	}

	// TODO:
	// сейчас игрокам видно всех актёров в менеджере - добавить возможность скрывать их по кнопке isPrivate
	//
	// совсем TODO 
	// добавить storyThemes (хотя бы в основные теги сцены, без актёров)


	get config() {
		const config = game.settings.get("litm-rn", "storytags");
		if (!config || foundry.utils.isEmpty(config))
			return { actors: [], tags: [], selectedTags: [], helpingTags: [] };
		return { selectedTags: [], ...config };
	}

	get actors() {
		return (
			this.config.actors
				?.map((ref) => {
					const actor = this.#resolveActor(ref);
					if (!actor) return null;
					return {
						ref,
						name: actor.name,
						type: actor.type,
						img: actor.prototypeToken.texture.src || actor.img,
						id: ref,
						formKey: ref.replaceAll('.', '___'),
						isOwner: actor.isOwner,
						tags: actor.effects
							.filter((e) => !!e.flags["litm-rn"]?.type)
							.map((e) => ({
								id: e._id,
								name: e.name,
								values: e.flags["litm-rn"].values,
								isScratched: e.flags["litm-rn"].isScratched,
								isHindering: e.flags["litm-rn"].isHindering || false,
								value: e.flags["litm-rn"].values.findLast((v) => !!v),
								type: e.flags["litm-rn"].values.some((v) => !!v) ? "status" : "tag",
							}))
							.sort((a, b) => a.name.localeCompare(b.name))
							.sort((a, b) =>
								a.type === b.type ? 0 : a.type === "status" ? -1 : 1,
							),
					}
				})
				.filter(Boolean) || []
			);
		}

	get tags() {
		return this.config.tags
			.sort((a, b) => (a.type === b.type ? 0 : a.type === "status" ? -1 : 1));
	}

	get selectedTags() {
		return this.config.selectedTags
			.sort((a, b) => (a.type === b.type ? 0 : a.type === "status" ? -1 : 1));
	}

	async syncSelectedTagsFromActor(actorRef) {
		const actor = this.#resolveActor(actorRef);
		if (!actor) return;

		const config = game.settings.get("litm-rn", "storytags")
			|| { actors: [], tags: [], selectedTags: [] };
		if (!config.selectedTags?.length) return;

		const updatedEffects = new Map();
		for (const e of actor.effects) {
			if (e.flags["litm-rn"]?.type) {
					updatedEffects.set(e._id, this.#effectToTag(e));
			}
		}

		let changed = false;
		const selectedTags = config.selectedTags.map(st => {
			const fresh = updatedEffects.get(st.id);
			if (!fresh) return st;
			if (fresh.name !== st.name
				|| fresh.type !== st.type
				|| fresh.isScratched !== st.isScratched
				|| fresh.isHindering !== st.isHindering
				|| JSON.stringify(fresh.values) !== JSON.stringify(st.values)
			) {
				changed = true;
				return fresh;
			}
			return st;
		});

		if (changed) {
			await game.settings.set("litm-rn", "storytags", { ...config, selectedTags });
		}
	}

	async setActors(actors) {
		const freshConfig = game.settings.get("litm-rn", "storytags")
			|| { actors: [], tags: [], selectedTags: [] };

		const newActorRefs = new Set(actors);
		const removedActorRefs = (freshConfig.actors || [])
			.filter(ref => !newActorRefs.has(ref));

		const removedTagIds = new Set();
		for (const ref of removedActorRefs) {
			const actor = this.#resolveActor(ref);
			if (!actor) continue;
			for (const e of actor.effects) {
				if (e.flags["litm-rn"]?.type) removedTagIds.add(e._id);
			}
		}

		const selectedTags = (freshConfig.selectedTags || [])
			.filter(st => !removedTagIds.has(st.id));

		await game.settings.set("litm-rn", "storytags", {
			...freshConfig, actors, selectedTags,
		});
		return this.#broadcastRender();
	}

	async setTags(tags) {
		const freshConfig = game.settings.get("litm-rn", "storytags")
			|| { tags: [], actors: [], selectedTags: [] };

		const oldStoryIds = new Set((freshConfig.tags || []).map(t => t.id));
		const newTagMap = new Map(tags.map(t => [t.id, t]));

		const selectedTags = (freshConfig.selectedTags || [])
			.filter(t => {
				const wasStoryTag = oldStoryIds.has(t.id);
				return !wasStoryTag || newTagMap.has(t.id);
			})
			.map(t => {
				const updated = newTagMap.get(t.id);
				return updated ? { ...updated } : t;
			});

		await game.settings.set("litm-rn", "storytags", {
			 ...freshConfig, tags, selectedTags
			});
		return this.#broadcastRender();
	}

	async setSelectedTags(selectedTags) {
		await game.settings.set("litm-rn", "storytags", { ...this.config, selectedTags });
		return this.#broadcastRender();
	}

	async getData() {
		return {
			actors: this.actors
				.sort((a, b) => a.name.localeCompare(b.name))
				.sort((_a, b) => (b.type === "challenge" ? 1 : -1)),
			tags: this.tags || [],
			selectedTags: this.selectedTags || [],
			isLocked: this.#isLocked
		};
	}

	#debouncedRender(force = false, delay = 100) {
		clearTimeout(this.#renderDebounceTimer);
		this.#renderDebounceTimer = setTimeout(() => {
			this.render(force);
		}, delay);
	}

	#registerSocketListener() {
		if (this.#socketRegistered) return;
		this.#socketRegistered = true;

		game.socket.on("system.litm-rn", async (data) => {
			if (data.app !== "story-tags") return;
			switch (data.type) {
				case "update":
					await this.#doUpdate(data.component, data.data);
					break;
				case "render":
					this.#debouncedRender();
					Hooks.callAll("litmStoryTagsUpdated");
					break;
			}
		});
	}

	#registerResizeListener() {
		if (this.#resizeRegistered) return;
		this.#resizeRegistered = true;

		window.addEventListener("resize", () => {
			if (this.rendered) this.setPosition({ left: window.innerWidth - 605 });
		});
	}

	#resolveActor(ref) {
		const id = ref.replaceAll('___', '.');
		const worldActor = game.actors.get(id);
		if (worldActor) return worldActor;

		try {
			const doc = fromUuidSync(id);
			if (doc instanceof TokenDocument) return doc.actor;
			if (doc instanceof Actor) return doc;
		} catch (_) { /* no-op */ }
		return null;
	}

	activateListeners(html) {
		super.activateListeners(html);
		html.find("[data-click]").on("click", this.#onClick.bind(this));
		html.find("[data-context]").on("contextmenu", this.#onContext.bind(this));

		html.find("[data-focus")
			.on("focus", (event) => event.currentTarget.select());

		this.#registerSocketListener();
		this.#registerResizeListener();

		// GM only listeners
		if (!game.user.isGM) return;

		this.#contextmenu = foundry.applications.ux.ContextMenu.implementation.create(
			this,
			html[0],
			"[data-context='menu']",
			[
				{
					name: game.i18n.localize("Litm.ui.remove-story-tags"),
					icon: '<i class="fas fa-tags"></i>',
					callback: () => {
						this.setTags([]);
					},
				},
				{
					name: game.i18n.localize("Litm.ui.remove-actors"),
					icon: "<i class='fas fa-user-slash'></i>",
					callback: () => {
						this.setActors([]);
					},
				},
			],
			{
				hookName: "LitmStoryTagsContextMenu",
				jQuery: false,
			},
		);

		this.#contextmenu._setPosition = function (contextMenuHtmlElement, targetHtmlElement) {
			// biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
			contextMenuHtmlElement.classList.toggle("expand-up", (this._expandUp = true));
			targetHtmlElement.appendChild(contextMenuHtmlElement);
			targetHtmlElement.classList.add("context");
		};
	}

	async _updateObject(_event, formData) {
		const data = foundry.utils.expandObject(formData);
		if (foundry.utils.isEmpty(data)) return;

		const { story, ...actors } = data;

		await Promise.all(
			Object.entries(actors).map(([formKey, tags]) => {
				const id = formKey.replaceAll('___', '.');

				return this.#updateTagsOnActor({
					id,
					tags: Object.entries(tags)
						.filter(([_, data]) => data.values !== undefined)
						.map(([tagId, data]) => ({
							_id: tagId,
							name: data.name,
							flags: {
								["litm-rn"]: {
									type: data.values.some((v) => v !== null) ? "status" : "tag",
									values: data.values,
									isScratched: data.isScratched,
									isHindering: data.isHindering || false,
								},
							},
						})),
				})
			}),
		);

		const storyTags = Object.entries(story || {}).map(([tagId, data]) => ({
			id: tagId,
			name: data.name,
			values: data.values,
			isScratched: data.isScratched,
			isHindering: data.isHindering || false,
			type: data.values.some((v) => v !== null) ? "status" : "tag",
			value: data.values.filter((v) => v !== null).at(-1),
		}));

		if (game.user.isGM) await this.setTags(storyTags);
		else this.#broadcastUpdate("tags", storyTags);
	}

	async _onDrop(dragEvent) {
		const dragData = dragEvent.dataTransfer.getData("text/plain");
		const data = JSON.parse(dragData);

		// Handle only Actors to begin with
		if (!["Actor", "tag", "status"].includes(data.type)) return;
		const id = data.uuid?.split(".").pop() || data.id;

		// Add tags and statuses to the story / Actor
		if (data.type === "tag" || data.type === "status") {
			const target = dragEvent.target.closest("[data-id]")?.dataset.id;
			if (target) {
				return this.#addTagToActor({
					id: target,
					tag: data,
				});
			}

			if (game.user.isGM) return this.setTags([...this.tags, data]);
			return this.#broadcastUpdate("tags", [...this.tags, data]);
		}

		let ref;
		if (data.uuid?.includes(".Token.")) {
			const doc = fromUuidSync(data.uuid);
			if (doc?.actorLink) {
				ref = doc.actorId;
			} else {
				ref = data.uuid;
			}
		} else {
			ref = data.uuid?.split(".").pop() || data.id;
		}

		if (this.config.actors.includes(ref)) return;

		await this.setActors([...this.config.actors, ref]);
	}

	// Only GM can drop actors onto the board
	_canDragDrop() {
		return game.user.isGM;
	}

	#onClick(event) {
		const action = event.currentTarget.dataset.click;
		const target = event.currentTarget.dataset.id;

		switch (action) {
			case "add-tag":
				this.#addTag(target);
				break;
			case "open-sheet": {
				const actor = this.#resolveActor(target);
				actor.sheet.render(true);
				break;
			}
			case "select":
				this.#select(event);
				break;
		}
	}

	#onContext(event) {
		const action = event.currentTarget.dataset.context;
		const target = event.currentTarget.dataset.id;

		switch (action) {
			case "remove-all-tags":
				event.preventDefault();
				event.stopPropagation();
				this.#removeAllTags();
				break;
			case "remove-tag":
				event.preventDefault();
				event.stopPropagation();
				this.#removeTag(event.currentTarget);
				break;
			case "remove-actor":
				event.preventDefault();
				event.stopPropagation();
				this.#removeActor(target);
				break;
		}
	}

	async #addTag(target) {
		const tag = {
			name: t("Litm.ui.name-tag"),
			values: Array(6)
				.fill()
				.map(() => null),
			type: "tag",
			isScratched: false,
			id: foundry.utils.randomID(),
		};

		if (target === "story") {
			if (game.user.isGM) return this.setTags([...this.tags, tag]);
			return this.#broadcastUpdate("tags", [...this.tags, tag]);
		}

		return this.#addTagToActor({ id: target, tag });
	}

	async #removeTag(target) {
		const id = target.dataset.id;
		const type = target.dataset.type;

		if (type === "story") {
			if (!(await confirmDelete("Litm.other.tag"))) return;
			if (game.user.isGM)
				return this.setTags(this.config.tags.filter((t) => t.id !== id));
			return this.#broadcastUpdate(
				"tags",
				this.config.tags.filter((t) => t.id !== id),
			);
		}
		return this.#removeTagFromActor({ actorId: type, id });
	}

	async #removeSelected(id) {
		const freshConfig = game.settings.get("litm-rn", "storytags");
		const freshSelected = freshConfig?.selectedTags ?? [];
		const filtered = freshSelected.filter((t) => t.id !== id);

		if (game.user.isGM)
			return this.setSelectedTags(filtered);
		return this.#broadcastUpdate("selectedTags", filtered);
	}

	async #removeAllTags() {
		if (!this.config.tags.length || !(await confirmDelete())) return;
		if (game.user.isGM) return this.setTags([]);
		return this.#broadcastUpdate("tags", []);
	}

	async #addTagToActor({ id, tag }) {
		const actor = this.#resolveActor(id);
		if (!actor)
			return ui.notifications.error("Litm.ui.error-no-actor", {
				localize: true,
			});
		if (!actor.isOwner)
			return ui.notifications.error("Litm.ui.warn-not-owner", {
				localize: true,
			});

		await actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: tag.name,
				flags: { ["litm-rn"]: { type: "tag", values: tag.values, isScratched: false } },
			},
		]);
		return this.#broadcastRender();
	}

	async #updateTagsOnActor({ id, tags }) {
		const actor = this.#resolveActor(id);
		if (!actor) return;
		await actor.updateEmbeddedDocuments("ActiveEffect", tags);

		const config = game.settings.get("litm-rn", "storytags")
			|| { actors: [], tags: [], selectedTags: [] };

		const updatedEffects = new Map();
		for (const e of actor.effects) {
			if (e.flags["litm-rn"]?.type) {
				updatedEffects.set(e._id, this.#effectToTag(e));
			}
		}

		let changed = false;
		const selectedTags = (config.selectedTags || []).map(st => {
			const fresh = updatedEffects.get(st.id);
			if (!fresh) return st;

			if (fresh.name !== st.name
				|| fresh.type !== st.type
				|| fresh.isScratched !== st.isScratched
				|| fresh.isHindering !== st.isHindering
				|| JSON.stringify(fresh.values) !== JSON.stringify(st.values)
			) {
				changed = true;
				return fresh;
			}
			return st;
		});

		if (changed) {
			await game.settings.set("litm-rn", "storytags", {
				...config, selectedTags,
			});
		}
	}

	async #removeTagFromActor({ actorId, id }) {
		const actor = this.#resolveActor(actorId);

		if (!actor)
			return ui.notifications.error("Litm.ui.error-no-actor", {
				localize: true,
			});
		if (!actor.isOwner) return;

		if (!(await confirmDelete("Litm.other.tag"))) return;

		await this.#removeSelected(id);
		await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
		return this.#broadcastRender();
	}

	async #removeActor(id) {
		if (!game.user.isGM) return;
		if (!(await confirmDelete("Actor"))) return;

		await this.setActors(this.config.actors.filter((a) => a !== id));
		this.#broadcastRender();
	}

	async #select(event) {
		// Prevent double clicks from selecting the tag
		if (event.detail > 1) return;

		const t = event.currentTarget;
		const id = t.dataset.id;
		const selected = t.hasAttribute("data-selected");
		if (selected) {
			return this.#removeSelected(id);
		}

		const tag = this.tags.find((t) => t.id === id)
			?? this.actors.flatMap((a) => a.tags).find((t) => t.id === id);
		if (!tag) return;

		const freshConfig = game.settings.get("litm-rn", "storytags");
		const freshSelected = freshConfig?.selectedTags ?? [];

		if (freshSelected.some((t) => t.id === id)) return;

		const currentSelected = [...freshSelected, tag];

		if (game.user.isGM)
			return this.setSelectedTags(currentSelected);
		return this.#broadcastUpdate(
			"selectedTags",
			currentSelected,
		);
	}

	#effectToTag(effect) {
		const flags = effect.flags["litm-rn"];
		return {
			id: effect._id,
			name: effect.name,
			values: flags.values,
			isScratched: flags.isScratched,
			isHindering: flags.isHindering || false,
			value: flags.values.findLast((v) => !!v),
			type: flags.values.some((v) => !!v) ? "status" : "tag",
		};
	}

	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();

		buttons.unshift({
			class: "litm--lock-btn",
			icon: `fas ${this.#isLocked ? "fa-lock" : "fa-lock-open"}`,
			tooltip: t("Litm.ui.lock-story"),
			onclick: (event) => {
				event.preventDefault();

				this.#isLocked = !this.#isLocked;

				const icon = event.currentTarget.querySelector("i");
				icon.classList.toggle("fa-lock");
				icon.classList.toggle("fa-lock-open");

				this.render(false); // with no save in DB
			}
		});

		return buttons;
	}

	/**  Start Socket Methods  */

	#broadcastUpdate(component, data) {
		dispatch({ app: "story-tags", type: "update", component, data });
	}

	#broadcastRender() {
		dispatch({ app: "story-tags", type: "render" });
		this.#debouncedRender();
		Hooks.callAll("litmStoryTagsUpdated");
	}

	async #doUpdate(component, data) {
		if (!game.user.isGM) return;
		if (component === "tags") return this.setTags(data);
		if (component === "selectedTags") return this.setSelectedTags(data);
	}

	/**  End Socket Methods  */
}
