import { cloneCollection } from "../data/keyed-collections.js";
import {
	prepareKeyedDocumentUpdate,
	resolveKeyedPath,
} from "../system/keyed-documents.js";

const formSnapshots = new WeakMap();

function inputValue(input) {
	return input.type === "checkbox" ? input.checked : input.value;
}

/** Capture input values and stable record addresses when a sheet is rendered. */
export function captureKeyedForm(form, document) {
	const records = new Map();
	for (const input of form?.querySelectorAll("[name]") ?? []) {
		if (!input.name) continue;
		const resolved = resolveKeyedPath(document, input.name);
		records.set(input.name, {
			path: resolved?.path ?? input.name,
			original: inputValue(input),
			input,
		});
	}
	formSnapshots.set(form, records);
}

function removePath(object, path) {
	if (Object.hasOwn(object, path)) {
		delete object[path];
		return;
	}
	const parts = path.split(".");
	const chain = [];
	let node = object;
	for (const part of parts.slice(0, -1)) {
		if (!node?.[part] || typeof node[part] !== "object") return;
		chain.push([node, part]);
		node = node[part];
	}
	delete node[parts.at(-1)];
	for (const [parent, key] of chain.reverse()) {
		if (!Object.keys(parent[key]).length) delete parent[key];
	}
}

/** Save only changed collection inputs, using their IDs from the original render. */
export function prepareKeyedFormSubmission(form, data) {
	const result = cloneCollection(data);
	const snapshots = formSnapshots.get(form);
	if (!snapshots) return result;
	for (const [name, snapshot] of snapshots) {
		const value = Object.hasOwn(data, name)
			? data[name]
			: foundry.utils.getProperty(data, name);
		removePath(result, name);
		if (
			value !== undefined &&
			inputValue(snapshot.input) !== snapshot.original
		) {
			result[snapshot.path] = value;
		}
	}
	return result;
}

/** Preserve the stable record and rendered baseline of collection form inputs. */
export function KeyedSheetMixin(Base) {
	return class extends Base {
		/** Capture the record addressed by each displayed collection field. */
		_onRender(context, options) {
			super._onRender(context, options);
			captureKeyedForm(this.element, this.document);
		}

		/** Address dirty collection fields before Foundry validates the submission. */
		_prepareSubmitData(event, form, formData, updateData) {
			const data = this._processFormData(event, form, formData);
			if (updateData) {
				foundry.utils.mergeObject(data, updateData, { performDeletions: true });
				foundry.utils.mergeObject(data, updateData, {
					performDeletions: false,
				});
			}
			const submitted = prepareKeyedDocumentUpdate(
				this.document,
				prepareKeyedFormSubmission(form, data),
			);
			this.document.validate({
				changes: submitted,
				clean: true,
				fallback: false,
			});
			return submitted;
		}
	};
}
