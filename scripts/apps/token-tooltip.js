export class TokenTooltip {
  constructor() {
    this._element = null;
    this._currentToken = null;
    this._createDOM();
    this._registerHooks();
  }

  _createDOM() {
    const el = document.createElement("div");
    el.id = "litm-token-tooltip";
    el.style.position = "fixed";
    el.style.pointerEvents = "none";
    el.style.display = "none";
    document.body.appendChild(el);
    this._element = el;
  }

  _registerHooks() {
    Hooks.on("hoverToken", this._onHoverToken.bind(this));
    Hooks.on("canvasPan", () => this._reposition());

    Hooks.on("deleteCombatant", () => this._hide());
    Hooks.on("deleteCombat", () => this._hide());
    Hooks.on("updateCombat", () => this._hide());
    Hooks.on("canvasReady", () => this._hide());
  }

  _onHoverToken(token, isHovering) {
    if (!isHovering) return this._hide();
    if (!this._isTokenInCombat(token)) return;

    const actor = token.actor;
    if (!actor) return;

    const effects = this._collectEffects(actor);
    if (!effects.length) return;

    this._currentToken = token;
    this._element.innerHTML = this._renderMarks(effects);
    this._element.style.display = "";
    this._reposition();
  }

  _isTokenInCombat(token) {
    const tokenId = token.id;
    const sceneId = canvas.scene?.id;
    if (!tokenId || !sceneId) return false;

    for (const combat of game.combats) {
      const combatSceneId = combat.sceneId ?? combat.scene?.id;

      if (combatSceneId && combatSceneId !== sceneId) continue;

      if (combat.combatants.some((c) => c.tokenId === tokenId)) return true;
    }
    return false;
  }

  _collectEffects(actor) {
    return actor.effects
      .filter((e) => {
        const t = e.flags?.["litm-rn"]?.type;
        return t === "tag" || t === "status";
      })
      .map((e) => {
        const f = e.flags["litm-rn"];
        const values = f.values ?? [];
        const value = values.findLast((v) => !!v);
        const type = values.some((v) => !!v) ? "status" : "tag";

        return { name: e.name, type, value };
      })
      .sort((a, b) =>
        a.type !== b.type
          ? a.type === "status"
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
  }

  _renderMarks(effects) {
    return effects
      .map((e) => {
        if (e.type === "status") {
          const label = e.value ? `-${e.value}` : "";
          return `<mark class="litm--hover-status">${e.name}${label}</mark>`;
        }
        return `<mark class="litm--hover-tag">${e.name}</mark>`;
      })
      .join("");
  }

  _reposition() {
    const token = this._currentToken;
    if (!token || this._element.style.display === "none") return;

    const p = token.toGlobal(new PIXI.Point(token.w, 0));

    let left = Math.round(p.x + 20);
    let top = Math.round(p.y);

    this._element.style.left = `${left}px`;
    this._element.style.top = `${top}px`;
  }

  _hide() {
    if (this._element) this._element.style.display = "none";
    this._currentToken = null;
  }
}