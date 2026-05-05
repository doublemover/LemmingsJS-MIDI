class EventHandler {
  constructor () {
    this.handlers = new Set();
  }

  // Register a callback (idempotent)
  on (handler) {
    if (typeof handler === 'function' && !this.handlers.has(handler)) {
      this.handlers.add(handler);
    }
  }

  // Deregister a callback
  off (handler) {
    this.handlers.delete(handler);
  }

  // Remove all callbacks
  dispose () {
    this.handlers.clear();
  }

  // Run a stable snapshot; mutations during dispatch affect the next trigger.
  trigger (arg) {
    const snapshot = Array.from(this.handlers);
    for (const handler of snapshot) {
      handler(arg);
    }
  }
}
export { EventHandler };
