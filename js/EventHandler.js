import { Lemmings } from './LemmingsNamespace.js';

class EventHandler {
        constructor() {
            this.handlers = [];
        }
        on(handler) {
            this.handlers.push(handler);
        }
        off(handler) {
            this.handlers = this.handlers.filter(h => h !== handler);
        }
        /// clear all callbacks
        dispose() {
            this.handlers = [];
        }
        /// raise all 
        trigger(arg) {
            this.handlers.slice(0).forEach(h => h(arg));
        }
    }
    Lemmings.EventHandler = EventHandler;

export { EventHandler };
