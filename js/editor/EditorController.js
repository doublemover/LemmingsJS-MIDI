import { EditorTools } from './EditorTools.js';
import { EditorHistory } from './EditorHistory.js';
import {
  createTerrainEntry,
  createGadgetEntry,
  createSteelEntry,
  ensureEntryUid,
  setEntryProp,
  removeEntryAt
} from './EditorEntryFactory.js';
import { findEntryAt, getEntryBounds } from './EditorHitTest.js';

const DEFAULT_GRID = 4;
const MAX_ENTRANCES = 4;
const MAX_EXITS = 4;
const DEFAULT_HANDLE_SIZE = 2;
const MAX_BRUSH_SIZE = 64;

const snapValue = (value, gridSize) => {
  if (!Number.isFinite(gridSize) || gridSize <= 1) return Math.round(value);
  return Math.round(value / gridSize) * gridSize;
};

const clampSize = (value) => Math.max(1, Math.round(value));
const clampBrushSize = (value) => Math.min(MAX_BRUSH_SIZE, clampSize(value));

const cloneEntry = (entry, options = {}) => {
  const props = entry?.props ? { ...entry.props } : {};
  const order = Array.isArray(entry?.order) ? entry.order.slice() : Object.keys(props);
  const unknownLines = Array.isArray(entry?.unknownLines) ? entry.unknownLines.slice() : [];
  const clone = { props, order, unknownLines };
  if (options.preserveUid && entry?.uid) {
    clone.uid = entry.uid;
  } else if (options.assignUid !== false) {
    ensureEntryUid(clone, options.prefix || 'e');
  }
  return clone;
};

const coerceEntryNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};

const normalizeBounds = (x1, y1, x2, y2) => {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
};

