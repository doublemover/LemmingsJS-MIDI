import {
  boundsIntersect,
  findEntryAt,
  getEntryBounds,
  snapValue
} from './EditorControllerShared.js';

const editorControllerPointerSelectionMethods = {
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
  }
};

export { editorControllerPointerSelectionMethods };
