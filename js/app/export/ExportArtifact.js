import { MAX_BROWSER_DOWNLOAD_BYTES, requestBrowserDownload } from './BrowserDownload.js';
import { acquireNativeExportDeliveryOwner } from './NativeExportDeliveryOwner.js';

let nextArtifact = 0, nextDelivery = 0;
const MAX_DIGEST_BYTES = 8 * 1048576;
const DEFAULT_LIFETIME_MS = 10 * 60 * 1000;
const MAX_ARTIFACT_LEASES = 32;
const bytesFor = (value, maxBytes, mediaType) => {
  if (value instanceof Blob) {
    if (value.size > maxBytes) throw new RangeError('Prepared export exceeds its staging limit.');
    return value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    if (value.byteLength > maxBytes) throw new RangeError('Prepared export exceeds its staging limit.');
    // Blob construction snapshots mutable buffers without retaining a second manual copy.
    return new Blob([value], { type: mediaType });
  }
  if (typeof value === 'string') {
    if (value.length > maxBytes) throw new RangeError('Prepared export exceeds its staging limit.');
    const encoder = new TextEncoder(), parts = [];
    let total = 0;
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 65536, value.length);
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      const part = encoder.encode(value.slice(start, end));
      total += part.byteLength;
      if (total > maxBytes) throw new RangeError('Prepared export exceeds its staging limit.');
      parts.push(part); start = end;
    }
    return new Blob(parts, { type: mediaType });
  }
  throw new TypeError('Export bytes must be text, a byte view, an ArrayBuffer or a Blob.');
};
const errorKind = error => error?.name === 'AbortError' ? 'cancelled' : error?.name === 'NotAllowedError' ? 'permission-denied' :
  error?.name === 'QuotaExceededError' ? 'storage-full' : error?.name === 'TimeoutError' ? 'timeout' : 'sink-error';
const nextId = kind => `${kind}-${Date.now().toString(36)}-${kind === 'artifact' ? ++nextArtifact : ++nextDelivery}`;
const artifactClock = clock => {
  if (typeof clock !== 'function') throw new TypeError('Invalid prepared artifact clock.');
  const value = clock(); if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER - 86400000) throw new TypeError('Invalid prepared artifact clock reading.'); return value;
};
const createArtifactLifetime = ({ clock, createdAt, lifetimeMs, onRetire }) => {
  const expiresAt = createdAt + lifetimeMs, listeners = new Set(); let retired = false, reason = null, observed = createdAt;
  const retire = why => {
    if (retired) return; retired = true; reason = why; clearTimeout(timer);
    for (const callback of listeners) { try { callback(); } catch { /* One observer cannot prevent retirement. */ } } listeners.clear();
    try { onRetire(); } catch { /* Source ownership exposes its retained failure separately. */ }
  };
  const timer = setTimeout(() => retire('expired'), lifetimeMs); timer.unref?.();
  const check = () => {
    if (!retired) { try { observed = Math.max(observed, artifactClock(clock)); if (observed >= expiresAt) retire('expired'); } catch { retire('clock-unavailable'); } }
    return !retired;
  };
  return Object.freeze({ expiresAt, check, isRetired: () => retired, reason: () => reason, discard: () => retire('discarded'),
    observe(callback) { if (typeof callback !== 'function') throw new TypeError('Artifact observer must be a function.');
      check(); if (retired) { try { callback(); } catch { /* Already-retired observation remains harmless. */ } return () => {}; }
      listeners.add(callback); return () => listeners.delete(callback);
    }
  });
};
const waitForSink = (work, signal, timeoutMs = 30000) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
  const abort = () => finish(reject, signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('Export delivery canceled.'), { name: 'AbortError' }));
  const timer = setTimeout(() => finish(reject, Object.assign(new Error('Export sink deadline exceeded.'), { name: 'TimeoutError' })), timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) { Promise.resolve(work).catch(() => {}); abort(); return; }
  Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error));
});

