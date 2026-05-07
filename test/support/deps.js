import { Lemmings, setDependency } from '../helpers/lemmings.js';

const applyDependencyOverrides = (overrides = {}) => {
  const entries = Object.entries(overrides || {});
  const originals = new Map();
  for (const [key, value] of entries) {
    originals.set(key, Lemmings[key]);
    setDependency(key, value);
  }
  return () => {
    for (const [key, original] of originals.entries()) {
      setDependency(key, original);
    }
  };
};

export { applyDependencyOverrides };
