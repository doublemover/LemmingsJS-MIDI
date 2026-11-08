import { WAVE_SOURCE_DECODER_VERSION, WAVE_DECODE_PROFILES } from './WaveSourceProfile.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { AudioAssetError, validateAudioAssetRef, inspectWaveAudio, DECODER_VERSION } from './AudioAssetRef.js';
import { createAudioResourceLeases } from './AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

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
  jobs = backgroundJobService, maxEntries = 128, fetchConcurrency = 2, decodeConcurrency = 2, assetLimits = {},
  digest = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join(''),
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (typeof jobs?.compute !== 'function' || typeof getContext !== 'function' || typeof digest !== 'function' || typeof yieldTask !== 'function' ||
      fetchAsset == null && typeof resolveAssetUrl !== 'function' ||
      [maxRawBytes, maxDecodedBytes, maxDecodedAssetBytes].some(value => !Number.isSafeInteger(value) || value < 4096 || value > 512 * 1024 * 1024) ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096 ||
      [fetchConcurrency, decodeConcurrency].some(value => !Number.isSafeInteger(value) || value < 1 || value > 16)) throw new TypeError('Invalid audio asset loader.');
  const ownerPrefix = 'audio-assets-' + (++loaderSequence), resources = createAudioResourceLeases({ resourceBudget, ownerPrefix, maxReservations: maxEntries * 8 });
  const raw = new Map(), decoded = new Map(), packs = new Map(), packOperations = new Map(), packTasks = new Set(), storeGate = makeGate(1, maxEntries), fetchGate = makeGate(fetchConcurrency, maxEntries), decodeGate = makeGate(decodeConcurrency, maxEntries);
  const fetchBytes = fetchAsset || ((ref, options) => globalThis.fetch(resolveAssetUrl(ref), { signal: options.signal }));
  let disposed = false, rawBytes = 0, decodedBytes = 0, useSequence = 0;
  const retirement = createProcgenRetirementScope();
  const stats = { fetches: 0, decodes: 0, rawHits: 0, decodedHits: 0, evictions: 0, failures: 0, cancellations: 0 };
  const fail = (reason, ref) => new AudioAssetError(reason, ref?.contentHash);
  const retire = (map, key, entry, kind) => {
    if (entry.retirement) return entry.retirement;
    entry.retirement = createProcgenRetirementScope().retire([{ name: kind + '-reservation', run: () => entry.resource?.release() }]);
    if (entry.retirement.outcome === 'complete') {
      if (map.get(key) === entry) map.delete(key);
      if (entry.resource) { if (kind === 'raw') rawBytes -= entry.bytes; else decodedBytes -= entry.bytes; }
      entry.resource = null; entry.value = null;
    } else {
      entry.state = 'retirement-failed';
    }
    return entry.retirement;
  };
  const evict = (map, kind, needed = 0, limit = kind === 'raw' ? maxRawBytes : maxDecodedBytes, all = false, inserted = false) => {
    const entryLimit = maxEntries + (inserted ? 1 : 0);
    const candidates = [...map.entries()].filter(([, entry]) => entry.state === 'ready' && entry.pins === 0 && entry.waiters === 0).sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of candidates) {
      if (!all && (kind === 'raw' ? rawBytes : decodedBytes) + needed <= limit && map.size < entryLimit) break;
      if (retire(map, key, entry, kind).outcome === 'complete') stats.evictions++;
    }
    if (!all && ((kind === 'raw' ? rawBytes : decodedBytes) + needed > limit || map.size >= entryLimit)) throw fail(kind + '-cache-budget-exhausted');
  };
  const failed = (map, key, entry, kind) => {
    if (entry.state !== 'pending') return;
    stats.failures++; entry.state = 'failed'; retire(map, key, entry, kind);
  };
  const unregister = resourceBudget?.registerEvictor?.(ownerPrefix, ({ neededBytes }) => {
    const before = resourceBudget.diagnostics().accountedBytes;
    const candidates = [[decoded, 'decoded'], [raw, 'raw']].flatMap(([map, kind]) => [...map].filter(([, entry]) =>
      entry.state === 'ready' && entry.pins === 0 && entry.waiters === 0).map(([key, entry]) => ({ map, kind, key, entry }))).sort((a, b) => a.entry.used - b.entry.used);
    for (const { map, kind, key, entry } of candidates) {
      if (before - resourceBudget.diagnostics().accountedBytes >= neededBytes) break;
      if (retire(map, key, entry, kind).outcome === 'complete') stats.evictions++;
    }
  });
  const afterRetirement = (entry, options, retry) => new Promise((resolve, reject) => {
    const signal = options.signal; let settled = false;
    const finish = action => { if (settled) return; settled = true; signal?.removeEventListener('abort', cancel); action(); };
    const cancel = () => finish(() => reject(fail('asset-request-cancelled', entry.ref)));
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    const resume = () => finish(() => {
      if (disposed || signal?.aborted || options.isCurrent && !options.isCurrent()) reject(fail('asset-request-cancelled', entry.ref));
      else if (entry.state === 'retirement-failed') reject(fail('asset-retirement-unknown', entry.ref));
      else { try { resolve(retry()); } catch (error) { reject(error); } }
    });
    entry.promise.then(resume, resume);
  });
  const subscribe = (entry, { signal, isCurrent = () => true, joinCancellation = false } = {}, handle) => new Promise((resolve, reject) => {
    let settled = false;
    entry.waiters++;
    const finish = () => {
      settled = true; signal?.removeEventListener('abort', cancel); entry.waiters--;
      if (!entry.waiters && entry.state === 'pending') entry.controller.abort();
    };
    const cancel = () => {
      if (settled) return; stats.cancellations++; finish();
      const cancelled = fail('asset-request-cancelled', entry.ref);
      if (joinCancellation) Promise.resolve(entry.promise).then(() => reject(cancelled), error => reject(entry.state === 'retirement-failed' ? error : cancelled));
      else reject(cancelled);
    };
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
    if (entry?.state === 'pending' && entry.controller.signal.aborted) return afterRetirement(entry, options, () => acquireRaw(ref, options));
    if (entry?.state === 'retirement-failed') return Promise.reject(fail('asset-retirement-unknown', ref));
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
      decoderVersion: entry.decoderVersion, ...(entry.pcmHash ? { pcmHash: entry.pcmHash } : {}), frames: entry.value.length, channels: entry.value.numberOfChannels }), owner, generation,
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
  const acquire = (input, { owner = 'anonymous', generation = 0, signal, isCurrent = () => true, decodeProfile = 'native-context',
    decodeContext = null, joinCancellation = false } = {}) => {
    let ref, context, sampleRate, decoderVersion;
    try {
      ref = validateAudioAssetRef(input, assetLimits);
      if (!WAVE_DECODE_PROFILES.includes(decodeProfile)) throw fail('decode-profile-unavailable', ref);
      if (typeof joinCancellation !== 'boolean' || decodeContext != null && (decodeProfile !== 'native-context' || !joinCancellation)) throw fail('decode-context-owner-required', ref);
      context = decodeProfile === 'native-context' ? decodeContext ?? getContext() : null;
      sampleRate = decodeProfile === 'source-pcm' ? ref.sourceSampleRate : context?.sampleRate; decoderVersion = decodeProfile === 'source-pcm' ? WAVE_SOURCE_DECODER_VERSION : DECODER_VERSION;
      if (disposed) throw fail('asset-loader-disposed', ref);
      if (typeof owner !== 'string' || !owner || !Number.isSafeInteger(generation) || generation < 0 ||
          decodeProfile === 'source-pcm' && ref.kind !== 'sample' || decodeProfile === 'native-context' && (!context?.decodeAudioData || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || context.state === 'closed')) throw fail('decode-context-unavailable', ref);
    } catch (error) { return Promise.reject(error); }
    const key = ref.contentHash + ':' + sampleRate + ':' + decoderVersion;
    let entry = decoded.get(key);
    if (entry?.state === 'pending' && entry.controller.signal.aborted) return afterRetirement(entry, { signal, isCurrent }, () =>
      acquire(input, { owner, generation, signal, isCurrent, decodeProfile, decodeContext, joinCancellation }));
    if (entry?.state === 'retirement-failed') return Promise.reject(fail('asset-retirement-unknown', ref));
    if (entry && entry.fingerprint !== fingerprint(ref)) return Promise.reject(fail('asset-source-metadata-mismatch', ref));
    if (!entry) {
      const maximumFrames = decodeProfile === 'source-pcm' ? ref.frames : Math.ceil(ref.frames * sampleRate / ref.sourceSampleRate) + 1, maximumBytes = maximumFrames * ref.channels * 4;
      if (maximumBytes > maxDecodedAssetBytes) return Promise.reject(fail('decoded-asset-byte-limit', ref));
      try { evict(decoded, 'decoded', maximumBytes); } catch (error) { return Promise.reject(error); }
      entry = { key, ref, fingerprint: fingerprint(ref), state: 'pending', pins: 0, waiters: 0, used: ++useSequence,
        sampleRate, decoderVersion, pcmHash: null, bytes: maximumBytes, controller: new AbortController(), resource: null, value: null, promise: null };
      decoded.set(key, entry);
      entry.promise = decodeGate.run(async () => {
        let encoded = null, workspace = null, job = null, producerUnknown = false;
        try {
          aborted(entry.controller.signal); encoded = await acquireRaw(ref, { signal: entry.controller.signal });
          evict(decoded, 'decoded', maximumBytes, maxDecodedBytes, false, true);
          entry.resource = resources.reserveDecodedBuffer({ frames: maximumFrames, channels: ref.channels, sampleRate }); decodedBytes += maximumBytes;
          const estimate = decodeProfile === 'source-pcm' ? Math.max(16 * 1048576, ref.bytes * 8 + maximumBytes * 4 + 1048576) : maximumBytes;
          workspace = resources.reserve({ kind: 'decode-input-and-workspace', bytes: ref.bytes, estimateBytes: estimate });
          stats.decodes++; aborted(entry.controller.signal); let buffer;
          if (decodeProfile === 'source-pcm') {
            job = await jobs.compute({ kind: 'decode-wave-source', ownerId: ownerPrefix + '-source', ownerEpoch: 0, sourceRevision: ref.contentHash,
              inputBytes: ref.bytes, maxBytes: ref.bytes, estimatedPeakBytes: estimate, signal: entry.controller.signal, isCurrent: () => !disposed,
              deadlineMs: 60000, prepareInput: () => ({ bytes: encoded.bytes, ref }) });
            const value = job.value;
            if (value.contentHash !== ref.contentHash || value.decoderVersion !== decoderVersion || !/^[a-f0-9]{64}$/.test(value.pcmHash) || value.sampleRate !== sampleRate ||
                value.frames !== ref.frames || value.channels !== ref.channels || !Array.isArray(value.planes) || value.planes.length !== ref.channels ||
                value.planes.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer) || plane.length !== ref.frames)) throw fail('decoded-source-format-mismatch', ref);
            const planes = Object.freeze([...value.planes]); entry.pcmHash = value.pcmHash;
            buffer = Object.freeze({ length: ref.frames, numberOfChannels: ref.channels, sampleRate, getChannelData(channel) {
              if (!Number.isInteger(channel) || channel < 0 || channel >= planes.length) throw new RangeError('Invalid source channel.'); return planes[channel];
            } });
          } else buffer = await context.decodeAudioData(encoded.bytes.slice().buffer);
          entry.resource.validate(buffer);
          if (buffer.numberOfChannels !== ref.channels || Math.abs(buffer.length - ref.frames * sampleRate / ref.sourceSampleRate) > 1) throw fail('decoded-source-format-mismatch', ref);
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
          entry.value = buffer; return entry;
        } catch (error) {
          if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
          if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) {
            producerUnknown = true; entry.state = 'retirement-failed'; entry.resource?.retainUnknown(error); workspace?.retainUnknown(error);
          }
          failed(decoded, key, entry, 'decoded');
          throw error;
        } finally {
          let cleanupError = null;
          try {
            job?.release();
            if (job && !['released', 'canceled'].includes(job.retirementState().phase)) throw fail('asset-retirement-unknown', ref);
          } catch (error) { producerUnknown = true; cleanupError = error; }
          if (!producerUnknown) {
            try { workspace?.release(); } catch (error) { cleanupError = error; }
            try { encoded?.release(); } catch (error) { cleanupError ||= error; }
          }
          if (producerUnknown || cleanupError) {
            const error = cleanupError || fail('asset-retirement-unknown', ref); entry.state = 'retirement-failed';
            entry.resource?.retainUnknown(error); workspace?.retainUnknown(error); throw error;
          }
          if (entry.state === 'pending') entry.state = 'ready';
        }
      }, entry.controller.signal);
      entry.promise.catch(() => failed(decoded, key, entry, 'decoded'));
    } else stats.decodedHits++;
    return subscribe(entry, { signal, isCurrent, joinCancellation }, value => decodedHandle(value, owner, generation, ref));
  };
  const beginPackOperation = (packId, refs, signal) => {
    if (disposed) throw fail('asset-loader-disposed');
    aborted(signal);
    if (typeof packId !== 'string' || !packId || packId.length > 128) throw fail('invalid-pack-id');
    if (!packs.has(packId) && !packOperations.has(packId) && new Set([...packs.keys(), ...packOperations.keys()]).size >= 64) throw fail('pack-count-limit');
    const operation = { packId, refs, signal };
    packOperations.set(packId, operation);
    operation.check = () => { aborted(signal); if (disposed || packOperations.get(packId) !== operation) throw fail('pack-operation-superseded'); };
    return operation;
  };
  const trackPack = (operation, action) => {
    const task = Promise.resolve().then(action); packTasks.add(task);
    return task.finally(() => { packTasks.delete(task); if (packOperations.get(operation.packId) === operation) packOperations.delete(operation.packId); });
  };
  const downloadPack = (packId, inputs, { signal, onProgress = () => {} } = {}) => {
    try {
      if (!rawStore?.put || !Array.isArray(inputs) || inputs.length > maxEntries) throw fail('invalid-or-unavailable-pack-download');
      const refs = Object.freeze([...new Map(inputs.map(input => { const ref = validateAudioAssetRef(input, assetLimits); return [ref.contentHash, ref]; })).values()]);
      const operation = beginPackOperation(packId, refs, signal), totalBytes = refs.reduce((sum, ref) => sum + ref.bytes, 0);
      return trackPack(operation, async () => {
        let completedBytes = 0;
        for (const ref of refs) {
          operation.check(); const handle = await acquireRaw(ref, { signal, isCurrent: () => packOperations.get(packId) === operation });
          try {
            operation.check();
            await storeGate.run(async () => {
              operation.check(); const copy = resources.reserve({ kind: 'persistent-audio-write-copy', bytes: ref.bytes });
              try { await rawStore.put(ref.contentHash, handle.bytes); operation.check(); const cached = raw.get(ref.contentHash); if (cached) cached.persisted = true; }
              finally { copy.release(); }
            }, signal);
            operation.check(); completedBytes += ref.bytes;
            try { onProgress(Object.freeze({ packId, completedBytes, totalBytes })); } catch { /* Progress is observation. */ }
          } finally { handle.release(); }
        }
        operation.check(); packs.set(packId, refs);
        return Object.freeze({ status: 'offline-ready', packId, bytes: completedBytes, assets: refs.length });
      });
    } catch (error) { return Promise.reject(error); }
  };
  const inspectPack = async (packId, inputs = packs.get(packId)) => {
    if (disposed || !Array.isArray(inputs)) return Object.freeze({ status: disposed ? 'disposed' : 'unknown-pack', packId });
    const published = packs.get(packId), operation = packOperations.get(packId);
    const refs = inputs.map(ref => validateAudioAssetRef(ref, assetLimits)), missingHashes = [];
    for (const ref of refs) {
      if (!rawStore?.has || !await rawStore.has(ref.contentHash)) missingHashes.push(ref.contentHash);
      if (disposed || packs.get(packId) !== published || packOperations.get(packId) !== operation) return Object.freeze({ status: 'superseded', packId });
    }
    return Object.freeze({ status: missingHashes.length ? 'missing-assets' : 'offline-ready', packId,
      bytes: refs.reduce((sum, item) => sum + item.bytes, 0), missingHashes: Object.freeze(missingHashes), integrity: 'verified-on-read' });
  };
  const removePack = (packId, { referencedBy = [], confirmReferenced = false } = {}) => {
    try {
      const refs = packs.get(packId) || packOperations.get(packId)?.refs;
      if (!refs) return Promise.resolve(Object.freeze({ status: 'unknown-pack', packId }));
      if (referencedBy.length && !confirmReferenced) return Promise.resolve(Object.freeze({ status: 'referenced-by-project', packId,
        consequence: 'Future playback/export requires these exact assets to be downloaded again.', referencedBy: Object.freeze(referencedBy.slice(0, 32)) }));
      const operation = beginPackOperation(packId, [], null);
      return trackPack(operation, async () => {
        let removedBytes = 0;
        for (const ref of refs) await storeGate.run(async () => {
          operation.check();
          const shared = [...packs].some(([id, pack]) => id !== packId && pack.some(item => item.contentHash === ref.contentHash)) ||
            [...packOperations].some(([id, work]) => id !== packId && work.refs.some(item => item.contentHash === ref.contentHash));
          if (shared) return;
          await rawStore?.remove(ref.contentHash); operation.check();
          const cached = raw.get(ref.contentHash); if (cached) cached.persisted = false; removedBytes += ref.bytes;
        });
        operation.check(); packs.delete(packId);
        return Object.freeze({ status: 'removed', packId, removedBytes, activePinsPreserved: true });
      });
    } catch (error) { return Promise.reject(error); }
  };
  const purge = () => { evict(decoded, 'decoded', 0, maxDecodedBytes, true); evict(raw, 'raw', 0, maxRawBytes, true); };
  const diagnostics = () => Object.freeze({ ...stats, rawBytes, decodedBytes, rawEntries: raw.size, decodedEntries: decoded.size,
    activePins: [...decoded.values()].reduce((sum, entry) => sum + entry.pins, 0), fetch: fetchGate.diagnostics(), decode: decodeGate.diagnostics(),
    resources: resources.diagnostics(), pendingPackOperations: packTasks.size, maxRawBytes, maxDecodedBytes, maxEntries, disposed });
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
    const entries = [...raw.values(), ...decoded.values()], pending = entries.filter(entry => entry.state === 'pending');
    const retireUnpinned = () => createProcgenRetirementScope().retire([[raw, 'raw'], [decoded, 'decoded']].flatMap(([map, kind]) =>
      [...map].filter(([, entry]) => entry.state !== 'pending' && !entry.pins && !entry.waiters)
        .map(([key, entry]) => ({ name: kind + '-' + key, run: () => retire(map, key, entry, kind) }))));
    return retirement.retire([
      { name: 'budget-evictor', run: () => unregister?.() },
      ...entries.map((entry, index) => ({ name: 'request-' + index, run: () => entry.controller.abort() })),
      { name: 'unpinned-assets', run: retireUnpinned },
      ...(pending.length ? [{ name: 'pending-native-assets', run: () => Promise.allSettled(pending.map(entry => entry.promise)).then(retireUnpinned) }] : []),
      { name: 'pack-index', run: () => { packs.clear(); packOperations.clear(); } },
      { name: 'pending-pack-storage', run: () => Promise.allSettled([...packTasks]) }
    ]);
  };
  return Object.freeze({ acquire, downloadPack, inspectPack, removePack, purge, diagnostics, dispose });
}

