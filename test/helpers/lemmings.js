import * as Exports from '../../js/exports.js';
import {
  getDependency,
  setDependency,
  clearDependency,
  resetDependencies
} from '../../js/core/dependencies.js';

const defaults = { ...Exports };
const defaultKeys = new Set(Object.keys(defaults));

const Lemmings = new Proxy(defaults, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) {
      return getDependency(prop, target[prop]);
    }
    return target[prop];
  },
  set(target, prop, value) {
    if (typeof prop === 'string') {
      setDependency(prop, value);
      if (!defaultKeys.has(prop)) target[prop] = value;
      return true;
    }
    target[prop] = value;
    return true;
  },
  deleteProperty(target, prop) {
    if (typeof prop === 'string') {
      clearDependency(prop);
      if (!defaultKeys.has(prop)) delete target[prop];
      return true;
    }
    delete target[prop];
    return true;
  }
});

export { Lemmings, setDependency, clearDependency, resetDependencies };
