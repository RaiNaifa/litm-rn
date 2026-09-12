// export function registerToggleEdit(form, sheet) {
//   form.querySelectorAll("[data-click='toggle-edit']").forEach((el) => {
//     el.addEventListener("click", () => {
//       sheet.isEditing = !sheet.isEditing;
//       sheet.render({ force: true });
//     });
//   });
// }

/**
 * Synchronize contenteditable data-input controls with their form inputs.
 * @param {HTMLFormElement} form
 * @param {ApplicationV2} sheet
 */
export function registerDataInputSync(form, sheet) {
	form.querySelectorAll("[data-input]").forEach((el) => {
		el.addEventListener("input", (event) => {
			const t = event.currentTarget;
			const targetId = t.dataset.input;
			const value = t.textContent || t.value;
			const input =
				t.parentElement.querySelector(`input#${targetId}`) ??
				form.querySelector(`input#${targetId}`);
			if (input) input.value = value;
		});
		el.addEventListener("blur", () => {
			sheet.submit().catch(console.error);
		});
	});
}
