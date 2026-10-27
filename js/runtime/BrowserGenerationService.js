import { readDurableBrowserGenerationPins, withBrowserGenerationRetentionLock } from './BrowserGenerationPins.js';
import { hashBrowserBuildBytes, validBrowserBuildPath, verifyBrowserBuildManifest, BROWSER_ENTRY_ROUTES } from './BrowserBuildManifest.js';

const MANIFEST_LIMIT = 2 * 1048576, CACHE_LIMIT = 512 * 1048576;
const digestPattern = /^[a-f0-9]{64}$/;
const failure = (code, message) => Object.assign(new Error(message), { code });
export const awaitBrowserBuildOperation = async (start, signal) => {
  signal?.throwIfAborted(); if (!signal) return start();
  let rejectAbort; const interrupted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(signal.reason || failure('cancelled', 'Browser generation operation canceled.'));
  signal.addEventListener('abort', abort, { once: true });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }), interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
};
const withSignal = awaitBrowserBuildOperation;
export async function readBrowserBuildResponse(response, maximum, signal, { claimBytes = () => {}, observeProducer = () => {} } = {}) {
  if (typeof claimBytes !== 'function' || typeof observeProducer !== 'function' || !response?.ok || !Number.isSafeInteger(maximum) || maximum < 0) throw failure('response-unavailable', 'Browser generation response is unavailable.');
  const declared = response.headers?.get('content-length');
  if (declared != null && /^\d+$/.test(declared) && Number(declared) > maximum) throw failure('response-capacity', 'Browser generation response exceeds its bound.');
  signal?.throwIfAborted();
  if (!response.body) { if (maximum === 0) return new Uint8Array(); throw failure('stream-required', 'Browser generation responses require bounded streaming.'); }
  // Chromium cache-backed BYOB streams can leave the final one-byte EOF read pending.
  const reader = response.body.getReader();
  let rejectAbort;
  const interrupted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const cancel = reason => { try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* The platform reader already retired. */ } };
  const abort = () => { rejectAbort(signal.reason || failure('cancelled', 'Browser generation read canceled.')); cancel(signal.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  const parts = []; let size = 0, filled = 65536, chunks = 0;
  try {
    const consume = async () => {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        signal?.throwIfAborted(); if (done) break;
        if (++chunks > 262144) throw failure('response-work-capacity', 'Browser generation stream exceeds its chunk work bound.');
        if (!(value instanceof Uint8Array) || size + value.byteLength > maximum) throw failure('response-capacity', 'Browser generation stream exceeds its bound.');
        claimBytes(value.byteLength);
        let offset = 0;
        while (offset < value.byteLength) {
          if (filled === 65536) { parts.push(new Uint8Array(Math.min(65536, maximum - size))); filled = 0; }
          const count = Math.min(value.byteLength - offset, parts.at(-1).byteLength - filled);
          parts.at(-1).set(value.subarray(offset, offset + count), filled); filled += count; offset += count; size += count;
        }
      }
      const bytes = new Uint8Array(size); let cursor = 0;
      for (const part of parts) { const count = Math.min(part.byteLength, size - cursor); bytes.set(part.subarray(0, count), cursor); cursor += count; }
      return bytes;
    };
    const producer = consume();
    const settled = producer.then(() => undefined, () => undefined).finally(() => { try { reader.releaseLock(); } catch { /* Native stream may already have released. */ } });
    observeProducer(settled);
    return await Promise.race([producer, interrupted]);
  } catch (error) { cancel(error); throw error; }
  finally { signal?.removeEventListener('abort', abort); try { reader.releaseLock(); } catch { /* Cancellation can retain a pending platform read. */ } }
}