const boundsIntersect = (a, b) => {
  if (!a || !b) return false;
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
};

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

  setCallbacks(callbacks = {}) {
    this._callbacks = { ...this._callbacks, ...callbacks };
  }

  setAssets(assets) {
    this.assets = assets || null;
    const hasId = (list, id) => Array.isArray(list) && list.some(entry => entry?.id === id);
    if (assets?.terrain?.length && !hasId(assets.terrain, this.selectedTerrainId)) {
      this.selectedTerrainId = assets.terrain[0].id;
    }
    if (assets?.gadgets?.length && !hasId(assets.gadgets, this.selectedGadgetId)) {
      this.selectedGadgetId = assets.gadgets[0].id;
    }
    if (assets?.triggers?.length && !hasId(assets.triggers, this.selectedTriggerId)) {
      this.selectedTriggerId = assets.triggers[0].id;
    }
  }

  resetHistory(label = 'Init') {
    this.history.clear();
    this.history.pushSnapshot(this.session?.level, label);
  }

  setTool(tool) {
    if (!tool) return;
    this.tool = tool;
  }

  setSnapEnabled(enabled) {
    this.snapEnabled = !!enabled;
  }

  setBrushSize(size) {
    const value = Number.isFinite(size) ? size : 1;
    this.brushSize = clampBrushSize(value);
  }

  setEraseGadgets(enabled) {
    this.eraseGadgets = !!enabled;
  }

  setSelectedTerrain(id) {
    if (Number.isFinite(id)) this.selectedTerrainId = id;
  }

  setSelectedGadget(id) {
    if (Number.isFinite(id)) this.selectedGadgetId = id;
  }

  setSelectedTrigger(id) {
    if (Number.isFinite(id)) this.selectedTriggerId = id;
  }

  _getListForType(type) {
    if (!this.session?.level) return null;
    if (type === 'gadget') return this.session.level.gadgets;
    if (type === 'steel') return this.session.level.steel;
    return this.session.level.terrains;
  }

  getSelectedEntries() {
    if (!this.session?.level || !Array.isArray(this.selection)) return [];
    const results = [];
    for (const selected of this.selection) {
      const list = this._getListForType(selected.type);
      const entry = Array.isArray(list) ? list[selected.index] : null;
      if (!entry) continue;
      results.push({ ...selected, entry });
    }
    return results;
  }

  getSelectedEntry() {
    const entries = this.getSelectedEntries();
    if (entries.length !== 1) return null;
    return entries[0];
  }

  getSelectionBounds() {
    const selected = this.getSelectedEntry();
    if (!selected) return null;
    if (selected.type === 'steel') {
      return getEntryBounds(selected.entry, null);
    }
    const meta = selected.type === 'gadget'
      ? this.assets?.gadgetById?.get?.(selected.entry?.props?.PIECE)
      : this.assets?.terrainById?.get?.(selected.entry?.props?.PIECE);
    return getEntryBounds(selected.entry, meta);
  }

  getMarqueeBounds() {
    if (!this._marquee) return null;
    return normalizeBounds(
      this._marquee.startX,
      this._marquee.startY,
      this._marquee.x,
      this._marquee.y
    );
  }

  getHandleSize() {
    return this.handleSize;
  }

  canResizeSelection() {
    if (!Array.isArray(this.selection) || this.selection.length !== 1) return false;
    return this.selection[0].type === 'steel';
  }

  clearSelection() {
    this.selection = [];
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
  }

  _setSelection(list) {
    this.selection = Array.isArray(list) ? list.map(entry => ({
      type: entry.type,
      index: entry.index
    })) : [];
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
  }

  _isSelected(type, index) {
    return this.selection.some(entry => entry.type === type && entry.index === index);
  }

  _toggleSelection(hit) {
    if (!hit) return;
    if (this._isSelected(hit.type, hit.index)) {
      this.selection = this.selection.filter(entry => !(entry.type === hit.type && entry.index === hit.index));
    } else {
      this.selection = [...this.selection, { type: hit.type, index: hit.index }];
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
  }

  updateHeader(key, value) {
    if (!this.session?.level) return;
    this.session.level.setHeader(key, value);
    this._callbacks.onLevelChange?.(this.session.level);
    this._requestPreview('Header');
  }

  updateSelectedProps(patch = {}) {
    const entries = this.getSelectedEntries();
    if (entries.length === 0) return false;
    for (const selected of entries) {
      for (const [key, value] of Object.entries(patch)) {
        const removeIfFalse = typeof value === 'boolean';
        setEntryProp(selected.entry, key, value, { removeIfFalse });
      }
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._requestPreview('Edit');
    return true;
  }

  copySelection() {
    const entries = this.getSelectedEntries();
    if (entries.length === 0) return false;
    let minX = Infinity;
    let minY = Infinity;
    const items = [];
    for (const selected of entries) {
      const props = selected.entry?.props || {};
      const x = coerceEntryNumber(props.X, 0);
      const y = coerceEntryNumber(props.Y, 0);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      items.push({
        type: selected.type,
        entry: cloneEntry(selected.entry, { assignUid: false }),
        offsetX: x,
        offsetY: y
      });
    }
    for (const item of items) {
      item.offsetX -= minX;
      item.offsetY -= minY;
    }
    this._clipboard = { items, minX, minY };
    this._pasteOffset = 0;
    return true;
  }

  _getPasteStep() {
    if (this.snapEnabled && Number.isFinite(this.gridSize) && this.gridSize > 0) {
      return this.gridSize;
    }
    return 1;
  }

  _cloneSelection(entries, offsetX, offsetY) {
    const next = [];
    for (const selected of entries) {
      const list = this._getListForType(selected.type);
      if (!Array.isArray(list)) continue;
      const prefix = selected.type === 'gadget' ? 'g' : selected.type === 'steel' ? 's' : 't';
      const clone = cloneEntry(selected.entry, { prefix });
      clone.props.X = coerceEntryNumber(clone.props.X, 0) + offsetX;
      clone.props.Y = coerceEntryNumber(clone.props.Y, 0) + offsetY;
      list.push(clone);
      next.push({ type: selected.type, index: list.length - 1 });
    }
    if (!next.length) return null;
    this._setSelection(next);
    this._markChanged();
    return next;
  }

  pasteSelection() {
    if (!this.session?.level || !this._clipboard?.items?.length) return false;
    const step = this._getPasteStep();
    this._pasteOffset += step;
    const baseX = coerceEntryNumber(this._clipboard.minX, 0) + this._pasteOffset;
    const baseY = coerceEntryNumber(this._clipboard.minY, 0) + this._pasteOffset;
    const entries = this._clipboard.items.map(item => ({
      type: item.type,
      entry: item.entry,
      offsetX: item.offsetX,
      offsetY: item.offsetY
    }));
    const selected = [];
    for (const item of entries) {
      const list = this._getListForType(item.type);
      if (!Array.isArray(list)) continue;
      const prefix = item.type === 'gadget' ? 'g' : item.type === 'steel' ? 's' : 't';
      const clone = cloneEntry(item.entry, { prefix });
      clone.props.X = baseX + item.offsetX;
      clone.props.Y = baseY + item.offsetY;
      list.push(clone);
      selected.push({ type: item.type, index: list.length - 1 });
    }
    if (!selected.length) return false;
    this._setSelection(selected);
    this._commitHistory('Paste');
    this._requestPreview('Paste');
    return true;
  }

  duplicateSelection() {
    const copied = this.copySelection();
    if (!copied) return false;
    const pasted = this.pasteSelection();
    if (pasted) {
      this._requestPreview('Duplicate');
    }
    return pasted;
  }

  nudgeSelection(dx, dy, step = 1) {
    const entries = this.getSelectedEntries();
    if (entries.length === 0) return false;
    const moveX = coerceEntryNumber(dx, 0) * step;
    const moveY = coerceEntryNumber(dy, 0) * step;
    for (const selected of entries) {
      const props = selected.entry?.props;
      if (!props) continue;
      props.X = coerceEntryNumber(props.X, 0) + moveX;
      props.Y = coerceEntryNumber(props.Y, 0) + moveY;
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Nudge');
    this._requestPreview('Nudge');
    return true;
  }

  snapSelectionToGrid() {
    const entries = this.getSelectedEntries();
    if (entries.length === 0) return false;
    const grid = Number.isFinite(this.gridSize) && this.gridSize > 0 ? this.gridSize : 1;
    for (const selected of entries) {
      const props = selected.entry?.props;
      if (!props) continue;
      props.X = snapValue(coerceEntryNumber(props.X, 0), grid);
      props.Y = snapValue(coerceEntryNumber(props.Y, 0), grid);
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Snap');
    this._requestPreview('Snap');
    return true;
  }

  _getEntryMetaForType(type, entry) {
    if (type === 'gadget') {
      return this.assets?.gadgetById?.get?.(entry?.props?.PIECE) || null;
    }
    if (type === 'terrain') {
      return this.assets?.terrainById?.get?.(entry?.props?.PIECE) || null;
    }
    return null;
  }

  _getPieceMetaByType(type) {
    if (type === 'gadget') {
      return this.assets?.gadgetById || null;
    }
    if (type === 'terrain') {
      return this.assets?.terrainById || null;
    }
    return null;
  }

  _getSelectionBoundsEntries(entries = null) {
    const selectedEntries = Array.isArray(entries) ? entries : this.getSelectedEntries();
    if (!selectedEntries.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const resolved = [];
    for (const selected of selectedEntries) {
      const meta = this._getEntryMetaForType(selected.type, selected.entry);
      const bounds = getEntryBounds(selected.entry, meta);
      if (!bounds) continue;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
      resolved.push({ ...selected, bounds });
    }
    if (!resolved.length) return null;
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      entries: resolved
    };
  }

  alignSelection(axis = 'x', anchor = 'min') {
    const group = this._getSelectionBoundsEntries();
    if (!group || group.entries.length < 2) return false;
    const isX = axis === 'x';
    const groupMin = isX ? group.minX : group.minY;
    const groupMax = isX ? group.maxX : group.maxY;
    const groupCenter = (groupMin + groupMax) / 2;
    for (const selected of group.entries) {
      const props = selected.entry?.props;
      if (!props) continue;
      const bounds = selected.bounds;
      const start = isX ? bounds.x : bounds.y;
      const size = isX ? bounds.width : bounds.height;
      const offset = isX
        ? coerceEntryNumber(props.X, 0) - bounds.x
        : coerceEntryNumber(props.Y, 0) - bounds.y;
      let nextStart = groupMin;
      if (anchor === 'max' || anchor === 'end') {
        nextStart = groupMax - size;
      } else if (anchor === 'center' || anchor === 'mid') {
        nextStart = groupCenter - (size / 2);
      }
      if (isX) props.X = Math.round(nextStart + offset);
      else props.Y = Math.round(nextStart + offset);
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Align');
    this._requestPreview('Align');
    return true;
  }

  distributeSelection(axis = 'x') {
    const group = this._getSelectionBoundsEntries();
    if (!group || group.entries.length < 3) return false;
    const isX = axis === 'x';
    const sorted = group.entries.slice().sort((a, b) => {
      const av = isX ? a.bounds.x : a.bounds.y;
      const bv = isX ? b.bounds.x : b.bounds.y;
      return av - bv;
    });
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstStart = isX ? first.bounds.x : first.bounds.y;
    const lastStart = isX ? last.bounds.x : last.bounds.y;
    const spacing = (lastStart - firstStart) / (sorted.length - 1);
    for (let i = 1; i < sorted.length - 1; i++) {
      const selected = sorted[i];
      const props = selected.entry?.props;
      if (!props) continue;
      const bounds = selected.bounds;
      const offset = isX
        ? coerceEntryNumber(props.X, 0) - bounds.x
        : coerceEntryNumber(props.Y, 0) - bounds.y;
      const nextStart = firstStart + (spacing * i);
      if (isX) props.X = Math.round(nextStart + offset);
      else props.Y = Math.round(nextStart + offset);
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Distribute');
    this._requestPreview('Distribute');
    return true;
  }

  replaceSelectionPiece(pieceId, type = null) {
    const nextPieceId = Number(pieceId);
    if (!Number.isFinite(nextPieceId)) return false;
    const entries = this.getSelectedEntries();
    if (!entries.length) return false;
    let changed = false;
    for (const selected of entries) {
      if (type && selected.type !== type) continue;
      if (selected.type === 'steel') continue;
      if (!selected.entry?.props) continue;
      if (selected.entry.props.PIECE !== nextPieceId) {
        selected.entry.props.PIECE = nextPieceId;
        changed = true;
      }
    }
    if (!changed) return false;
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Replace');
    this._requestPreview('Replace');
    return true;
  }

  randomizeSelectionPieces(pieceIds = [], options = {}) {
    const entries = this.getSelectedEntries();
    if (!entries.length) return false;
    const {
      type = null,
      requireSameSize = false,
      seed = null
    } = options;
    const candidates = Array.from(new Set(
      (Array.isArray(pieceIds) ? pieceIds : [])
        .map(value => Number(value))
        .filter(value => Number.isFinite(value))
    ));
    if (!candidates.length) return false;

    let random = Math.random;
    if (Number.isFinite(seed)) {
      let state = (Math.floor(seed) >>> 0) || 1;
      random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }
    const pickPiece = (available) => {
      if (!available.length) return null;
      const index = Math.min(available.length - 1, Math.floor(random() * available.length));
      return available[index];
    };
    let changed = false;
    for (const selected of entries) {
      if (type && selected.type !== type) continue;
      if (selected.type === 'steel') continue;
      const props = selected.entry?.props;
      if (!props) continue;
      const metaById = this._getPieceMetaByType(selected.type);
      let available = candidates;
      if (requireSameSize && metaById?.get) {
        const sourceMeta = metaById.get(props.PIECE);
        if (sourceMeta) {
          available = candidates.filter(id => {
            const candidateMeta = metaById.get(id);
            return candidateMeta
              && candidateMeta.width === sourceMeta.width
              && candidateMeta.height === sourceMeta.height;
          });
          if (!available.length) {
            continue;
          }
        }
      }
      const nextPiece = pickPiece(available);
      if (!Number.isFinite(nextPiece)) continue;
      if (props.PIECE !== nextPiece) {
        props.PIECE = nextPiece;
        changed = true;
      }
    }
    if (!changed) return false;
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Randomize');
    this._requestPreview('Randomize');
    return true;
  }

  transformSelectionGroup({ scaleX = 1, scaleY = 1 } = {}) {
    const group = this._getSelectionBoundsEntries();
    if (!group || group.entries.length < 1) return false;
    const sx = Number.isFinite(scaleX) ? scaleX : 1;
    const sy = Number.isFinite(scaleY) ? scaleY : 1;
    if (sx === 1 && sy === 1) return false;
    const cx = group.minX + (group.width / 2);
    const cy = group.minY + (group.height / 2);
    for (const selected of group.entries) {
      const props = selected.entry?.props;
      if (!props) continue;
      const bounds = selected.bounds;
      const nx = cx + ((bounds.x - cx) * sx);
      const ny = cy + ((bounds.y - cy) * sy);
      const dx = nx - bounds.x;
      const dy = ny - bounds.y;
      props.X = Math.round(coerceEntryNumber(props.X, 0) + dx);
      props.Y = Math.round(coerceEntryNumber(props.Y, 0) + dy);
      if (Object.prototype.hasOwnProperty.call(props, 'WIDTH')) {
        props.WIDTH = clampSize(coerceEntryNumber(Number(props.WIDTH), 1) * Math.max(0.01, sx));
      }
      if (Object.prototype.hasOwnProperty.call(props, 'HEIGHT')) {
        props.HEIGHT = clampSize(coerceEntryNumber(Number(props.HEIGHT), 1) * Math.max(0.01, sy));
      }
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Transform');
    this._requestPreview('Transform');
    return true;
  }

  deleteSelected() {
    if (!this.session?.level || this.selection.length === 0) return false;
    const terrainIndices = [];
    const gadgetIndices = [];
    const steelIndices = [];
    for (const selected of this.selection) {
      if (selected.type === 'gadget') gadgetIndices.push(selected.index);
      else if (selected.type === 'steel') steelIndices.push(selected.index);
      else terrainIndices.push(selected.index);
    }
    terrainIndices.sort((a, b) => b - a);
    gadgetIndices.sort((a, b) => b - a);
    steelIndices.sort((a, b) => b - a);
    for (const index of terrainIndices) {
      removeEntryAt(this.session.level, 'terrain', index);
    }
    for (const index of gadgetIndices) {
      removeEntryAt(this.session.level, 'gadget', index);
    }
    for (const index of steelIndices) {
      removeEntryAt(this.session.level, 'steel', index);
    }
    this.selection = [];
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._commitHistory('Delete');
    this._requestPreview('Delete');
    return true;
  }

  _reorderSelection(mode) {
    if (!this.session?.level || this.selection.length === 0) return false;
    const groups = {
      terrain: [],
      gadget: [],
      steel: []
    };
    for (const selected of this.selection) {
      if (groups[selected.type]) groups[selected.type].push(selected.index);
    }
    const reorderList = (list, indices, dir) => {
      if (!Array.isArray(list) || indices.length === 0) return null;
      const unique = Array.from(new Set(indices)).filter(idx => idx >= 0 && idx < list.length);
      if (!unique.length) return null;
      const selectedSet = new Set(unique);
      if (dir === 'front' || dir === 'back') {
        const ordered = unique.slice().sort((a, b) => a - b).map(idx => list[idx]);
        const remaining = list.filter((_, idx) => !selectedSet.has(idx));
        list.length = 0;
        if (dir === 'front') {
          list.push(...remaining, ...ordered);
        } else {
          list.push(...ordered, ...remaining);
        }
        const next = new Map();
        list.forEach((entry, idx) => next.set(entry, idx));
        return ordered.map(entry => next.get(entry)).filter(idx => idx != null);
      }
      if (dir === 'forward') {
        const sorted = unique.slice().sort((a, b) => b - a);
        for (const idx of sorted) {
          if (idx >= list.length - 1) continue;
          if (selectedSet.has(idx + 1)) continue;
          const tmp = list[idx + 1];
          list[idx + 1] = list[idx];
          list[idx] = tmp;
          selectedSet.delete(idx);
          selectedSet.add(idx + 1);
        }
        return Array.from(selectedSet);
      }
      if (dir === 'backward') {
        const sorted = unique.slice().sort((a, b) => a - b);
        for (const idx of sorted) {
          if (idx <= 0) continue;
          if (selectedSet.has(idx - 1)) continue;
          const tmp = list[idx - 1];
          list[idx - 1] = list[idx];
          list[idx] = tmp;
          selectedSet.delete(idx);
          selectedSet.add(idx - 1);
        }
        return Array.from(selectedSet);
      }
      return null;
    };

    const nextSelection = [];
    for (const [type, indices] of Object.entries(groups)) {
      const list = this._getListForType(type);
      const nextIndices = reorderList(list, indices, mode);
      if (!nextIndices) continue;
      for (const idx of nextIndices) {
        nextSelection.push({ type, index: idx });
      }
    }
    if (!nextSelection.length) return false;
    this._setSelection(nextSelection);
    this._commitHistory('Reorder');
    this._requestPreview('Reorder');
    return true;
  }

  bringSelectionToFront() {
    return this._reorderSelection('front');
  }

  sendSelectionToBack() {
    return this._reorderSelection('back');
  }

  moveSelectionForward() {
    return this._reorderSelection('forward');
  }

  moveSelectionBackward() {
    return this._reorderSelection('backward');
  }

  undo() {
    const level = this.history.undo();
    if (!level || !this.session) return null;
    this.session.level = level;
    this.clearSelection();
    this._callbacks.onLevelChange?.(level);
    this._requestPreview('Undo');
    return level;
  }

  redo() {
    const level = this.history.redo();
    if (!level || !this.session) return null;
    this.session.level = level;
    this.clearSelection();
    this._callbacks.onLevelChange?.(level);
    this._requestPreview('Redo');
    return level;
  }

  _snap(x, y) {
    if (!this.snapEnabled) return { x: Math.round(x), y: Math.round(y) };
    return { x: snapValue(x, this.gridSize), y: snapValue(y, this.gridSize) };
  }

  _findSelectionAt(x, y) {
    const level = this.session?.level;
    if (!level) return null;
    const gadgetHit = findEntryAt(level.gadgets, this.assets?.gadgetById, x, y);
    if (gadgetHit) return { type: 'gadget', ...gadgetHit };
    const steelHit = findEntryAt(level.steel, null, x, y);
    if (steelHit) return { type: 'steel', ...steelHit };
    const terrainHit = findEntryAt(level.terrains, this.assets?.terrainById, x, y);
    if (terrainHit) return { type: 'terrain', ...terrainHit };
    return null;
  }

  _selectHit(hit, options = {}) {
    if (!hit) {
      if (!options.preserve) this.clearSelection();
      return null;
    }
    if (options.toggle) {
      this._toggleSelection(hit);
      return hit;
    }
    if (options.additive) {
      if (!this._isSelected(hit.type, hit.index)) {
        this.selection = [...this.selection, { type: hit.type, index: hit.index }];
        this._callbacks.onSelectionChange?.(this.getSelectedEntries());
      }
      return hit;
    }
    this._setSelection([hit]);
    return hit;
  }

  _buildHandlePoints(bounds) {
    const midX = bounds.x + Math.round(bounds.width / 2);
    const midY = bounds.y + Math.round(bounds.height / 2);
    return [
      { id: 'nw', x: bounds.x, y: bounds.y },
      { id: 'n', x: midX, y: bounds.y },
      { id: 'ne', x: bounds.x + bounds.width, y: bounds.y },
      { id: 'e', x: bounds.x + bounds.width, y: midY },
      { id: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { id: 's', x: midX, y: bounds.y + bounds.height },
      { id: 'sw', x: bounds.x, y: bounds.y + bounds.height },
      { id: 'w', x: bounds.x, y: midY }
    ];
  }

  _getResizeHandleAt(x, y) {
    if (!this.canResizeSelection()) return null;
    const bounds = this.getSelectionBounds();
    if (!bounds) return null;
    const half = Math.max(1, Math.floor(this.handleSize / 2));
    for (const handle of this._buildHandlePoints(bounds)) {
      if (x >= handle.x - half && x <= handle.x + half
          && y >= handle.y - half && y <= handle.y + half) {
        return handle.id;
      }
    }
    return null;
  }

  _beginMarquee(x, y, additive) {
    this._marquee = { startX: x, startY: y, x, y, additive: !!additive };
    this._callbacks.onMarqueeChange?.(this.getMarqueeBounds());
  }

  _updateMarquee(x, y) {
    if (!this._marquee) return;
    this._marquee.x = x;
    this._marquee.y = y;
    this._callbacks.onMarqueeChange?.(this.getMarqueeBounds());
  }

  _clearMarquee() {
    if (!this._marquee) return;
    this._marquee = null;
    this._callbacks.onMarqueeChange?.(null);
  }

  _applyMarqueeSelection() {
    if (!this._marquee || !this.session?.level) return;
    const bounds = this.getMarqueeBounds();
    const next = this._marquee.additive ? [...this.selection] : [];
    const addSelection = (type, index) => {
      if (next.some(entry => entry.type === type && entry.index === index)) return;
      next.push({ type, index });
    };
    const scan = (entries, metaById, type) => {
      if (!Array.isArray(entries)) return;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const meta = metaById?.get?.(entry?.props?.PIECE);
        const entryBounds = getEntryBounds(entry, meta);
        if (boundsIntersect(bounds, entryBounds)) addSelection(type, i);
      }
    };
    scan(this.session.level.terrains, this.assets?.terrainById, 'terrain');
    scan(this.session.level.gadgets, this.assets?.gadgetById, 'gadget');
    scan(this.session.level.steel, null, 'steel');
    this._setSelection(next);
  }

  _beginStroke() {
    this._strokeChanged = false;
    this._stampSet.clear();
    this._lastBrushPos = null;
  }

  _removeGadgetsById(pieceId) {
    if (!this.session?.level || !Number.isFinite(pieceId)) return;
    const list = this.session.level.gadgets;
    if (!Array.isArray(list)) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (entry?.props?.PIECE === pieceId) {
        list.splice(i, 1);
        this._markChanged();
      }
    }
  }

  _hasGadgetId(pieceId) {
    if (!this.session?.level || !Number.isFinite(pieceId)) return false;
    const list = this.session.level.gadgets;
    if (!Array.isArray(list)) return false;
    return list.some(entry => entry?.props?.PIECE === pieceId);
  }

  _trimGadgetsById(pieceId, maxCount) {
    if (!this.session?.level || !Number.isFinite(pieceId)) return;
    const list = this.session.level.gadgets;
    if (!Array.isArray(list)) return;
    const indices = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i]?.props?.PIECE === pieceId) indices.push(i);
    }
    const excess = indices.length - maxCount;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i++) {
      removeEntryAt(this.session.level, 'gadget', indices[i] - i);
      this._markChanged();
    }
  }

  _markChanged() {
    this._strokeChanged = true;
  }

  _getTerrainMeta(id) {
    const byId = this.assets?.terrainById?.get?.(id);
    if (byId) return byId;
    return this.assets?.terrain?.find?.(entry => entry?.id === id) || null;
  }

  _getGadgetMeta(id) {
    const byId = this.assets?.gadgetById?.get?.(id);
    if (byId) return byId;
    return this.assets?.gadgets?.find?.(entry => entry?.id === id) || null;
  }

  _centerPlacement(x, y, meta) {
    const width = Number(meta?.width || 0);
    const height = Number(meta?.height || 0);
    const offsetX = width > 0 ? Math.floor(width / 2) : 0;
    const offsetY = height > 0 ? Math.floor(height / 2) : 0;
    return {
      x: x - offsetX,
      y: y - offsetY
    };
  }

  _commitHistory(label) {
    this.history.pushSnapshot(this.session?.level, label);
  }

  _requestPreview(label) {
    if (this._previewTimer) return;
    const callback = this._callbacks.onPreviewRequest;
    if (!callback) return;
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      callback(label || 'Update');
    }, this._previewDelay);
  }

  _placeTerrainAt(x, y) {
    if (!this.session?.level) return null;
    const meta = this._getTerrainMeta(this.selectedTerrainId);
    const pos = this._centerPlacement(x, y, meta);
    const entry = createTerrainEntry({
      styleName: this.session.level.getHeader('STYLE'),
      piece: this.selectedTerrainId,
      x: pos.x,
      y: pos.y
    });
    this.session.level.terrains.push(entry);
    this._markChanged();
    return entry;
  }

  _placeGadgetAt(x, y, pieceId) {
    if (!this.session?.level) return null;
    const meta = this._getGadgetMeta(pieceId);
    const pos = this._centerPlacement(x, y, meta);
    const entry = createGadgetEntry({
      styleName: this.session.level.getHeader('STYLE'),
      piece: pieceId,
      x: pos.x,
      y: pos.y
    });
    this.session.level.gadgets.push(entry);
    this._markChanged();
    return entry;
  }

  ensureDefaultEntrancesExits(options = {}) {
    if (!this.session?.level) return false;
    const entranceId = Number.isFinite(options.entranceId)
      ? options.entranceId
      : this.assets?.entranceId;
    const exitId = Number.isFinite(options.exitId)
      ? options.exitId
      : this.assets?.exitId;
    const viewRect = options.viewRect || null;
    const headerWidth = coerceEntryNumber(this.session.level.getHeader?.('WIDTH'), 0);
    const headerHeight = coerceEntryNumber(this.session.level.getHeader?.('HEIGHT'), 0);
    const levelWidth = Number.isFinite(headerWidth) && headerWidth > 0 ? headerWidth : 0;
    const levelHeight = Number.isFinite(headerHeight) && headerHeight > 0 ? headerHeight : 0;
    const hasEntrance = Number.isFinite(entranceId) && this._hasGadgetId(entranceId);
    const hasExit = Number.isFinite(exitId) && this._hasGadgetId(exitId);
    if (hasEntrance && hasExit) return false;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const baseX = viewRect ? viewRect.x : 0;
    const baseY = viewRect ? viewRect.y : 0;
    const viewW = viewRect ? viewRect.w : Math.min(levelWidth, 320);
    const viewH = viewRect ? viewRect.h : Math.min(levelHeight, 160);
    const targetY = clamp(baseY + viewH - 32, 0, Math.max(0, levelHeight - 1));

    if (!hasEntrance && Number.isFinite(entranceId)) {
      const meta = this._getGadgetMeta(entranceId);
      const offset = Math.max(8, Math.floor((meta?.width || 16) / 2));
      const x = clamp(baseX + offset, 0, Math.max(0, levelWidth - 1));
      this._placeGadgetAt(x, targetY, entranceId);
    }
    if (!hasExit && Number.isFinite(exitId)) {
      const meta = this._getGadgetMeta(exitId);
      const offset = Math.max(8, Math.floor((meta?.width || 16) / 2));
      const x = clamp(baseX + viewW - offset, 0, Math.max(0, levelWidth - 1));
      this._placeGadgetAt(x, targetY, exitId);
    }

    this._commitHistory('Defaults');
    this._requestPreview('Defaults');
    return true;
  }

  _placeSteelAt(x, y, width, height) {
    if (!this.session?.level) return null;
    if (!Array.isArray(this.session.level.steel)) {
      this.session.level.steel = [];
    }
    const entry = createSteelEntry({ x, y, width, height });
    this.session.level.steel.push(entry);
    this._markChanged();
    return entry;
  }

  _beginSteelDraft(x, y) {
    const size = Number.isFinite(this.gridSize) && this.gridSize > 0 ? this.gridSize : 1;
    const entry = this._placeSteelAt(x, y, size, size);
    if (!entry) return;
    const list = this.session.level.steel;
    const index = list.length - 1;
    this._setSelection([{ type: 'steel', index }]);
    this._steelDraft = { index, startX: x, startY: y };
    this._requestPreview('Steel');
  }

  _updateSteelDraft(x, y) {
    if (!this._steelDraft || !this.session?.level) return;
    const list = this.session.level.steel;
    const entry = Array.isArray(list) ? list[this._steelDraft.index] : null;
    if (!entry) return;
    const bounds = normalizeBounds(this._steelDraft.startX, this._steelDraft.startY, x, y);
    setEntryProp(entry, 'X', bounds.x, { removeIfEmpty: false });
    setEntryProp(entry, 'Y', bounds.y, { removeIfEmpty: false });
    setEntryProp(entry, 'WIDTH', clampSize(bounds.width), { removeIfEmpty: false });
    setEntryProp(entry, 'HEIGHT', clampSize(bounds.height), { removeIfEmpty: false });
    this._markChanged();
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
    this._requestPreview('Steel');
  }

  _eraseAt(x, y) {
    if (!this.session?.level) return;
    const level = this.session.level;
    const terrainHit = findEntryAt(level.terrains, this.assets?.terrainById, x, y);
    if (terrainHit) {
      removeEntryAt(level, 'terrain', terrainHit.index);
      this._markChanged();
    }
    if (this.eraseGadgets) {
      const gadgetHit = findEntryAt(level.gadgets, this.assets?.gadgetById, x, y);
      if (gadgetHit) {
        removeEntryAt(level, 'gadget', gadgetHit.index);
        this._markChanged();
      }
    }
  }

  _getBrushStep() {
    if (this.snapEnabled && Number.isFinite(this.gridSize) && this.gridSize > 0) {
      return this.gridSize;
    }
    return 1;
  }

  _brushLine(start, end) {
    if (!start || !end) return;
    const step = Math.max(1, this._getBrushStep());
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const segments = Math.max(1, Math.floor(distance / step));
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = Math.round(start.x + dx * t);
      const py = Math.round(start.y + dy * t);
      this._brushAt(px, py);
    }
  }

  _eraseLine(start, end) {
    if (!start || !end) return;
    const step = Math.max(1, this._getBrushStep());
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const segments = Math.max(1, Math.floor(distance / step));
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const px = Math.round(start.x + dx * t);
      const py = Math.round(start.y + dy * t);
      this._eraseAt(px, py);
    }
  }

  _brushAt(x, y) {
    const size = Math.max(1, this.brushSize);
    const key = `${x},${y},${size}`;
    if (this._stampSet.has(key)) return;
    this._stampSet.add(key);
    const half = Math.floor(size / 2);
    const step = this._getBrushStep();
    for (let by = -half; by <= half; by++) {
      for (let bx = -half; bx <= half; bx++) {
        const px = x + bx * step;
        const py = y + by * step;
        this._placeTerrainAt(px, py);
      }
    }
  }

  handlePointerDown(pos, button = 0, options = {}) {
    if (!this.session?.level) return;
    const { x, y } = this._snap(pos.x, pos.y);
    const shiftKey = options.shiftKey === true;
    const altKey = options.altKey === true;
    this._pointerDown = button === 0;
    this._pointerButton = button;
    if (button === 2) {
      this.clearSelection();
      this._clearMarquee();
      return;
    }

    this._beginStroke();

    switch (this.tool) {
    case EditorTools.SELECT: {
      const resizeHandle = !shiftKey ? this._getResizeHandleAt(x, y) : null;
      if (resizeHandle) {
        const selected = this.getSelectedEntry();
        const bounds = this.getSelectionBounds();
        if (selected && bounds) {
          this._resize = {
            handle: resizeHandle,
            type: selected.type,
            index: selected.index,
            bounds
          };
          return;
        }
      }
      const hit = this._findSelectionAt(x, y);
      if (!hit) {
        if (!shiftKey) this.clearSelection();
        this._beginMarquee(x, y, shiftKey);
        return;
      }
      if (shiftKey) {
        this._selectHit(hit, { toggle: true });
        return;
      }
      if (!this._isSelected(hit.type, hit.index)) {
        this._selectHit(hit);
      }
      if (altKey) {
        this._cloneSelection(this.getSelectedEntries(), 0, 0);
      }
      const selectedEntries = this.getSelectedEntries();
      this._drag = {
        entries: selectedEntries.map(entry => ({
          type: entry.type,
          index: entry.index,
          offsetX: x - (entry.entry?.props?.X || 0),
          offsetY: y - (entry.entry?.props?.Y || 0)
        })),
        label: altKey ? 'Duplicate' : 'Move'
      };
      break;
    }
    case EditorTools.TERRAIN:
      this._placeTerrainAt(x, y);
      this._commitHistory('Terrain');
      this._requestPreview('Terrain');
      break;
    case EditorTools.GADGET:
      this._placeGadgetAt(x, y, this.selectedGadgetId);
      this._commitHistory('Gadget');
      this._requestPreview('Gadget');
      break;
    case EditorTools.TRIGGER:
      this._placeGadgetAt(x, y, this.selectedTriggerId ?? this.selectedGadgetId);
      this._commitHistory('Trigger');
      this._requestPreview('Trigger');
      break;
    case EditorTools.ENTRANCE: {
      const entranceId = this.assets?.entranceId ?? 1;
      this._trimGadgetsById(entranceId, MAX_ENTRANCES - 1);
      this._placeGadgetAt(x, y, entranceId);
      this._commitHistory('Entrance');
      this._requestPreview('Entrance');
      break;
    }
    case EditorTools.EXIT: {
      const exitId = this.assets?.exitId ?? this.selectedGadgetId;
      if (Number.isFinite(exitId)) {
        this._trimGadgetsById(exitId, MAX_EXITS - 1);
      }
      this._placeGadgetAt(x, y, exitId);
      this._commitHistory('Exit');
      this._requestPreview('Exit');
      break;
    }
    case EditorTools.STEEL:
      this._beginSteelDraft(x, y);
      break;
    case EditorTools.BRUSH:
      this._brushAt(x, y);
      this._lastBrushPos = { x, y };
      this._requestPreview('Brush');
      break;
    case EditorTools.ERASER:
      this._eraseAt(x, y);
      this._lastBrushPos = { x, y };
      this._requestPreview('Erase');
      break;
    default:
      break;
    }
  }

  handlePointerMove(pos, options = {}) {
    if (!this.session?.level) return;
    const { x, y } = this._snap(pos.x, pos.y);
    const isDown = typeof options.isDown === 'boolean'
      ? options.isDown
      : this._pointerDown;

    if (this._steelDraft && this.tool === EditorTools.STEEL) {
      this._updateSteelDraft(x, y);
      return;
    }

    if (this._resize && this.tool === EditorTools.SELECT) {
      const selected = this.getSelectedEntry();
      if (!selected) return;
      const bounds = this._resize.bounds;
      let left = bounds.x;
      let right = bounds.x + bounds.width;
      let top = bounds.y;
      let bottom = bounds.y + bounds.height;
      const snapCoord = (value) => (
        this.snapEnabled ? snapValue(value, this.gridSize) : Math.round(value)
      );
      const handle = this._resize.handle;
      if (handle.includes('w')) left = snapCoord(x);
      if (handle.includes('e')) right = snapCoord(x);
      if (handle.includes('n')) top = snapCoord(y);
      if (handle.includes('s')) bottom = snapCoord(y);
      if (right <= left) {
        if (handle.includes('w')) left = right - 1;
        else right = left + 1;
      }
      if (bottom <= top) {
        if (handle.includes('n')) top = bottom - 1;
        else bottom = top + 1;
      }
      const width = clampSize(right - left);
      const height = clampSize(bottom - top);
      const entry = selected.entry;
      setEntryProp(entry, 'X', left, { removeIfEmpty: false });
      setEntryProp(entry, 'Y', top, { removeIfEmpty: false });
      setEntryProp(entry, 'WIDTH', width, { removeIfEmpty: false });
      setEntryProp(entry, 'HEIGHT', height, { removeIfEmpty: false });
      this._markChanged();
      this._callbacks.onSelectionChange?.(this.getSelectedEntries());
      this._requestPreview('Resize');
      return;
    }

    if (this._drag && this.tool === EditorTools.SELECT) {
      for (const dragEntry of this._drag.entries || []) {
        const list = this._getListForType(dragEntry.type);
        const entry = list?.[dragEntry.index];
        if (entry) {
          entry.props.X = x - dragEntry.offsetX;
          entry.props.Y = y - dragEntry.offsetY;
          this._markChanged();
        }
      }
      if (this._drag.entries?.length) {
        this._callbacks.onSelectionChange?.(this.getSelectedEntries());
        this._requestPreview('Move');
      }
      return;
    }

    if (isDown && this._marquee && this.tool === EditorTools.SELECT) {
      this._updateMarquee(x, y);
      return;
    }

    if (isDown && this.tool === EditorTools.BRUSH) {
      if (this._lastBrushPos) {
        this._brushLine(this._lastBrushPos, { x, y });
      } else {
        this._brushAt(x, y);
      }
      this._lastBrushPos = { x, y };
      this._requestPreview('Brush');
    }

    if (isDown && this.tool === EditorTools.ERASER) {
      if (this._lastBrushPos) {
        this._eraseLine(this._lastBrushPos, { x, y });
      } else {
        this._eraseAt(x, y);
      }
      this._lastBrushPos = { x, y };
      this._requestPreview('Erase');
    }
  }

  handlePointerUp() {
    this._pointerDown = false;
    this._pointerButton = 0;
    if (!this.session?.level) return;
    this._lastBrushPos = null;
    if (this._steelDraft) {
      this._steelDraft = null;
      if (this._strokeChanged) {
        this._commitHistory('Steel');
      }
      this._strokeChanged = false;
      return;
    }
    if (this._resize) {
      this._resize = null;
      if (this._strokeChanged) {
        this._commitHistory('Resize');
      }
      this._strokeChanged = false;
      return;
    }
    if (this._drag) {
      const label = this._drag.label || 'Move';
      this._drag = null;
      if (this._strokeChanged) {
        this._commitHistory(label);
      }
      this._strokeChanged = false;
      return;
    }
    if (this._marquee) {
      this._applyMarqueeSelection();
      this._clearMarquee();
      return;
    }

    if (this.tool === EditorTools.BRUSH && this._strokeChanged) {
      this._commitHistory('Brush');
    }
    if (this.tool === EditorTools.ERASER && this._strokeChanged) {
      this._commitHistory('Erase');
    }
    this._strokeChanged = false;
  }
}

export { EditorController };

const __test__ = {
  cloneEntry,
  normalizeBounds,
  boundsIntersect
};

export { __test__ };
