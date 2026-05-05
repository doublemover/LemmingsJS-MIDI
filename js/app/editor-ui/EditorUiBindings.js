import {
  BinaryReader,
  EDITOR_SHORTCUT_SECTIONS,
  EditorAssetCache,
  EditorController,
  EditorHistory,
  EditorKeybindings,
  EditorPreviewCache,
  HISTORY_COALESCE_WINDOW_MS,
  LevelReader,
  LevelWriter,
  MAX_BRUSH_SIZE,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  PALETTE_PREVIEW_BATCH_SIZE,
  PALETTE_SEARCH_DEBOUNCE_MS,
  ShortcutOverlay,
  createClassicLevelData,
  createEditorLevelFromClassic,
  downloadBinaryFile,
  downloadTextFile,
  ensureLevelEntryUids,
  formatRotation,
  formatValue,
  getEntryBounds,
  getRuntimeDependency,
  getStyle,
  getStyleNames,
  listSavedLevels,
  loadSavedLevel,
  normalizeRotation,
  normalizeText,
  parseNumber,
  readArrayBufferFile,
  readTextFile,
  sanitizeFileName,
  saveLevel,
  validateLevel
} from './EditorUiControllerShared.js';
const editorUiBindingsMethods = {
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
      toolList: get('editorToolList'),
      snapToggle: get('editorSnapToggle'),
      gridSize: get('editorGridSize'),
      brushSize: get('editorBrushSize'),
      eraseGadgets: get('editorEraseGadgets'),
      paletteTabs: get('editorPaletteTabs'),
      paletteSearch: get('editorPaletteSearch'),
      paletteViewList: get('editorPaletteViewList'),
      paletteViewGrid: get('editorPaletteViewGrid'),
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
  },

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

  _bindHeaderFields() {
    const headerMap = [
      ['headerTitle', 'TITLE', value => normalizeText(value)],
      ['headerStyle', 'STYLE', value => normalizeText(value)],
      ['headerWidth', 'WIDTH', value => parseNumber(value)],
      ['headerHeight', 'HEIGHT', value => parseNumber(value)],
      ['headerLemmings', 'LEMMINGS', value => parseNumber(value)],
      ['headerSaveRequirement', 'SAVE_REQUIREMENT', value => parseNumber(value)],
      ['headerTimeLimit', 'TIME_LIMIT', value => {
        const text = normalizeText(value);
        if (!text) return 'INFINITE';
        if (text.toUpperCase() === 'INFINITE') return 'INFINITE';
        return parseNumber(text);
      }],
      ['headerSpawnInterval', 'MAX_SPAWN_INTERVAL', value => parseNumber(value)],
      ['headerStartX', 'START_X', value => parseNumber(value)],
      ['headerStartY', 'START_Y', value => parseNumber(value)]
    ];
  
    for (const [key, headerKey, parser] of headerMap) {
      const el = this.el[key];
      if (!el) continue;
      this._addDomListener(el, 'change', async () => {
        if (this._suppressHeader) return;
        const parsed = parser(el.value);
        this.controller.updateHeader(headerKey, parsed);
        this.controller.history.pushSnapshot(this.session?.level, 'Header');
        if (headerKey === 'STYLE') {
          const token = this._nextAsyncToken();
          await this._reloadAssets(token);
          if (!this._isAsyncCurrent(token)) return;
        }
        this._refreshAfterEdit('Header');
      });
    }
  },

  _bindSelectionFields() {
    const bindField = (el, handler) => {
      if (!el) return;
      this._addDomListener(el, 'change', () => {
        if (this._suppressInspector) return;
        handler();
      });
    };
  
    bindField(this.el.selX, () => this._commitSelectionPatch({ X: parseNumber(this.el.selX.value) }));
    bindField(this.el.selY, () => this._commitSelectionPatch({ Y: parseNumber(this.el.selY.value) }));
    bindField(this.el.selWidth, () => this._commitSelectionPatch({ WIDTH: parseNumber(this.el.selWidth.value) }));
    bindField(this.el.selHeight, () => this._commitSelectionPatch({ HEIGHT: parseNumber(this.el.selHeight.value) }));
    bindField(this.el.selRotate, () => {
      const snapped = normalizeRotation(this.el.selRotate.value);
      this._commitSelectionPatch({ ROTATE: snapped });
      this.el.selRotate.value = snapped == null ? '' : String(snapped);
    });
    bindField(this.el.selSkill, () => this._commitSelectionPatch({ SKILL: normalizeText(this.el.selSkill.value) }));
    bindField(this.el.selLemmings, () => this._commitSelectionPatch({ LEMMINGS: parseNumber(this.el.selLemmings.value) }));
    bindField(this.el.selPairing, () => this._commitSelectionPatch({ PAIRING: parseNumber(this.el.selPairing.value) }));
    bindField(this.el.selMidiFlag, () => {
      const enabled = !!this.el.selMidiFlag.checked;
      const flagId = parseNumber(this.el.selMidiFlagId?.value);
      this._commitSelectionPatch({
        MIDI_FLAG: enabled,
        MIDI_FLAG_ID: enabled ? flagId : null
      });
    });
    bindField(this.el.selMidiFlagId, () => this._commitSelectionPatch({ MIDI_FLAG_ID: parseNumber(this.el.selMidiFlagId.value) }));
  
    bindField(this.el.selFlipH, () => this._commitSelectionPatch({ FLIP_HORIZONTAL: !!this.el.selFlipH.checked }));
    bindField(this.el.selFlipV, () => this._commitSelectionPatch({ FLIP_VERTICAL: !!this.el.selFlipV.checked }));
    bindField(this.el.selNoOverwrite, () => this._commitSelectionPatch({ NO_OVERWRITE: !!this.el.selNoOverwrite.checked }));
    bindField(this.el.selErase, () => this._commitSelectionPatch({ ERASE: !!this.el.selErase.checked }));
    bindField(this.el.selOneWay, () => this._commitSelectionPatch({ ONE_WAY: !!this.el.selOneWay.checked }));
  
    if (this.el.deleteSelection) {
      this._addDomListener(this.el.deleteSelection, 'click', () => {
        if (this.controller.deleteSelected()) {
          this._refreshAfterEdit('Delete');
        }
      });
    }
  },

  _bindBrushControls() {
    if (this.el.snapToggle) {
      this._addDomListener(this.el.snapToggle, 'change', () => {
        this.controller.setSnapEnabled(this.el.snapToggle.checked);
        this._updateStatus();
      });
    }
    if (this.el.gridSize) {
      this._addDomListener(this.el.gridSize, 'change', () => {
        const value = parseNumber(this.el.gridSize.value);
        this.controller.gridSize = value && value > 0 ? value : 1;
        this._updateStatus();
      });
    }
    if (this.el.brushSize) {
      this._addDomListener(this.el.brushSize, 'change', () => {
        const value = parseNumber(this.el.brushSize.value);
        const next = Number.isFinite(value) ? Math.min(Math.max(value, 1), MAX_BRUSH_SIZE) : 1;
        this.controller.setBrushSize(next);
        this.el.brushSize.value = String(next);
      });
    }
    if (this.el.eraseGadgets) {
      this._addDomListener(this.el.eraseGadgets, 'change', () => {
        this.controller.setEraseGadgets(this.el.eraseGadgets.checked);
      });
    }
  },

  _bindSavedControls() {
    if (this.el.newLevel) {
      this._addDomListener(this.el.newLevel, 'click', () => {
        this._createNewLevel();
      });
    }
    if (this.el.savedSelect) {
      this._addDomListener(this.el.savedSelect, 'change', () => {
        const id = this.el.savedSelect.value;
        if (!id) return;
        const text = loadSavedLevel(undefined, id);
        if (!text) return;
        this._currentSavedId = id;
        this._loadLevelFromText(text, { resetSaved: false });
      });
    }
  
    if (this.el.savedSave) {
      this._addDomListener(this.el.savedSave, 'click', () => {
        this._saveCurrentLevel();
      });
    }
  
    if (this.el.savedExport) {
      this._addDomListener(this.el.savedExport, 'click', () => {
        this._exportCurrentLevel();
      });
    }
  
    if (this.el.savedExportClassic) {
      this._addDomListener(this.el.savedExportClassic, 'click', () => {
        this._exportCurrentLevelClassic();
      });
    }
  
    if (this.el.savedImport && this.el.savedImportInput) {
      this._addDomListener(this.el.savedImport, 'click', () => {
        this.el.savedImportInput.click();
      });
      this._addDomListener(this.el.savedImportInput, 'change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const token = this._nextAsyncToken();
        try {
          const text = await readTextFile(file);
          if (!text || !this._isAsyncCurrent(token)) return;
          this._currentSavedId = '';
          this._loadLevelFromText(text, { resetSaved: true, token });
        } catch (error) {
          console.error('Failed to read level file.', error);
        } finally {
          event.target.value = '';
        }
      });
    }
  
    if (this.el.savedImportClassic && this.el.savedImportClassicInput) {
      this._addDomListener(this.el.savedImportClassic, 'click', () => {
        this.el.savedImportClassicInput.click();
      });
      this._addDomListener(this.el.savedImportClassicInput, 'change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const token = this._nextAsyncToken();
        try {
          const buffer = await readArrayBufferFile(file);
          if (!buffer || !this._isAsyncCurrent(token)) return;
          const binary = new BinaryReader(buffer, 0, undefined, file.name);
          const levelReader = new LevelReader(binary);
          this._currentSavedId = '';
          this._loadLevelFromClassic(levelReader, { resetSaved: true, token });
        } catch (error) {
          console.error('Failed to read classic level file.', error);
        } finally {
          event.target.value = '';
        }
      });
    }
  },

  _bindLevelSelectors() {
    if (this.el.gameType) {
      this._addDomListener(this.el.gameType, 'change', async (event) => {
        const token = this._nextAsyncToken();
        const value = this.view?.strToNum?.(event.target.value) ?? event.target.value;
        await this.view?.selectGameType?.(value);
        if (!this._isAsyncCurrent(token)) return;
        await this._syncAfterSelection('Load');
      });
    }
    if (this.el.levelGroup) {
      this._addDomListener(this.el.levelGroup, 'change', async (event) => {
        const token = this._nextAsyncToken();
        const value = this.view?.strToNum?.(event.target.value) ?? event.target.value;
        await this.view?.selectLevelGroup?.(value);
        if (!this._isAsyncCurrent(token)) return;
        await this._syncAfterSelection('Load');
      });
    }
    if (this.el.levelIndex) {
      this._addDomListener(this.el.levelIndex, 'change', async (event) => {
        const token = this._nextAsyncToken();
        const value = this.view?.strToNum?.(event.target.value) ?? event.target.value;
        await this.view?.selectLevel?.(value);
        if (!this._isAsyncCurrent(token)) return;
        await this._syncAfterSelection('Load');
      });
    }
  },

  _bindPlaytest() {
    if (!this.el.playtestToggle) return;
    this._addDomListener(this.el.playtestToggle, 'click', () => {
      this._togglePlaytest();
    });
  },

  _bindCanvasInput() {
    const display = this.view?.stage?.getGameDisplay?.();
    if (!display) return;
    this._addDisplayListener(display.onMouseDown, pos => {
      this._clearActiveInputFocus();
      if (this._playtest) return;
      this._pointerDown = true;
      this.controller.handlePointerDown(pos, 0, { shiftKey: this._shiftKey, altKey: this._altKey });
      this._updateCursor(pos);
    });
    this._addDisplayListener(display.onMouseRightDown, pos => {
      this._clearActiveInputFocus();
      if (this._playtest) return;
      this._pointerDown = false;
      this.controller.handlePointerDown(pos, 2, { shiftKey: this._shiftKey, altKey: this._altKey });
      this._updateCursor(pos);
    });
    this._addDisplayListener(display.onMouseUp, () => {
      if (this._playtest) return;
      this._pointerDown = false;
      this.controller.handlePointerUp();
      this._refreshAfterEdit('Pointer');
    });
    this._addDisplayListener(display.onMouseRightUp, () => {
      if (this._playtest) return;
      this.controller.handlePointerUp();
      this._refreshAfterEdit('Pointer');
    });
    this._addDisplayListener(display.onMouseMove, pos => {
      if (this._playtest) return;
      this.controller.handlePointerMove(pos, { isDown: this._pointerDown });
      this._updateCursor(pos);
    });
  },

  _clearActiveInputFocus() {
    const doc = this.document;
    const active = doc?.activeElement;
    if (!active) return;
    const tag = active.tagName;
    if (active.isContentEditable ||
          tag === 'INPUT' ||
          tag === 'SELECT' ||
          tag === 'TEXTAREA') {
      active.blur?.();
      if (doc?.body) {
        doc.body.tabIndex = -1;
        doc.body.focus?.({ preventScroll: true });
      }
    }
  },

  _updateCursor(pos) {
    if (!pos) return;
    this._cursorPos = { x: pos.x, y: pos.y };
    this._updateStatus();
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
export { editorUiBindingsMethods };