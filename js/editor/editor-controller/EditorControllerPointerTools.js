import {
  MAX_ENTRANCES,
  MAX_EXITS,
  MAX_MIDI_FLAG_ID,
  clampMidiFlagId,
  clampSize,
  coerceEntryNumber,
  createGadgetEntry,
  createSteelEntry,
  createTerrainEntry,
  findEntryAt,
  isMidiFlagEnabled,
  normalizeBounds,
  removeEntryAt,
  setEntryProp
} from './EditorControllerShared.js';

const editorControllerPointerToolMethods = {
  _beginStroke() {
    this._strokeChanged = false;
    this._stampSet.clear();
    this._lastBrushPos = null;
  },

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
  },

  _hasGadgetId(pieceId) {
    if (!this.session?.level || !Number.isFinite(pieceId)) return false;
    const list = this.session.level.gadgets;
    if (!Array.isArray(list)) return false;
    return list.some(entry => entry?.props?.PIECE === pieceId);
  },

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
  },

  _markChanged() {
    this._strokeChanged = true;
    this._invalidateEntryIndexCache();
  },

  _getTerrainMeta(id) {
    const byId = this.assets?.terrainById?.get?.(id);
    if (byId) return byId;
    return this.assets?.terrain?.find?.(entry => entry?.id === id) || null;
  },

  _getGadgetMeta(id) {
    const byId = this.assets?.gadgetById?.get?.(id);
    if (byId) return byId;
    return this.assets?.gadgets?.find?.(entry => entry?.id === id) || null;
  },

  _centerPlacement(x, y, meta) {
    const width = Number(meta?.width || 0);
    const height = Number(meta?.height || 0);
    const offsetX = width > 0 ? Math.floor(width / 2) : 0;
    const offsetY = height > 0 ? Math.floor(height / 2) : 0;
    return {
      x: x - offsetX,
      y: y - offsetY
    };
  },

  _commitHistory(label) {
    this.history.pushSnapshot(this.session?.level, label);
  },

  beginHistoryTransaction(label = 'Batch') {
    this.history?.beginTransaction?.(label);
  },

  endHistoryTransaction(label = '') {
    return this.history?.endTransaction?.(label) || false;
  },

  runHistoryTransaction(label, callback) {
    if (typeof callback !== 'function') return false;
    const history = this.history;
    const supportsTransactions = !!(
      history
        && typeof history.beginTransaction === 'function'
        && typeof history.endTransaction === 'function'
    );
    if (!supportsTransactions) {
      return callback();
    }
    history.beginTransaction(label);
    try {
      const result = callback();
      history.endTransaction(label);
      return result;
    } catch (error) {
      if (typeof history.cancelTransaction === 'function') {
        history.cancelTransaction();
      } else {
        history.endTransaction(label);
      }
      throw error;
    }
  },

  dispose() {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
    this._callbacks = {
      onSelectionChange: null,
      onLevelChange: null,
      onPreviewRequest: null,
      onMarqueeChange: null
    };
    this._drag = null;
    this._resize = null;
    this._marquee = null;
    this._steelDraft = null;
    this._pointerDown = false;
    this._stampSet.clear();
  },

  _requestPreview(label) {
    if (this._previewTimer) return;
    const callback = this._callbacks.onPreviewRequest;
    if (!callback) return;
    const nextLabel = label || 'Update';
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      this._callbacks.onPreviewRequest?.(nextLabel);
    }, this._previewDelay);
  },

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
  },

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
  },

  _nextMidiFlagId() {
    const list = this.session?.level?.gadgets;
    if (!Array.isArray(list) || !list.length) return 1;
    const used = new Set();
    for (const entry of list) {
      if (!isMidiFlagEnabled(entry?.props?.MIDI_FLAG)) continue;
      const id = clampMidiFlagId(Number(entry?.props?.MIDI_FLAG_ID));
      if (id !== null) used.add(id);
    }
    for (let id = 1; id <= MAX_MIDI_FLAG_ID; id += 1) {
      if (!used.has(id)) return id;
    }
    return MAX_MIDI_FLAG_ID;
  },

  _placeMidiFlagAt(x, y) {
    if (!this.session?.level) return null;
    const pieceId = Number.isFinite(this.selectedTriggerId)
      ? this.selectedTriggerId
      : this.selectedGadgetId;
    if (!Number.isFinite(pieceId)) return null;
    const entry = this._placeGadgetAt(x, y, pieceId);
    if (!entry?.props) return null;
    setEntryProp(entry, 'MIDI_FLAG', true, { removeIfFalse: true });
    if (clampMidiFlagId(Number(entry.props.MIDI_FLAG_ID)) === null) {
      setEntryProp(entry, 'MIDI_FLAG_ID', this._nextMidiFlagId(), { removeIfEmpty: false });
    }
    return entry;
  },

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
  },

  _placeSteelAt(x, y, width, height) {
    if (!this.session?.level) return null;
    if (!Array.isArray(this.session.level.steel)) {
      this.session.level.steel = [];
    }
    const entry = createSteelEntry({ x, y, width, height });
    this.session.level.steel.push(entry);
    this._markChanged();
    return entry;
  },

  _beginSteelDraft(x, y) {
    const size = Number.isFinite(this.gridSize) && this.gridSize > 0 ? this.gridSize : 1;
    const entry = this._placeSteelAt(x, y, size, size);
    if (!entry) return;
    const list = this.session.level.steel;
    const index = list.length - 1;
    this._setSelection([{ type: 'steel', index }]);
    this._steelDraft = { index, startX: x, startY: y };
    this._requestPreview('Steel');
  },

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
  },

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
  },

  _getBrushStep() {
    if (this.snapEnabled && Number.isFinite(this.gridSize) && this.gridSize > 0) {
      return this.gridSize;
    }
    return 1;
  },

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
  },

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
  },

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
};

export { editorControllerPointerToolMethods };