export function createAudioAssetSet({ loader, owner } = {}) {
  if (!loader?.acquire || typeof owner !== 'string' || !owner) throw new TypeError('Invalid prepared audio asset owner.');
  let current = Object.freeze([]), revision = 0, pending = null, disposed = false, lastError = null;
  let cleanupFault = null;
  const retirement = createProcgenRetirementScope(), failedReleases = new Map();
  const releaseAssets = assets => {
    const receipt = createProcgenRetirementScope().retire(assets.map((lease, index) => ({ name: 'asset-pin-' + index, run: () => lease.release() })));
    if (receipt.outcome !== 'complete') {
      cleanupFault = receipt; failedReleases.set(receipt, assets);
      receipt.completion.then(result => { if (result.outcome === 'complete') { failedReleases.delete(result); if (cleanupFault === result) cleanupFault = null; } });
    }
    return receipt;
  };
  const summary = receipt => receipt ? Object.freeze({ state: receipt.state, outcome: receipt.outcome }) : null;
  const replace = async (refs, { generation = 0, signal } = {}) => {
    if (disposed || !Array.isArray(refs) || refs.length > 128) throw new AudioAssetError('invalid-asset-preparation');
    if (cleanupFault) throw new AudioAssetError('asset-retirement-unknown');
    pending?.abort(); const controller = new AbortController(), request = ++revision; pending = controller;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    let firstError = null;
    const results = await Promise.allSettled(refs.map(ref => loader.acquire(ref, { owner, generation, signal: controller.signal,
      isCurrent: () => !disposed && request === revision }).catch(error => { if (!controller.signal.aborted) firstError = error; controller.abort(); throw error; })));
    signal?.removeEventListener('abort', cancel); if (pending === controller) pending = null;
    const staged = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (disposed || cleanupFault || request !== revision || controller.signal.aborted || firstError) {
      const receipt = releaseAssets(staged); lastError = firstError || new AudioAssetError('asset-preparation-cancelled'); lastError.retirement = receipt; throw lastError;
    }
    const prior = current; current = Object.freeze(staged); const receipt = releaseAssets(prior); lastError = null;
    return Object.freeze({ status: 'ready', revision, assets: current, retirement: summary(receipt) });
  };
  return Object.freeze({ replace, snapshot: () => current,
    diagnostics: () => Object.freeze({ revision, readyAssets: current.length, preparing: !!pending, lastError: lastError?.reason || lastError?.message || null,
      retirement: summary(cleanupFault), disposed }),
    dispose: () => {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; revision++;
      return retirement.retire([
        { name: 'pending-preparation', run: () => { pending?.abort(); pending = null; } },
        { name: 'current-assets', run: () => releaseAssets(current) },
        ...[...failedReleases.keys()].map((receipt, index) => ({ name: 'prior-release-' + index, run: () => receipt })),
        { name: 'asset-references', run: () => { current = Object.freeze([]); } }
      ]);
    } });
}
