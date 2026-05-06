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
import {
  getClassicExportLossSummary
} from './editorClassicSubsetContract.js';
const editorLevelIoUiMethods = {
  _refreshSavedList(selectedId = this._currentSavedId) {
    if (!this.el.savedSelect) return;
    const entries = listSavedLevels();
    this.el.savedSelect.innerHTML = '';
    const placeholder = this.document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Saved levels';
    this.el.savedSelect.appendChild(placeholder);
    for (const entry of entries) {
      const opt = this.document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.name;
      this.el.savedSelect.appendChild(opt);
    }
    this.el.savedSelect.value = selectedId || '';
  },

  _saveCurrentLevel() {
    if (!this.view?.editorSession?.level) return;
    const defaultName = this.view.getEditorLevelTitle?.() || 'Untitled';
    const prompt = this.window?.prompt;
    if (typeof prompt !== 'function') return;
    const name = normalizeText(prompt('Save level as', defaultName));
    if (!name) return;
    const text = this.view.getEditorLevelText();
    const id = saveLevel(undefined, {
      id: this._currentSavedId || undefined,
      name,
      text
    });
    if (!id) return;
    this._currentSavedId = id;
    this._refreshSavedList(id);
    this._setDirty(false);
  },

  async _createNewLevel() {
    if (!this.view) return;
    const token = this._nextAsyncToken();
    this._clearTransientIssue?.('import');
    this.view.createBlankEditorLevel({ render: false });
    this.session = this.view.editorSession || this.session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.resetHistory('New');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._needsDefaultEntrances = true;
    this._currentSavedId = '';
    this._refreshSavedList('');
    await this._reloadAssets(token);
    if (!this._isAsyncCurrent(token)) return;
    await this._refreshStyleOptions();
    this._refreshHeaderFields();
    this._refreshSelection(null);
    this._refreshValidation();
    await this._refreshPreview('New', { preserveView: false, token });
  },

  _bindSelectionActions() {
    const bind = (el, handler, label = 'Selection') => {
      if (!el) return;
      this._addDomListener(el, 'click', () => {
        if (handler()) {
          this._refreshAfterEdit(label);
        }
      });
    };
    const parsePieceIds = (value) => {
      const text = normalizeText(value);
      if (!text) return [];
      return text
        .split(/[,\s]+/)
        .map(token => parseNumber(token))
        .filter(id => Number.isFinite(id));
    };

    bind(this.el.selectionBringFront, () => this.controller.bringSelectionToFront(), 'Reorder');
    bind(this.el.selectionMoveForward, () => this.controller.moveSelectionForward(), 'Reorder');
    bind(this.el.selectionMoveBackward, () => this.controller.moveSelectionBackward(), 'Reorder');
    bind(this.el.selectionSendBack, () => this.controller.sendSelectionToBack(), 'Reorder');

    bind(this.el.selectionAlignLeft, () => this.controller.alignSelection('x', 'min'), 'Align');
    bind(this.el.selectionAlignCenter, () => this.controller.alignSelection('x', 'center'), 'Align');
    bind(this.el.selectionAlignRight, () => this.controller.alignSelection('x', 'max'), 'Align');
    bind(this.el.selectionAlignTop, () => this.controller.alignSelection('y', 'min'), 'Align');
    bind(this.el.selectionAlignMiddle, () => this.controller.alignSelection('y', 'center'), 'Align');
    bind(this.el.selectionAlignBottom, () => this.controller.alignSelection('y', 'max'), 'Align');
    bind(this.el.selectionDistributeX, () => this.controller.distributeSelection('x'), 'Distribute');
    bind(this.el.selectionDistributeY, () => this.controller.distributeSelection('y'), 'Distribute');

    bind(this.el.selectionReplaceApply, () => {
      const pieceId = parseNumber(this.el.selectionReplacePiece?.value);
      return this.controller.replaceSelectionPiece(pieceId);
    }, 'Replace');

    bind(this.el.selectionRandomApply, () => {
      const pieceIds = parsePieceIds(this.el.selectionRandomPieces?.value);
      const seed = parseNumber(this.el.selectionRandomSeed?.value);
      const requireSameSize = !!this.el.selectionRandomSameSize?.checked;
      return this.controller.randomizeSelectionPieces(pieceIds, {
        requireSameSize,
        seed
      });
    }, 'Randomize');

    bind(this.el.selectionTransformApply, () => {
      const scaleX = parseNumber(this.el.selectionScaleX?.value);
      const scaleY = parseNumber(this.el.selectionScaleY?.value);
      return this.controller.transformSelectionGroup({
        scaleX: Number.isFinite(scaleX) ? scaleX : 1,
        scaleY: Number.isFinite(scaleY) ? scaleY : 1
      });
    }, 'Transform');
  },

  _bindUndoRedo() {
    if (this.el.undo) {
      this._addDomListener(this.el.undo, 'click', () => {
        if (this.controller.undo()) {
          this._refreshAfterEdit('Undo');
        }
      });
    }
    if (this.el.redo) {
      this._addDomListener(this.el.redo, 'click', () => {
        if (this.controller.redo()) {
          this._refreshAfterEdit('Redo');
        }
      });
    }
  },

  _ensureDefaultEntrancesExits() {
    if (!this._needsDefaultEntrances) return;
    if (!this.assets) return;
    const viewRect = this.view?.stage?.getGameViewRect?.() || null;
    const added = this.controller.ensureDefaultEntrancesExits({
      entranceId: this.assets?.entranceId,
      exitId: this.assets?.exitId,
      viewRect
    });
    if (added) {
      this._refreshSelection(null);
      this._refreshValidation();
    }
    if (this.assets?.entranceId != null || this.assets?.exitId != null) {
      this._needsDefaultEntrances = false;
    }
  },

  _exportCurrentLevel() {
    this._refreshValidation();
    if (this._hasErrors) {
      this.window?.alert?.('Fix validation errors before exporting.');
      return;
    }
    const text = this.view.getEditorLevelText();
    const title = this.view.getEditorLevelTitle();
    const filename = `${sanitizeFileName(title)}.nxlv`;
    downloadTextFile(this.document, text, filename);
  },

  _exportCurrentLevelClassic() {
    this._refreshValidation();
    if (this._hasErrors) {
      this.window?.alert?.('Fix validation errors before exporting.');
      return;
    }
    if (!this.session?.level) return;
    const loss = getClassicExportLossSummary(this.session.level);
    const classic = createClassicLevelData(this.session.level);
    if (!classic?.levelReader) return;
    const writer = new LevelWriter();
    const payload = {
      levelProperties: classic.levelReader.levelProperties,
      screenPositionX: classic.levelReader.screenPositionX,
      graphicSet1: classic.levelReader.graphicSet1,
      graphicSet2: classic.levelReader.graphicSet2,
      isSuperLemming: classic.levelReader.isSuperLemming,
      objects: classic.levelReader.objects,
      terrains: classic.levelReader.terrains,
      steel: classic.levelReader.steel
    };
    const bytes = writer.write(payload);
    const title = this.view.getEditorLevelTitle();
    const filename = `${sanitizeFileName(title)}.lvl`;
    downloadBinaryFile(this.document, bytes, filename);
    this._updateStatus(loss.hasLoss ? `Export LVL lossy: ${loss.summary}` : 'Export LVL');
  },

  _loadLevelFromText(text, options = {}) {
    if (!this.view) return;
    const token = Number.isFinite(options.token) ? options.token : this._nextAsyncToken();
    let level = null;
    try {
      level = this.view.loadEditorLevelFromText(text, { render: false });
    } catch (error) {
      this._reportImportFailure?.('NXLV', error);
      return;
    }
    if (!level) {
      this._reportImportFailure?.('NXLV', 'No level data was loaded.');
      return;
    }
    this._clearTransientIssue?.('import');
    this.session = this.view.editorSession;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    this._reloadAssets(token).then(async () => {
      if (!this._isAsyncCurrent(token)) return;
      this.controller.resetHistory('Import');
      this._setDirty(false);
      this._refreshUndoRedo();
      this._refreshHeaderFields(level);
      this._refreshSelection(null);
      this._refreshValidation();
      if (options.resetSaved) this._refreshSavedList('');
      await this._refreshPreview('Import', { preserveView: false, token });
    });
  },

  _loadLevelFromClassic(levelReader, options = {}) {
    if (!this.view) return;
    const token = Number.isFinite(options.token) ? options.token : this._nextAsyncToken();
    const session = this.view.ensureEditorSession?.() || this.session;
    let editorLevel = null;
    try {
      editorLevel = createEditorLevelFromClassic(levelReader);
    } catch (error) {
      this._reportImportFailure?.('LVL', error);
      return;
    }
    if (!editorLevel) {
      this._reportImportFailure?.('LVL', 'No classic level data was loaded.');
      return;
    }
    this._clearTransientIssue?.('import');
    session.level = editorLevel;
    this.session = session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    this._reloadAssets(token).then(async () => {
      if (!this._isAsyncCurrent(token)) return;
      this.controller.resetHistory('Import LVL');
      this._setDirty(false);
      this._refreshUndoRedo();
      this._refreshHeaderFields(editorLevel);
      this._refreshSelection(null);
      this._refreshValidation();
      if (options.resetSaved) this._refreshSavedList('');
      await this._refreshPreview('Import LVL', { preserveView: false, token });
    });
  },

  async _reloadAssets(token = this._asyncToken) {
    const config = this.view?.gameResources?.config
        || await this.view?.gameFactory?.getConfig?.(this.view?.gameType);
    if (!this._isAsyncCurrent(token)) return null;
    const styleName = this.session?.level?.getHeader?.('STYLE');
    const assets = await this.assetCache.loadStyleAssets(
      styleName,
      config,
      this.view?.gameFactory?.fileProvider
    );
    if (!this._isAsyncCurrent(token)) return null;
    this.assets = assets;
    if (this.previewCache?.invalidateTypeIds) {
      this.previewCache.invalidateTypeIds(
        'terrain',
        this.assets?.terrain?.map(entry => Number(entry?.id))
      );
      const gadgetIds = this.assets?.gadgets?.map(entry => Number(entry?.id));
      this.previewCache.invalidateTypeIds('gadget', gadgetIds);
      // Remove older trigger-scoped cache keys after hard-cutover to gadget previews.
      this.previewCache.invalidateTypeIds('trigger', gadgetIds);
    }
    this.controller.setAssets(this.assets);
    this._refreshPalettes();
    await this._refreshStyleOptions();
  },

  async _refreshPreview(label, options = {}) {
    if (!this.view) return;
    const token = Number.isFinite(options.token) ? options.token : this._asyncToken;
    if (!this._isAsyncCurrent(token)) return;
    const preserveView = options.preserveView !== false;
    if (this._previewInFlight) {
      this._previewQueued = true;
      const nextLabel = label || 'Preview';
      if (this._previewQueuedLabel && this._previewQueuedLabel !== nextLabel) {
        this._previewQueuedLabel = 'Preview';
      } else {
        this._previewQueuedLabel = nextLabel;
      }
      const queuedPreserve = this._previewQueuedOptions?.preserveView ?? true;
      this._previewQueuedOptions = { preserveView: queuedPreserve && preserveView };
      return;
    }
    this._previewInFlight = true;
    try {
      await this.view.loadEditorPreviewLevel({
        suspend: !this._playtest,
        preserveView
      });
      if (!this._isAsyncCurrent(token)) return;
      this.view.setEditorPlaytest(this._playtest);
      this._ensureDefaultEntrancesExits();
      this._drawSelectionOverlay();
      this._refreshValidation();
      this._updateStatus(label || 'Preview');
    } finally {
      this._previewInFlight = false;
      if (this._previewQueued) {
        const nextLabel = this._previewQueuedLabel || 'Queued';
        const nextOptions = this._previewQueuedOptions || {};
        this._previewQueued = false;
        this._previewQueuedLabel = null;
        this._previewQueuedOptions = null;
        this._refreshPreview(nextLabel, nextOptions);
      }
    }
  }
};
export { editorLevelIoUiMethods };
