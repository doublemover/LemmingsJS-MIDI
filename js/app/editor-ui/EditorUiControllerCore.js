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
import { editorUiBindingsMethods } from './EditorUiBindings.js';
import { editorPaletteUiMethods } from './EditorPaletteUi.js';
import { editorSelectionPanelMethods } from './EditorSelectionPanel.js';
import { editorLevelIoUiMethods } from './EditorLevelIoUi.js';
class EditorUiController {
  constructor(options = {}) {
    this.view = options.view || null;
    this.document = options.document || getRuntimeDependency('document', null);
    this.window = options.window || getRuntimeDependency('window', null);
    this.session = options.session || this.view?.ensureEditorSession?.() || null;
    this.history = options.history || new EditorHistory({
      maxEntries: MAX_HISTORY,
      maxBytes: MAX_HISTORY_BYTES,
      coalesceWindowMs: HISTORY_COALESCE_WINDOW_MS
    });
    this.controller = options.controller || new EditorController({
      session: this.session,
      history: this.history
    });
    this.assetCache = options.assetCache || new EditorAssetCache();
    this.previewCache = options.previewCache || new EditorPreviewCache({
      document: this.document,
      window: this.window
    });
    this.assets = null;
    this._selection = [];
    this._activeTab = 'terrain';
    this._currentSavedId = '';
    this._currentProject = null;
    this._playtest = false;
    this._previewInFlight = false;
    this._previewQueued = false;
    this._previewQueuedLabel = null;
    this._previewQueuedOptions = null;
    this._cursorPos = null;
    this._paletteViewMode = 'list';
    this._paletteGridColumns = 4;
    this._paletteEntries = {
      terrain: [],
      gadget: [],
      trigger: []
    };
    this._recentPaletteEntries = [];
    this._palettePreviewQueue = [];
    this._palettePreviewIndex = 0;
    this._palettePreviewTimer = null;
    this._palettePreviewToken = 0;
    this._paletteFilterTimer = null;
    this._styleAvailability = new Map();
    this._suppressHeader = false;
    this._suppressInspector = false;
    this._pointerDown = false;
    this._shiftKey = false;
    this._altKey = false;
    this._antsOffset = 0;
    this._selectionOverlayVisible = false;
    this._needsDefaultEntrances = false;
    this._eventsBound = false;
    this._disposed = false;
    this._asyncToken = 0;
    this._domListeners = [];
    this._displayListeners = [];
    this.shortcutOverlay = null;
    this._dirty = false;
    this._baseTitle = this.document?.title || 'Lemmings Editor';
    this._lastSolvabilityCheck = null;
    this._solvabilityCheckInFlight = false;

    this._bindElements();
    this._bindController();
  }

  _renderPaletteList(container, items, type) {
    if (!container) return;
    container.innerHTML = '';
    const nextEntries = [];
    for (const entry of items || []) {
      const width = Number(entry.width || 0);
      const height = Number(entry.height || 0);
      if (width <= 0 && height <= 0) {
        continue;
      }
      const button = this.document.createElement('button');
      button.type = 'button';
      button.dataset.id = String(entry.id);
      button.dataset.type = type;
      const labelText = this._getPaletteLabelText(entry);
      const label = this.document.createElement('span');
      label.className = 'palette-label';
      label.textContent = labelText;
      button.title = `Select ${labelText}`;
      const previewWrap = this.document.createElement('span');
      previewWrap.className = 'palette-preview';
      previewWrap.classList.add('pending');
      const previewImg = this.document.createElement('img');
      previewImg.alt = labelText;
      previewImg.loading = 'lazy';
      previewWrap.appendChild(previewImg);
      button.append(previewWrap, label);
      button.addEventListener('click', () => {
        this._selectPaletteEntry(entry, type, { recordRecent: true });
      });
      container.appendChild(button);
      nextEntries.push({
        id: Number(entry.id),
        type,
        entry,
        searchKey: normalizeText(labelText).toLowerCase(),
        button,
        previewWrap,
        previewImg,
        previewLoaded: false
      });
    }
    this._paletteEntries[type] = nextEntries;
  }

  _refreshSelection(selection) {
    const entries = Array.isArray(selection)
      ? selection
      : this.controller.getSelectedEntries();
    this._selection = entries;
    if (!entries.length) {
      this._setSelectionFields(null);
      this._updateSelectionStatus();
      return;
    }
    if (entries.length > 1) {
      this._setSelectionFields({ multi: true, count: entries.length, entries });
      this._updateSelectionStatus();
      return;
    }
    const selected = entries[0];
    const props = selected.entry?.props || {};
    const isSteel = selected.type === 'steel';
    const meta = selected.type === 'gadget'
      ? this.assets?.gadgetById?.get?.(props.PIECE)
      : this.assets?.terrainById?.get?.(props.PIECE);
    const name = isSteel ? 'Steel' : (meta?.name || `#${props.PIECE}`);
    const pieceId = Number(props.PIECE);
    if (!isSteel && Number.isFinite(pieceId)) {
      if (selected.type === 'gadget') {
        this.controller.setSelectedGadget(pieceId);
      } else {
        this.controller.setSelectedTerrain(pieceId);
      }
      this._refreshPaletteSelection();
    }
    this._setSelectionFields({
      type: selected.type,
      name,
      props,
      meta
    });
    this._updateSelectionStatus();
  }

  _updateSelectionStatus() {
    if (!this.el.selectionStatus) return;
    if (!this._selection || this._selection.length === 0) {
      this.el.selectionStatus.textContent = 'No selection';
      return;
    }
    if (this._selection.length > 1) {
      this.el.selectionStatus.textContent = `${this._selection.length} selected`;
      return;
    }
    const selected = this._selection[0];
    const props = selected.entry?.props || {};
    const name = selected.type === 'steel'
      ? 'steel'
      : (selected.entry?.props?.PIECE ?? 'unknown');
    this.el.selectionStatus.textContent = `${selected.type} #${name} @ ${props.X ?? 0},${props.Y ?? 0}`;
  }
}
for (const methods of [
  editorUiBindingsMethods,
  editorPaletteUiMethods,
  editorSelectionPanelMethods,
  editorLevelIoUiMethods
]) {
  Object.defineProperties(EditorUiController.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { EditorUiController };
