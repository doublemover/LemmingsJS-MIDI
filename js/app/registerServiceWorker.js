import { appendRevisionParam, resolveRuntimeRevision } from '../core/cacheBust.js';
import { getRuntimeDependency } from '../core/dependencies.js';
import { DEFAULT_RUNTIME_PROFILE, normalizeRuntimeProfile } from '../core/runtimeProfiles.js';

const DISABLED_PROFILES = new Set(['dev', 'editor', 'perf', 'e2e']);
const DISABLED_CACHE_PREFIXES = Object.freeze(['lemmings-core-', 'lemmings-runtime-']);
let activeServiceWorkerRuntime = null;

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
  cacheStorage = getRuntimeDependency('caches', null)
) => {
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
      try {
        await registrations[i]?.unregister?.();
      } catch {
        /* ignored */
      }
    }
  }

  if (cacheStorage?.keys && cacheStorage?.delete) {
    try {
      const cacheKeys = await cacheStorage.keys();
      for (let i = 0; i < cacheKeys.length; i += 1) {
        const key = cacheKeys[i];
        if (!DISABLED_CACHE_PREFIXES.some(prefix => String(key).startsWith(prefix))) {
          continue;
        }
        try {
          await cacheStorage.delete(key);
        } catch {
          /* ignored */
        }
      }
    } catch {
      /* ignored */
    }
  }
};

const registerServiceWorker = (options = {}) => {
  activeServiceWorkerRuntime?.dispose?.();
  activeServiceWorkerRuntime = null;
  const nav = options.navigator ?? getRuntimeDependency('navigator', null);
  const windowRef = options.window ?? getRuntimeDependency('window', null);
  const documentRef = options.document ?? getRuntimeDependency('document', null);
  const location = options.location ?? windowRef?.location ?? getRuntimeDependency('location', null);
  let disposed = false;
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
    dispose() {
      disposed = true;
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
      await disableActiveServiceWorker(
        serviceWorker,
        options.cacheStorage ?? getRuntimeDependency('caches', null)
      );
      return;
    }

    const hadController = !!serviceWorker.controller;
    try {
      const revision = resolveRuntimeRevision({
        revision: options.revision,
        location,
        document: documentRef
      });
      const workerUrl = appendRevisionParam('service-worker.js', revision);
      const registration = await serviceWorker.register(workerUrl, { updateViaCache: 'none' });
      let refreshing = false;
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
