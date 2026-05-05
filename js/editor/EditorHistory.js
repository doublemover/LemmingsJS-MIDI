import { NxlvParser } from './NxlvParser.js';
import { NxlvWriter } from './NxlvWriter.js';
import { EditorLevel } from './EditorLevel.js';

class EditorHistory {
  constructor(options = {}) {
    this.maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 100;
    this.maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? Math.floor(options.maxBytes)
      : Infinity;
    this.coalesceWindowMs = Number.isFinite(options.coalesceWindowMs) && options.coalesceWindowMs > 0
      ? Math.floor(options.coalesceWindowMs)
      : 0;
    this.parser = options.parser || new NxlvParser();
    this.writer = options.writer || new NxlvWriter();
    this._entries = [];
    this._cursor = -1;
    this._totalBytes = 0;
    this._transactionDepth = 0;
    this._transactionPending = null;
  }

  clear() {
    this._entries = [];
    this._cursor = -1;
    this._totalBytes = 0;
    this._transactionDepth = 0;
    this._transactionPending = null;
  }

  get entries() {
    return this._entries.slice();
  }

  get cursor() {
    return this._cursor;
  }

  getStats() {
    const pendingText = this._transactionPending?.changed
      ? this._transactionPending.text
      : null;
    return {
      entries: this._entries.length,
      cursor: this._cursor,
      bytes: this._totalBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      transactionDepth: this._transactionDepth,
      pendingBytes: typeof pendingText === 'string' ? this._estimateBytes(pendingText) : 0
    };
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

  _estimateBytes(text) {
    return typeof text === 'string' ? text.length * 2 : 0;
  }

  _removeEntries(start, deleteCount) {
    if (deleteCount <= 0) return [];
    const removed = this._entries.splice(start, deleteCount);
    for (const entry of removed) {
      this._totalBytes -= entry?.bytes || 0;
    }
    this._totalBytes = Math.max(0, this._totalBytes);
    return removed;
  }

  _truncateRedoEntries() {
    if (this._cursor >= this._entries.length - 1) return;
    this._removeEntries(this._cursor + 1, this._entries.length - this._cursor - 1);
  }

  _trimToLimits() {
    while (
      this._entries.length > 1
      && (
        this._entries.length > this.maxEntries
        || this._totalBytes > this.maxBytes
      )
    ) {
      this._removeEntries(0, 1);
      this._cursor -= 1;
    }
    if (this._entries.length === 0) {
      this._cursor = -1;
    } else {
      this._cursor = Math.min(Math.max(this._cursor, 0), this._entries.length - 1);
    }
  }

  _canCoalesce(label, time) {
    if (!this.coalesceWindowMs || this._cursor < 0) return false;
    const prev = this._entries[this._cursor];
    if (!prev || prev.label !== label) return false;
    return Math.abs(time - prev.time) <= this.coalesceWindowMs;
  }

  _pushSerialized(text, label = '', time = Date.now()) {
    const prev = this._entries[this._cursor]?.text;
    if (prev === text) return false;
    this._truncateRedoEntries();
    const bytes = this._estimateBytes(text);
    if (this._canCoalesce(label, time)) {
      const entry = this._entries[this._cursor];
      this._totalBytes += bytes - (entry.bytes || 0);
      entry.text = text;
      entry.label = label;
      entry.time = time;
      entry.bytes = bytes;
    } else {
      this._entries.push({ text, label, time, bytes });
      this._totalBytes += bytes;
      this._cursor = this._entries.length - 1;
    }
    this._trimToLimits();
    return true;
  }

  beginTransaction(label = 'Batch') {
    this._transactionDepth += 1;
    if (this._transactionDepth === 1) {
      this._transactionPending = {
        text: null,
        label: label || 'Batch',
        time: Date.now(),
        changed: false
      };
    } else if (label) {
      this._transactionPending.label = label;
    }
  }

  endTransaction(label = '') {
    if (this._transactionDepth <= 0) return false;
    if (label && this._transactionPending) {
      this._transactionPending.label = label;
    }
    this._transactionDepth -= 1;
    if (this._transactionDepth > 0) return false;
    const pending = this._transactionPending;
    this._transactionPending = null;
    if (!pending?.changed || typeof pending.text !== 'string') return false;
    return this._pushSerialized(
      pending.text,
      pending.label || label || 'Batch',
      pending.time
    );
  }

  cancelTransaction() {
    if (this._transactionDepth <= 0 && !this._transactionPending) return false;
    this._transactionDepth = 0;
    this._transactionPending = null;
    return true;
  }

  /**
   * Queue snapshots as a single undo unit until `endTransaction` is called.
   * Nested transactions are supported and only commit at the outer boundary.
   */
  pushSnapshot(level, label = '') {
    const text = this._serialize(level);
    if (this._transactionDepth > 0) {
      if (!this._transactionPending) {
        this._transactionPending = {
          text: null,
          label: label || 'Batch',
          time: Date.now(),
          changed: false
        };
      }
      const baseText = this._transactionPending.changed
        ? this._transactionPending.text
        : this._entries[this._cursor]?.text;
      if (baseText === text) return false;
      this._transactionPending.text = text;
      this._transactionPending.time = Date.now();
      this._transactionPending.changed = true;
      if (label) {
        this._transactionPending.label = label;
      }
      return true;
    }
    return this._pushSerialized(text, label, Date.now());
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
