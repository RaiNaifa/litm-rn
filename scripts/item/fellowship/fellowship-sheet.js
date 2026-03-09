import { SheetMixin } from "../../mixins/sheet-mixin.js";
import { confirmDelete, localize as t } from "../../utils.js";

export class FellowshipThemeSheet extends SheetMixin(foundry.appv1.sheets.ItemSheet) {
  static defaultOptions = foundry.utils.mergeObject(foundry.appv1.sheets.ItemSheet.defaultOptions, {
    classes: ["litm", "litm--theme"],
    width: 330,
    height: 700,
  });

  #backside = false;

  get system() {
    return this.item.system;
  }

  get template() {
    return "systems/litm-rn/templates/item/fellowship.html";
  }

  getData() {
    const { data, ...rest } = super.getData();

    data.system.weakness = this.system.weakness;
    data.system.levels = this.system.levels;
    data.system.backside = this.#backside,
    data.system.specials = this.system.specials;

    const fallbackSrc = ["origin", "adventure", "greatness"].includes(
      data.system.level,
    )
      ? data.system.level
      : "origin";
    const themesrc =
      CONFIG.litm.theme_src[data.system.level] ||
      `systems/litm-rn/assets/media/${fallbackSrc}`;
    const themeiconsrc =
      CONFIG.litm.themeicon_src[data.system.level] ||
      `systems/litm-rn/assets/media/icons/${fallbackSrc}`;

    return { data, themesrc, themeiconsrc, ...rest };
  }

  activateListeners(html) {
    super.activateListeners(html);
  
    html.find("[data-click]").click(this.#handleClicks.bind(this));
    html.find("[data-context").contextmenu(this.#handleContextmenu.bind(this));
  }

  /** @override - This method needs to be overriden to accommodate readonly input fields */
  _getSubmitData(updateData) {
    if (!this.form)
      throw new Error(
        "The FormApplication subclass has no registered form element",
      );
    const fd = new foundry.applications.ux.FormDataExtended(this.form, {
      editors: this.editors,
      readonly: true,
      disabled: true,
    });
    let data = fd.object;
    if (updateData)
      data = foundry.utils.flattenObject(
        foundry.utils.mergeObject(data, updateData),
      );
    return data;
  }

  #handleClicks(event) {
    const t = event.currentTarget;
    const action = t.dataset.click;
    const id = t.dataset.id;
    switch (action) {
      case "add-power-tag":
        this.#addTag("powerCrispy");
        break;
      case "add-weakness-tag":
        this.#addTag("weaknessTag");
        break;
      case "add-special":
        this.#addSpecial();
        break;
      case "increase":
        this.#increase(id);
        break;
      case "open-levels":
        this.#openlevels(event);
        break;
      case "select-level":
        this.#selectlevel(event);
        break;
      case "toggle-backside":
        this.#toggleBackside();
        break;
    }
  }

  #handleContextmenu(event) {
    const button = event.currentTarget;
    const action = button.dataset.context;
    const id = button.dataset.id;

    switch (action) {
      case "decrease":
        this.#decrease(id);
        break;
      case "remove-tag":
        this.#removeTag(button, "powerCrispy");
        break;
      case "remove-weakness":
        this.#removeTag(button, "weaknessTag");
        break;
      case "remove-special":
        this.#removeSpecial(button);
        break;
    }
  }

  #handleCloseLevels = (event) => {
    const $dropdown = $(".litm--image-dropdown.open");
    const dropdown = $dropdown[0];
    if (!dropdown) return;

    const $icon = $dropdown.find(".selected-image i.fas");
    if (!dropdown.contains(event.target)) {
      $dropdown.removeClass("open");
      $icon.toggleClass("fa-angle-down fa-angle-up");
      $(document).off("click", this.#handleCloseLevels);
    }
  };

  #openlevels(event) {
    const dropdown = event.currentTarget.closest(".litm--image-dropdown");
    const $dropdown = $(dropdown);
    const $icon = $dropdown.find(".selected-image i.fas");

    $dropdown.toggleClass("open");
    $icon.toggleClass("fa-angle-down fa-angle-up");

    const isOpen = $dropdown.hasClass("open");
    if (isOpen) {
      $(document).on("click", this.#handleCloseLevels);
    } else {
      $(document).off("click", this.#handleCloseLevels);
    }
  }

  async #selectlevel(event) {
      const $option = $(event.currentTarget);
      const value = $option.data("value");

      const $dropdown = $option.closest(".litm--image-dropdown");
      const $input = $dropdown.find("input[type=hidden]");

      $input.val(value);

      await this._onSubmit(event);
      await this.render();
  }

  async #addTag(type) {
    const item = {
      name: t("Litm.ui.name-tag"),
      isScratched: false,
      type: type,
      id: foundry.utils.randomID(),
    };

    const tags = this.system[`${type}s`];
    tags.push(item);

    await this.item.update({ [`system.${type}s`]: tags });
  }

  async #removeTag(button, type) {
    if (!(await confirmDelete("Litm.other.tag"))) return;
    const id = button.dataset.id;
    const tags = this.system[`${type}s`].filter((t) => t.id !== id);

    await this.item.update({ [`system.${type}s`]: tags });
  }

  async #addSpecial() {
    const item = {
      name: t("Litm.ui.name-special"),
      description: t("Litm.ui.name-special-description"),
      isActive: true,
      id: foundry.utils.randomID(),
    };

    const specials = this.system.specials;
    specials.push(item);

    await this.item.update({ "system.specials": specials });
  }

  async #removeSpecial(button) {
    if (!(await confirmDelete("Litm.other.special"))) return;

    const id = button.dataset.id;
    const specials = this.system.specials.filter((t) => t.id !== id);

    await this.item.update({ "system.specials": specials });
  }

  async #toggleBackside() {
    this.#backside = !this.#backside;

    this.render(false);
  }

  async #increase(field) {
    const attribute = foundry.utils.getProperty(this.item, field);
    await this.item.update({ [field]: attribute + 1 });
  }

  async #decrease(field) {
    const attribute = foundry.utils.getProperty(this.item, field);
    await this.item.update({ [field]: attribute - 1 });
  }
}
