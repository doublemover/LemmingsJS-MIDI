import {
  EDITOR_SHORTCUT_SECTIONS,
  EditorKeybindings,
  ShortcutOverlay,
  ensureLevelEntryUids
} from './EditorUiControllerShared.js';

const editorUiBindingLifecycleMethods = {
  async init() {
    if (this._disposed) return;
    if (!this.session?.level) {
      this.view?.createBlankEditorLevel({ render: false });
      this.session = this.view?.editorSession || this.session;
      this.controller.session = this.session;
      this._needsDefaultEntrances = true;
    }
    ensureLevelEntryUids(this.session?.level);
    const token = this._nextAsyncToken();
    await this._reloadAssets(token);
    if (!this._isAsyncCurrent(token)) return;
    this.controller.resetHistory('Init');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._refreshHeaderFields();
    this._refreshSelection(null);
    this._refreshValidation();
    this._refreshSavedList();
    this._refreshProjectList();
    this._bindEvents();
    await this._refreshPreview('Init', { preserveView: false, token });
  },

  _bindElements() {
    const get = id => this.document.getElementById(id);
    this.el = {
      gameType: get('editorGameTypeSelect'),
      levelGroup: get('editorLevelGroupSelect'),
      levelIndex: get('editorLevelIndexSelect'),
      savedSelect: get('editorSavedSelect'),
      projectSelect: get('editorProjectSelect'),
      projectLevelSelect: get('editorProjectLevelSelect'),
      projectNew: get('editorProjectNew'),
      projectSaveLevel: get('editorProjectSaveLevel'),
      projectAddLevel: get('editorProjectAddLevel'),
      projectDuplicateLevel: get('editorProjectDuplicateLevel'),
      projectRenameLevel: get('editorProjectRenameLevel'),
      projectDeleteLevel: get('editorProjectDeleteLevel'),
      projectExportPack: get('editorProjectExportPack'),
      projectExportArchive: get('editorProjectExportArchive'),
      projectInstallPack: get('editorProjectInstallPack'),
      projectInstallPackInput: get('editorProjectInstallPackInput'),
      newLevel: get('editorNewLevel'),
      savedSave: get('editorSavedSave'),
      undo: get('editorUndo'),
      redo: get('editorRedo'),
      dirtyStatus: get('editorDirtyStatus'),
      savedExport: get('editorSavedExport'),
      savedExportClassic: get('editorSavedExportClassic'),
      savedImport: get('editorSavedImport'),
      savedImportClassic: get('editorSavedImportClassic'),
      savedImportInput: get('editorSavedImportInput'),
      savedImportClassicInput: get('editorSavedImportClassicInput'),
      playtestToggle: get('editorPlaytestToggle'),
      solvabilityCheck: get('editorSolvabilityCheck'),
      validationReportExport: get('editorValidationReportExport'),
      solvabilityStatus: get('editorSolvabilityStatus'),
      toolList: get('editorToolList'),
      snapToggle: get('editorSnapToggle'),
      gridSize: get('editorGridSize'),
      brushSize: get('editorBrushSize'),
      eraseGadgets: get('editorEraseGadgets'),
      paletteTabs: get('editorPaletteTabs'),
      paletteSearch: get('editorPaletteSearch'),
      paletteViewList: get('editorPaletteViewList'),
      paletteViewGrid: get('editorPaletteViewGrid'),
      paletteRecent: get('editorPaletteRecent'),
      paletteTerrain: get('editorPaletteTerrain'),
      paletteGadgets: get('editorPaletteGadgets'),
      paletteTriggers: get('editorPaletteTriggers'),
      cursorStatus: get('editorCursorStatus'),
      status: get('editorStatus'),
      selectionStatus: get('editorSelectionStatus'),
      headerTitle: get('editorHeaderTitle'),
      headerStyle: get('editorHeaderStyle'),
      headerWidth: get('editorHeaderWidth'),
      headerHeight: get('editorHeaderHeight'),
      headerLemmings: get('editorHeaderLemmings'),
      headerSaveRequirement: get('editorHeaderSaveRequirement'),
      headerTimeLimit: get('editorHeaderTimeLimit'),
      headerSpawnInterval: get('editorHeaderSpawnInterval'),
      headerStartX: get('editorHeaderStartX'),
      headerStartY: get('editorHeaderStartY'),
      selType: get('editorSelType'),
      selName: get('editorSelName'),
      selX: get('editorSelX'),
      selY: get('editorSelY'),
      selWidth: get('editorSelWidth'),
      selHeight: get('editorSelHeight'),
      selRotate: get('editorSelRotate'),
      selSkill: get('editorSelSkill'),
      selLemmings: get('editorSelLemmings'),
      selPairing: get('editorSelPairing'),
      selMidiFlag: get('editorSelMidiFlag'),
      selMidiFlagId: get('editorSelMidiFlagId'),
      selFlipH: get('editorSelFlipH'),
      selFlipV: get('editorSelFlipV'),
      selNoOverwrite: get('editorSelNoOverwrite'),
      selErase: get('editorSelErase'),
      selOneWay: get('editorSelOneWay'),
      selectionActions: get('editorSelectionActions'),
      selectionFlags: get('editorSelectionFlags'),
      selectionBringFront: get('editorSelectionBringFront'),
      selectionMoveForward: get('editorSelectionMoveForward'),
      selectionMoveBackward: get('editorSelectionMoveBackward'),
      selectionSendBack: get('editorSelectionSendBack'),
      selectionAlignLeft: get('editorSelectionAlignLeft'),
      selectionAlignCenter: get('editorSelectionAlignCenter'),
      selectionAlignRight: get('editorSelectionAlignRight'),
      selectionAlignTop: get('editorSelectionAlignTop'),
      selectionAlignMiddle: get('editorSelectionAlignMiddle'),
      selectionAlignBottom: get('editorSelectionAlignBottom'),
      selectionDistributeX: get('editorSelectionDistributeX'),
      selectionDistributeY: get('editorSelectionDistributeY'),
      selectionReplacePiece: get('editorSelectionReplacePiece'),
      selectionReplaceApply: get('editorSelectionReplaceApply'),
      selectionRandomPieces: get('editorSelectionRandomPieces'),
      selectionRandomSeed: get('editorSelectionRandomSeed'),
      selectionRandomSameSize: get('editorSelectionRandomSameSize'),
      selectionRandomApply: get('editorSelectionRandomApply'),
      selectionScaleX: get('editorSelectionScaleX'),
      selectionScaleY: get('editorSelectionScaleY'),
      selectionTransformApply: get('editorSelectionTransformApply'),
      deleteSelection: get('editorDeleteSelection'),
      issuesList: get('editorIssuesList'),
      shortcutOverlay: get('editorShortcutOverlay')
    };
  },

  _bindController() {
    this.controller.setCallbacks({
      onSelectionChange: selection => {
        this._refreshSelection(selection);
        this._drawSelectionOverlay();
      },
      onMarqueeChange: () => {
        this._drawSelectionOverlay();
      },
      onLevelChange: level => {
        this._refreshHeaderFields(level);
        this._refreshValidation();
      },
      onPreviewRequest: label => {
        this._refreshPreview(label);
      }
    });
  },

  _nextAsyncToken() {
    this._asyncToken += 1;
    return this._asyncToken;
  },

  _isAsyncCurrent(token) {
    return !this._disposed && token === this._asyncToken;
  },

  _addDomListener(element, eventName, handler, options) {
    if (!element?.addEventListener || typeof handler !== 'function') return;
    element.addEventListener(eventName, handler, options);
    if (!Array.isArray(this._domListeners)) this._domListeners = [];
    this._domListeners.push({ element, eventName, handler, options });
  },

  _addDisplayListener(eventHandler, handler) {
    if (!eventHandler?.on || typeof handler !== 'function') return;
    eventHandler.on(handler);
    if (!Array.isArray(this._displayListeners)) this._displayListeners = [];
    this._displayListeners.push({ eventHandler, handler });
  },

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._asyncToken += 1;
    this._cancelPalettePreviewHydration();
    if (this._paletteFilterTimer) {
      clearTimeout(this._paletteFilterTimer);
      this._paletteFilterTimer = null;
    }
    while (this._displayListeners.length) {
      const { eventHandler, handler } = this._displayListeners.pop();
      eventHandler?.off?.(handler);
    }
    while (this._domListeners.length) {
      const { element, eventName, handler, options } = this._domListeners.pop();
      element?.removeEventListener?.(eventName, handler, options);
    }
    this.keybindings?.dispose?.();
    this.keybindings = null;
    this.controller?.dispose?.();
    this.previewCache?.dispose?.();
    this.shortcutOverlay = null;
    this._eventsBound = false;
  },

  _bindEvents() {
    if (this._eventsBound || this._disposed) return;
    this._eventsBound = true;
    this._bindToolButtons();
    this._bindPaletteTabs();
    this._bindPaletteSearch();
    this._bindPaletteView();
    this._bindHeaderFields();
    this._bindSelectionFields();
    this._bindSelectionActions();
    this._bindUndoRedo();
    this._bindBrushControls();
    this._bindSavedControls();
    this._bindLevelSelectors();
    this._bindValidationControls();
    this._bindPlaytest();
    this._bindCanvasInput();
    this._bindKeybindings();
    this._bindShortcutOverlay();
    this._bindModifierKeys();
  },

  _bindModifierKeys() {
    const win = this.window;
    if (!win?.addEventListener) return;
    const update = (event) => {
      this._shiftKey = !!event.shiftKey;
      this._altKey = !!event.altKey;
    };
    this._addDomListener(win, 'keydown', update);
    this._addDomListener(win, 'keyup', update);
    this._addDomListener(win, 'blur', () => {
      this._shiftKey = false;
      this._altKey = false;
    });
  },

  _bindKeybindings() {
    if (!this.view) return;
    this.keybindings?.dispose?.();
    this.keybindings = new EditorKeybindings(this.controller, {
      fileProvider: this.view.gameFactory?.fileProvider,
      onBindingsLoaded: () => {
        this._applyTooltips();
        this._refreshShortcutOverlay();
      },
      onToolChange: tool => {
        this._setToolButton(tool);
        this._syncPaletteTabForTool(tool);
        this._updateStatus();
      },
      onCopy: () => {
        if (this.controller.copySelection()) {
          this._updateStatus('Copy');
        }
      },
      onPaste: () => {
        if (this.controller.pasteSelection()) {
          this._refreshAfterEdit('Paste');
        }
      },
      onDuplicate: () => {
        if (this.controller.duplicateSelection()) {
          this._refreshAfterEdit('Duplicate');
        }
      },
      onNudge: (dx, dy, step) => {
        if (this.controller.nudgeSelection(dx, dy, step)) {
          this._refreshAfterEdit('Nudge');
        }
      },
      onSnap: () => {
        if (this.controller.snapSelectionToGrid()) {
          this._refreshAfterEdit('Snap');
        }
      },
      onUndo: () => {
        if (this.controller.undo()) {
          this._refreshAfterEdit('Undo');
        }
      },
      onRedo: () => {
        if (this.controller.redo()) {
          this._refreshAfterEdit('Redo');
        }
      },
      onDelete: () => {
        if (this.controller.deleteSelected()) {
          this._refreshAfterEdit('Delete');
        }
      },
      onBringToFront: () => {
        if (this.controller.bringSelectionToFront()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onSendToBack: () => {
        if (this.controller.sendSelectionToBack()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onMoveForward: () => {
        if (this.controller.moveSelectionForward()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onMoveBackward: () => {
        if (this.controller.moveSelectionBackward()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onPlaytestToggle: () => this._togglePlaytest(),
      onToggleShortcutOverlay: () => this._toggleShortcutOverlay()
    });
    this.keybindings.bind();
    this._applyTooltips();
    this._refreshShortcutOverlay();
  },

  _bindShortcutOverlay() {
    if (this.shortcutOverlay || !this.el.shortcutOverlay) return;
    this.shortcutOverlay = new ShortcutOverlay({
      root: this.el.shortcutOverlay,
      title: 'Editor Shortcuts',
      sections: EDITOR_SHORTCUT_SECTIONS,
      getBindings: action => this.keybindings?.getDisplayBindings(action) || []
    });
  },

  _toggleShortcutOverlay() {
    this.shortcutOverlay?.toggle();
  },

  _refreshShortcutOverlay() {
    if (!this.shortcutOverlay) return;
    this.shortcutOverlay.render();
  }
};

export { editorUiBindingLifecycleMethods };
