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
const editorControllerSelectionMethods = {
  setCallbacks(callbacks = {}) {
    this._callbacks = { ...this._callbacks, ...callbacks };
  },

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
  },

  resetHistory(label = 'Init') {
    this.history.clear();
    this.history.pushSnapshot(this.session?.level, label);
  },

  setTool(tool) {
    if (!tool) return;
    this.tool = tool;
  },

  setSnapEnabled(enabled) {
    this.snapEnabled = !!enabled;
  },

  setBrushSize(size) {
    const value = Number.isFinite(size) ? size : 1;
    this.brushSize = clampBrushSize(value);
  },

  setEraseGadgets(enabled) {
    this.eraseGadgets = !!enabled;
  },

  setSelectedTerrain(id) {
    if (Number.isFinite(id)) this.selectedTerrainId = id;
  },

  setSelectedGadget(id) {
    if (Number.isFinite(id)) this.selectedGadgetId = id;
  },

  setSelectedTrigger(id) {
    if (Number.isFinite(id)) this.selectedTriggerId = id;
  },

  _getListForType(type) {
    if (!this.session?.level) return null;
    if (type === 'gadget') return this.session.level.gadgets;
    if (type === 'steel') return this.session.level.steel;
    return this.session.level.terrains;
  },

  _setSelectionState(list) {
    const normalized = Array.isArray(list) ? list.map((entry) => ({
      type: entry?.type,
      index: entry?.index,
      uid: entry?.uid || null
    })) : [];
    this._selection = normalized;
    this._selectionSet.clear();
    for (const entry of normalized) {
      if (!entry || !entry.type || !Number.isFinite(entry.index)) continue;
      this._selectionSet.add(selectionKey(entry.type, entry.index));
    }
  },

  _invalidateEntryIndexCache(type = null) {
    if (type) {
      const cache = this._entryIndexCache[type];
      if (!cache) return;
      cache.list = null;
      cache.size = -1;
      cache.map.clear();
      return;
    }
    for (const cache of Object.values(this._entryIndexCache)) {
      cache.list = null;
      cache.size = -1;
      cache.map.clear();
    }
  },

  _getEntryIndexByUid(type, uid, list) {
    if (!uid || !Array.isArray(list)) return -1;
    const cache = this._entryIndexCache[type];
    if (!cache) return -1;
    if (cache.list !== list || cache.size !== list.length) {
      cache.list = list;
      cache.size = list.length;
      cache.map = new Map();
      for (let index = 0; index < list.length; index += 1) {
        const entryUid = list[index]?.uid;
        if (entryUid) {
          cache.map.set(entryUid, index);
        }
      }
    }
    return cache.map.get(uid) ?? -1;
  },

  _resolveSelectionEntry(selected) {
    const list = this._getListForType(selected?.type);
    if (!Array.isArray(list)) return null;
    const currentIndex = Number.isFinite(selected?.index) ? selected.index : -1;
    const currentEntry = currentIndex >= 0 ? list[currentIndex] : null;
    if (currentEntry && (!selected.uid || selected.uid === currentEntry.uid)) {
      if (!selected.uid && currentEntry.uid) {
        selected.uid = currentEntry.uid;
      }
      return { index: currentIndex, entry: currentEntry };
    }
    if (selected?.uid) {
      const nextIndex = this._getEntryIndexByUid(selected.type, selected.uid, list);
      if (nextIndex >= 0) {
        const nextEntry = list[nextIndex];
        if (nextEntry) {
          if (currentIndex !== nextIndex && Number.isFinite(currentIndex)) {
            this._selectionSet.delete(selectionKey(selected.type, currentIndex));
            this._selectionSet.add(selectionKey(selected.type, nextIndex));
          }
          selected.index = nextIndex;
          return { index: nextIndex, entry: nextEntry };
        }
      }
    }
    if (currentEntry?.uid) {
      selected.uid = currentEntry.uid;
      return { index: currentIndex, entry: currentEntry };
    }
    return null;
  },

  getSelectedEntries() {
    if (!this.session?.level || !Array.isArray(this.selection)) return [];
    const results = [];
    for (const selected of this.selection) {
      const resolved = this._resolveSelectionEntry(selected);
      if (!resolved?.entry) continue;
      results.push({
        type: selected.type,
        index: resolved.index,
        uid: selected.uid || resolved.entry.uid || null,
        entry: resolved.entry
      });
    }
    return results;
  },

  getSelectedEntry() {
    const entries = this.getSelectedEntries();
    if (entries.length !== 1) return null;
    return entries[0];
  },

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
  },

  getMarqueeBounds() {
    if (!this._marquee) return null;
    return normalizeBounds(
      this._marquee.startX,
      this._marquee.startY,
      this._marquee.x,
      this._marquee.y
    );
  },

  getHandleSize() {
    return this.handleSize;
  },

  canResizeSelection() {
    if (!Array.isArray(this.selection) || this.selection.length !== 1) return false;
    return this.selection[0].type === 'steel';
  },

  clearSelection() {
    this.selection = [];
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
  },

  _setSelection(list) {
    this.selection = Array.isArray(list) ? list.map(entry => ({
      type: entry.type,
      index: entry.index,
      uid: entry?.uid || entry?.entry?.uid || this._getListForType(entry.type)?.[entry.index]?.uid || null
    })) : [];
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
  },

  _isSelected(type, index) {
    return this._selectionSet.has(selectionKey(type, index));
  },

  _toggleSelection(hit) {
    if (!hit) return;
    if (this._isSelected(hit.type, hit.index)) {
      this.selection = this.selection.filter(entry => !(entry.type === hit.type && entry.index === hit.index));
    } else {
      this.selection = [...this.selection, {
        type: hit.type,
        index: hit.index,
        uid: hit?.entry?.uid || null
      }];
    }
    this._callbacks.onSelectionChange?.(this.getSelectedEntries());
  },

  updateHeader(key, value) {
    if (!this.session?.level) return;
    this.session.level.setHeader(key, value);
    this._callbacks.onLevelChange?.(this.session.level);
    this._requestPreview('Header');
  },

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
};
export { editorControllerSelectionMethods };