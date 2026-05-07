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
  checkEditorSolvabilityAdvisory,
  validateLevel
} from './EditorUiControllerShared.js';
import {
  buildClassicSubsetIssues,
  getErrorMessage,
  isDestructiveQuickFix
} from './editorClassicSubsetContract.js';

const getMultiSelectionCapabilities = (entries = []) => {
  const types = new Set(entries.map(entry => entry?.type).filter(Boolean));
  const type = types.size === 1 ? Array.from(types)[0] : null;
  const isTerrain = type === 'terrain';
  const isGadget = type === 'gadget';
  const isSteel = type === 'steel';
  return {
    type,
    x: !!type,
    y: !!type,
    width: isSteel,
    height: isSteel,
    rotate: isTerrain || isGadget,
    skill: isGadget,
    lemmings: isGadget,
    pairing: isGadget,
    midiFlag: isGadget,
    midiFlagId: isGadget,
    flipH: isTerrain || isGadget,
    flipV: isTerrain || isGadget,
    noOverwrite: isTerrain,
    erase: isTerrain,
    oneWay: isTerrain
  };
};

const setBatchInputState = (input, enabled) => {
  if (!input) return;
  input.value = '';
  input.disabled = !enabled;
  input.placeholder = enabled ? 'batch' : '';
};

const setBatchCheckState = (check, enabled) => {
  if (!check) return;
  check.checked = false;
  check.indeterminate = !!enabled;
  check.disabled = !enabled;
};

const hasEditorGadgetPiece = (level, pieceId) => {
  if (!Number.isFinite(pieceId) || !Array.isArray(level?.gadgets)) return false;
  return level.gadgets.some(entry => Number(entry?.props?.PIECE) === pieceId);
};

const createAdvisoryWarningKey = warning => [
  warning?.code || '',
  warning?.target || '',
  warning?.message || ''
].join('|');