export function createBrowserGenerationService({ scopeUrl, buildId, cacheStorage = globalThis.caches, fetchFile = globalThis.fetch,
  getClients = async () => [], retentionLocks = globalThis.navigator?.locks, getDurableBuildPins = () => readDurableBrowserGenerationPins({ scopeUrl }), candidatePending = () => false, maximumCacheBytes = CACHE_LIMIT } = {}) {
  const scope = new URL(scopeUrl), tag = encodeURIComponent(scope.pathname), prefix = `lemmings-generation-${tag}-v1-`;
  if (!digestPattern.test(buildId) || !['https:', 'http:'].includes(scope.protocol) || !scope.pathname.endsWith('/') || scope.search || scope.hash ||
      !Number.isSafeInteger(maximumCacheBytes) || maximumCacheBytes < 1 || maximumCacheBytes > 1024 * 1048576) throw new Error('Invalid browser generation owner.');
  const markerUrl = new URL('__runtime_generation_manifest__', scope).href;
  const catalog = new Map(), qualifications = new Map(), verifications = new Map();
  let installing = null, restoring = null, state = { schemaVersion: 1, buildId, status: 'uninstalled', offlineReady: false, completedFiles: 0, totalFiles: null, completedBytes: 0 };
  const ownedName = name => name.startsWith(prefix) && /^[a-f0-9]{64}-[a-f0-9]{32}$/.test(name.slice(prefix.length));
  const request = async (url, maximum, signal) => {
    const response = await withSignal(() => fetchFile(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal }), signal);
    return readBrowserBuildResponse(response, maximum, signal);
  };
  const readMarker = async (cache, signal) => {
    const response = await withSignal(() => cache.match(markerUrl), signal); if (!response) return null;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBrowserBuildResponse(response, MANIFEST_LIMIT, signal)));
  };
  const records = async (signal, { requestedBuild = null, strict = true } = {}) => {
    const result = [], names = (await withSignal(() => cacheStorage.keys(), signal)).filter(ownedName);
    const retained = new Set(names);
    for (const name of catalog.keys()) if (!retained.has(name)) { catalog.delete(name); qualifications.delete(name); }
    const selected = requestedBuild ? names.filter(name => name.startsWith(prefix + requestedBuild + '-')) : names;
    if (strict && selected.length > 16) throw failure('generation-cache-capacity', 'Owned generation cache count exceeds its inspection bound.');
    for (const name of selected.slice(0, 16)) {
      const cached = catalog.get(name);
      if (cached) { result.push(cached); continue; }
      let cache, marker;
      try { cache = await withSignal(() => cacheStorage.open(name), signal); marker = await readMarker(cache, signal); }
      catch (error) { if (strict || signal?.aborted) throw error; continue; }
      if (!marker || !digestPattern.test(marker.buildId) || !name.startsWith(prefix + marker.buildId + '-') ||
          !['staging', 'complete'].includes(marker.status) || !Number.isSafeInteger(marker.reservedBytes) || marker.reservedBytes < 1 || marker.reservedBytes > maximumCacheBytes) {
        if (strict) throw failure('cache-state-unknown', 'An owned generation cache has incomplete accounting.'); continue;
      }
      const record = { name, cache, marker }; result.push(record);
      if (marker.status === 'complete') catalog.set(name, record);
    }
    return result;
  };
  const qualify = async (record, signal) => {
    if (qualifications.has(record.name)) return qualifications.get(record.name);
    const manifest = record.marker.manifest;
    const first = await verifyBrowserBuildManifest(manifest, { expectedBuildId: record.marker.buildId });
    const response = await withSignal(() => record.cache.match(new URL(`${record.marker.buildId}/${first.templatePath}`, scope).href), signal);
    const template = new TextDecoder('utf-8', { fatal: true }).decode(await readBrowserBuildResponse(response, first.templateBytes, signal));
    const verified = await verifyBrowserBuildManifest(manifest, { expectedBuildId: record.marker.buildId, template });
    const result = { ...verified, byPath: new Map(verified.files.map(file => [file.path, file])) };
    if (qualifications.size >= 8) qualifications.delete(qualifications.keys().next().value);
    qualifications.set(record.name, result); return result;
  };
  const checkStored = async (record, signal, publishProgress = true) => {
    const verified = await qualify(record, signal);
    if (publishProgress) state = { ...state, status: 'checking-installed-generation', totalFiles: verified.files.length, completedFiles: 0, completedBytes: 0 };
    for (const file of verified.files) {
      const response = await withSignal(() => record.cache.match(new URL(`${record.marker.buildId}/${file.path}`, scope).href), signal);
      if (!response) return false;
      const bytes = await readBrowserBuildResponse(response, file.bytes, signal);
      if (bytes.byteLength !== file.bytes || await hashBrowserBuildBytes(bytes) !== file.sha256) return false;
      if (publishProgress) state = { ...state, completedFiles: state.completedFiles + 1, completedBytes: state.completedBytes + bytes.byteLength };
    }
    return true;
  };
  const verifyInstalledBuild = requestedBuild => {
    if (!digestPattern.test(requestedBuild)) return Promise.reject(failure('invalid-generation', 'Invalid generation verification request.'));
    if (verifications.has(requestedBuild)) return verifications.get(requestedBuild);
    if (verifications.size >= 2) return Promise.reject(failure('generation-verification-capacity', 'Two generation verifications are already active.'));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(failure('verification-deadline', 'Installed generation verification timed out.')), 120000);
    const pending = Promise.resolve().then(async () => {
      for (const record of await records(controller.signal, { requestedBuild, strict: false })) if (record.marker.status === 'complete' &&
          await checkStored(record, controller.signal, false).catch(error => { if (controller.signal.aborted) throw error; return false; }))
        return Object.freeze({ schemaVersion: 1, buildId: requestedBuild, status: 'installed', offlineReady: true, resourceDelivery: 'verified-immutable-responses' });
      throw failure('generation-unavailable', 'The requested generation is incomplete.');
    }).finally(() => { clearTimeout(timer); verifications.delete(requestedBuild); });
    verifications.set(requestedBuild, pending); return pending;
  };
  const install = () => {
    if (installing) return installing;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(failure('installation-deadline', 'Browser generation installation deadline exceeded.')), 180000);
    installing = Promise.resolve().then(async () => {
      let cacheName = null;
      try {
        state = { ...state, status: 'reading-manifest', offlineReady: false, error: null, completedFiles: 0, completedBytes: 0 };
        const manifestBytes = await request(new URL(`${buildId}/runtime-build.json`, scope), MANIFEST_LIMIT, controller.signal);
        const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
        const declared = await verifyBrowserBuildManifest(manifest, { expectedBuildId: buildId });
        const templateBytes = await request(new URL(`${buildId}/${declared.templatePath}`, scope), declared.templateBytes, controller.signal);
        const template = new TextDecoder('utf-8', { fatal: true }).decode(templateBytes);
        const verified = await verifyBrowserBuildManifest(manifest, { expectedBuildId: buildId, template });
        const existing = await records(controller.signal);
        for (const record of existing) if (record.marker.status === 'complete' && record.marker.buildId === buildId) {
          const complete = await checkStored(record, controller.signal).catch(error => { if (controller.signal.aborted) throw error; return false; });
          if (complete) { state = { ...state, status: 'installed', offlineReady: true, completedFiles: verified.files.length, totalFiles: verified.files.length, completedBytes: verified.totalBytes }; return state; }
        }
        const reservedBytes = verified.totalBytes + templateBytes.byteLength + manifestBytes.byteLength + 4096;
        if (existing.length >= 8 || existing.reduce((bytes, record) => bytes + record.marker.reservedBytes, 0) + reservedBytes > maximumCacheBytes)
          throw failure('generation-cache-capacity', 'Browser generation storage capacity is occupied by earlier packages.');
        cacheName = prefix + buildId + '-' + globalThis.crypto.randomUUID().replaceAll('-', '');
        const cache = await withSignal(() => cacheStorage.open(cacheName), controller.signal);
        await withSignal(() => cache.put(markerUrl, new globalThis.Response(JSON.stringify({ buildId, status: 'staging', reservedBytes }))), controller.signal);
        await withSignal(() => cache.put(new URL(`${buildId}/${declared.templatePath}`, scope).href, new globalThis.Response(templateBytes)), controller.signal);
        state = { ...state, status: 'staging', totalFiles: verified.files.length };
        let cursor = 0;
        const copy = async () => {
          try {
            while (cursor < verified.files.length) {
              controller.signal.throwIfAborted(); const file = verified.files[cursor++], url = new URL(`${buildId}/${file.path}`, scope);
              const bytes = await request(url, file.bytes, controller.signal);
              if (bytes.byteLength !== file.bytes || await hashBrowserBuildBytes(bytes) !== file.sha256) throw failure('generation-byte-mismatch', `Browser generation bytes changed: ${file.path}`);
              const type = file.path.endsWith('.js') || file.path.endsWith('.mjs') ? 'application/javascript' : file.path.endsWith('.html') ? 'text/html' :
                file.path.endsWith('.css') ? 'text/css' : file.path.endsWith('.json') ? 'application/json' : file.path.endsWith('.svg') ? 'image/svg+xml' :
                  file.path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
              await withSignal(() => cache.put(url.href, new globalThis.Response(bytes, { headers: { 'content-type': type, 'content-length': String(bytes.byteLength) } })), controller.signal);
              state = { ...state, completedFiles: state.completedFiles + 1, completedBytes: state.completedBytes + bytes.byteLength };
            }
          } catch (error) { controller.abort(error); throw error; }
        };
        const copies = await Promise.allSettled([copy(), copy()]);
        const rejected = copies.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason;
        await withSignal(() => cache.put(markerUrl, new globalThis.Response(JSON.stringify({ buildId, status: 'complete', reservedBytes, manifest }))), controller.signal);
        state = { ...state, status: 'installed', offlineReady: true }; return state;
      } catch (error) {
        controller.abort(error);
        if (cacheName && ownedName(cacheName)) {
          const cleanup = new AbortController(), cleanupTimer = setTimeout(() => cleanup.abort(), 1000);
          try { await withSignal(() => cacheStorage.delete(cacheName), cleanup.signal); } catch { state = { ...state, cacheCleanup: 'unknown' }; }
          finally { clearTimeout(cleanupTimer); }
        }
        state = { ...state, status: 'failed', offlineReady: false, error: { code: error.code || error.name, message: String(error.message).slice(0, 512) } }; throw error;
      } finally { clearTimeout(timer); }
    }).finally(() => { installing = null; });
    return installing;
  };
  const restore = () => {
    if (installing) return installing;
    if (restoring) return restoring;
    if (state.offlineReady) return Promise.resolve(state);
    state = { ...state, status: 'checking-installed-generation', offlineReady: false };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(failure('restore-deadline', 'Installed browser generation verification timed out.')), 180000);
    restoring = Promise.resolve().then(async () => {
      for (const record of await records(controller.signal, { requestedBuild: buildId, strict: false })) if (record.marker.status === 'complete') {
        if (await checkStored(record, controller.signal).catch(error => { if (controller.signal.aborted) throw error; return false; })) {
          state = { ...state, status: 'installed', offlineReady: true, error: null }; return state;
        }
      }
      throw failure('generation-unavailable', 'No complete installed browser generation matches this worker.');
    }).catch(error => { state = { ...state, status: 'failed', offlineReady: false, error: Object.freeze({ code: error.code || error.name, message: String(error.message).slice(0, 512) }) }; throw error; })
      .finally(() => { clearTimeout(timer); restoring = null; });
    return restoring;
  };
  const responseFor = async requestValue => {
    const url = new URL(requestValue.url), relative = url.pathname.slice(scope.pathname.length);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || requestValue.method !== 'GET') return null;
    if (!relative || BROWSER_ENTRY_ROUTES.includes(relative)) {
      if (['rev', 'cb', 'cacheBust'].some(key => url.searchParams.has(key) && url.searchParams.get(key) !== buildId)) return new globalThis.Response('This source revision is unavailable offline.', { status: 503 });
      try { await restore(); } catch { return new globalThis.Response('This browser generation is not completely installed.', { status: 503 }); }
      const target = new URL(`${buildId}/${relative || 'index.html'}`, scope); target.search = url.search;
      return globalThis.Response.redirect(target.href, 302);
    }
    const slash = relative.indexOf('/'), requestedBuild = relative.slice(0, slash), filePath = relative.slice(slash + 1);
    if (slash < 0 || !digestPattern.test(requestedBuild) || !validBrowserBuildPath(filePath)) return null;
    const revision = url.searchParams.get('rev'), navigation = requestValue.mode === 'navigate' && BROWSER_ENTRY_ROUTES.includes(filePath);
    if (['rev', 'cb', 'cacheBust'].some(key => url.searchParams.has(key) && url.searchParams.get(key) !== requestedBuild) ||
        url.search && !navigation && !(url.searchParams.size === 1 && revision === requestedBuild)) return new globalThis.Response('The requested resource identity is unavailable.', { status: 503 });
    for (const record of await records(undefined, { requestedBuild, strict: false })) if (record.marker.status === 'complete') {
      let verified;
      try { verified = await qualify(record); } catch { continue; }
      if (filePath === 'runtime-build.json') return new globalThis.Response(JSON.stringify(record.marker.manifest), { headers: { 'content-type': 'application/json' } });
      if (filePath === verified.templatePath) {
        try {
          const cached = await record.cache.match(new URL(`${requestedBuild}/${filePath}`, scope).href);
          const bytes = await readBrowserBuildResponse(cached?.clone(), verified.templateBytes);
          if (bytes.byteLength === verified.templateBytes && await hashBrowserBuildBytes(bytes) === verified.templateSha256) return cached;
        } catch { /* Another complete instance can still satisfy this exact generation. */ }
        continue;
      }
      const ref = verified.byPath.get(filePath);
      if (!ref) return new globalThis.Response('This resource is outside the declared browser generation.', { status: 503 });
      const canonicalUrl = new URL(`${requestedBuild}/${filePath}`, scope).href, cached = await record.cache.match(canonicalUrl);
      if (!cached) continue;
      try {
        const bytes = await readBrowserBuildResponse(cached.clone(), ref.bytes);
        if (bytes.byteLength === ref.bytes && await hashBrowserBuildBytes(bytes) === ref.sha256) return cached;
      } catch { /* Never replace corrupted generation bytes with a different revision. */ }
    }
    return new globalThis.Response('The requested browser generation is unavailable or incomplete.', { status: 503 });
  };
  const trimLocked = async () => {
    if (candidatePending()) return { status: 'deferred', reason: 'candidate-pending' };
    let pins; try { pins = await getDurableBuildPins(); } catch { return { status: 'deferred', reason: 'recovery-pins-unavailable' }; }
    if (pins?.status !== 'complete' || !Array.isArray(pins.buildIds) || pins.buildIds.length > 2 || pins.buildIds.some(id => !digestPattern.test(id))) return { status: 'deferred', reason: pins?.reason || 'recovery-pins-unresolved' };
    const active = new Set([buildId, ...pins.buildIds]);
    for (const client of await getClients()) {
      const url = new URL(client.url); if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) continue;
      const first = url.pathname.slice(scope.pathname.length).split('/')[0]; if (digestPattern.test(first)) active.add(first);
    }
    for (const record of await records(undefined, { strict: false })) if (!active.has(record.marker.buildId)) { await cacheStorage.delete(record.name); catalog.delete(record.name); qualifications.delete(record.name); }
    return { status: 'complete', retainedBuildIds: [...active].sort() };
  };
  const trim = async () => {
    try { return await withBrowserGenerationRetentionLock(trimLocked, { locks: retentionLocks, required: true, ifAvailable: true }); }
    catch (error) { return { status: 'deferred', reason: error.code || 'generation-retention-unresolved' }; }
  };
  return Object.freeze({ install, restore, verifyInstalledBuild, responseFor, trim, getState: () => Object.freeze({ ...state }) });
}

