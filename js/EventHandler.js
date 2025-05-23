import { Lemmings } from './LemmingsNamespace.js';

class EventHandler {
  constructor () {
    this.handlers = [];
  }

  // Register a callback (idempotent)
  on (handler) {
    if (typeof handler === 'function' && !this.handlers.includes(handler)) {
      this.handlers.push(handler);
    }
  }

  // Deregister a callback
  off (handler) {
    const arr = this.handlers;
    for (let i = arr.length - 1; i >= 0; --i) {
      if (arr[i] === handler) {
        arr.splice(i, 1);
        break;
      }
    }
  }

  // Remove all callbacks
  dispose () {
    this.handlers.length = 0;
  }

  // Run every handler with `arg`.  No `.slice()` → no transient allocations
  trigger (arg) {
    // snapshot length once to tolerate `off` during iteration without skipping
    const len = this.handlers.length;
    for (let i = 0; i < len; ++i) {
      this.handlers[i](arg);
    }
  }
}

Lemmings.EventHandler = EventHandler;
export { EventHandler };