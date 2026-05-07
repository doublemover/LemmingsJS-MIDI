import {
  EditorTools,
  MAX_ENTRANCES,
  MAX_EXITS,
  clampSize,
  setEntryProp,
  snapValue
} from './EditorControllerShared.js';

const editorControllerPointerInputMethods = {
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

export { editorControllerPointerInputMethods };
