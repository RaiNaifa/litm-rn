// import { localize as t, titleCase } from "../../utils.js";

// export class ThemeData extends foundry.abstract.TypeDataModel {
//   static defineSchema() {
//     const fields = foundry.data.fields;
//     const abstract = game.litm.data;
//     return {
//       isActiveFellowship: new fields.BooleanField({
//         initial: false, // если в чарниках уже есть isActiveFellowship: true, то оставить false, иначе сделать true
//       }),
//       members: new fields.ArrayField(
//         new fields.EmbeddedDataField(CONFIG.Actor.dataModels.character),
//         {
//           initial: () => [], // сюда будут перетаскиваться чарники игроков
//         },
//       ),
//       isActive: new fields.BooleanField({
//         initial: true,
//       }),
//       isBurnt: new fields.BooleanField(),
//       powerTags: new fields.ArrayField(
//         new fields.EmbeddedDataField(abstract.TagData),
//         {
//           initial: () =>
//             Array(2)
//               .fill()
//               .map((_, i) => ({
//                 id: foundry.utils.randomID(),
//                 name: t("Litm.ui.name-power"),
//                 type: "powerTag",
//                 isActive: true,
//                 isBurnt: false,
//               })),
//         },
//       ),
//       weaknessTags: new fields.ArrayField(
//         new fields.EmbeddedDataField(abstract.TagData),
//         {
//           initial: () =>
//             Array(1)
//               .fill()
//               .map(() => ({
//                 id: foundry.utils.randomID(),
//                 name: t("Litm.ui.name-weakness"),
//                 isActive: true,
//                 isBurnt: false,
//                 type: "weaknessTag",
//               })),
//         },
//       ),
//       specials: new fields.ArrayField(
//         new fields.EmbeddedDataField(abstract.SpecialData),
//         {
//           initial: () =>
//             Array(1)
//               .fill()
//               .map(() => ({
//                 id: foundry.utils.randomID(),
//                 name: t("Litm.ui.name-special"),
//                 description: t("Litm.ui.name-special-description"),
//                 isActive: false,
//               })),
//         }
//       ),
//       motivation: new fields.StringField({
//         initial: t("Litm.ui.name-motivation"),
//       }),
//       note: new fields.HTMLField({
//         initial: t("Litm.ui.name-note"),
//       }),
//       backside: new fields.BooleanField({
//         required: true,
//         initial: false,
//       }),
//     };
//   }

//   get themeTag() {
//     const item = {
//       id: this.parent._id,
//       name: titleCase(this.parent.name),
//       isActive: this.isActive,
//       isBurnt: this.isBurnt,
//       type: "themeTag",
//     };
//     return game.litm.data.TagData.fromSource(item);
//   }

//   get activatedPowerTags() {
//     const powerTags = this.powerTags;
//     const themeTag = this.themeTag;
//     return [...powerTags, themeTag].filter((tag) => tag.isActive);
//   }

//   get availablePowerTags() {
//     return this.activatedPowerTags.filter((tag) => !tag.isBurnt);
//   }

//   get powerTagRatio() {
//     return this.availablePowerTags.length / this.activatedPowerTags.length;
//   }

//   get weakness() {
//     return this.weaknessTags;
//   }

//   get allTags() {
//     return [...this.weaknessTags, ...this.powerTags, this.themeTag];
//   }

//   async prepareDerivedData() {
//     // проверять isActiveFellowship, только один в мире может быть true
//     // Make sure only four themes are present
//     // const themes = this.parent.items.filter((item) => item.type === "theme");
//     // if (themes.length > 4) {
//     //   warn(
//     //     `Too many themes found for ${this.parent.name}, attempting to resolve...`,
//     //   );
//     //   const toDelete = themes.slice(4);
//     //   await this.parent.deleteEmbeddedDocuments(
//     //     "Item",
//     //     toDelete.map((item) => item._id),
//     //   );
//     }
// }
