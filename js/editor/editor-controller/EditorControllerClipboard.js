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
const editorControllerClipboardMethods = {
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
  },

  _getPasteStep() {
    if (this.snapEnabled && Number.isFinite(this.gridSize) && this.gridSize > 0) {
      return this.gridSize;
    }
    return 1;
  },

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
  },

  pasteSelection(options = {}) {
    if (!this.session?.level || !this._clipboard?.items?.length) return false;
    const historyLabel = typeof options.historyLabel === 'string'
      ? options.historyLabel
      : 'Paste';
    const previewLabel = typeof options.previewLabel === 'string'
      ? options.previewLabel
      : 'Paste';
    const commitHistory = options.commitHistory !== false;
    const requestPreview = options.requestPreview !== false;
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
    if (commitHistory) {
      this._commitHistory(historyLabel);
    }
    if (requestPreview) {
      this._requestPreview(previewLabel);
    }
    return true;
  },

  duplicateSelection() {
    const copied = this.copySelection();
    if (!copied) return false;
    const pasted = this.runHistoryTransaction('Duplicate', () => this.pasteSelection({
      historyLabel: 'Duplicate',
      previewLabel: 'Duplicate',
      commitHistory: true,
      requestPreview: false
    }));
    if (pasted) {
      this._requestPreview('Duplicate');
    }
    return pasted;
  },

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
  },

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
  },

  _getEntryMetaForType(type, entry) {
    if (type === 'gadget') {
      return this.assets?.gadgetById?.get?.(entry?.props?.PIECE) || null;
    }
    if (type === 'terrain') {
      return this.assets?.terrainById?.get?.(entry?.props?.PIECE) || null;
    }
    return null;
  },

  _getPieceMetaByType(type) {
    if (type === 'gadget') {
      return this.assets?.gadgetById || null;
    }
    if (type === 'terrain') {
      return this.assets?.terrainById || null;
    }
    return null;
  },

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
  },

  alignSelection(axis = 'x', anchor = 'min') {
    return this.runHistoryTransaction('Align', () => {
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
    });
  },

  distributeSelection(axis = 'x') {
    return this.runHistoryTransaction('Distribute', () => {
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
    });
  },

  replaceSelectionPiece(pieceId, type = null) {
    return this.runHistoryTransaction('Replace', () => {
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
    });
  },

  randomizeSelectionPieces(pieceIds = [], options = {}) {
    return this.runHistoryTransaction('Randomize', () => {
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
    });
  },

  transformSelectionGroup({ scaleX = 1, scaleY = 1 } = {}) {
    return this.runHistoryTransaction('Transform', () => {
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
    });
  },

  deleteSelected() {
    return this.runHistoryTransaction('Delete', () => {
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
      this._invalidateEntryIndexCache();
      this.selection = [];
      this._callbacks.onSelectionChange?.(this.getSelectedEntries());
      this._commitHistory('Delete');
      this._requestPreview('Delete');
      return true;
    });
  },

  _reorderSelection(mode) {
    return this.runHistoryTransaction('Reorder', () => {
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
      this._invalidateEntryIndexCache();
      this._setSelection(nextSelection);
      this._commitHistory('Reorder');
      this._requestPreview('Reorder');
      return true;
    });
  },

  bringSelectionToFront() {
    return this._reorderSelection('front');
  },

  sendSelectionToBack() {
    return this._reorderSelection('back');
  },

  moveSelectionForward() {
    return this._reorderSelection('forward');
  },

  moveSelectionBackward() {
    return this._reorderSelection('backward');
  }
};
export { editorControllerClipboardMethods };