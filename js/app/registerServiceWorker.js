import { appendRevisionParam, resolveRuntimeRevision } from '../core/cacheBust.js';
import { getRuntimeDependency } from '../core/dependencies.js';
import { DEFAULT_RUNTIME_PROFILE, normalizeRuntimeProfile } from '../core/runtimeProfiles.js';
import { getApplicationBuild, getApplicationDeploymentRoot } from '../runtime/ActiveExecutionIdentity.js';
import { readBrowserGenerationStatus } from '../runtime/BrowserGenerationClient.js';

const DISABLED_PROFILES = new Set(['dev', 'editor', 'perf', 'e2e']);
let activeServiceWorkerRuntime = null;

const ownedWorkerUrls = location => {
  try {
    const page = new URL(location.href || `${location.protocol}//${location.host || location.hostname}${location.pathname || '/'}`);
    const deployment = getApplicationDeploymentRoot();
    const scope = deployment?.origin === page.origin && page.pathname.startsWith(deployment.pathname) ? deployment : new URL('./', page);
    const script = new URL('service-worker.js', scope);
    return { scope: scope.href, script: script.href, tag: encodeURIComponent(scope.pathname) };
  } catch { return null; }
};
const isOwnedScript = (scriptURL, owner) => {
  if (!scriptURL || !owner) return false;
  try {
    const url = new URL(scriptURL);
    return url.origin + url.pathname === owner.script;
  } catch { return false; }
};
const isOwnedRegistration = (registration, owner) => {
  if (!owner || registration?.scope !== owner.scope) return false;
  const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
  return workers.length > 0 && workers.every(worker => isOwnedScript(worker.scriptURL, owner));
};
const isOwnedCache = (key, owner) => {
  if (!owner) return false;
  const scoped = ['lemmings-core-', 'lemmings-runtime-'].some(prefix => {
    const stem = `${prefix}${owner.tag}-v`;
    return key.startsWith(stem) && /^[0-9]+$/.test(key.slice(stem.length));
  });
  const legacyRoot = /^lemmings-(?:core|runtime)-v[0-9]+$/;
  const generations = `lemmings-generation-${owner.tag}-v1-`;
  return scoped || key.startsWith(generations) && /^[a-f0-9]{64}-[a-f0-9]{32}$/.test(key.slice(generations.length)) || owner.tag === '%2F' && legacyRoot.test(key);
};

const isTruthyQueryValue = (value) => {
  if (value == null || value === '') return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
};

const hasTruthyQueryKey = (location, key) => {
  if (!location || typeof URLSearchParams === 'undefined') return false;
  const params = new URLSearchParams(location.search || '');
  if (!params.has(key)) return false;
  return isTruthyQueryValue(params.get(key));
};

