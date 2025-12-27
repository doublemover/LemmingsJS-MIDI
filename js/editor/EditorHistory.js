import { NxlvParser } from './NxlvParser.js';
import { NxlvWriter } from './NxlvWriter.js';
import { EditorLevel } from './EditorLevel.js';

class EditorHistory {
  constructor(options = {}) {
    this.maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 100;
    this.parser = options.parser || new NxlvParser();
    this.writer = options.writer || new NxlvWriter();
    this._entries = [];
    this._cursor = -1;
  }

  clear() {
    this._entries = [];
    this._cursor = -1;
  }

  get entries() {
    return this._entries.slice();
  }

  get cursor() {
    return this._cursor;
  }

  canUndo() {
    return this._cursor > 0;
  }

  canRedo() {
    return this._cursor >= 0 && this._cursor < this._entries.length - 1;
  }

  _serialize(level) {
    return this.writer.write(level || new EditorLevel());
  }

  pushSnapshot(level, label = '') {
    const text = this._serialize(level);
    const prev = this._entries[this._cursor]?.text;
    if (prev === text) return false;
    if (this._cursor < this._entries.length - 1) {
      this._entries = this._entries.slice(0, this._cursor + 1);
    }
    this._entries.push({ text, label, time: Date.now() });
    if (this._entries.length > this.maxEntries) {
      const overflow = this._entries.length - this.maxEntries;
      this._entries.splice(0, overflow);
      this._cursor = this._entries.length - 1;
    } else {
      this._cursor = this._entries.length - 1;
    }
    return true;
  }

  _applySnapshot(index) {
    if (index < 0 || index >= this._entries.length) return null;
    this._cursor = index;
    return this.parser.parse(this._entries[index].text);
  }

  undo() {
    if (!this.canUndo()) return null;
    return this._applySnapshot(this._cursor - 1);
  }

  redo() {
    if (!this.canRedo()) return null;
    return this._applySnapshot(this._cursor + 1);
  }
}

export { EditorHistory };
