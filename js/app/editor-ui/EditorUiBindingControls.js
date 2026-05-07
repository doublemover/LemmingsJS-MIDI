import {
  BinaryReader,
  LevelReader,
  MAX_BRUSH_SIZE,
  loadSavedLevel,
  normalizeRotation,
  normalizeText,
  parseNumber,
  readArrayBufferFile,
  readTextFile
} from './EditorUiControllerShared.js';

const reportImportFailure = (ui, kind, error) => {
  console.error(`${kind} import failed`, error);
  if (typeof ui?._reportImportFailure === 'function') {
    ui._reportImportFailure(kind, error);
  } else {
    ui?._updateStatus?.(`${kind} import failed`);
  }
};

const editorUiBindingControlMethods = {
  _bindHeaderFields() {
    /** @type {Array<[string, string, (value: any) => any]>} */
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

    if (this.el.projectSelect) {
      this._addDomListener(this.el.projectSelect, 'change', () => {
        const id = this.el.projectSelect.value;
        if (!id) return;
        this._loadProjectById?.(id);
      });
    }

    if (this.el.projectLevelSelect) {
      this._addDomListener(this.el.projectLevelSelect, 'change', () => {
        const id = this.el.projectLevelSelect.value;
        if (!id) return;
        this._loadProjectLevel?.(id);
      });
    }

    if (this.el.projectNew) {
      this._addDomListener(this.el.projectNew, 'click', () => {
        this._createProjectFromCurrentLevel?.();
      });
    }

    if (this.el.projectSaveLevel) {
      this._addDomListener(this.el.projectSaveLevel, 'click', () => {
        this._saveCurrentLevelToProject?.();
      });
    }

    if (this.el.projectAddLevel) {
      this._addDomListener(this.el.projectAddLevel, 'click', () => {
        this._saveCurrentLevelToProject?.({ forceNew: true });
      });
    }

    if (this.el.projectDuplicateLevel) {
      this._addDomListener(this.el.projectDuplicateLevel, 'click', () => {
        this._duplicateProjectLevel?.();
      });
    }

    if (this.el.projectRenameLevel) {
      this._addDomListener(this.el.projectRenameLevel, 'click', () => {
        this._renameProjectLevel?.();
      });
    }

    if (this.el.projectDeleteLevel) {
      this._addDomListener(this.el.projectDeleteLevel, 'click', () => {
        this._deleteProjectLevel?.();
      });
    }

    if (this.el.projectExportPack) {
      this._addDomListener(this.el.projectExportPack, 'click', () => {
        this._exportCurrentProjectPack?.();
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
          if (!text) throw new Error('Level file is empty.');
          if (!this._isAsyncCurrent(token)) return;
          this._currentSavedId = '';
          this._loadLevelFromText(text, { resetSaved: true, token });
        } catch (error) {
          reportImportFailure(this, 'NXLV', error);
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
          if (!buffer || buffer.byteLength === 0) throw new Error('Classic level file is empty.');
          if (!this._isAsyncCurrent(token)) return;
          const binary = new BinaryReader(buffer, 0, undefined, file.name);
          const levelReader = new LevelReader(binary);
          this._currentSavedId = '';
          this._loadLevelFromClassic(levelReader, { resetSaved: true, token });
        } catch (error) {
          reportImportFailure(this, 'LVL', error);
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

  _bindValidationControls() {
    if (this.el.solvabilityCheck) {
      this._addDomListener(this.el.solvabilityCheck, 'click', () => {
        this._runSolvabilityCheck?.();
      });
    }
    if (this.el.validationReportExport) {
      this._addDomListener(this.el.validationReportExport, 'click', () => {
        this._exportValidationReport?.();
      });
    }
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
  }
};

export { editorUiBindingControlMethods };
