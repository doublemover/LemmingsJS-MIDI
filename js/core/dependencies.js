const overrides = new Map();
let appContext = null;

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

function setAppContext(app) {
  appContext = app || null;
}

function getAppContext() {
  return appContext;
}

function clearAppContext(expectedApp = null) {
  if (!expectedApp || expectedApp === appContext) {
    appContext = null;
  }
}

export {
  setDependency,
  getDependency,
  clearDependency,
  resetDependencies,
  setAppContext,
  getAppContext,
  clearAppContext
};
