import { MAX_BROWSER_DOWNLOAD_BYTES, requestBrowserDownload } from './BrowserDownload.js';

let nextArtifact = 0, nextDelivery = 0;
const MAX_DIGEST_BYTES = 8 * 1048576;
const DEFAULT_LIFETIME_MS = 10 * 60 * 1000;
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
const waitForSink = (work, signal, timeoutMs = 30000) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
  const abort = () => finish(reject, Object.assign(new Error('Export delivery canceled.'), { name: 'AbortError' }));
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
  const budgetToken = {};
  const predictedBytes = Math.min(maxBytes, typeof bytes === 'string' ? bytes.length * 3 :
    bytes instanceof Blob ? bytes.size : bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes) ? bytes.byteLength : maxBytes);
  let blob, budgetHeld = false;
  try {
    if (budgetAdapter) { budgetAdapter.reserve({ token: budgetToken, owner: 'export', kind: 'export', bytes: predictedBytes,
      previousBytes: 0, pinned: true, reloadable: false }); budgetHeld = true; }
    blob = bytesFor(bytes, maxBytes, mediaType);
    budgetAdapter?.reserve({ token: budgetToken, owner: 'export', kind: 'export', bytes: blob.size,
      previousBytes: predictedBytes, pinned: true, reloadable: false });
  } catch (error) { if (budgetHeld) budgetAdapter?.release({ token: budgetToken, owner: 'export' }); throw error; }
  const artifactId = nextId('artifact'), expiresAt = clock() + lifetimeMs, byteLength = blob.size;
  let discarded = false, leases = 0, digestState = blob.size <= MAX_DIGEST_BYTES ? 'pending' : 'omitted-over-budget', digest = null;
  let digestPending = digestState === 'pending', releaseAttempted = false, releaseError = null;
  const retireBlob = () => {
    if (!discarded || leases || digestPending) return;
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
  const discardListeners = new Set();
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
  const metadata = () => Object.freeze({ artifactId, immutableSourceRef, formatVersion, mediaType, suggestedFilename,
    byteLength, deliveryModes: Object.freeze(['anchor', 'file-handle']), digestState, sha256: digest,
    coverageLossReportRef, expiresAt, retained: !discarded, activeLeases: leases,
    budgetState: releaseError ? 'failed-or-unknown' : budgetHeld ? discarded ? 'waiting-for-leases-or-digest' : 'retained' : budgetAdapter ? 'released' : 'unbudgeted' });
  return Object.freeze({ artifactId, metadata, digest: () => digestPromise,
    onDiscard(callback) {
      if (discarded) { callback(); return () => {}; }
      discardListeners.add(callback); return () => discardListeners.delete(callback);
    },
    borrow() {
      if (discarded || clock() >= expiresAt) throw Object.assign(new Error('Prepared export has expired.'), { kind: 'artifact-expired' });
      leases++;
      let released = false;
      return Object.freeze({ blob, release() { if (!released) { released = true; leases--; retireBlob(); } } });
    },
    discard() {
      if (!discarded) { discarded = true; for (const listener of discardListeners) { try { listener(); } catch { /* Retirement continues. */ } } discardListeners.clear(); }
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
  const artifactId = nextId('artifact'), expiresAt = clock() + lifetimeMs;
  let discarded = false, leases = 0;
  const discardListeners = new Set();
  const metadata = () => Object.freeze({ artifactId, immutableSourceRef, formatVersion, mediaType,
    suggestedFilename, byteLength, streamingEstimate, maxDeliveryBytes,
    deliveryModes: Object.freeze(['file-handle']), digestState: 'omitted-streaming',
    sha256: null, coverageLossReportRef, expiresAt, retained: !discarded, activeLeases: leases });
  return Object.freeze({ artifactId, metadata, digest: () => Promise.resolve(null),
    onDiscard(callback) {
      if (discarded) { callback(); return () => {}; }
      discardListeners.add(callback); return () => discardListeners.delete(callback);
    },
    borrow() {
      if (discarded || clock() >= expiresAt) throw Object.assign(new Error('Prepared export has expired.'), { kind: 'artifact-expired' });
      leases++;
      let released = false, opened = false;
      return Object.freeze({ openChunks() {
        if (opened) throw new Error('A delivery lease opens its source only once.');
        opened = true;
        const source = openChunks();
        if (!source || typeof source[Symbol.asyncIterator] !== 'function') throw Object.assign(new Error('Replayable source is not an async iterable.'), { kind: 'invalid-source' });
        return source;
      }, release() { if (!released) { released = true; leases--; } } });
    },
    discard() {
      if (!discarded) { discarded = true; for (const listener of discardListeners) { try { listener(); } catch { /* Retirement continues. */ } } discardListeners.clear(); }
      return metadata();
    } });
}

export function deliverArtifactToAnchor(artifact, { document, windowRef = globalThis } = {}) {
  const deliveryId = nextId('delivery'), { suggestedFilename, artifactId } = artifact.metadata();
  let lease;
  try {
    lease = artifact.borrow();
    if (!lease.blob) return Object.freeze({ deliveryId, artifactId, sinkKind: 'anchor', state: 'unsupported',
      bytesWritten: 0, errorKind: 'streaming-source-requires-file-handle', evidence: 'no-bounded-blob' });
    const requested = requestBrowserDownload({ document, windowRef, bytes: lease.blob,
      filename: suggestedFilename, mediaType: artifact.metadata().mediaType });
    return Object.freeze({ deliveryId, artifactId, sinkKind: 'anchor', state: requested.state,
      bytesWritten: 0, errorKind: null, evidence: requested.evidence });
  } catch (error) {
    return Object.freeze({ deliveryId, artifactId, sinkKind: 'anchor', state: 'failed', bytesWritten: 0,
      errorKind: error.kind || errorKind(error), evidence: 'anchor-request-failed' });
  } finally { lease?.release(); }
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
  const deliveryId = nextId('delivery'), { artifactId } = artifact.metadata();
  let observedTime = clock();
  if (!Number.isFinite(observedTime)) throw new TypeError('Invalid export delivery clock reading.');
  const startedAt = observedTime, deadline = startedAt + maxDeliveryMs;
  const ownerAbort = new AbortController();
  const forwardAbort = () => ownerAbort.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const unwatch = artifact.onDiscard(forwardAbort);
  if (signal?.aborted) ownerAbort.abort();
  const preflight = () => {
    if (ownerAbort.signal.aborted) throw Object.assign(new Error('Export delivery canceled.'), { name: 'AbortError' });
    const reading = clock();
    if (!Number.isFinite(reading)) throw new TypeError('Invalid export delivery clock reading.');
    observedTime = Math.max(observedTime, reading);
    if (observedTime >= deadline) throw Object.assign(new Error('Export delivery deadline exceeded.'), { name: 'TimeoutError' });
    return Math.min(30000, deadline - observedTime);
  };
  const wait = start => {
    const remaining = preflight();
    return waitForSink(start(), ownerAbort.signal, remaining);
  };
  let lease, writable, reader, iterator, bytesWritten = 0, phase = 'opening', abortAttempted = false, abortAcknowledged = false, retired = false;
  let state = 'failed', kind = null, evidence = null;
  try {
    preflight();
    lease = artifact.borrow();
    writable = await wait(() => {
      const opening = Promise.resolve(handle.createWritable({ keepExistingData: false }));
      opening.then(late => {
        if (retired) { try { Promise.resolve(late.abort?.()).catch(() => {}); } catch { /* Late handle remains unacknowledged. */ } }
      }, () => {});
      return opening;
    });
    preflight();
    if (lease.blob) reader = lease.blob.stream().getReader();
    else iterator = lease.openChunks()[Symbol.asyncIterator]();
    phase = 'writing';
    while (true) {
      const { done, value } = await wait(() => reader ? reader.read() : iterator.next());
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Object.assign(new Error('Export source yielded invalid bytes.'), { kind: 'invalid-source' });
      if (bytesWritten + value.byteLength > (artifact.metadata().maxDeliveryBytes || MAX_BROWSER_DOWNLOAD_BYTES))
        throw Object.assign(new Error('Export stream exceeded its declared limit.'), { kind: 'artifact-limit' });
      await wait(() => writable.write(value));
      bytesWritten += value.byteLength;
      try { onProgress(bytesWritten, artifact.metadata().byteLength ?? artifact.metadata().streamingEstimate); } catch { /* Presentation callbacks cannot fail delivery. */ }
    }
    if (artifact.metadata().byteLength != null && bytesWritten !== artifact.metadata().byteLength)
      throw Object.assign(new Error('Export source length changed.'), { kind: 'source-length-mismatch' });
    phase = 'closing'; await wait(() => writable.close()); writable = null;
    state = 'close-acknowledged'; evidence = 'writable-close-resolved';
  } catch (error) { kind = error.kind || errorKind(error); state = kind === 'cancelled' ? 'canceled' : 'failed'; evidence = phase; }
  finally {
    retired = true;
    try { if (reader) await waitForSink(reader.cancel(), null, 2000); } catch { /* A released reader may already be closed. */ }
    try { if (iterator?.return) await waitForSink(iterator.return(), null, 2000); } catch { /* Source cancellation has an unknown outcome. */ }
    if (writable) {
      abortAttempted = true;
      try { if (typeof writable.abort === 'function') { await waitForSink(writable.abort(), null, 2000); abortAcknowledged = true; } }
      catch { /* An external write may have an unknown outcome. */ }
    }
    lease?.release();
    unwatch(); signal?.removeEventListener('abort', forwardAbort);
  }
  const finalTime = clock();
  if (Number.isFinite(finalTime)) observedTime = Math.max(observedTime, finalTime);
  return Object.freeze({ deliveryId, artifactId, sinkKind: 'file-handle', state, bytesWritten,
    errorKind: kind, evidence, abortAttempted, abortAcknowledged,
    deadlineExceeded: kind === 'timeout' || observedTime >= deadline, elapsedMs: observedTime - startedAt });
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
