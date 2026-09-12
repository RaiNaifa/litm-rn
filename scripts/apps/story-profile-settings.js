import { confirmDelete } from "../utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** GM-only world settings application for managing Story profiles. */
export class StoryProfileSettings extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-story-profile-settings",
		classes: ["litm", "litm--story-profile-settings"],
		position: { width: 520, height: "auto" },
		window: { title: "Litm.settings.story-profiles", resizable: true },
	};

	static PARTS = {
		main: {
			template: "systems/litm-rn/templates/apps/story-profile-settings.html",
		},
	};

	/** Create the initial profile from the legacy Story Tags setting when required. */
	static async migrate() {
		if (!game.user.isGM) return;
		const store = game.settings.get("litm-rn", "storyProfiles") || {};
		if (Array.isArray(store.profiles) && store.profiles.length) return;
		const data = foundry.utils.deepClone(
			game.settings.get("litm-rn", "storytags") || {
				tags: [],
				actors: [],
				helpingTags: [],
			},
		);
		await game.settings.set("litm-rn", "storyProfiles", {
			version: 1,
			activeId: "main",
			profiles: [
				{
					id: "main",
					name: game.i18n.localize("Litm.settings.main-story-profile"),
					data,
				},
			],
		});
	}

	/**
	 * Persist an updated active Story Tags configuration into its profile.
	 * @param {object} storyConfig Current value of the legacy-compatible storytags setting.
	 */
	static async syncActiveProfile(storyConfig) {
		if (!game.user.isGM) return;
		const store = game.settings.get("litm-rn", "storyProfiles") || {};
		if (!store.activeId || !Array.isArray(store.profiles)) return;
		const index = store.profiles.findIndex(
			(profile) => profile.id === store.activeId,
		);
		if (index < 0) return;
		const profiles = [...store.profiles];
		profiles[index] = {
			...profiles[index],
			data: foundry.utils.deepClone(storyConfig),
		};
		await game.settings.set("litm-rn", "storyProfiles", { ...store, profiles });
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const store = game.settings.get("litm-rn", "storyProfiles") || {};
		return {
			...context,
			activeId: store.activeId,
			profiles: (store.profiles || []).map((profile) => ({
				...profile,
				active: profile.id === store.activeId,
			})),
		};
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelector('[data-action="create-profile"]')
			?.addEventListener("click", (event) => {
				this.#createProfile(event);
			});
		this.element
			.querySelectorAll('[data-action="activate-profile"]')
			.forEach((button) => {
				button.addEventListener("click", (event) =>
					this.#activateProfile(event),
				);
			});
		this.element
			.querySelectorAll('[data-action="rename-profile"]')
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#renameProfile(event));
			});
		this.element
			.querySelectorAll('[data-action="delete-profile"]')
			.forEach((button) => {
				button.addEventListener("click", (event) => this.#deleteProfile(event));
			});
	}

	async #createProfile(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		const input = this.element.querySelector('[name="newProfileName"]');
		const name = input?.value.trim();
		if (!name) return;
		const store = game.settings.get("litm-rn", "storyProfiles");
		const profile = {
			id: foundry.utils.randomID(),
			name,
			data: { tags: [], actors: [], helpingTags: [] },
		};
		await game.settings.set("litm-rn", "storyProfiles", {
			...store,
			profiles: [...(store.profiles || []), profile],
		});
		this.render();
	}

	async #activateProfile(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		const id = event.currentTarget.dataset.profileId;
		const store = game.settings.get("litm-rn", "storyProfiles");
		const profile = store.profiles?.find((entry) => entry.id === id);
		if (!profile || id === store.activeId) return;
		await StoryProfileSettings.syncActiveProfile(
			game.settings.get("litm-rn", "storytags"),
		);
		const freshStore = game.settings.get("litm-rn", "storyProfiles");
		await game.settings.set("litm-rn", "storyProfiles", {
			...freshStore,
			activeId: id,
		});
		await game.settings.set(
			"litm-rn",
			"storytags",
			foundry.utils.deepClone(profile.data),
		);
		this.render();
	}

	async #renameProfile(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		const id = event.currentTarget.dataset.profileId;
		const input = this.element.querySelector(`[data-profile-name="${id}"]`);
		const name = input?.value.trim();
		if (!name) return;
		const store = game.settings.get("litm-rn", "storyProfiles");
		const profiles = store.profiles.map((profile) =>
			profile.id === id ? { ...profile, name } : profile,
		);
		await game.settings.set("litm-rn", "storyProfiles", { ...store, profiles });
		this.render();
	}

	async #deleteProfile(event) {
		event.preventDefault();
		if (!game.user.isGM) return;
		const id = event.currentTarget.dataset.profileId;
		const store = game.settings.get("litm-rn", "storyProfiles");
		if (id === store.activeId || store.profiles.length <= 1) return;
		if (!(await confirmDelete("Litm.settings.story-profile"))) return;
		await game.settings.set("litm-rn", "storyProfiles", {
			...store,
			profiles: store.profiles.filter((profile) => profile.id !== id),
		});
		this.render();
	}
}
