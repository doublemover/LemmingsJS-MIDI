import { getApplicationBuild, getApplicationDeploymentRoot } from './ActiveExecutionIdentity.js';
import { BROWSER_ENTRY_ROUTES } from './BrowserBuildManifest.js';

const cancelled = () => new globalThis.DOMException('Browser generation entry canceled.', 'AbortError');
export function readBrowserGenerationStatus(worker, { signal, timeout = 1500, verifyBuildId = null, Channel = globalThis.MessageChannel } = {}) {
  signal?.throwIfAborted();
  if (!worker?.postMessage || typeof Channel !== 'function') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const channel = new Channel(); let timer;
    const finish = (error, value = null) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      channel.port1.onmessage = null; channel.port1.close(); channel.port2.close();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(signal.reason || cancelled());
    channel.port1.onmessage = event => {
      const value = event.data;
      if (!value || value.schemaVersion !== 1 || typeof value.buildId !== 'string' || !/^[a-f0-9]{64}$/.test(value.buildId)) { finish(null); return; }
      finish(null, Object.freeze({ buildId: value.buildId, status: String(value.status).slice(0, 64), offlineReady: value.offlineReady === true,
        resourceDelivery: value.resourceDelivery === 'verified-immutable-responses' ? value.resourceDelivery : null,
        completedFiles: Number.isSafeInteger(value.completedFiles) ? value.completedFiles : null, totalFiles: Number.isSafeInteger(value.totalFiles) ? value.totalFiles : null }));
    };
    timer = setTimeout(() => finish(null), Math.max(1, Math.min(verifyBuildId ? 125000 : 5000, timeout)));
    signal?.addEventListener('abort', abort, { once: true });
    try { signal?.throwIfAborted(); worker.postMessage(verifyBuildId ? { type: 'GENERATION_VERIFY', buildId: verifyBuildId } : { type: 'GENERATION_STATUS' }, [channel.port2]); }
    catch (error) { finish(error); }
  });
}

export async function waitForBrowserGeneration(registration, buildId, { signal, timeout = 210000, onStatus = () => {}, Channel } = {}) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    signal?.throwIfAborted();
    const workers = [...new Set([registration.installing, registration.waiting, registration.active].filter(Boolean))];
    const states = await Promise.all(workers.map(worker => readBrowserGenerationStatus(worker, { signal, Channel,
      timeout: Math.min(1500, Math.max(1, deadline - performance.now())) }).catch(error => { signal?.throwIfAborted(); return { status: error.name }; })));
    const matching = states.find(value => value?.buildId === buildId); if (matching) onStatus(matching);
    if (matching?.status === 'installed' && matching.offlineReady) return matching;
    if (matching?.status === 'failed') throw new Error('The complete browser generation could not be installed.');
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason || cancelled()); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(250, Math.max(1, deadline - performance.now())));
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }
  throw new Error('Timed out waiting for a complete browser generation.');
}

export async function startBrowserGenerationEntry({ route, windowRef = globalThis.window, navigatorRef = globalThis.navigator,
  documentRef = globalThis.document } = {}) {
  const build = getApplicationBuild(), root = getApplicationDeploymentRoot();
  if (!build || !root || !BROWSER_ENTRY_ROUTES.includes(route)) throw new Error('This entry has no immutable browser generation.');
  const controller = new AbortController(), stop = () => controller.abort(cancelled());
  windowRef.addEventListener('pagehide', stop, { once: true });
  const status = documentRef.getElementById('generation-status');
  try {
    if (!navigatorRef.serviceWorker) throw new Error('Offline installation requires service worker support on this origin.');
    const registration = await navigatorRef.serviceWorker.register(new URL('service-worker.js', root), { type: 'module', scope: root.href, updateViaCache: 'none' });
    controller.signal.throwIfAborted();
    await waitForBrowserGeneration(registration, build.buildId, { signal: controller.signal,
      onStatus: state => { if (status) status.textContent = state.totalFiles == null ? 'Preparing application files…' : `Preparing application files (${state.completedFiles}/${state.totalFiles})…`; } });
    controller.signal.throwIfAborted();
    const target = new URL(`${build.buildId}/${route}`, root), current = new URL(windowRef.location.href);
    target.search = current.search; target.hash = current.hash; windowRef.location.replace(target.href);
  } catch (error) { if (!controller.signal.aborted && status) status.textContent = `Application installation failed: ${error.message}`; throw error; }
  finally { windowRef.removeEventListener('pagehide', stop); }
}
