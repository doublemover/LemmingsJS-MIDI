const overrides = new Map();
let appContext = null;
let runtimeContext = null;

const RUNTIME_GLOBAL_KEY_ALIASES = Object.freeze({
  bootNoAutoStart: '__LEMMINGS_BOOT_NO_AUTO_START__',
  webMidi: 'WebMidi',
  localStorage: 'localStorage',
  history: 'history',
  window: 'window',
  document: 'document',
  navigator: 'navigator',
  location: 'location',
  caches: 'caches',
  performance: 'performance',
  analyticsDisabled: '__LEMMINGS_ANALYTICS_DISABLED__',
  analyticsHardDisabled: '__LEMMINGS_ANALYTICS_HARD_DISABLED__',
  analyticsBeaconEnabled: '__LEMMINGS_ANALYTICS_BEACON_ENABLED__',
  analyticsBeaconEndpoint: '__LEMMINGS_ANALYTICS_BEACON_ENDPOINT__',
  analyticsSampleRate: '__LEMMINGS_ANALYTICS_SAMPLE_RATE__',
  rolloutFlags: '__LEMMINGS_ROLLOUT_FLAGS__'
});

const readGlobalValue = (key) => {
  if (!key || typeof globalThis === 'undefined') return undefined;
  const globalKey = RUNTIME_GLOBAL_KEY_ALIASES[key] || key;
  if (!Object.prototype.hasOwnProperty.call(globalThis, globalKey)) {
    return undefined;
  }
  return globalThis[globalKey];
};

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

function setRuntimeContext(context = {}) {
  const next = context && typeof context === 'object' ? context : {};
  runtimeContext = {
    ...(runtimeContext || {}),
    ...next
  };
  return { ...runtimeContext };
}

function clearRuntimeContext() {
  runtimeContext = null;
}

function getRuntimeContext() {
  return runtimeContext ? { ...runtimeContext } : null;
}

function getRuntimeDependency(key, fallback = null) {
  if (!key) return fallback;
  if (runtimeContext && Object.prototype.hasOwnProperty.call(runtimeContext, key)) {
    const value = runtimeContext[key];
    return value === undefined ? fallback : value;
  }
  const globalValue = readGlobalValue(key);
  if (globalValue !== undefined) {
    return globalValue;
  }
  return fallback;
}

export {
  setDependency,
  getDependency,
  clearDependency,
  resetDependencies,
  setAppContext,
  getAppContext,
  clearAppContext,
  setRuntimeContext,
  clearRuntimeContext,
  getRuntimeContext,
  getRuntimeDependency
};