export function prepareExportArtifact({ bytes, immutableSourceRef, formatVersion, mediaType = 'application/octet-stream',
  suggestedFilename, coverageLossReportRef = null, lifetimeMs = DEFAULT_LIFETIME_MS,
  maxBytes = MAX_BROWSER_DOWNLOAD_BYTES, clock = Date.now, budgetAdapter = null } = {}) {
  if (typeof immutableSourceRef !== 'string' || !immutableSourceRef || typeof formatVersion !== 'string' || !formatVersion)
    throw new TypeError('Export source and format version are required.');
  if (coverageLossReportRef != null && typeof coverageLossReportRef !== 'string') throw new TypeError('Coverage report reference must be a string.');
  if (typeof suggestedFilename !== 'string' || !suggestedFilename || suggestedFilename.length > 160 || /[\\/\x00-\x1f]/.test(suggestedFilename))
    throw new TypeError('Invalid export filename.');
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 24 * 60 * 60 * 1000) throw new RangeError('Invalid artifact lifetime.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BROWSER_DOWNLOAD_BYTES) throw new RangeError('Invalid export staging limit.');
  const createdAt = artifactClock(clock);
  const budgetToken = {};
  const predictedBytes = Math.min(maxBytes, typeof bytes === 'string' ? bytes.length * 3 :
    bytes instanceof Blob ? bytes.size : bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes) ? bytes.byteLength : maxBytes);
  let blob, budgetHeld = false;
  try {
    if (budgetAdapter && predictedBytes) { budgetAdapter.reserve({ token: budgetToken, owner: 'export', kind: 'export', bytes: predictedBytes,
      previousBytes: 0, pinned: true, reloadable: false }); budgetHeld = true; }
    blob = bytesFor(bytes, maxBytes, mediaType);
    if (budgetAdapter && (budgetHeld || blob.size)) { budgetAdapter.reserve({ token: budgetToken, owner: 'export', kind: 'export', bytes: blob.size,
      previousBytes: predictedBytes, pinned: true, reloadable: false }); budgetHeld = blob.size > 0; }
  } catch (error) {
    if (budgetHeld) { try { const ack = budgetAdapter.release({ token: budgetToken, owner: 'export' });
      if (ack === false || ack && typeof ack.then === 'function') { if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('Export preparation reservation release was not acknowledged.'); }
    } catch (retirementError) { throw Object.assign(new Error('Export preparation failed with unresolved reservation retirement.'), { cause: error, retirementError }); } }
    throw error;
  }
  const artifactId = nextId('artifact'), byteLength = blob.size;
  let lifetime = null, leases = 0, digestState = blob.size <= MAX_DIGEST_BYTES ? 'pending' : 'omitted-over-budget', digest = null;
  let digestPending = digestState === 'pending', releaseAttempted = false, releaseError = null;
  const retireBlob = () => {
    if (!lifetime?.isRetired() || leases || digestPending) return;
    blob = null;
    if (budgetHeld) {
      if (releaseAttempted) throw releaseError;
      releaseAttempted = true; releaseError = new Error('Export reservation release is already retiring or failed.');
      try {
        const acknowledged = budgetAdapter.release({ token: budgetToken, owner: 'export' });
        if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
          if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {});
          throw new Error('Export reservation release was not acknowledged synchronously.');
        }
      } catch (error) { releaseError = error; throw error; }
      budgetHeld = false; releaseError = null;
    }
  };
  lifetime = createArtifactLifetime({ clock, createdAt, lifetimeMs, onRetire: retireBlob });
  const digestPromise = digestState === 'pending' ? (async () => {
    try {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) { digestState = 'unavailable'; return null; }
      const bytes = await blob.arrayBuffer(), hash = await subtle.digest('SHA-256', bytes);
      digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      digestState = 'ready'; return digest;
    } catch { digestState = 'unavailable'; return null; }
    finally { digestPending = false; try { retireBlob(); } catch { /* The retained release failure is exposed in artifact metadata. */ } }
  })() : Promise.resolve(null);
  const metadata = () => { const retained = lifetime.check(); return Object.freeze({ artifactId, immutableSourceRef, formatVersion, mediaType, suggestedFilename,
    byteLength, deliveryModes: Object.freeze(['anchor', 'file-handle']), digestState, sha256: digest,
    coverageLossReportRef, expiresAt: lifetime.expiresAt, retained, retirementReason: lifetime.reason(), activeLeases: leases, maxConsumerLeases: MAX_ARTIFACT_LEASES,
    budgetState: releaseError ? 'failed-or-unknown' : budgetHeld ? !retained ? 'waiting-for-leases-or-digest' : 'retained' : budgetAdapter ? 'released' : 'unbudgeted' }); };
  return Object.freeze({ artifactId, metadata, digest: () => digestPromise,
    onDiscard: lifetime.observe,
    borrow() {
      if (!lifetime.check()) throw Object.assign(new Error('Prepared export has expired.'), { kind: 'artifact-expired' });
      if (leases >= MAX_ARTIFACT_LEASES) throw Object.assign(new Error('Prepared export consumer capacity reached.'), { kind: 'artifact-capacity' });
      leases++;
      let released = false, leasedBlob = blob;
      return Object.freeze({ get blob() { if (released) throw new Error('Export delivery lease was released.'); return leasedBlob; },
        release() { if (!released) { released = true; leasedBlob = null; leases--; retireBlob(); } } });
    },
    discard() {
      lifetime.discard();
      retireBlob();
      return metadata();
    } });
}

