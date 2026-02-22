import { appendRevisionParam, resolveRuntimeRevision } from '../core/cacheBust.js';

const DISABLED_PROFILES = new Set(['dev', 'editor', 'perf']);
const DISABLED_CACHE_PREFIXES = Object.freeze(['lemmings-core-', 'lemmings-runtime-']);

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
  profile = 'gameplay',
  e2e = false,
  dev = false,
  disableServiceWorker = false,
  location = globalThis.location
} = {}) => {
  const normalizedProfile = String(profile || '').trim().toLowerCase();
  if (DISABLED_PROFILES.has(normalizedProfile)) return true;
  if (e2e === true || hasTruthyQueryKey(location, 'e2e')) return true;
  if (disableServiceWorker === true || hasTruthyQueryKey(location, 'noSw')) return true;
  if (dev === true || hasTruthyQueryKey(location, 'dev')) return true;
  return isDevLocation(location);
};

const disableActiveServiceWorker = async (
  serviceWorker = null,
  cacheStorage = globalThis.caches
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
  const nav = options.navigator ?? globalThis.navigator;
  if (!nav || !('serviceWorker' in nav)) return;
  const serviceWorker = nav.serviceWorker;
  const windowRef = options.window ?? globalThis.window;
  const documentRef = options.document ?? globalThis.document;
  const location = options.location ?? windowRef?.location ?? globalThis.location;

  const onLoad = async () => {
    if (shouldBypassServiceWorker({ ...options, location })) {
      await disableActiveServiceWorker(serviceWorker, options.cacheStorage ?? globalThis.caches);
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
        requestUpdate();
        activateWaiting();
      };
      registration.addEventListener?.('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener?.('statechange', () => {
          if (installing.state === 'installed' && serviceWorker.controller) {
            activateWaiting();
          }
        });
      });
      serviceWorker.addEventListener?.('controllerchange', () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        windowRef?.location?.reload?.();
      });
      scheduleUpdate();
      windowRef?.setInterval?.(scheduleUpdate, 5 * 60 * 1000);
      documentRef?.addEventListener?.('visibilitychange', () => {
        if (documentRef.visibilityState === 'visible') {
          scheduleUpdate();
        }
      });
      windowRef?.addEventListener?.('focus', scheduleUpdate);
      windowRef?.addEventListener?.('online', scheduleUpdate);
    } catch {
      // Ignore service worker registration failures.
    }
  };

  if (windowRef && documentRef) {
    if (documentRef.readyState === 'complete') {
      onLoad();
    } else {
      windowRef.addEventListener('load', onLoad, { once: true });
    }
    return;
  }
  onLoad();
};

export {
  disableActiveServiceWorker,
  registerServiceWorker,
  shouldBypassServiceWorker
};
