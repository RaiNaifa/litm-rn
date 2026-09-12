/**
 * Fit an open advancement popover inside its application, opening upward when needed.
 * @param {HTMLElement} picker Popover owner.
 * @param {HTMLElement} menu Popover menu.
 * @param {HTMLElement} root Application content root.
 * @returns {void}
 */
export function fitAdvancementPopover(picker, menu, root) {
	if (!picker || !menu || !root) return;
	const clippingContainer =
		picker.closest(".litm--advancement-content") ??
		root.closest(".window-content") ??
		root;
	const bounds = clippingContainer.getBoundingClientRect();
	const pickerBounds = picker.getBoundingClientRect();
	const spaceBelow = bounds.bottom - pickerBounds.bottom - 8;
	const spaceAbove = pickerBounds.top - bounds.top - 8;
	const desiredHeight = Math.min(menu.scrollHeight, 330);
	const opensUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
	picker.classList.toggle("open-up", opensUp);
	picker.style.setProperty(
		"--advancement-select-space",
		`${Math.max(100, opensUp ? spaceAbove : spaceBelow)}px`,
	);
}

/**
 * Replace native select presentation with the advancement popover while keeping
 * the original select as the form value and change-event source.
 * @param {HTMLElement} root Application content root.
 * @param {AbortSignal} signal Application render lifecycle signal.
 * @returns {void}
 */
export function enhanceAdvancementSelects(root, signal) {
	for (const select of root.querySelectorAll(
		"select:not([data-advancement-select-ready])",
	)) {
		select.dataset.advancementSelectReady = "true";
		select.classList.add("litm--advancement-native-select");
		const picker = document.createElement("div");
		picker.className = "litm--advancement-select";
		select.before(picker);
		picker.append(select);

		const trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = "litm--advancement-select-trigger";
		trigger.innerHTML = '<span></span><i class="fa-solid fa-angle-down"></i>';
		picker.append(trigger);
		const preview = document.createElement("div");
		preview.className = "litm--advancement-select-preview";
		preview.hidden = true;
		picker.append(preview);

		const menu = document.createElement("div");
		menu.className = "litm--advancement-select-menu";
		picker.append(menu);

		for (const option of select.options) {
			const choice = document.createElement("button");
			choice.type = "button";
			choice.className = "litm--advancement-select-option";
			choice.dataset.value = option.value;
			if (option.dataset.enrichedDescription) {
				const heading = document.createElement("strong");
				heading.textContent = option.dataset.name || option.textContent;
				const source = document.createElement("small");
				source.textContent = option.dataset.sourceName || "";
				const description = document.createElement("div");
				description.innerHTML = option.dataset.enrichedDescription;
				choice.classList.add("rich");
				choice.append(heading, source, description);
			} else choice.textContent = option.textContent;
			choice.disabled = option.disabled;
			choice.addEventListener(
				"click",
				(event) => {
					event.preventDefault();
					select.value = option.value;
					select.dispatchEvent(new Event("change", { bubbles: true }));
					picker.classList.remove("open");
				},
				{ signal },
			);
			menu.append(choice);
		}

		const sync = () => {
			const selectedOption = select.selectedOptions[0];
			trigger.querySelector("span").textContent =
				selectedOption?.textContent ?? "";
			if (selectedOption?.dataset.enrichedDescription) {
				preview.innerHTML = selectedOption.dataset.enrichedDescription;
				preview.hidden = false;
			} else {
				preview.replaceChildren();
				preview.hidden = true;
			}
			for (const choice of menu.querySelectorAll(
				".litm--advancement-select-option",
			)) {
				choice.classList.toggle(
					"selected",
					choice.dataset.value === select.value,
				);
			}
		};
		trigger.addEventListener(
			"click",
			(event) => {
				event.preventDefault();
				const opening = !picker.classList.contains("open");
				root
					.querySelectorAll(".litm--advancement-select.open")
					.forEach((other) => other.classList.remove("open"));
				picker.classList.toggle("open", opening);
				if (opening) {
					fitAdvancementPopover(picker, menu, root);
				}
			},
			{ signal },
		);
		select.addEventListener("change", sync, { signal });
		sync();
	}
}