// The caller retains an immutable encoder snapshot and supplies a fresh chunk
// iterator for every retry. No complete Blob is materialized by this artifact.
export function prepareReplayableExportArtifact({ openChunks, immutableSourceRef, formatVersion,
  mediaType = 'application/octet-stream', suggestedFilename, byteLength = null,
  streamingEstimate = null, coverageLossReportRef = null, lifetimeMs = DEFAULT_LIFETIME_MS,
  maxDeliveryBytes = 512 * 1048576, clock = Date.now } = {}) {
  if (typeof openChunks !== 'function' || typeof immutableSourceRef !== 'string' || !immutableSourceRef ||
      typeof formatVersion !== 'string' || !formatVersion || typeof suggestedFilename !== 'string' ||
      !suggestedFilename || suggestedFilename.length > 160 || /[\\/\x00-\x1f]/.test(suggestedFilename) ||
      byteLength != null && (!Number.isSafeInteger(byteLength) || byteLength < 0) ||
      streamingEstimate != null && (!Number.isSafeInteger(streamingEstimate) || streamingEstimate < 0) ||
      !Number.isSafeInteger(maxDeliveryBytes) || maxDeliveryBytes < 1 || maxDeliveryBytes > 2 ** 31 ||
      byteLength != null && byteLength > maxDeliveryBytes ||
      !Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 24 * 60 * 60 * 1000 ||
      coverageLossReportRef != null && typeof coverageLossReportRef !== 'string') throw new TypeError('Invalid replayable export artifact.');
  const createdAt = artifactClock(clock), artifactId = nextId('artifact');
  let leases = 0, sourceOpener = openChunks, unknownSources = 0, lifetime = null;
  const retireSource = () => { if (lifetime?.isRetired() && !leases) sourceOpener = null; };
  lifetime = createArtifactLifetime({ clock, createdAt, lifetimeMs, onRetire: retireSource });
  const metadata = () => { const retained = lifetime.check(); return Object.freeze({ artifactId, immutableSourceRef, formatVersion, mediaType,
    suggestedFilename, byteLength, streamingEstimate, maxDeliveryBytes,
    deliveryModes: Object.freeze(['file-handle']), digestState: 'omitted-streaming',
    sha256: null, coverageLossReportRef, expiresAt: lifetime.expiresAt, retained, retirementReason: lifetime.reason(), activeLeases: leases, maxConsumerLeases: MAX_ARTIFACT_LEASES,
    sourceRetirement: unknownSources ? 'failed-or-unknown' : !sourceOpener ? 'released' : retained ? 'retained' : 'waiting-for-source-leases' }); };
  return Object.freeze({ artifactId, metadata, digest: () => Promise.resolve(null),
    onDiscard: lifetime.observe,
    borrow() {
      if (!lifetime.check()) throw Object.assign(new Error('Prepared export has expired.'), { kind: 'artifact-expired' });
      if (leases >= MAX_ARTIFACT_LEASES) throw Object.assign(new Error('Prepared export consumer capacity reached.'), { kind: 'artifact-capacity' });
      leases++;
      let released = false, opened = false, retired = false, source = null, iterator = null, pending = 0, ended = false, returnPromise = null, sourceError = null;
      let opener = sourceOpener, complete; const sourceController = new AbortController();
      const settlement = new Promise(resolve => { complete = resolve; });
      const acknowledge = () => { if (!retired && released && !pending && (!opened || ended) && !sourceError) {
        retired = true; source = null; iterator = null; opener = null; leases--; retireSource(); complete();
      } };
      const invoke = (method, value) => {
        pending++; const target = iterator;
        const result = Promise.resolve().then(() => target[method](value));
        return result.then(item => { if (!item || typeof item.done !== 'boolean') throw new Error('Replayable iterator returned invalid progress.');
          if (item.done) { ended = true; if (sourceError) { sourceError = null; unknownSources--; } } return released ? { done: true, value: undefined } : item;
        }).catch(error => { if (!ended && !sourceError) { sourceError = error; unknownSources++; } throw error; })
          .finally(() => { pending--; acknowledge(); });
      };
      const closeSource = () => {
        sourceController.abort(Object.assign(new Error('Replayable export source retired.'), { name: 'AbortError' }));
        if (returnPromise) return returnPromise;
        if (!opened || ended) { ended = true; acknowledge(); return Promise.resolve({ done: true }); }
        if (typeof iterator?.return !== 'function') { if (!sourceError) { sourceError = new Error('Replayable source cannot acknowledge cancellation.'); unknownSources++; } return Promise.reject(sourceError); }
        returnPromise = invoke('return'); returnPromise.catch(() => {}); return returnPromise;
      };
      return Object.freeze({ settlement, releaseState: () => retired ? 'released' : sourceError ? 'failed-or-unknown' : released ? 'pending-native-settlement' : 'borrowed',
        openChunks() {
          if (released || !lifetime.check()) throw Object.assign(new Error('Replayable delivery lease is retired.'), { kind: 'artifact-expired' });
          if (opened) throw new Error('A delivery lease opens its source only once.');
          opened = true;
          source = opener({ signal: sourceController.signal });
          if (!source || typeof source[Symbol.asyncIterator] !== 'function') throw Object.assign(new Error('Replayable source is not an async iterable.'), { kind: 'invalid-source' });
          iterator = source[Symbol.asyncIterator]();
          if (!iterator || typeof iterator.next !== 'function') throw Object.assign(new Error('Replayable source has no iterator.'), { kind: 'invalid-source' });
          return Object.freeze({ [Symbol.asyncIterator]() { return this; }, next(value) {
            if (released || !lifetime.check()) return Promise.reject(Object.assign(new Error('Replayable delivery lease is retired.'), { kind: 'artifact-expired' }));
            if (pending) return Promise.reject(new Error('Replayable delivery reads must be sequential.')); return invoke('next', value);
          }, return: closeSource });
        }, release() { if (!released) { released = true; if (opened && !ended) closeSource().catch(() => {}); acknowledge(); } } });
    },
    discard() {
      lifetime.discard(); retireSource();
      return metadata();
    } });
}

