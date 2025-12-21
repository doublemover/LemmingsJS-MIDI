const overrides = new Map();

function setDependency(key, value) {
  if (!key) return;
  overrides.set(key, value);
}

function getDependency(key, fallback) {
  if (!key) return fallback;
  return overrides.has(key) ? overrides.get(key) : fallback;
}

function clearDependency(key) {
  if (!key) return;
  overrides.delete(key);
}

function resetDependencies() {
  overrides.clear();
}

export {
  setDependency,
  getDependency,
  clearDependency,
  resetDependencies
};
