import { AudioAssetError, validateAudioAssetRef, inspectWaveAudio, DECODER_VERSION } from './AudioAssetRef.js';
import { createAudioResourceLeases } from './AudioResourceLeases.js';

let loaderSequence = 0;
const aborted = signal => { if (signal?.aborted) throw new AudioAssetError('asset-request-cancelled'); };
const fingerprint = ref => [ref.bytes, ref.mime, ref.channels, ref.sourceSampleRate, ref.frames].join(':');
const makeGate = (concurrency, capacity) => {
  const queued = []; let active = 0;
  const pump = () => {
    while (active < concurrency && queued.length) {
      const item = queued.shift(); item.signal?.removeEventListener('abort', item.cancel); active++;
      Promise.resolve().then(() => { aborted(item.signal); return item.action(); }).then(item.resolve, item.reject).finally(() => { active--; pump(); });
    }
  };
  return { run(action, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new AudioAssetError('asset-request-cancelled')); return; }
      if (queued.length >= capacity) { reject(new AudioAssetError('asset-task-queue-full')); return; }
      const item = { action, signal, resolve, reject, cancel: null };
      item.cancel = () => { const index = queued.indexOf(item); if (index >= 0) queued.splice(index, 1); reject(new AudioAssetError('asset-request-cancelled')); };
      signal?.addEventListener('abort', item.cancel, { once: true }); queued.push(item); pump();
    });
  }, diagnostics: () => ({ active, queued: queued.length, concurrency, capacity }) };
};