export function deliverArtifactToAnchor(artifact, { document, windowRef = globalThis } = {}) {
  const deliveryId = nextId('delivery'), { suggestedFilename, artifactId } = artifact.metadata();
  let lease, urlOwnsSource = false, urlRetired = false;
  try {
    lease = artifact.borrow();
    if (!lease.blob) return Object.freeze({ deliveryId, artifactId, sinkKind: 'anchor', state: 'unsupported',
      bytesWritten: 0, errorKind: 'streaming-source-requires-file-handle', evidence: 'no-bounded-blob' });
    const requested = requestBrowserDownload({ document, windowRef, bytes: lease.blob,
      filename: suggestedFilename, mediaType: artifact.metadata().mediaType,
      onURLAcquired: () => { urlOwnsSource = true; },
      onURLRetired: receipt => { urlRetired = receipt.state === 'revoked'; urlOwnsSource = !urlRetired; if (urlRetired) lease.release(); } });
    urlOwnsSource = !urlRetired;
    return Object.freeze({ deliveryId, artifactId, sinkKind: 'anchor', state: requested.state,
      bytesWritten: 0, errorKind: null, evidence: requested.evidence });
  } catch (error) {
    return Object.freeze({ deliveryId, artifactId, sinkKind: 'anchor', state: 'failed', bytesWritten: 0,
      errorKind: error.kind || errorKind(error), evidence: 'anchor-request-failed' });
  } finally { if (!urlOwnsSource) lease?.release(); }
}

