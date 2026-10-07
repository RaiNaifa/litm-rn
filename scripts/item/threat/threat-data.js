import {
	KeyedCollectionField,
	KeyedDataModelMixin,
} from "../../data/keyed-collections.js";
import { localize as t } from "../../utils.js";

export class ThreatData extends KeyedDataModelMixin(
	foundry.abstract.TypeDataModel,
) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			threat: new fields.StringField({
				required: true,
				nullable: false,
				blank: false,
				initial: () => t("Litm.ui.name-threat"),
			}),
			consequences: new KeyedCollectionField(
				new fields.StringField({ required: true, nullable: false }),
				{
					initial: () => [t("Litm.ui.name-consequence")],
				},
			),
			category: new fields.StringField(),
		};
	}
}
