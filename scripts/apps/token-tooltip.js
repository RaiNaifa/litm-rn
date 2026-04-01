export class TokenTooltip {
  constructor() {
    this._container = null;

    this._hoverEl = null;
    this._currentToken = null;

    this._altTooltips = new Map();
    this._altActive = false;

    this._createDOM();
    this._registerHooks();
    this._registerKeyListeners();
  }

  _createDOM() {
    const container = document.createElement("div");
    container.id = "litm-token-tooltip-container";
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "100";
    document.body.appendChild(container);
    this._container = container;

    const el = document.createElement("div");
    el.classList.add("litm-token-tooltip");
    el.style.position = "fixed";
    el.style.pointerEvents = "none";
    el.style.display = "none";
    container.appendChild(el);
    this._hoverEl = el;
  }

  _registerHooks() {
    Hooks.on("hoverToken", this._onHoverToken.bind(this));
    Hooks.on("canvasPan", () => this._repositionAll());

    Hooks.on("deleteCombatant", () => this._hideAll());
    Hooks.on("deleteCombat", () => this._hideAll());
    Hooks.on("updateCombat", () => this._hideAll());
    Hooks.on("canvasReady", () => this._hideAll());

    Hooks.on("updateActiveEffect", () => this._refreshAlt());
    Hooks.on("createActiveEffect", () => this._refreshAlt());
    Hooks.on("deleteActiveEffect", () => this._refreshAlt());
  }

  _registerKeyListeners() {
    document.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (!this._altActive && this._matchesHighlightBinding(e)) {
        this._altActive = true;
        this._showAltTooltips();
      }
    });

    document.addEventListener("keyup", (e) => {
      if (this._altActive && this._matchesHighlightRelease(e)) {
        this._altActive = false;
        this._hideAltTooltips();
      }
    });

    window.addEventListener("blur", () => {
      if (this._altActive) {
        this._altActive = false;
        this._hideAltTooltips();
      }
    });
  }

  _matchesHighlightBinding(event) {
    const bindings = game.keybindings.get("core", "highlight");
    if (!bindings?.length) return false;

    return bindings.some((b) => {
      if (event.code !== b.key) return false;
      const mods = b.modifiers ?? [];
      if (mods.includes("Shift") && !event.shiftKey) return false;
      if (mods.includes("Control") && !event.ctrlKey) return false;
      if (mods.includes("Alt") && !event.altKey) return false;
      return true;
    });
  }

  _matchesHighlightRelease(event) {
    const bindings = game.keybindings.get("core", "highlight");
    if (!bindings?.length) return false;

    return bindings.some((b) => {
      if (event.code === b.key) return true;

      const mods = b.modifiers ?? [];
      const code = event.code;
      if (mods.includes("Alt") && (code === "AltLeft" || code === "AltRight")) return true;
      if (mods.includes("Control") && (code === "ControlLeft" || code === "ControlRight")) return true;
      if (mods.includes("Shift") && (code === "ShiftLeft" || code === "ShiftRight")) return true;

      return false;
    });
  }

  _onHoverToken(token, isHovering) {
    if (this._altActive) return;

    if (!isHovering) return this._hideHover();
    if (!this._isTokenInCombat(token)) return;

    const actor = token.actor;
    if (!actor) return;

    const effects = this._collectEffects(actor);
    if (!effects.length) return;

    this._currentToken = token;
    this._hoverEl.innerHTML = this._renderMarks(effects);
    this._hoverEl.style.display = "";
    this._repositionHover();
  }

  _repositionHover() {
    const token = this._currentToken;
    if (!token || this._hoverEl.style.display === "none") return;

    const { left, top } = this._getTooltipPosition(token);
    this._hoverEl.style.left = `${left}px`;
    this._hoverEl.style.top = `${top}px`;
  }

  _hideHover() {
    if (this._hoverEl) this._hoverEl.style.display = "none";
    this._currentToken = null;
  }

  _showAltTooltips() {
    this._hideHover();
    this._clearAltTooltips();

    const tokens = this._getCombatTokensOnCanvas();

    for (const token of tokens) {
      const actor = token.actor;
      if (!actor) continue;

      const effects = this._collectEffects(actor);
      if (!effects.length) continue;

      const el = document.createElement("div");
      el.classList.add("litm-token-tooltip", "litm-token-tooltip--alt");
      el.style.position = "fixed";
      el.style.pointerEvents = "none";
      el.innerHTML = this._renderMarks(effects);

      this._container.appendChild(el);
      this._altTooltips.set(token.id, { element: el, token });

      const { left, top } = this._getTooltipPosition(token);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
  }

  _hideAltTooltips() {
    this._clearAltTooltips();
  }

  _clearAltTooltips() {
    for (const { element } of this._altTooltips.values()) {
      element.remove();
    }
    this._altTooltips.clear();
  }

  _refreshAlt() {
    if (this._altActive) {
      this._showAltTooltips();
    }
  }

  _getTooltipPosition(token) {
    const p = token.toGlobal(new PIXI.Point(token.w, 0));
    return {
      left: Math.round(p.x + 20),
      top: Math.round(p.y),
    };
  }

  _repositionAll() {
    this._repositionHover();

    for (const { element, token } of this._altTooltips.values()) {
      const { left, top } = this._getTooltipPosition(token);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }
  }

  _hideAll() {
    this._hideHover();
    this._clearAltTooltips();
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

  _getCombatTokensOnCanvas() {
    const sceneId = canvas.scene?.id;
    if (!sceneId) return [];

    const combatTokenIds = new Set();
    for (const combat of game.combats) {
      const combatSceneId = combat.sceneId ?? combat.scene?.id;
      if (combatSceneId && combatSceneId !== sceneId) continue;
      for (const c of combat.combatants) {
        if (c.tokenId) combatTokenIds.add(c.tokenId);
      }
    }

    if (!combatTokenIds.size) return [];

    return canvas.tokens.placeables.filter((t) => combatTokenIds.has(t.id));
  }

  _collectEffects(actor) {
    const isGM = game.user.isGM;
    const isOwner = actor.isOwner;

    return actor.effects
      .filter((e) => {
        const f = e.flags?.["litm-rn"];
        const t = f?.type;
        if (t !== "tag" && t !== "status") return false;

        if (f?.isPrivate && !isGM && !isOwner) return false;

        return true;
      })
      .map((e) => {
        const f = e.flags["litm-rn"];
        const values = f.values ?? [];
        const value = values.findLast((v) => !!v);
        const type = values.some((v) => !!v) ? "status" : "tag";
        const isPrivate = !!f.isPrivate;

        return { name: e.name, type, value, isPrivate };
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
        const privateCls = e.isPrivate ? " litm--hover-private" : "";
        if (e.type === "status") {
          const label = e.value ? `-${e.value}` : "";
          return `<mark class="litm--hover-status${privateCls}">${e.name}${label}</mark>`;
        }
        return `<mark class="litm--hover-tag${privateCls}">${e.name}</mark>`;
      })
      .join("");
  }
}