export async function requestExportFileHandle(artifact, { windowRef = globalThis } = {}) {
  const { suggestedFilename } = artifact.metadata();
  try { artifact.borrow().release(); }
  catch (error) { return { state: 'failed', handle: null, errorKind: error.kind || errorKind(error) }; }
  if (typeof windowRef.showSaveFilePicker !== 'function') return { state: 'unsupported', handle: null, errorKind: 'unsupported-sink' };
  try {
    // Invoke the picker before the first await; transient user activation belongs to this call.
    const pending = windowRef.showSaveFilePicker({ suggestedName: suggestedFilename });
    return { state: 'selected', handle: await pending, errorKind: null };
  } catch (error) { return { state: errorKind(error) === 'cancelled' ? 'canceled' : 'failed', handle: null, errorKind: errorKind(error) }; }
}

export async function deliverArtifactToFileHandle(artifact, handle, { signal, onProgress = () => {}, maxDeliveryMs = 300000,
  clock = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  if (!Number.isFinite(maxDeliveryMs) || maxDeliveryMs < 1 || maxDeliveryMs > 900000) throw new RangeError('Invalid export delivery deadline.');
  if (typeof clock !== 'function') throw new TypeError('Invalid export delivery clock.');
  if (typeof onProgress !== 'function' || !artifact?.metadata || !artifact?.borrow || !artifact?.onDiscard ||
      signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean')) throw new TypeError('Invalid export delivery owner.');
  const deliveryId = nextId('delivery'), { artifactId } = artifact.metadata();
  let observedTime = clock();
  if (!Number.isFinite(observedTime)) throw new TypeError('Invalid export delivery clock reading.');
  const startedAt = observedTime, deadline = startedAt + maxDeliveryMs;
  const nativeOwner = acquireNativeExportDeliveryOwner();
  if (!nativeOwner) return Object.freeze({ deliveryId, artifactId, sinkKind: 'file-handle', state: 'unsupported', bytesWritten: 0,
    errorKind: 'native-delivery-capacity', evidence: 'no-native-admission', abortAttempted: false, abortAcknowledged: false, deadlineExceeded: false,
    elapsedMs: 0, nativeRetirement: 'not-admitted', nativePendingCalls: 0 });
  const ownerAbort = new AbortController();
  const forwardAbort = () => { const reason = artifact.metadata().retirementReason;
    ownerAbort.abort(reason === 'expired' ? Object.assign(new Error('Prepared export expired during delivery.'), { kind: 'artifact-expired' }) :
      reason === 'clock-unavailable' ? Object.assign(new Error('Prepared export clock became unavailable.'), { kind: 'artifact-clock-unavailable' }) : Object.assign(new Error('Export delivery canceled.'), { name: 'AbortError' }));
  };
  let unwatch = () => {};
  try { signal?.addEventListener('abort', forwardAbort, { once: true }); unwatch = artifact.onDiscard(forwardAbort);
    if (typeof unwatch !== 'function') throw new TypeError('Invalid artifact observer release.');
    if (signal?.aborted) ownerAbort.abort();
  } catch (error) { nativeOwner.close(); signal?.removeEventListener('abort', forwardAbort); throw error; }
  const preflight = () => {
    if (!artifact.metadata().retained) forwardAbort();
    if (ownerAbort.signal.aborted) throw ownerAbort.signal.reason || Object.assign(new Error('Export delivery canceled.'), { name: 'AbortError' });
    const reading = clock();
    if (!Number.isFinite(reading)) throw Object.assign(new TypeError('Invalid export delivery clock reading.'), { kind: 'delivery-clock-unavailable' });
    observedTime = Math.max(observedTime, reading);
    if (observedTime >= deadline) throw Object.assign(new Error('Export delivery deadline exceeded.'), { name: 'TimeoutError' });
    return Math.min(30000, deadline - observedTime);
  };
  const wait = (start, options) => {
    const remaining = preflight();
    return waitForSink(nativeOwner.track(() => { preflight(); return start(); }, options), ownerAbort.signal, remaining);
  };
  let lease, writable, reader, iterator, bytesWritten = 0, phase = 'opening', abortAttempted = false, abortAcknowledged = false, retired = false;
  let state = 'failed', kind = null, evidence = null;
  try {
    preflight();
    lease = artifact.borrow();
    nativeOwner.attachLease(lease);
    writable = await wait(() => {
      const opening = Promise.resolve(handle.createWritable({ keepExistingData: false }));
      return opening.then(async opened => {
        nativeOwner.acquireWriter(opened);
        if (retired || ownerAbort.signal.aborted) {
          if (typeof opened.abort !== 'function') { nativeOwner.unknown(new Error('Late native writable cannot acknowledge abort.')); throw new Error('Late native writable cannot acknowledge abort.'); }
          await nativeOwner.track(() => opened.abort(), { terminal: 'aborted' });
          throw ownerAbort.signal.reason || Object.assign(new Error('Export delivery retired before opening completed.'), { name: 'AbortError' });
        }
        return opened;
      });
    });
    preflight();
    if (lease.blob) reader = lease.blob.stream().getReader();
    else iterator = lease.openChunks()[Symbol.asyncIterator]();
    phase = 'writing';
    while (true) {
      phase = 'reading';
      const { done, value } = await wait(() => reader ? reader.read() : iterator.next());
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Object.assign(new Error('Export source yielded invalid bytes.'), { kind: 'invalid-source' });
      if (bytesWritten + value.byteLength > (artifact.metadata().maxDeliveryBytes || MAX_BROWSER_DOWNLOAD_BYTES))
        throw Object.assign(new Error('Export stream exceeded its declared limit.'), { kind: 'artifact-limit' });
      phase = 'writing';
      await wait(() => writable.write(value));
      bytesWritten += value.byteLength;
      try { onProgress(bytesWritten, artifact.metadata().byteLength ?? artifact.metadata().streamingEstimate); } catch { /* Presentation callbacks cannot fail delivery. */ }
    }
    if (artifact.metadata().byteLength != null && bytesWritten !== artifact.metadata().byteLength)
      throw Object.assign(new Error('Export source length changed.'), { kind: 'source-length-mismatch' });
    phase = 'closing'; await wait(() => writable.close(), { terminal: 'closed' }); writable = null;
    state = 'close-acknowledged'; evidence = 'writable-close-resolved';
  } catch (error) { kind = error.kind || errorKind(error); state = kind === 'cancelled' ? 'canceled' : 'failed'; evidence = phase; }
  finally {
    retired = true;
    try { if (reader) await waitForSink(nativeOwner.track(async () => { try { await reader.cancel(); } finally { reader.releaseLock(); } }), null, 2000); } catch { /* Accepted cleanup remains owned until actual settlement. */ }
    try { if (iterator?.return) await waitForSink(nativeOwner.track(() => iterator.return()), null, 2000); } catch { /* Accepted source cancellation remains inventoried. */ }
    if (writable) {
      abortAttempted = true;
      try { if (typeof writable.abort === 'function') { await waitForSink(nativeOwner.track(() => writable.abort(), { terminal: 'aborted' }), null, 2000); abortAcknowledged = true; }
      else nativeOwner.unknown(new Error('Native writable has no abort acknowledgment.')); }
      catch (error) { nativeOwner.unknown(error); }
    }
    nativeOwner.close();
    unwatch(); signal?.removeEventListener('abort', forwardAbort);
  }
  let finalTime;
  try { finalTime = clock(); } catch { kind ||= 'delivery-clock-unavailable'; }
  if (!Number.isFinite(finalTime)) kind ||= 'delivery-clock-unavailable';
  if (Number.isFinite(finalTime)) observedTime = Math.max(observedTime, finalTime);
  const native = nativeOwner.inspect();
  if (native.terminal === 'closed') { state = 'close-acknowledged'; evidence = 'writable-close-resolved'; }
  return Object.freeze({ deliveryId, artifactId, sinkKind: 'file-handle', state, bytesWritten,
    errorKind: kind, evidence, abortAttempted, abortAcknowledged,
    deadlineExceeded: kind === 'timeout' || observedTime >= deadline, elapsedMs: observedTime - startedAt,
    nativeRetirement: native.state, nativePendingCalls: native.pendingCalls, cancelRequested: ownerAbort.signal.aborted });
}

export function aggregateExportDeliveries(receipts) {
  const list = Array.from(receipts || []);
  return Object.freeze({ state: !list.length ? 'empty' : list.every(item => item.state === 'close-acknowledged') ? 'close-acknowledged' :
    list.some(item => ['failed', 'canceled', 'unsupported'].includes(item.state)) ? 'partial' : 'delivery-requested',
  complete: !!list.length && list.every(item => item.state === 'close-acknowledged'), receipts: Object.freeze(list) });
}

export function createExportDeliveryManifest(entries) {
  if (!Array.isArray(entries) || entries.length > 64) throw new TypeError('Invalid export delivery group.');
  const ids = new Set();
  const files = entries.map(({ artifact, receipts = [] }) => {
    if (!artifact || typeof artifact.metadata !== 'function' || !Array.isArray(receipts)) throw new TypeError('Invalid export delivery entry.');
    const source = artifact.metadata();
    if (ids.has(source.artifactId) || receipts.some(receipt => receipt?.artifactId !== source.artifactId))
      throw new TypeError('Duplicate artifact or receipt from another source.');
    ids.add(source.artifactId);
    const last = receipts.at(-1) || null;
    return Object.freeze({ artifactId: source.artifactId, immutableSourceRef: source.immutableSourceRef,
      formatVersion: source.formatVersion, suggestedFilename: source.suggestedFilename,
      byteLength: source.byteLength, sha256: source.sha256, digestState: source.digestState,
      state: last?.state || 'ready', completed: last?.state === 'close-acknowledged',
      attempts: Object.freeze([...receipts]) });
  });
  const complete = files.length > 0 && files.every(file => file.completed);
  return Object.freeze({ schema: 'export-delivery-manifest/v1', state: !files.length ? 'empty' :
    complete ? 'close-acknowledged' : files.some(file => file.state === 'failed' || file.state === 'canceled') ? 'partial' :
      'delivery-requested', complete, files: Object.freeze(files) });
}
