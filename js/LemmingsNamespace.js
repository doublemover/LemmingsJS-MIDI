import * as Exports from './exports.js';
import { getDependency, setDependency, clearDependency } from './core/dependencies.js';

const defaults = { ...Exports };
const defaultKeys = new Set(Object.keys(defaults));

let lemmingsProxy;
lemmingsProxy = new Proxy(defaults, {
  get(target, prop) {
    if (prop === Symbol.toStringTag) return 'Lemmings';
    if (prop in target) {
      return getDependency(String(prop), target[prop]);
    }
    const globalLemmings = typeof globalThis !== 'undefined' ? globalThis.lemmings : null;
    if (globalLemmings && globalLemmings !== lemmingsProxy) {
      return globalLemmings[prop];
    }
    return target[prop];
  },
  set(target, prop, value) {
    const key = String(prop);
    if (!defaultKeys.has(key)) {
      target[prop] = value;
    }
    setDependency(key, value);
    return true;
  },
  deleteProperty(target, prop) {
    const key = String(prop);
    clearDependency(key);
    if (!defaultKeys.has(key)) {
      delete target[prop];
    }
    return true;
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target) {
      return { enumerable: true, configurable: true };
    }
    return Object.getOwnPropertyDescriptor(target, prop);
  }
});

const Lemmings = lemmingsProxy;
export { Lemmings };
