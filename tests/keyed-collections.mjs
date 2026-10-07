import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const common = process.argv[2];
if (!common)
	throw new Error(
		"Pass the Foundry resources/app/common directory to this test.",
	);
const load = (path) => import(pathToFileURL(`${common}/${path}`).href);
const utils = await load("utils/_module.mjs");
const fields = await load("data/fields.mjs");
globalThis.CONST = await load("constants.mjs");
const { default: DataModel } = await load("abstract/data.mjs");
const { default: TypeDataModel } = await load("abstract/type-data.mjs");
const primitives = await load("primitives/_module.mjs");
for (const [name, methods] of Object.entries(primitives)) {
	for (const [method, value] of Object.entries(methods)) {
		if (!(method in globalThis[name])) globalThis[name][method] = value;
		if (globalThis[name].prototype && !(method in globalThis[name].prototype))
			globalThis[name].prototype[method] = value;
	}
}
globalThis.foundry = {
	data: { fields, validators: await load("data/validators.mjs") },
	abstract: { DataModel, TypeDataModel },
	utils,
};
globalThis.game = {
	i18n: { localize: (value) => value },
	settings: { get: () => null },
};
globalThis.CONFIG = {
	Actor: { dataModels: {} },
	Item: { dataModels: {} },
	compatibility: { mode: 0 },
};
const {
	KeyedCollectionField,
	KeyedDataModelMixin,
	cloneCollection,
	collectionKey,
} = await import("../scripts/data/keyed-collections.js");
const {
	prepareKeyedDocumentUpdate,
	migrateDocumentSource,
	migrateTokenSource,
} = await import("../scripts/system/keyed-documents.js");
const { captureKeyedForm, prepareKeyedFormSubmission, KeyedSheetMixin } =
	await import("../scripts/mixins/keyed-sheet.js");

class Model extends KeyedDataModelMixin(DataModel) {
	static defineSchema() {
		return {
			records: new KeyedCollectionField(
				new fields.SchemaField({
					id: new fields.StringField({ required: true }),
					name: new fields.StringField({ initial: "" }),
					tags: new KeyedCollectionField(
						new fields.SchemaField({
							id: new fields.StringField({ required: true }),
							name: new fields.StringField({ initial: "" }),
						}),
						{ initial: () => [] },
					),
				}),
				{ initial: () => [] },
			),
			strings: new KeyedCollectionField(new fields.StringField(), {
				initial: () => [],
			}),
		};
	}
}
CONFIG.Actor.dataModels.test = Model;
const make = () => {
	const system = new Model({
		records: [
			{
				id: "A",
				name: "Alpha",
				tags: [
					{ id: "a1", name: "one" },
					{ id: "a2", name: "two" },
				],
			},
			{ id: "B", name: "Beta", tags: [] },
		],
		strings: ["first", "second"],
	});
	return { system, _source: { system: system._source } };
};
const apply = (document, updates) => {
	document.system.updateSource(
		Object.fromEntries(
			Object.entries(updates).map(([path, value]) => [path.slice(7), value]),
		),
	);
	document._source.system = document.system._source;
};

const document = make();
assert.equal(Array.isArray(document._source.system.records), false);
assert.deepEqual(
	document.system.records.map((record) => record.name),
	["Alpha", "Beta"],
);
const left = cloneCollection(document.system.toObject().records);
const right = cloneCollection(document.system.toObject().records);
left[0].name = "Changed Alpha";
right[1].name = "Changed Beta";
apply(
	document,
	prepareKeyedDocumentUpdate(document, { "system.records": left }),
);
const delayed = prepareKeyedDocumentUpdate(document, {
	"system.records": right,
});
assert.deepEqual(Object.keys(delayed), [
	`system.records.${collectionKey("B")}.value.name`,
]);
apply(document, delayed);
assert.deepEqual(
	document.system.records.map((record) => record.name),
	["Changed Alpha", "Changed Beta"],
);

const deletion = cloneCollection(document.system.toObject().records).filter(
	(record) => record.id !== "A",
);
const addition = cloneCollection(document.system.toObject().records);
addition.push({ id: "C", name: "Gamma", tags: [] });
apply(
	document,
	prepareKeyedDocumentUpdate(document, { "system.records": addition }),
);
apply(
	document,
	prepareKeyedDocumentUpdate(document, { "system.records": deletion }),
);
assert.deepEqual(
	document.system.records.map((record) => record.id),
	["B", "C"],
);
const tombstoneDocument = make();
const insertedDocument = make();
const inserted = cloneCollection(insertedDocument.system.toObject().records);
inserted.splice(1, 0, { id: "inserted", name: "Middle", tags: [] });
apply(
	insertedDocument,
	prepareKeyedDocumentUpdate(insertedDocument, { "system.records": inserted }),
);
assert.deepEqual(
	insertedDocument.system.records.map((record) => record.id),
	["A", "inserted", "B"],
);
const staleRename = cloneCollection(
	tombstoneDocument.system.toObject().records,
);
staleRename[0].name = "Late rename";
const removeA = tombstoneDocument.system
	.toObject()
	.records.filter((record) => record.id !== "A");
