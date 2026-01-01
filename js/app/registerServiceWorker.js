const registerServiceWorker = () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const onLoad = () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
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
