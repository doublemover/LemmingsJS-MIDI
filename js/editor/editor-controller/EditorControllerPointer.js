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
const editorControllerPointerMethods = {
  undo() {
    const level = this.history.undo();
    if (!level || !this.session) return null;
    this.session.level = level;
    this._invalidateEntryIndexCache();
    this.clearSelection();
    this._callbacks.onLevelChange?.(level);
    this._requestPreview('Undo');
    return level;
  },

  redo() {
    const level = this.history.redo();
    if (!level || !this.session) return null;
    this.session.level = level;
    this._invalidateEntryIndexCache();
    this.clearSelection();
    this._callbacks.onLevelChange?.(level);
    this._requestPreview('Redo');
    return level;
  },

  _snap(x, y) {
    if (!this.snapEnabled) return { x: Math.round(x), y: Math.round(y) };
    return { x: snapValue(x, this.gridSize), y: snapValue(y, this.gridSize) };
  },

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
  },

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
        this.selection = [...this.selection, {
          type: hit.type,
          index: hit.index,
          uid: hit?.entry?.uid || null
        }];
        this._callbacks.onSelectionChange?.(this.getSelectedEntries());
      }
      return hit;
    }
    this._setSelection([hit]);
    return hit;
  },

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
  },

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
  },

  _beginMarquee(x, y, additive) {
    this._marquee = { startX: x, startY: y, x, y, additive: !!additive };
    this._callbacks.onMarqueeChange?.(this.getMarqueeBounds());
  },

  _updateMarquee(x, y) {
    if (!this._marquee) return;
    this._marquee.x = x;
    this._marquee.y = y;
    this._callbacks.onMarqueeChange?.(this.getMarqueeBounds());
  },

  _clearMarquee() {
    if (!this._marquee) return;
    this._marquee = null;
    this._callbacks.onMarqueeChange?.(null);
  },

  _applyMarqueeSelection() {
    if (!this._marquee || !this.session?.level) return;
    const bounds = this.getMarqueeBounds();
    const next = this._marquee.additive ? [...this.selection] : [];
    const addSelection = (type, index, uid = null) => {
      if (next.some(entry => entry.type === type && entry.index === index)) return;
      next.push({ type, index, uid });
    };
    const scan = (entries, metaById, type) => {
      if (!Array.isArray(entries)) return;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const meta = metaById?.get?.(entry?.props?.PIECE);
        const entryBounds = getEntryBounds(entry, meta);
        if (boundsIntersect(bounds, entryBounds)) addSelection(type, i, entry?.uid || null);
      }
    };
    scan(this.session.level.terrains, this.assets?.terrainById, 'terrain');
    scan(this.session.level.gadgets, this.assets?.gadgetById, 'gadget');
    scan(this.session.level.steel, null, 'steel');
    this._setSelection(next);
  },

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
  },

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
    case EditorTools.MIDI_FLAG:
      this._placeMidiFlagAt(x, y);
      this._commitHistory('MIDI Flag');
      this._requestPreview('MIDI Flag');
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
  },

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
  },

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
};
export { editorControllerPointerMethods };