apply(
	tombstoneDocument,
	prepareKeyedDocumentUpdate(tombstoneDocument, { "system.records": removeA }),
);
apply(
	tombstoneDocument,
	prepareKeyedDocumentUpdate(tombstoneDocument, {
		"system.records": staleRename,
	}),
);
assert.deepEqual(
	tombstoneDocument.system.records.map((record) => record.id),
	["B"],
);

const nestedDocument = make();
const nestedLeft = cloneCollection(nestedDocument.system.toObject().records);
const nestedRight = cloneCollection(nestedDocument.system.toObject().records);
nestedLeft[0].tags[0].name = "ONE";
nestedRight[0].tags[1].name = "TWO";
apply(
	nestedDocument,
	prepareKeyedDocumentUpdate(nestedDocument, { "system.records": nestedLeft }),
);
apply(
	nestedDocument,
	prepareKeyedDocumentUpdate(nestedDocument, { "system.records": nestedRight }),
);
assert.deepEqual(
	nestedDocument.system.records[0].tags.map((record) => record.name),
	["ONE", "TWO"],
);

const primitiveCopy = cloneCollection(nestedDocument.system.toObject().strings);
primitiveCopy.splice(0, 1);
primitiveCopy.push("third");
apply(
	nestedDocument,
	prepareKeyedDocumentUpdate(nestedDocument, {
		"system.strings": primitiveCopy,
	}),
);
assert.deepEqual(nestedDocument.system.strings, ["second", "third"]);
assert.throws(
	() => prepareKeyedDocumentUpdate(nestedDocument, { "system.records": [] }),
	/no original snapshot/,
);
const legacy = {
	type: "test",
	system: {
		records: [{ id: "Z", name: "Legacy", tags: [] }],
		strings: ["text"],
	},
};
const migrated = migrateDocumentSource(legacy);
assert.deepEqual(migrateDocumentSource(migrated), migrated);
assert.equal(migrated.system.records[collectionKey("Z")].value.name, "Legacy");
const formDocument = make();
const firstInput = {
	name: "system.records.0.name",
	value: "Alpha",
	type: "text",
};
const secondInput = {
	name: "system.records.1.name",
	value: "Beta",
	type: "text",
};
const form = { querySelectorAll: () => [firstInput, secondInput] };
captureKeyedForm(form, formDocument);
const remote = cloneCollection(formDocument.system.toObject().records);
remote[1].name = "Remote Beta";
apply(
	formDocument,
	prepareKeyedDocumentUpdate(formDocument, { "system.records": remote }),
);
firstInput.value = "Local Alpha";
const submission = prepareKeyedFormSubmission(form, {
	system: { records: { 0: { name: "Local Alpha" }, 1: { name: "Beta" } } },
});
assert.deepEqual(Object.keys(submission), [
	`system.records.${collectionKey("A")}.value.name`,
]);
apply(formDocument, prepareKeyedDocumentUpdate(formDocument, submission));
assert.deepEqual(
	formDocument.system.records.map((record) => record.name),
	["Local Alpha", "Remote Beta"],
);
const expanded = prepareKeyedDocumentUpdate(formDocument, {
	system: { records: { 0: { name: "Expanded" } } },
});
assert.deepEqual(Object.keys(expanded), [
	`system.records.${collectionKey("A")}.value.name`,
]);
const rebuilt = make();
const rebuiltLocal = cloneCollection(rebuilt.system.toObject().records);
const rebuiltRemote = cloneCollection(rebuilt.system.toObject().records);
rebuiltLocal[0].tags = [{ id: "replacement", name: "New tag" }];
rebuiltRemote[0].tags.push({ id: "remote-added", name: "Remote tag" });
apply(
	rebuilt,
	prepareKeyedDocumentUpdate(rebuilt, { "system.records": rebuiltRemote }),
);
apply(
	rebuilt,
	prepareKeyedDocumentUpdate(rebuilt, { "system.records": rebuiltLocal }),
);
assert.deepEqual(
	new Set(rebuilt.system.records[0].tags.map((tag) => tag.id)),
	new Set(["replacement", "remote-added"]),
);

