import {
  DEFAULT_GRID,
  DEFAULT_HANDLE_SIZE,
  EditorHistory,
  EditorTools,
  MAX_BRUSH_SIZE,
  MAX_ENTRANCES,
  MAX_EXITS,
  MAX_MIDI_FLAG_ID,
  MIDI_FLAG_TRIGGER_MAX,
  __test__,
  boundsIntersect,
  clampBrushSize,
  clampMidiFlagId,
  clampSize,
  cloneEntry,
  coerceEntryNumber,
  createGadgetEntry,
  createSteelEntry,
  createTerrainEntry,
  ensureEntryUid,
  findEntryAt,
  getEntryBounds,
  isMidiFlagEnabled,
  normalizeBounds,
  removeEntryAt,
  selectionKey,
  setEntryProp,
  snapValue
} from './EditorControllerShared.js';
import { editorControllerSelectionMethods } from './EditorControllerSelection.js';
import { editorControllerClipboardMethods } from './EditorControllerClipboard.js';
import { editorControllerPointerMethods } from './EditorControllerPointer.js';
class EditorController {
  constructor(options = {}) {
    this.session = options.session || null;
    this.history = options.history || new EditorHistory();
    this.tool = options.tool || EditorTools.SELECT;
    this.gridSize = Number.isFinite(options.gridSize) ? options.gridSize : DEFAULT_GRID;
    this.snapEnabled = options.snapEnabled !== false;
    this.brushSize = 1;
    this.setBrushSize(Number.isFinite(options.brushSize) ? options.brushSize : 1);
    this.eraseGadgets = !!options.eraseGadgets;
    this.assets = options.assets || null;
    this.selectedTerrainId = 0;
    this.selectedGadgetId = 0;
    this.selectedTriggerId = null;
    this._selection = [];
    this._selectionSet = new Set();
    this._entryIndexCache = {
      terrain: { list: null, size: -1, map: new Map() },
      gadget: { list: null, size: -1, map: new Map() },
      steel: { list: null, size: -1, map: new Map() }
    };
    Object.defineProperty(this, 'selection', {
      configurable: true,
      enumerable: true,
      get: () => this._selection,
      set: (value) => {
        this._setSelectionState(value);
      }
    });
    this.selection = [];
    this._drag = null;
    this._resize = null;
    this._marquee = null;
    this._steelDraft = null;
    this._strokeChanged = false;
    this._stampSet = new Set();
    this._lastBrushPos = null;
    this._clipboard = null;
    this._pasteOffset = 0;
    this._previewTimer = null;
    this._pointerDown = false;
    this._pointerButton = 0;
    this._previewDelay = Number.isFinite(options.previewDelay) ? options.previewDelay : 60;
    this.handleSize = Number.isFinite(options.handleSize) ? options.handleSize : DEFAULT_HANDLE_SIZE;
    this._callbacks = {
      onSelectionChange: null,
      onLevelChange: null,
      onPreviewRequest: null,
      onMarqueeChange: null
    };
  }
}
for (const methods of [
  editorControllerSelectionMethods,
  editorControllerClipboardMethods,
  editorControllerPointerMethods
]) {
  Object.defineProperties(EditorController.prototype, Object.getOwnPropertyDescriptors(methods));
}
export { EditorController };