const editorSelectionPanelMethods = {
  _setSelectionFields(data) {
    this._suppressInspector = true;
    if (!data) {
      this._toggleSelectionActions(false);
      if (this.el.selType) this.el.selType.textContent = 'None';
      if (this.el.selName) this.el.selName.textContent = '';
      const inputs = [
        this.el.selX,
        this.el.selY,
        this.el.selWidth,
        this.el.selHeight,
        this.el.selRotate,
        this.el.selSkill,
        this.el.selLemmings,
        this.el.selPairing,
        this.el.selMidiFlagId
      ];
      inputs.forEach(input => {
        if (input) {
          input.value = '';
          input.placeholder = '';
          input.disabled = true;
        }
      });
      const checks = [
        this.el.selFlipH,
        this.el.selFlipV,
        this.el.selMidiFlag,
        this.el.selNoOverwrite,
        this.el.selErase,
        this.el.selOneWay
      ];
      checks.forEach(check => {
        if (check) {
          check.checked = false;
          check.indeterminate = false;
          check.disabled = true;
        }
      });
      if (this.el.deleteSelection) this.el.deleteSelection.disabled = true;
      this._suppressInspector = false;
      return;
    }

    if (data.multi) {
      const capabilities = getMultiSelectionCapabilities(data.entries || []);
      this._toggleSelectionActions(true);
      if (this.el.selType) this.el.selType.textContent = 'Multiple';
      if (this.el.selName) {
        const suffix = capabilities.type ? `${capabilities.type} items` : 'mixed items';
        this.el.selName.textContent = `${data.count} ${suffix}`;
      }
      setBatchInputState(this.el.selX, capabilities.x);
      setBatchInputState(this.el.selY, capabilities.y);
      setBatchInputState(this.el.selWidth, capabilities.width);
      setBatchInputState(this.el.selHeight, capabilities.height);
      setBatchInputState(this.el.selRotate, capabilities.rotate);
      setBatchInputState(this.el.selSkill, capabilities.skill);
      setBatchInputState(this.el.selLemmings, capabilities.lemmings);
      setBatchInputState(this.el.selPairing, capabilities.pairing);
      setBatchInputState(this.el.selMidiFlagId, capabilities.midiFlagId);
      setBatchCheckState(this.el.selFlipH, capabilities.flipH);
      setBatchCheckState(this.el.selFlipV, capabilities.flipV);
      setBatchCheckState(this.el.selMidiFlag, capabilities.midiFlag);
      setBatchCheckState(this.el.selNoOverwrite, capabilities.noOverwrite);
      setBatchCheckState(this.el.selErase, capabilities.erase);
      setBatchCheckState(this.el.selOneWay, capabilities.oneWay);
      if (this.el.deleteSelection) this.el.deleteSelection.disabled = false;
      this._suppressInspector = false;
      return;
    }

    this._toggleSelectionActions(true);
    if (this.el.selType) this.el.selType.textContent = data.type;
    if (this.el.selName) this.el.selName.textContent = data.name || '';

    const props = data.props || {};
    const meta = data.meta || null;
    const isGadget = data.type === 'gadget';
    const isSteel = data.type === 'steel';
    const isTerrain = data.type === 'terrain';
    const supportsResize = isSteel;
    const widthValue = props.WIDTH ?? (isSteel ? undefined : meta?.width);
    const heightValue = props.HEIGHT ?? (isSteel ? undefined : meta?.height);

    if (this.el.selX) {
      this.el.selX.value = formatValue(props.X);
      this.el.selX.placeholder = '';
      this.el.selX.disabled = false;
    }
    if (this.el.selY) {
      this.el.selY.value = formatValue(props.Y);
      this.el.selY.placeholder = '';
      this.el.selY.disabled = false;
    }
    if (this.el.selWidth) {
      this.el.selWidth.value = formatValue(widthValue);
      this.el.selWidth.placeholder = '';
      this.el.selWidth.disabled = !supportsResize;
    }
    if (this.el.selHeight) {
      this.el.selHeight.value = formatValue(heightValue);
      this.el.selHeight.placeholder = '';
      this.el.selHeight.disabled = !supportsResize;
    }
    if (this.el.selRotate) {
      this.el.selRotate.value = formatRotation(props.ROTATE);
      this.el.selRotate.placeholder = '';
      this.el.selRotate.disabled = isSteel;
    }
    if (this.el.selSkill) {
      this.el.selSkill.value = formatValue(props.SKILL);
      this.el.selSkill.placeholder = '';
      this.el.selSkill.disabled = !isGadget;
    }
    if (this.el.selLemmings) {
      this.el.selLemmings.value = formatValue(props.LEMMINGS);
      this.el.selLemmings.placeholder = '';
      this.el.selLemmings.disabled = !isGadget;
    }
    if (this.el.selPairing) {
      this.el.selPairing.value = formatValue(props.PAIRING);
      this.el.selPairing.placeholder = '';
      this.el.selPairing.disabled = !isGadget;
    }
    if (this.el.selMidiFlag) {
      const enabled = !!props.MIDI_FLAG;
      this.el.selMidiFlag.checked = enabled;
      this.el.selMidiFlag.indeterminate = false;
      this.el.selMidiFlag.disabled = !isGadget;
    }
    if (this.el.selMidiFlagId) {
      const flagId = props.MIDI_FLAG_ID;
      this.el.selMidiFlagId.value = formatValue(flagId);
      this.el.selMidiFlagId.placeholder = '';
      const enabled = !!props.MIDI_FLAG;
      this.el.selMidiFlagId.disabled = !isGadget || !enabled;
    }

    if (this.el.selFlipH) {
      this.el.selFlipH.checked = !!props.FLIP_HORIZONTAL;
      this.el.selFlipH.indeterminate = false;
      this.el.selFlipH.disabled = isSteel;
    }
    if (this.el.selFlipV) {
      this.el.selFlipV.checked = !!props.FLIP_VERTICAL;
      this.el.selFlipV.indeterminate = false;
      this.el.selFlipV.disabled = isSteel;
    }
    if (this.el.selNoOverwrite) {
      this.el.selNoOverwrite.checked = !!props.NO_OVERWRITE;
      this.el.selNoOverwrite.indeterminate = false;
      this.el.selNoOverwrite.disabled = isGadget || isSteel;
    }
    if (this.el.selErase) {
      this.el.selErase.checked = !!props.ERASE;
      this.el.selErase.indeterminate = false;
      this.el.selErase.disabled = isGadget || isSteel;
    }
    if (this.el.selOneWay) {
      this.el.selOneWay.checked = !!props.ONE_WAY;
      this.el.selOneWay.indeterminate = false;
      this.el.selOneWay.disabled = !isTerrain;
    }
    if (this.el.deleteSelection) this.el.deleteSelection.disabled = false;

    this._suppressInspector = false;
  },

  _toggleSelectionActions(visible) {
    if (this.el.selectionActions) {
      this.el.selectionActions.hidden = !visible;
    }
  },

  _commitSelectionPatch(patch) {
    const updated = this.controller.updateSelectedProps(patch);
    if (!updated) return;
    this.controller.history.pushSnapshot(this.session?.level, 'Edit');
    this._refreshAfterEdit('Edit');
  },

  async _syncAfterSelection(label) {
    if (!this.view) return;
    const token = this._asyncToken;
    this._currentSavedId = '';
    this.session = this.view.editorSession || this.session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this._clearSolvabilityCheck();
    this.controller.clearSelection();
    await this._reloadAssets(token);
    if (!this._isAsyncCurrent(token)) return;
    this.controller.resetHistory(label || 'Load');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._refreshHeaderFields(this.session?.level);
    this._refreshSelection(null);
    this._refreshValidation();
    this._refreshSavedList('');
    this._drawSelectionOverlay();
    this._updateStatus(label || 'Load');
  },

  _refreshAfterEdit(label) {
    this._clearTransientIssue?.('import');
    this._clearSolvabilityCheck();
    this._refreshValidation();
    this._drawSelectionOverlay();
    this._updateStatus(label || 'Edit');
    this._setDirty(true);
    this._refreshUndoRedo();
  },

  _setDirty(isDirty) {
    this._dirty = !!isDirty;
    if (this.el.dirtyStatus) {
      this.el.dirtyStatus.textContent = this._dirty ? 'Unsaved' : 'Saved';
      this.el.dirtyStatus.classList.toggle('is-dirty', this._dirty);
    }
    if (this.document) {
      this.document.title = this._dirty ? `${this._baseTitle} *` : this._baseTitle;
    }
  },

  _refreshUndoRedo() {
    const canUndo = !!this.controller?.history?.canUndo?.();
    const canRedo = !!this.controller?.history?.canRedo?.();
    if (this.el.undo) this.el.undo.disabled = !canUndo;
    if (this.el.redo) this.el.redo.disabled = !canRedo;
  },

  _refreshValidation() {
    const level = this.session?.level;
    const issues = [
      ...validateLevel(level, this.assets || null, {
        solverAdvisorySource: this.view?.game?.level || null
      }),
      ...buildClassicSubsetIssues(level),
      ...(this._transientIssues || [])
    ];
    this._renderIssues(issues);
  },

  _clearSolvabilityCheck() {
    this._lastSolvabilityCheck = null;
    this._renderSolvabilityStatus();
  },

  _renderSolvabilityStatus(state = this._lastSolvabilityCheck) {
    if (!this.el.solvabilityStatus) return;
    const status = state?.status || 'idle';
    this.el.solvabilityStatus.dataset.status = status;
    this.el.solvabilityStatus.dataset.warningCount = String(state?.warningCount ?? 0);
    this.el.solvabilityStatus.textContent = state?.message || 'Solvability not checked';
  },

  async _waitForPreviewIdle(token) {
    const win = this.window;
    for (let i = 0; i < 120; i += 1) {
      if (!this._previewInFlight && !this._previewQueued) return true;
      if (!this._isAsyncCurrent(token)) return false;
      await new Promise(resolve => (win?.setTimeout || setTimeout)(resolve, 16));
    }
    return !this._previewInFlight && !this._previewQueued;
  },

  async _runSolvabilityCheck() {
    if (this._solvabilityCheckInFlight) return;
    this._solvabilityCheckInFlight = true;
    const token = this._asyncToken;
    if (this.el.solvabilityCheck) this.el.solvabilityCheck.disabled = true;
    this._lastSolvabilityCheck = {
      status: 'running',
      message: 'Solvability: checking preview...',
      warningCount: 0,
      warnings: [],
      budgetUsage: null
    };
    this._renderSolvabilityStatus();
    try {
      await this._refreshPreview('Solvability', { preserveView: true, token });
      await this._waitForPreviewIdle(token);
      if (!this._isAsyncCurrent(token)) return;
      const editorLevel = this.session?.level || null;
      const runtimeSource = this.view?.game?.level || null;
      const source = runtimeSource || editorLevel;
      if (!source) {
        this._lastSolvabilityCheck = {
          status: 'unavailable',
          message: 'Solvability: no level source available',
          warningCount: 0,
          warnings: [],
          budgetUsage: null
        };
      } else {
        const options = {
          assets: this.assets,
          entranceId: this.assets?.entranceId,
          exitId: this.assets?.exitId
        };
        const primaryAdvisory = checkEditorSolvabilityAdvisory(source, options);
        const editorAdvisory = editorLevel && runtimeSource && runtimeSource !== editorLevel
          ? checkEditorSolvabilityAdvisory(editorLevel, options)
          : null;
        const editorHasEntrance = hasEditorGadgetPiece(editorLevel, this.assets?.entranceId);
        const editorHasExit = hasEditorGadgetPiece(editorLevel, this.assets?.exitId);
        const warningKeys = new Set();
        const warnings = [];
        const pushWarning = (warning, origin) => {
          if (origin === 'runtime' &&
              warning?.code === 'missing-entrance' &&
              editorHasEntrance) {
            return;
          }
          if (origin === 'runtime' &&
              warning?.code === 'missing-exit' &&
              editorHasExit) {
            return;
          }
          const key = createAdvisoryWarningKey(warning);
          if (warningKeys.has(key)) return;
          warningKeys.add(key);
          warnings.push({
            code: warning.code || null,
            message: warning.message || '',
            target: warning.target || null
          });
        };
        for (const warning of editorAdvisory?.warnings || []) {
          pushWarning(warning, 'editor');
        }
        for (const warning of primaryAdvisory.warnings || []) {
          pushWarning(warning, runtimeSource ? 'runtime' : 'editor');
        }
        this._lastSolvabilityCheck = {
          status: warnings.length ? 'warnings' : 'ok',
          message: warnings.length
            ? `Solvability: ${warnings.length} advisory warning${warnings.length === 1 ? '' : 's'}`
            : 'Solvability: no obvious route warnings',
          warningCount: warnings.length,
          warnings,
          budgetUsage: primaryAdvisory.budgetUsage || editorAdvisory?.budgetUsage || null
        };
      }
      this._renderSolvabilityStatus();
      this._refreshValidation();
      this._updateStatus('Solvability');
    } finally {
      this._solvabilityCheckInFlight = false;
      if (this.el.solvabilityCheck) this.el.solvabilityCheck.disabled = false;
    }
  },

  _setTransientIssue(id, issue) {
    if (!id || !issue?.message) return;
    if (!Array.isArray(this._transientIssues)) this._transientIssues = [];
    this._transientIssues = this._transientIssues.filter(entry => entry.id !== id);
    this._transientIssues.push({
      id,
      severity: issue.severity || 'error',
      message: issue.message
    });
  },

  _clearTransientIssue(id) {
    if (!Array.isArray(this._transientIssues)) return;
    this._transientIssues = this._transientIssues.filter(entry => entry.id !== id);
  },

  _reportImportFailure(kind, error) {
    const message = getErrorMessage(error);
    this._setTransientIssue('import', {
      severity: 'error',
      message: `${kind} import failed: ${message}`
    });
    this._refreshValidation();
    this._updateStatus(`${kind} import failed`);
  },

  _renderIssues(issues) {
    this._hasErrors = false;
    const summary = { error: 0, warning: 0, info: 0 };
    if (!this.el.issuesList) {
      this._validationSummary = summary;
      return;
    }
    this.el.issuesList.innerHTML = '';
    for (const issue of issues) {
      const severity = issue.severity === 'error'
        ? 'error'
        : issue.severity === 'warning'
          ? 'warning'
          : 'info';
      const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
      if (severity === 'error') this._hasErrors = true;
      summary[severity] += 1;
      const item = this.document.createElement('div');
      item.className = `issue-item ${severity}`;
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-severity', severity);
      item.setAttribute('aria-label', `${severityLabel}: ${issue.message}`);
      const label = this.document.createElement('span');
      label.className = 'issue-severity';
      label.textContent = severityLabel;
      item.appendChild(label);
      const message = this.document.createElement('div');
      message.className = 'issue-message';
      message.textContent = issue.message;
      item.appendChild(message);
      if (issue.fix) {
        const destructive = isDestructiveQuickFix(issue);
        if (destructive) {
          item.classList.add('has-destructive-fix');
          item.setAttribute('data-fix', 'destructive');
          const note = this.document.createElement('div');
          note.className = 'issue-note';
          note.textContent = 'Destructive quick fix: changes or removes level data.';
          item.appendChild(note);
        }
        const button = this.document.createElement('button');
        button.className = destructive ? 'issue-action destructive' : 'issue-action';
        button.type = 'button';
        button.textContent = issue.fixLabel || 'Fix';
        button.title = issue.fixLabel
          ? `${destructive ? 'Destructive quick fix' : 'Apply fix'}: ${issue.fixLabel}`
          : 'Apply automatic fix.';
        button.addEventListener('click', () => {
          issue.fix();
          this.controller.history.pushSnapshot(this.session?.level, 'Fix');
          this._refreshAfterEdit('Fix');
          this._refreshPreview('Fix');
        });
        item.appendChild(button);
      }
      this.el.issuesList.appendChild(item);
    }
    this._validationSummary = summary;
  },

  _updateStatus(label) {
    if (this.el.cursorStatus) {
      if (this._cursorPos) {
        const cx = Math.round(this._cursorPos.x);
        const cy = Math.round(this._cursorPos.y);
        this.el.cursorStatus.textContent = `X:${cx} Y:${cy}`;
      } else {
        this.el.cursorStatus.textContent = 'X:— Y:—';
      }
    }
    if (!this.el.status) return;
    const parts = [];
    if (label) parts.push(label);
    parts.push(`Tool: ${this.controller.tool}`);
    const grid = this.controller.snapEnabled
      ? `Grid ${this.controller.gridSize}`
      : 'Grid off';
    parts.push(grid);
    parts.push(this._playtest ? 'Playtest' : 'Edit');
    const summary = this._validationSummary || {};
    if (summary.error) {
      parts.push(`${summary.error} error${summary.error === 1 ? '' : 's'}`);
    }
    if (summary.warning) {
      parts.push(`${summary.warning} warning${summary.warning === 1 ? '' : 's'}`);
    }
    this.el.status.textContent = parts.join(' • ');
  },

  _drawSelectionOverlay() {
    if (!this.view?.game || !this.view.stage) return;
    this.view.game.render();
    const stage = this.view.stage;
    const baseDisplay = stage.getGameDisplay();
    const overlayDisplay = stage.getGameOverlayDisplay?.() || null;
    const display = overlayDisplay || baseDisplay;
    const selectedEntries = this.controller.getSelectedEntries();
    const marquee = this.controller.getMarqueeBounds();
    const steelEntries = this.session?.level?.steel;
    const hasMarquee = !!marquee;
    const hasSteelOverlay = !!display?.drawStippleRect && Array.isArray(steelEntries) && steelEntries.length > 0;
    const hasSelectionOverlay = selectedEntries.length > 0;
    const hasOverlay = hasMarquee || hasSteelOverlay || hasSelectionOverlay;
    if (overlayDisplay && (hasOverlay || this._selectionOverlayVisible)) {
      overlayDisplay.clear(0x00000000);
    }
    if (marquee) {
      this._antsOffset = (this._antsOffset + 1) % 12;
      display.drawMarchingAntRect(
        marquee.x,
        marquee.y,
        marquee.width,
        marquee.height,
        3,
        this._antsOffset,
        0xFFFFFFFF,
        0x00000000
      );
    }
    if (display?.drawStippleRect && Array.isArray(steelEntries)) {
      const gridSize = 16;
      for (const entry of steelEntries) {
        const bounds = getEntryBounds(entry, null);
        display.drawStippleRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          180,
          180
        );
        for (let x = bounds.x; x <= bounds.x + bounds.width; x += gridSize) {
          display.drawStippleRect(x, bounds.y, 0, bounds.height, 0, 255, 255);
        }
        for (let y = bounds.y; y <= bounds.y + bounds.height; y += gridSize) {
          display.drawStippleRect(bounds.x, y, bounds.width, 0, 0, 255, 255);
        }
      }
    }
    for (const selected of selectedEntries) {
      const meta = selected.type === 'steel'
        ? null
        : selected.type === 'gadget'
          ? this.assets?.gadgetById?.get?.(selected.entry?.props?.PIECE)
          : this.assets?.terrainById?.get?.(selected.entry?.props?.PIECE);
      const bounds = getEntryBounds(selected.entry, meta);
      display.drawDashedRect(bounds.x, bounds.y, bounds.width, bounds.height, 210, 106, 60, 3);
    }
    if (selectedEntries.length === 1 && this.controller.canResizeSelection?.()) {
      const selected = selectedEntries[0];
      const meta = selected.type === 'steel'
        ? null
        : selected.type === 'gadget'
          ? this.assets?.gadgetById?.get?.(selected.entry?.props?.PIECE)
          : this.assets?.terrainById?.get?.(selected.entry?.props?.PIECE);
      const bounds = getEntryBounds(selected.entry, meta);
      const handleSize = this.controller.getHandleSize();
      const half = Math.max(1, Math.floor(handleSize / 2));
      const midX = bounds.x + Math.round(bounds.width / 2);
      const midY = bounds.y + Math.round(bounds.height / 2);
      const handles = [
        [bounds.x, bounds.y],
        [midX, bounds.y],
        [bounds.x + bounds.width, bounds.y],
        [bounds.x + bounds.width, midY],
        [bounds.x + bounds.width, bounds.y + bounds.height],
        [midX, bounds.y + bounds.height],
        [bounds.x, bounds.y + bounds.height],
        [bounds.x, midY]
      ];
      for (const [hx, hy] of handles) {
        display.drawRect(hx - half, hy - half, handleSize - 1, handleSize - 1, 255, 255, 255, true);
      }
    }
    if (overlayDisplay) {
      this._selectionOverlayVisible = hasOverlay;
      stage.setGameOverlayVisible?.(hasOverlay);
    } else {
      this._selectionOverlayVisible = false;
    }
    stage.redraw();
  },

  _togglePlaytest() {
    this._playtest = !this._playtest;
    this.view?.setEditorPlaytest?.(this._playtest);
    if (this.el.playtestToggle) {
      this.el.playtestToggle.classList.toggle('is-active', this._playtest);
      this.el.playtestToggle.textContent = this._playtest ? 'Playtest On' : 'Playtest';
    }
    this._updateStatus('Playtest');
  }
};
export { editorSelectionPanelMethods };
