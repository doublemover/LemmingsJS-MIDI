class EventHandler {
  constructor () {
    this.handlers = new Set();
    this._snapshot = [];
    this._snapshotDirty = true;
  }

  // Register a callback (idempotent)
  on (handler) {
    if (typeof handler === 'function' && !this.handlers.has(handler)) {
      this.handlers.add(handler);
      this._snapshotDirty = true;
    }
  }

  // Deregister a callback
  off (handler) {
    if (this.handlers.delete(handler)) {
      this._snapshotDirty = true;
    }
  }

  // Remove all callbacks
  dispose () {
    if (this.handlers.size) {
      this.handlers.clear();
      this._snapshotDirty = true;
    }
    this._snapshot.length = 0;
  }

  // Run a stable snapshot; mutations during dispatch affect the next trigger.
  trigger (arg) {
    if (this._snapshotDirty) {
      this._snapshot = Array.from(this.handlers);
      this._snapshotDirty = false;
    }
    const snapshot = this._snapshot;
    for (const handler of snapshot) {
      handler(arg);
    }
  }
}
export { EventHandler };
