const registerServiceWorker = () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  const onLoad = async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        'service-worker.js',
        { updateViaCache: 'none' }
      );
      let refreshing = false;
      const requestUpdate = () => registration.update().catch(() => {});
      const activateWaiting = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      };
      const scheduleUpdate = () => {
        requestUpdate();
        activateWaiting();
      };
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            activateWaiting();
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      scheduleUpdate();
      window.setInterval(scheduleUpdate, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          scheduleUpdate();
        }
      });
      window.addEventListener('focus', scheduleUpdate);
      window.addEventListener('online', scheduleUpdate);
    } catch {
      // Ignore service worker registration failures.
    }
  };
  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }
  }
};

export { registerServiceWorker };