export function installBrowserGenerationWorker({ buildId, worker = globalThis } = {}) {
  const owner = createBrowserGenerationService({ buildId, scopeUrl: worker.registration.scope, cacheStorage: worker.caches,
    fetchFile: worker.fetch.bind(worker), getClients: () => worker.clients.matchAll({ includeUncontrolled: true, type: 'all' }),
    candidatePending: () => !!worker.registration.installing || !!worker.registration.waiting });
  worker.addEventListener('install', event => event.waitUntil(owner.install().then(() => worker.skipWaiting())));
  worker.addEventListener('activate', event => event.waitUntil(owner.restore().then(() => owner.trim()).then(() => worker.clients.claim())));
  worker.addEventListener('fetch', event => {
    const url = new URL(event.request.url), scope = new URL(worker.registration.scope);
    if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
    event.respondWith(owner.responseFor(event.request).then(response => response || worker.fetch(event.request)));
  });
  worker.addEventListener('message', event => {
    if (event.data?.type === 'GENERATION_VERIFY') {
      const verified = owner.verifyInstalledBuild(event.data.buildId).then(receipt => event.ports?.[0]?.postMessage(receipt),
        () => event.ports?.[0]?.postMessage({ schemaVersion: 1, buildId: event.data.buildId, status: 'failed', offlineReady: false }));
      event.waitUntil?.(verified); return;
    }
    if (event.data?.type === 'GENERATION_STATUS') {
      const restored = owner.restore(); event.waitUntil?.(restored.catch(() => {}));
      event.ports?.[0]?.postMessage(owner.getState());
    }
    if (event.data?.type === 'SKIP_WAITING' && owner.getState().offlineReady) worker.skipWaiting();
  });
  return owner;
}