export function createAudioAssetLoader({ getContext, resolveAssetUrl, fetchAsset = null, rawStore = null, resourceBudget = null,
  maxRawBytes = 32 * 1024 * 1024, maxDecodedBytes = 64 * 1024 * 1024, maxDecodedAssetBytes = 32 * 1024 * 1024,
  maxEntries = 128, fetchConcurrency = 2, decodeConcurrency = 2, assetLimits = {},
  digest = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join(''),
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (typeof getContext !== 'function' || typeof digest !== 'function' || typeof yieldTask !== 'function' ||
      fetchAsset == null && typeof resolveAssetUrl !== 'function' ||
      [maxRawBytes, maxDecodedBytes, maxDecodedAssetBytes].some(value => !Number.isSafeInteger(value) || value < 4096 || value > 512 * 1024 * 1024) ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096 ||
      [fetchConcurrency, decodeConcurrency].some(value => !Number.isSafeInteger(value) || value < 1 || value > 16)) throw new TypeError('Invalid audio asset loader.');
  const ownerPrefix = 'audio-assets-' + (++loaderSequence), resources = createAudioResourceLeases({ resourceBudget, ownerPrefix, maxReservations: maxEntries * 8 });
  const raw = new Map(), decoded = new Map(), packs = new Map(), fetchGate = makeGate(fetchConcurrency, maxEntries), decodeGate = makeGate(decodeConcurrency, maxEntries);
  const fetchBytes = fetchAsset || ((ref, options) => globalThis.fetch(resolveAssetUrl(ref), { signal: options.signal }));
  let disposed = false, rawBytes = 0, decodedBytes = 0, useSequence = 0;
  const stats = { fetches: 0, decodes: 0, rawHits: 0, decodedHits: 0, evictions: 0, failures: 0, cancellations: 0 };
  const fail = (reason, ref) => new AudioAssetError(reason, ref?.contentHash);
  const retire = (map, key, entry, kind) => {
    if (map.get(key) === entry) map.delete(key);
    if (entry.resource) {
      entry.resource.release(); entry.resource = null;
      if (kind === 'raw') rawBytes -= entry.bytes; else decodedBytes -= entry.bytes;
    }
    entry.value = null;
  };
  const evict = (map, kind, needed = 0, limit = kind === 'raw' ? maxRawBytes : maxDecodedBytes, all = false, inserted = false) => {
    const entryLimit = maxEntries + (inserted ? 1 : 0);
    const candidates = [...map.entries()].filter(([, entry]) => entry.state === 'ready' && entry.pins === 0 && entry.waiters === 0).sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of candidates) {
      if (!all && (kind === 'raw' ? rawBytes : decodedBytes) + needed <= limit && map.size < entryLimit) break;
      retire(map, key, entry, kind);
      stats.evictions++;
    }
    if (!all && ((kind === 'raw' ? rawBytes : decodedBytes) + needed > limit || map.size >= entryLimit)) throw fail(kind + '-cache-budget-exhausted');
  };
  const failed = (map, key, entry, kind) => {
    if (entry.state !== 'pending') return;
    stats.failures++; entry.state = 'failed'; retire(map, key, entry, kind);
  };
  const unregister = resourceBudget?.registerEvictor?.(ownerPrefix, () => { evict(decoded, 'decoded', 0, maxDecodedBytes, true); evict(raw, 'raw', 0, maxRawBytes, true); });
  const subscribe = (entry, { signal, isCurrent = () => true } = {}, handle) => new Promise((resolve, reject) => {
    let settled = false;
    entry.waiters++;
    const finish = () => {
      settled = true; signal?.removeEventListener('abort', cancel); entry.waiters--;
      if (!entry.waiters && entry.state === 'pending') entry.controller.abort();
    };
    const cancel = () => { if (settled) return; stats.cancellations++; finish(); reject(fail('asset-request-cancelled', entry.ref)); };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    entry.promise.then(() => {
      if (settled) return;
      let current = false; try { current = isCurrent(); } catch { /* Selection callbacks cannot activate stale resources. */ }
      finish();
      if (disposed || signal?.aborted || !current) {
        if (disposed && entry.state === 'ready' && !entry.pins && !entry.waiters) retire(entry.key ? decoded : raw, entry.key || entry.ref.contentHash, entry, entry.key ? 'decoded' : 'raw');
        reject(fail('asset-request-cancelled', entry.ref)); return;
      }
      try { resolve(handle(entry)); } catch (error) { reject(error); }
    }, error => { if (!settled) { finish(); reject(error); } });
  });
  const readBounded = async (response, ref, signal) => {
    aborted(signal);
    if (response == null) return null;
    if (response.ok === false) throw fail('asset-http-' + response.status, ref);
    const declared = response.headers?.get?.('content-length');
    if (declared != null && Number(declared) !== ref.bytes) throw fail('encoded-byte-count-mismatch', ref);
    const result = new Uint8Array(ref.bytes);
    if (response instanceof ArrayBuffer || response instanceof Uint8Array) {
      const source = response instanceof Uint8Array ? response : new Uint8Array(response);
      if (source.byteLength !== ref.bytes) throw fail('encoded-byte-count-mismatch', ref); result.set(source); return result;
    }
    if (!response.body?.getReader) throw fail('bounded-response-stream-unavailable', ref);
    const reader = response.body.getReader(); let offset = 0;
    const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        aborted(signal); const part = await reader.read(); if (part.done) break;
        if (!(part.value instanceof Uint8Array) || offset + part.value.byteLength > ref.bytes) throw fail('encoded-byte-count-mismatch', ref);
        result.set(part.value, offset); offset += part.value.byteLength;
      }
      aborted(signal); if (offset !== ref.bytes) throw fail('truncated-audio-asset', ref); return result;
    } finally { signal?.removeEventListener('abort', cancel); try { await reader.cancel(); } catch { /* The response may already be closed. */ } }
  };
  const rawHandle = entry => {
    entry.pins++; entry.used = ++useSequence; let released = false;
    return { bytes: entry.value, release() {
      if (released) return; released = true; entry.pins--; entry.used = ++useSequence;
      if (disposed && !entry.pins && !entry.waiters) retire(raw, entry.ref.contentHash, entry, 'raw');
    } };
  };
  const acquireRaw = (ref, options = {}) => {
    if (disposed) return Promise.reject(fail('asset-loader-disposed', ref));
    let entry = raw.get(ref.contentHash);
    if (entry && entry.fingerprint !== fingerprint(ref)) return Promise.reject(fail('asset-source-metadata-mismatch', ref));
    if (!entry) {
      try { evict(raw, 'raw', ref.bytes); } catch (error) { return Promise.reject(error); }
      entry = { ref, fingerprint: fingerprint(ref), state: 'pending', pins: 0, waiters: 0, used: ++useSequence,
        controller: new AbortController(), bytes: ref.bytes, resource: null, value: null, persisted: false, promise: null };
      raw.set(ref.contentHash, entry);
      entry.promise = fetchGate.run(async () => {
        let workspace = null;
        try {
          aborted(entry.controller.signal); evict(raw, 'raw', ref.bytes, maxRawBytes, false, true);
          entry.resource = resources.reserve({ kind: 'encoded-audio', bytes: ref.bytes }); rawBytes += ref.bytes;
          workspace = resources.reserve({ kind: 'encoded-ingest-copy', bytes: ref.bytes, estimateBytes: 65536 });
          let response = rawStore ? await rawStore.get(ref.contentHash) : null;
          if (response) entry.persisted = true;
          else { stats.fetches++; response = await fetchBytes(ref, { signal: entry.controller.signal }); }
          const bytes = await readBounded(response, ref, entry.controller.signal);
          if (!bytes || await digest(bytes) !== ref.contentHash) throw fail('asset-hash-mismatch', ref);
          inspectWaveAudio(bytes, ref); aborted(entry.controller.signal);
          entry.value = bytes; entry.state = 'ready'; return entry;
        } catch (error) {
          failed(raw, ref.contentHash, entry, 'raw');
          if (error?.reason === 'asset-hash-mismatch' && entry.persisted) { try { await rawStore.remove(ref.contentHash); } catch { /* Integrity failure remains explicit. */ } }
          throw error;
        } finally { workspace?.release(); }
      }, entry.controller.signal);
      entry.promise.catch(() => failed(raw, ref.contentHash, entry, 'raw'));
    } else stats.rawHits++;
    return subscribe(entry, options, rawHandle);
  };
  const decodedHandle = (entry, owner, generation, ref) => {
    if (disposed || entry.state !== 'ready') throw fail('decoded-asset-unavailable', ref);
    entry.pins++; entry.used = ++useSequence; let active = true;
    const lease = { ref, get buffer() { if (!active || !entry.value) throw fail('asset-pin-released', ref); return entry.value; }, variant: Object.freeze({ contentHash: ref.contentHash, targetSampleRate: entry.sampleRate,
      decoderVersion: DECODER_VERSION, frames: entry.value.length, channels: entry.value.numberOfChannels }), owner, generation,
    isActive: () => active && entry.value != null,
    retain: (next = {}) => {
      if (!active || disposed) throw fail('asset-pin-released', ref);
      return decodedHandle(entry, next.owner ?? owner, next.generation ?? generation, ref);
    },
    release: () => {
      if (!active) return false; active = false; entry.pins--; entry.used = ++useSequence;
      if (disposed && !entry.pins && !entry.waiters) retire(decoded, entry.key, entry, 'decoded');
      return true;
    } };
    return Object.freeze(lease);
  };
  const acquire = (input, { owner = 'anonymous', generation = 0, signal, isCurrent = () => true } = {}) => {
    let ref, context;
    try {
      ref = validateAudioAssetRef(input, assetLimits); context = getContext();
      if (disposed) throw fail('asset-loader-disposed', ref);
      if (typeof owner !== 'string' || !owner || !Number.isSafeInteger(generation) || generation < 0 ||
          !context?.decodeAudioData || !Number.isSafeInteger(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 192000 || context.state === 'closed') throw fail('decode-context-unavailable', ref);
    } catch (error) { return Promise.reject(error); }
    const key = ref.contentHash + ':' + context.sampleRate + ':' + DECODER_VERSION;
    let entry = decoded.get(key);
    if (entry && entry.fingerprint !== fingerprint(ref)) return Promise.reject(fail('asset-source-metadata-mismatch', ref));
    if (!entry) {
      const maximumFrames = Math.ceil(ref.frames * context.sampleRate / ref.sourceSampleRate) + 1, maximumBytes = maximumFrames * ref.channels * 4;
      if (maximumBytes > maxDecodedAssetBytes) return Promise.reject(fail('decoded-asset-byte-limit', ref));
      try { evict(decoded, 'decoded', maximumBytes); } catch (error) { return Promise.reject(error); }
      entry = { key, ref, fingerprint: fingerprint(ref), state: 'pending', pins: 0, waiters: 0, used: ++useSequence,
        sampleRate: context.sampleRate, bytes: maximumBytes, controller: new AbortController(), resource: null, value: null, promise: null };
      decoded.set(key, entry);
      entry.promise = decodeGate.run(async () => {
        let encoded = null, workspace = null;
        try {
          aborted(entry.controller.signal); encoded = await acquireRaw(ref, { signal: entry.controller.signal });
          evict(decoded, 'decoded', maximumBytes, maxDecodedBytes, false, true);
          entry.resource = resources.reserveDecodedBuffer({ frames: maximumFrames, channels: ref.channels, sampleRate: context.sampleRate }); decodedBytes += maximumBytes;
          workspace = resources.reserve({ kind: 'decode-input-and-workspace', bytes: ref.bytes, estimateBytes: maximumBytes });
          const input = encoded.bytes.slice().buffer; stats.decodes++; aborted(entry.controller.signal);
          const buffer = await context.decodeAudioData(input);
          entry.resource.validate(buffer);
          if (buffer.numberOfChannels !== ref.channels || Math.abs(buffer.length - ref.frames * context.sampleRate / ref.sourceSampleRate) > 1) throw fail('decoded-source-format-mismatch', ref);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let first = 0; first < samples.length; first += 65536) {
              aborted(entry.controller.signal);
              for (let frame = first; frame < Math.min(samples.length, first + 65536); frame++) if (!Number.isFinite(samples[frame])) throw fail('nonfinite-decoded-pcm', ref);
              if (samples.length > 65536) await yieldTask();
            }
          }
          aborted(entry.controller.signal); entry.resource.reconcile(buffer);
          const actualBytes = buffer.length * buffer.numberOfChannels * 4; decodedBytes += actualBytes - entry.bytes; entry.bytes = actualBytes;
          entry.value = buffer; entry.state = 'ready'; return entry;
        } catch (error) {
          failed(decoded, key, entry, 'decoded');
          throw error;
        } finally { workspace?.release(); encoded?.release(); }
      }, entry.controller.signal);
      entry.promise.catch(() => failed(decoded, key, entry, 'decoded'));
    } else stats.decodedHits++;
    return subscribe(entry, { signal, isCurrent }, value => decodedHandle(value, owner, generation, ref));
  };
  const downloadPack = async (packId, inputs, { signal, onProgress = () => {} } = {}) => {
    if (!rawStore?.put || typeof packId !== 'string' || !packId || packId.length > 128 || !Array.isArray(inputs) || inputs.length > maxEntries) throw fail('invalid-or-unavailable-pack-download');
    const refs = [...new Map(inputs.map(input => { const ref = validateAudioAssetRef(input, assetLimits); return [ref.contentHash, ref]; })).values()];
    if (!packs.has(packId) && packs.size >= 64) throw fail('pack-count-limit');
    let completedBytes = 0;
    for (const ref of refs) {
      const handle = await acquireRaw(ref, { signal }); let copy = null;
      try {
        aborted(signal); copy = resources.reserve({ kind: 'persistent-audio-write-copy', bytes: ref.bytes });
        await rawStore.put(ref.contentHash, handle.bytes); aborted(signal);
        const cached = raw.get(ref.contentHash); if (cached) cached.persisted = true; completedBytes += ref.bytes;
        try { onProgress(Object.freeze({ packId, completedBytes, totalBytes: refs.reduce((sum, item) => sum + item.bytes, 0) })); } catch { /* Progress is observation. */ }
      } finally { copy?.release(); handle.release(); }
    }
    packs.set(packId, Object.freeze(refs)); return Object.freeze({ status: 'offline-ready', packId, bytes: completedBytes, assets: refs.length });
  };
  const inspectPack = async (packId, inputs = packs.get(packId)) => {
    if (!Array.isArray(inputs)) return Object.freeze({ status: 'unknown-pack', packId });
    const refs = inputs.map(ref => validateAudioAssetRef(ref, assetLimits)), missingHashes = [];
    for (const ref of refs) if (!rawStore?.has || !await rawStore.has(ref.contentHash)) missingHashes.push(ref.contentHash);
    return Object.freeze({ status: missingHashes.length ? 'missing-assets' : 'offline-ready', packId,
      bytes: refs.reduce((sum, item) => sum + item.bytes, 0), missingHashes: Object.freeze(missingHashes), integrity: 'verified-on-read' });
  };
  const removePack = async (packId, { referencedBy = [], confirmReferenced = false } = {}) => {
    const refs = packs.get(packId); if (!refs) return Object.freeze({ status: 'unknown-pack', packId });
    if (referencedBy.length && !confirmReferenced) return Object.freeze({ status: 'referenced-by-project', packId,
      consequence: 'Future playback/export requires these exact assets to be downloaded again.', referencedBy: Object.freeze(referencedBy.slice(0, 32)) });
    let removedBytes = 0;
    for (const ref of refs) if (![...packs.entries()].some(([id, pack]) => id !== packId && pack.some(item => item.contentHash === ref.contentHash))) {
      await rawStore?.remove(ref.contentHash); const cached = raw.get(ref.contentHash); if (cached) cached.persisted = false; removedBytes += ref.bytes;
    }
    packs.delete(packId);
    return Object.freeze({ status: 'removed', packId, removedBytes, activePinsPreserved: true });
  };
  const purge = () => { evict(decoded, 'decoded', 0, maxDecodedBytes, true); evict(raw, 'raw', 0, maxRawBytes, true); };
  const diagnostics = () => Object.freeze({ ...stats, rawBytes, decodedBytes, rawEntries: raw.size, decodedEntries: decoded.size,
    activePins: [...decoded.values()].reduce((sum, entry) => sum + entry.pins, 0), fetch: fetchGate.diagnostics(), decode: decodeGate.diagnostics(),
    resources: resources.diagnostics(), maxRawBytes, maxDecodedBytes, maxEntries, disposed });
  const dispose = () => {
    if (disposed) return; disposed = true; unregister?.();
    for (const entry of [...raw.values(), ...decoded.values()]) entry.controller.abort();
    // Existing render pins outlive the loader. Native decode reservations remain
    // admitted until its non-abortable browser call returns and drops the result.
    for (const [map, kind] of [[raw, 'raw'], [decoded, 'decoded']]) {
      for (const [key, entry] of map) if (entry.state === 'ready' && !entry.pins && !entry.waiters) retire(map, key, entry, kind);
    }
    packs.clear();
  };
  return Object.freeze({ acquire, downloadPack, inspectPack, removePack, purge, diagnostics, dispose });
}

