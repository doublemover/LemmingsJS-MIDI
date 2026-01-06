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

const setGlobalLemmings = (value) => {
  const prev = globalThis.lemmings;
  globalThis.lemmings = value;
  return () => {
    if (prev === undefined) {
      delete globalThis.lemmings;
    } else {
      globalThis.lemmings = prev;
    }
  };
};

const withLemmingsGame = (game, extra = {}) => (
  setGlobalLemmings({ ...extra, game })
);

const withGlobalLemmings = (value, fn) => {
  const restore = setGlobalLemmings(value);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
};

const withMissingGlobalLemmings = (fn) => {
  const hadProp = Object.prototype.hasOwnProperty.call(globalThis, 'lemmings');
  const prev = globalThis.lemmings;
  delete globalThis.lemmings;
  const restore = () => {
    if (hadProp) {
      globalThis.lemmings = prev;
    } else {
      delete globalThis.lemmings;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
};

const withShowDebug = (value, fn) => {
  const game = globalThis.lemmings?.game;
  if (!game) {
    throw new Error('globalThis.lemmings.game is required for withShowDebug');
  }
  const hadProp = Object.prototype.hasOwnProperty.call(game, 'showDebug');
  const prev = game.showDebug;
  game.showDebug = value;
  const restore = () => {
    if (hadProp) {
      game.showDebug = prev;
    } else {
      delete game.showDebug;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
};

const useGlobalLemmings = (value) => {
  let restore;
  beforeEach(() => {
    const resolved = typeof value === 'function' ? value() : value;
    restore = setGlobalLemmings(resolved);
  });
  afterEach(() => {
    restore();
  });
};

export {
  setGlobalLemmings,
  withGlobalLemmings,
  withLemmingsGame,
  withMissingGlobalLemmings,
  withShowDebug,
  useGlobalLemmings
};