const isDevLocation = (location) => {
  if (!location) return false;
  if (location.protocol === 'file:') return true;
  const host = String(location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
};

const shouldBypassServiceWorker = ({
  profile = DEFAULT_RUNTIME_PROFILE,
  e2e = false,
  dev = false,
  enableServiceWorker = false,
  disableServiceWorker = false,
  location = getRuntimeDependency('location', null)
} = {}) => {
  const rawProfile = String(profile || '').trim().toLowerCase();
  const normalizedProfile = normalizeRuntimeProfile(rawProfile);
  const explicitlyEnabled = enableServiceWorker === true
    || hasTruthyQueryKey(location, 'sw')
    || hasTruthyQueryKey(location, 'serviceWorker');
  if (disableServiceWorker === true || hasTruthyQueryKey(location, 'noSw')) return true;
  if (e2e === true || hasTruthyQueryKey(location, 'e2e')) return true;
  if (DISABLED_PROFILES.has(rawProfile) || DISABLED_PROFILES.has(normalizedProfile)) return true;
  if (dev === true || hasTruthyQueryKey(location, 'dev')) return !explicitlyEnabled;
  if (isDevLocation(location)) return !explicitlyEnabled;
  return false;
};

const disableActiveServiceWorker = async (
  serviceWorker = null,
  cacheStorage = getRuntimeDependency('caches', null),
  { location = getRuntimeDependency('location', null), shouldContinue = () => true, removeCaches = true } = {}
) => {
  const owner = location && ownedWorkerUrls(location);
  const result = { unregistered: 0, deletedCaches: 0, controlled: !!serviceWorker?.controller };
  if (!owner) return result;
  if (serviceWorker) {
    const registrations = [];
    try {
      const list = await serviceWorker.getRegistrations?.();
      if (Array.isArray(list)) registrations.push(...list);
    } catch {
      /* ignored */
    }
    if (!registrations.length) {
      try {
        const single = await serviceWorker.getRegistration?.();
        if (single) registrations.push(single);
      } catch {
        /* ignored */
      }
    }
    for (let i = 0; i < registrations.length; i += 1) {
      if (!shouldContinue()) return result;
      if (!isOwnedRegistration(registrations[i], owner)) continue;
      try {
        if (await registrations[i]?.unregister?.()) result.unregistered++;
      } catch {
        /* ignored */
      }
    }
  }

  if (removeCaches && cacheStorage?.keys && cacheStorage?.delete) {
    try {
      const cacheKeys = await cacheStorage.keys();
      for (let i = 0; i < cacheKeys.length; i += 1) {
        if (!shouldContinue()) return result;
        const key = cacheKeys[i];
        if (!isOwnedCache(String(key), owner)) {
          continue;
        }
        try {
          if (await cacheStorage.delete(key)) result.deletedCaches++;
        } catch {
          /* ignored */
        }
      }
    } catch {
      /* ignored */
    }
  }
  return result;
};

const registerServiceWorker = (options = {}) => {
  activeServiceWorkerRuntime?.dispose?.();
  activeServiceWorkerRuntime = null;
  const nav = options.navigator ?? getRuntimeDependency('navigator', null);
  const windowRef = options.window ?? getRuntimeDependency('window', null);
  const documentRef = options.document ?? getRuntimeDependency('document', null);
  const location = options.location ?? windowRef?.location ?? getRuntimeDependency('location', null);
  const owner = location && ownedWorkerUrls(location);
  let disposed = false;
  let mode = 'pending';
  const applicationBuild = getApplicationBuild(), deployment = getApplicationDeploymentRoot();
  const generated = !!applicationBuild && !!deployment;
  let offlineInstallation = generated ? 'checking' : 'unqualified', installedBuildId = null;
  const statusController = new AbortController();
  const cleanup = [];
  let updateIntervalId = null;
  const addCleanup = (fn) => {
    if (typeof fn === 'function') cleanup.push(fn);
  };
  const addListener = (target, eventName, handler, listenerOptions) => {
    if (!target?.addEventListener || typeof handler !== 'function') return;
    target.addEventListener(eventName, handler, listenerOptions);
    addCleanup(() => target.removeEventListener?.(eventName, handler, listenerOptions));
  };
  const runtime = {
    getState: () => ({ mode, offlineInstallation, ...(generated ? { installedBuildId, executingBuildId: applicationBuild.buildId } : {}), controlledByOwnedWorker: isOwnedScript(nav?.serviceWorker?.controller?.scriptURL, owner),
      controlled: !!nav?.serviceWorker?.controller }),
    async removeOwnedAndReload() {
      if (disposed || !isOwnedScript(nav?.serviceWorker?.controller?.scriptURL, owner)) return false;
      const result = await disableActiveServiceWorker(nav.serviceWorker, options.cacheStorage ?? getRuntimeDependency('caches', null),
        { location, removeCaches: false, shouldContinue: () => !disposed && activeServiceWorkerRuntime === runtime });
      if (disposed || !result.unregistered) return false;
      mode = 'reload-pending';
      windowRef?.location?.reload?.();
      return true;
    },
    dispose() {
      disposed = true;
      statusController.abort();
      mode = 'disposed';
      if (updateIntervalId != null) {
        windowRef?.clearInterval?.(updateIntervalId);
        updateIntervalId = null;
      }
      while (cleanup.length) {
        try {
          cleanup.pop()?.();
        } catch {
          /* ignored */
        }
      }
      if (activeServiceWorkerRuntime === runtime) {
        activeServiceWorkerRuntime = null;
      }
    }
  };
  if (!nav || !('serviceWorker' in nav)) return runtime;
  const serviceWorker = nav.serviceWorker;
  activeServiceWorkerRuntime = runtime;

  const onLoad = async () => {
    if (disposed) return;
    if (shouldBypassServiceWorker({ ...options, location })) {
      mode = serviceWorker.controller && isOwnedScript(serviceWorker.controller.scriptURL, owner) ? 'bypassed-controlled' : 'bypassed';
      return;
    }

    const hadController = !!serviceWorker.controller;
    try {
      const revision = resolveRuntimeRevision({
        revision: options.revision,
        location,
        document: documentRef
      });
      const workerUrl = generated ? new URL('service-worker.js', deployment).href : appendRevisionParam('service-worker.js', revision);
      const registration = await serviceWorker.register(workerUrl, generated ? { type: 'module', scope: deployment.href, updateViaCache: 'none' } : { updateViaCache: 'none' });
      if (disposed) return;
      mode = 'registered';
      let refreshing = false;
      let statusPending = false;
      const refreshStatus = async () => {
        if (!generated || disposed || statusPending) return;
        statusPending = true;
        try {
          const result = await readBrowserGenerationStatus(serviceWorker.controller || registration.active, { signal: statusController.signal });
          if (disposed || !result) return;
          installedBuildId = result.offlineReady && result.status === 'installed' ? result.buildId : null;
          offlineInstallation = installedBuildId === applicationBuild.buildId ? 'installed' : installedBuildId ? 'different-controller-generation' : result.status;
        } catch { if (!disposed) offlineInstallation = 'unavailable'; }
        finally { statusPending = false; }
      };
      const requestUpdate = () => registration.update?.().catch(() => {});
      const activateWaiting = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      };
      const scheduleUpdate = () => {
        if (disposed) return;
        requestUpdate();
        activateWaiting();
        refreshStatus();
      };
      const onUpdateFound = () => {
        const installing = registration.installing;
        if (!installing) return;
        const onStateChange = () => {
          if (installing.state === 'installed' && serviceWorker.controller) {
            activateWaiting();
          }
        };
        addListener(installing, 'statechange', onStateChange);
      };
      addListener(registration, 'updatefound', onUpdateFound);
      const onControllerChange = () => {
        if (generated) { mode = 'controller-updated'; refreshStatus(); return; }
        if (!hadController || refreshing) return;
        refreshing = true;
        windowRef?.location?.reload?.();
      };
      addListener(serviceWorker, 'controllerchange', onControllerChange);
      scheduleUpdate();
      if (typeof windowRef?.setInterval === 'function') {
        updateIntervalId = windowRef.setInterval(scheduleUpdate, 5 * 60 * 1000);
      }
      const onVisibilityChange = () => {
        if (documentRef.visibilityState === 'visible') {
          scheduleUpdate();
        }
      };
      addListener(documentRef, 'visibilitychange', onVisibilityChange);
      addListener(windowRef, 'focus', scheduleUpdate);
      addListener(windowRef, 'online', scheduleUpdate);
    } catch {
      // Ignore service worker registration failures.
    }
  };

  if (windowRef && documentRef) {
    if (documentRef.readyState === 'complete') {
      onLoad();
    } else {
      addListener(windowRef, 'load', onLoad, { once: true });
    }
    return runtime;
  }
  onLoad();
  return runtime;
};

export {
  disableActiveServiceWorker,
  registerServiceWorker,
  shouldBypassServiceWorker
};