class FormBase {
	constructor(document) {
		this.document = document;
	}
	_processFormData(_event, _form, formData) {
		return utils.expandObject(formData.object);
	}
}
const formModel = make();
let validated = false;
formModel.validate = ({ changes }) => {
	validated = true;
	formModel.system.validate({
		changes: Object.fromEntries(
			Object.entries(changes).map(([path, value]) => [path.slice(7), value]),
		),
		clean: true,
		fallback: false,
	});
};
const formName = {
	name: "system.records.0.name",
	value: "Alpha",
	type: "text",
};
const formUnchanged = {
	name: "system.records.1.name",
	value: "Beta",
	type: "text",
};
const formElement = { querySelectorAll: () => [formName, formUnchanged] };
captureKeyedForm(formElement, formModel);
formName.value = "Before validation";
const actualSubmission = new (KeyedSheetMixin(FormBase))(
	formModel,
)._prepareSubmitData(null, formElement, {
	object: {
		[formName.name]: formName.value,
		[formUnchanged.name]: formUnchanged.value,
	},
});
assert.ok(validated);
assert.deepEqual(Object.keys(actualSubmission), [
	`system.records.${collectionKey("A")}.value.name`,
]);

const scalarInput = {
	name: "system.themeTag.name",
	value: "Unchanged title",
	type: "text",
};
const mixedForm = { querySelectorAll: () => [scalarInput, formName] };
captureKeyedForm(mixedForm, formModel);
formName.value = "Dirty power tag";
const mixedSubmission = prepareKeyedFormSubmission(mixedForm, {
	system: {
		themeTag: { name: "Unchanged title" },
		records: { 0: { name: "Dirty power tag" } },
	},
});
assert.ok(!Object.hasOwn(mixedSubmission, "system.themeTag.name"));
assert.ok(!mixedSubmission.system?.themeTag);
console.log(
	"Keyed collection migration, delayed concurrent writes, nested edits, deletion/create and primitive-array tests passed.",
);

game.litm = { data: await import("../scripts/data/abstract.js") };
foundry.applications = { api: { DialogV2: {} } };
CONFIG.litm = {
	theme_levels: { origin: {} },
	challenge_types: {},
	journey_types: {},
};
const { CharacterData } = await import(
	"../scripts/actor/character/character-data.js"
);
const { ChallengeData } = await import(
	"../scripts/actor/challenge/challenge-data.js"
);
const { FellowshipThemeData } = await import(
	"../scripts/item/fellowship/fellowship-data.js"
);
const { StoryThemeData } = await import(
	"../scripts/item/storytheme/storytheme-data.js"
);
const { JourneyData } = await import(
	"../scripts/actor/journey/journey-data.js"
);
const { ThreatData } = await import("../scripts/item/threat/threat-data.js");
for (const ActualModel of [
	CharacterData,
	ChallengeData,
	FellowshipThemeData,
	StoryThemeData,
	JourneyData,
	ThreatData,
]) {
	const actual = new ActualModel({});
	const publicData = actual.toObject();
	const reloaded = new ActualModel(cloneCollection(publicData));
	const normalized = reloaded.toObject();
	assert.deepEqual(
		new ActualModel(cloneCollection(normalized)).toObject(),
		normalized,
		ActualModel.name,
	);
}
const challenge = new ChallengeData({
	limits: [{ name: "Injured", value: 2 }],
	secrets: [{ name: "Hidden", description: "Secret" }],
});
assert.ok(challenge.limits[0].id);
assert.equal(
	Object.values(challenge._source.limits)[0].id,
	challenge.limits[0].id,
);
assert.equal(
	Object.values(challenge._source.secrets)[0].id,
	challenge.secrets[0].id,
);
console.log(
	"All six real data models load and round-trip; legacy limits and secrets gain stable IDs.",
);

CONFIG.Actor.dataModels.challenge = ChallengeData;
CONFIG.Item.dataModels.story = StoryThemeData;
const importedToken = migrateTokenSource({
	actorId: "base",
	actorLink: false,
	delta: {
		type: "challenge",
		system: { limits: [{ name: "Wound", statusIds: ["one", "two"] }] },
		items: [
			{
				_id: "story",
				type: "story",
				system: { powerTags: [{ id: "p", name: "Power" }] },
			},
		],
	},
});
assert.equal(importedToken.delta.flags["litm-rn"].keyedCollectionsVersion, 1);
assert.ok(!Array.isArray(importedToken.delta.system.limits));
assert.ok(!Array.isArray(importedToken.delta.items[0].system.powerTags));
assert.deepEqual(migrateTokenSource(importedToken), importedToken);
const importedChallenge = new ChallengeData(importedToken.delta.system);
const challengeDocument = {
	system: importedChallenge,
	_source: { system: importedChallenge._source },
};
const reorderedLimits = cloneCollection(importedChallenge.toObject().limits);
reorderedLimits[0].statusIds = [...reorderedLimits[0].statusIds].reverse();
apply(
	challengeDocument,
	prepareKeyedDocumentUpdate(challengeDocument, {
		"system.limits": reorderedLimits,
	}),
);
assert.deepEqual(importedChallenge.limits[0].statusIds, ["two", "one"]);
console.log(
	"Legacy token imports and nested primitive status-link reordering passed.",
);