export function createAudioAssetSet({ loader, owner } = {}) {
  if (!loader?.acquire || typeof owner !== 'string' || !owner) throw new TypeError('Invalid prepared audio asset owner.');
  let current = Object.freeze([]), revision = 0, pending = null, disposed = false, lastError = null;
  const replace = async (refs, { generation = 0, signal } = {}) => {
    if (disposed || !Array.isArray(refs) || refs.length > 128) throw new AudioAssetError('invalid-asset-preparation');
    pending?.abort(); const controller = new AbortController(), request = ++revision; pending = controller;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    let firstError = null;
    const results = await Promise.allSettled(refs.map(ref => loader.acquire(ref, { owner, generation, signal: controller.signal,
      isCurrent: () => !disposed && request === revision }).catch(error => { if (!controller.signal.aborted) firstError = error; controller.abort(); throw error; })));
    signal?.removeEventListener('abort', cancel); if (pending === controller) pending = null;
    const staged = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (disposed || request !== revision || controller.signal.aborted || firstError) {
      for (const lease of staged) lease.release(); lastError = firstError || new AudioAssetError('asset-preparation-cancelled'); throw lastError;
    }
    const prior = current; current = Object.freeze(staged); for (const lease of prior) lease.release(); lastError = null;
    return Object.freeze({ status: 'ready', revision, assets: current });
  };
  return Object.freeze({ replace, snapshot: () => current,
    diagnostics: () => Object.freeze({ revision, readyAssets: current.length, preparing: !!pending, lastError: lastError?.reason || lastError?.message || null, disposed }),
    dispose: () => { if (disposed) return; disposed = true; revision++; pending?.abort(); pending = null; for (const lease of current) lease.release(); current = Object.freeze([]); } });
}
