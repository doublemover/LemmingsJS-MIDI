import { Lemmings } from './LemmingsNamespace.js';

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

  // Run every handler with `arg`.  No `.slice()` → no transient allocations
  trigger (arg) {
    // snapshot length once to tolerate `off` during iteration without skipping
    for (const handler of this.handlers) {
      handler(arg);
    }
  }
}

Lemmings.EventHandler = EventHandler;
export { EventHandler };