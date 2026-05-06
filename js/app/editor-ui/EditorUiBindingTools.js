import {
  PALETTE_SEARCH_DEBOUNCE_MS
} from './EditorUiControllerShared.js';

const editorUiBindingToolMethods = {
  _bindToolButtons() {
    if (!this.el.toolList) return;
    this._addDomListener(this.el.toolList, 'click', (event) => {
      const button = event.target?.closest?.('button');
      const tool = button?.dataset?.tool;
      if (!tool) return;
      this.controller.setTool(tool);
      this._setToolButton(tool);
      this._syncPaletteTabForTool(tool);
      this._updateStatus();
    });
    this._setToolButton(this.controller.tool);
    this._syncPaletteTabForTool(this.controller.tool);
  },

  _bindPaletteTabs() {
    if (!this.el.paletteTabs) return;
    this._addDomListener(this.el.paletteTabs, 'click', (event) => {
      const button = event.target?.closest?.('button');
      const tab = button?.dataset?.tab;
      if (!tab) return;
      this._setPaletteTab(tab);
    });
  },

  _bindPaletteSearch() {
    if (!this.el.paletteSearch) return;
    this._addDomListener(this.el.paletteSearch, 'input', () => {
      if (this._paletteFilterTimer) {
        clearTimeout(this._paletteFilterTimer);
      }
      this._paletteFilterTimer = setTimeout(() => {
        this._paletteFilterTimer = null;
        this._applyPaletteFilter();
      }, PALETTE_SEARCH_DEBOUNCE_MS);
    });
  },

  _setToolButton(tool) {
    const buttons = this.el.toolList?.querySelectorAll?.('button') || [];
    buttons.forEach(button => {
      const isActive = button.dataset?.tool === tool;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  },

  _applyTooltips() {
    if (!this.keybindings || !this.el.toolList) return;
    const map = {
      select: 'editorToolSelect',
      terrain: 'editorToolTerrain',
      gadget: 'editorToolGadget',
      trigger: 'editorToolTrigger',
      'midi-flag': 'editorToolMidiFlag',
      entrance: 'editorToolEntrance',
      exit: 'editorToolExit',
      steel: 'editorToolSteel',
      brush: 'editorToolBrush',
      eraser: 'editorToolEraser'
    };
    const buttons = this.el.toolList.querySelectorAll('button');
    buttons.forEach(button => {
      const tool = button.dataset?.tool;
      const action = map[tool];
      if (!action) return;
      const bindings = this.keybindings.getDisplayBindings(action);
      const base = button.dataset?.tooltip || button.title || '';
      if (!bindings.length) {
        if (base) button.title = base;
        return;
      }
      const suffix = bindings.length === 1
        ? `Shortcut: ${bindings[0]}`
        : `Shortcuts: ${bindings.join(', ')}`;
      button.title = base ? `${base} (${suffix})` : suffix;
    });
  }
};

export { editorUiBindingToolMethods };
