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
  maxBytes = MAX_BROWSER_DOWNLOAD_BYTES, clock = Date.now } = {}) {
  if (typeof immutableSourceRef !== 'string' || !immutableSourceRef || typeof formatVersion !== 'string' || !formatVersion)
    throw new TypeError('Export source and format version are required.');
  if (coverageLossReportRef != null && typeof coverageLossReportRef !== 'string') throw new TypeError('Coverage report reference must be a string.');
  if (typeof suggestedFilename !== 'string' || !suggestedFilename || suggestedFilename.length > 160 || /[\\/\x00-\x1f]/.test(suggestedFilename))
    throw new TypeError('Invalid export filename.');
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 24 * 60 * 60 * 1000) throw new RangeError('Invalid artifact lifetime.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BROWSER_DOWNLOAD_BYTES) throw new RangeError('Invalid export staging limit.');
  let blob = bytesFor(bytes, maxBytes, mediaType);
  const artifactId = nextId('artifact'), expiresAt = clock() + lifetimeMs, byteLength = blob.size;
  let discarded = false, leases = 0, digestState = blob.size <= MAX_DIGEST_BYTES ? 'pending' : 'omitted-over-budget', digest = null;
  const discardListeners = new Set();
  const digestPromise = digestState === 'pending' ? (async () => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) { digestState = 'unavailable'; return null; }
    try {
      const bytes = await blob.arrayBuffer(), hash = await subtle.digest('SHA-256', bytes);
      digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      digestState = 'ready'; return digest;
    } catch { digestState = 'unavailable'; return null; }
  })() : Promise.resolve(null);
  const metadata = () => Object.freeze({ artifactId, immutableSourceRef, formatVersion, mediaType, suggestedFilename,
    byteLength, digestState, sha256: digest, coverageLossReportRef, expiresAt, retained: !discarded, activeLeases: leases });
  return Object.freeze({ artifactId, metadata, digest: () => digestPromise,
    onDiscard(callback) {
      if (discarded) { callback(); return () => {}; }
      discardListeners.add(callback); return () => discardListeners.delete(callback);
    },
    borrow() {
      if (discarded || clock() >= expiresAt) throw Object.assign(new Error('Prepared export has expired.'), { kind: 'artifact-expired' });
      leases++;
      let released = false;
      return Object.freeze({ blob, release() { if (!released) { released = true; leases--; if (discarded && leases === 0) blob = null; } } });
    },
    discard() {
      if (!discarded) { discarded = true; for (const listener of discardListeners) { try { listener(); } catch { /* Retirement continues. */ } } discardListeners.clear(); }
      if (!leases) blob = null;
      return metadata();
    } });
}

export function deliverArtifactToAnchor(artifact, { document, windowRef = globalThis } = {}) {
  const deliveryId = nextId('delivery'), { suggestedFilename, artifactId } = artifact.metadata();
  let lease;
  try {
    lease = artifact.borrow();
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

export async function deliverArtifactToFileHandle(artifact, handle, { signal, onProgress = () => {}, maxDeliveryMs = 300000 } = {}) {
  if (!Number.isFinite(maxDeliveryMs) || maxDeliveryMs < 1 || maxDeliveryMs > 900000) throw new RangeError('Invalid export delivery deadline.');
  const deliveryId = nextId('delivery'), { artifactId } = artifact.metadata();
  const deadline = Date.now() + maxDeliveryMs;
  const ownerAbort = new AbortController();
  const forwardAbort = () => ownerAbort.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const unwatch = artifact.onDiscard(forwardAbort);
  if (signal?.aborted) ownerAbort.abort();
  const wait = work => waitForSink(work, ownerAbort.signal, Math.max(1, Math.min(30000, deadline - Date.now())));
  let lease, writable, reader, bytesWritten = 0, phase = 'opening', abortAttempted = false, abortAcknowledged = false, retired = false;
  let state = 'failed', kind = null, evidence = null;
  try {
    if (ownerAbort.signal.aborted) throw Object.assign(new Error('Export delivery canceled.'), { name: 'AbortError' });
    lease = artifact.borrow();
    const opening = Promise.resolve(handle.createWritable({ keepExistingData: false }));
    opening.then(late => {
      if (retired) { try { Promise.resolve(late.abort?.()).catch(() => {}); } catch { /* Late handle remains unacknowledged. */ } }
    }, () => {});
    writable = await wait(opening);
    reader = lease.blob.stream().getReader();
    phase = 'writing';
    while (true) {
      const { done, value } = await wait(reader.read());
      if (done) break;
      await wait(writable.write(value));
      bytesWritten += value.byteLength;
      try { onProgress(bytesWritten, lease.blob.size); } catch { /* Presentation callbacks cannot fail delivery. */ }
    }
    phase = 'closing'; await wait(writable.close()); writable = null;
    state = 'close-acknowledged'; evidence = 'writable-close-resolved';
  } catch (error) { kind = error.kind || errorKind(error); state = kind === 'cancelled' ? 'canceled' : 'failed'; evidence = phase; }
  finally {
    retired = true;
    try { if (reader) await waitForSink(reader.cancel(), null, 2000); } catch { /* A released reader may already be closed. */ }
    if (writable) {
      abortAttempted = true;
      try { if (typeof writable.abort === 'function') { await waitForSink(writable.abort(), null, 2000); abortAcknowledged = true; } }
      catch { /* An external write may have an unknown outcome. */ }
    }
    lease?.release();
    unwatch(); signal?.removeEventListener('abort', forwardAbort);
  }
  return Object.freeze({ deliveryId, artifactId, sinkKind: 'file-handle', state, bytesWritten,
    errorKind: kind, evidence, abortAttempted, abortAcknowledged });
}

export function aggregateExportDeliveries(receipts) {
  const list = Array.from(receipts || []);
  return Object.freeze({ state: !list.length ? 'empty' : list.every(item => item.state === 'close-acknowledged') ? 'close-acknowledged' :
    list.some(item => ['failed', 'canceled', 'unsupported'].includes(item.state)) ? 'partial' : 'delivery-requested',
  complete: !!list.length && list.every(item => item.state === 'close-acknowledged'), receipts: Object.freeze(list) });
}
