import { ResourceLoadError, resourceKindFromStatus } from './ResourceLoadError.js';

const headersOf = response => ({ etag: response.headers?.get?.('ETag') || null,
  lastModified: response.headers?.get?.('Last-Modified') || null,
  cacheControl: response.headers?.get?.('Cache-Control') || null });

/** A bounded application-owned buffer; native network buffering stays estimated. */
export function requestBinaryStream(provider, url, owner, fetchRef) {
  const controller = new AbortController();
  let stopped = false, reader = null, timer, rejectRetired, releaseUnallocated = null;
  const error = (kind, options = {}) => new ResourceLoadError(kind, url, { operationId: owner?.operationId ?? null, ...options });
  const cancelBody = () => {
    try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* The reader may already have retired. */ }
  };
  const stop = kind => {
    if (stopped) return;
    stopped = true; controller.abort(); cancelBody(); releaseUnallocated?.(); rejectRetired(error(kind));
  };
  const assertLive = () => {
    if (stopped || provider._disposed || owner?.controller.signal.aborted) throw error('cancelled');
  };
  const retired = new Promise((_resolve, reject) => { rejectRetired = reject; });
  const request = { key: `binary:${url}`, owner, abort: () => stop('cancelled') };
  provider._requests.add(request);
  owner?.controller.signal.addEventListener('abort', request.abort, { once: true });
  timer = setTimeout(() => stop('timeout'), provider._requestTimeoutMs);

  const attempt = async () => {
    let lease = null, buffer = null, used = 0, responseBody = null;
    try {
      assertLive();
      let capacity = Math.min(provider._binaryChunkBytes, provider._maxResponseBytes);
      lease = provider._reserveRawBytes(capacity);
      releaseUnallocated = () => { if (!buffer) { lease?.release(); lease = null; } };
      const validators = owner?.validation?.entry, headers = {};
      if (validators?.etag) headers['If-None-Match'] = validators.etag;
      else if (validators?.lastModified) headers['If-Modified-Since'] = validators.lastModified;
      const response = await fetchRef(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store' });
      responseBody = response.body;
      assertLive();
      const responseHeaders = headersOf(response);
      if (response.status === 304 && (validators?.etag || validators?.lastModified)) {
        try { Promise.resolve(responseBody?.cancel?.()).catch(() => {}); } catch { /* A 304 has no consumable representation. */ }
        lease?.release(); lease = null;
        return { notModified: true, headers: responseHeaders };
      }
      if (response.status < 200 || response.status >= 300) throw error(resourceKindFromStatus(response.status), { status: response.status });
      const lengthHint = Number(response.headers?.get?.('Content-Length'));
      if (Number.isFinite(lengthHint) && lengthHint > provider._maxResponseBytes) throw error('too-large');
      let byob = false, emptyReads = 0;
      const emptyRead = (value, done) => {
        if (value?.byteLength || done) { emptyReads = 0; return false; }
        if (byob || !(value instanceof Uint8Array) || ++emptyReads > 32) throw error('decode', { cause: new Error('Binary stream exceeded its empty-read allowance or returned invalid bytes.') });
        return true;
      };
      if (response.body) {
        try { reader = response.body.getReader({ mode: 'byob' }); byob = true; }
        catch (cause) {
          if (provider._requireByob) throw error('unavailable', { cause });
          reader = response.body.getReader();
        }
      }
      provider._rawByteMetrics[byob ? 'byobResponses' : 'estimatedStreamResponses']++;
      buffer = new ArrayBuffer(capacity);
      provider._rawByteMetrics.streamBufferAllocations++;
      const grow = next => {
        lease?.resize(capacity + next);
        const replacement = new Uint8Array(next);
        replacement.set(new Uint8Array(buffer, 0, used));
        provider._rawByteMetrics.streamBufferAllocations++; provider._rawByteMetrics.streamBufferCopies++;
        provider._rawByteMetrics.streamBufferCopyBytes += used;
        buffer = replacement.buffer; capacity = next;
        lease?.resize(capacity);
      };
      if (reader) while (true) {
        assertLive();
        if (used === capacity) {
          // Admit one byte before deciding whether another growth is necessary.
          const probeLease = provider._reserveRawBytes(1);
          try {
            const probeView = byob ? new Uint8Array(1) : null;
            if (byob) provider._rawByteMetrics.streamBufferAllocations++;
            const probe = await (byob ? reader.read(probeView) : reader.read());
            assertLive();
            const count = probe.value?.byteLength || 0;
            if (emptyRead(probe.value, probe.done)) continue;
            if (byob && probe.value && (probe.value.buffer.byteLength !== 1 || count > 1)) throw error('decode');
            if (count > provider._maxResponseBytes - used) throw error('too-large');
            if (count) {
              grow(Math.min(provider._maxResponseBytes, Math.max(used + count, capacity * 2)));
              new Uint8Array(buffer, used, count).set(probe.value); used += count;
              provider._rawByteMetrics.streamBufferCopies++; provider._rawByteMetrics.streamBufferCopyBytes += count;
            }
            if (probe.done) break;
          } finally { probeLease?.release(); }
          continue;
        }
        const result = await (byob ? reader.read(new Uint8Array(buffer, used, capacity - used)) : reader.read());
        assertLive();
        const value = result.value;
        if (byob) {
          if (value && (value.buffer.byteLength !== capacity || value.byteLength && value.byteOffset !== used)) throw error('decode');
          if (value?.buffer) buffer = value.buffer;
          else if (!buffer.byteLength && used) throw error('decode');
        }
        const count = value?.byteLength || 0;
        if (emptyRead(value, result.done)) continue;
        if (count > provider._maxResponseBytes - used) throw error('too-large');
        if (!byob && count) {
          if (used + count > capacity) grow(Math.min(provider._maxResponseBytes, Math.max(used + count, capacity * 2)));
          new Uint8Array(buffer, used, count).set(value);
          provider._rawByteMetrics.streamBufferCopies++; provider._rawByteMetrics.streamBufferCopyBytes += count;
        }
        used += count;
        if (result.done) break;
      }
      assertLive();
      if (used !== capacity) {
        lease?.resize(capacity + used);
        buffer = buffer.slice(0, used); capacity = used;
        provider._rawByteMetrics.streamBufferAllocations++; provider._rawByteMetrics.streamBufferCopies++;
        provider._rawByteMetrics.streamBufferCopyBytes += used;
        lease?.resize(used);
      }
      return { data: buffer, headers: responseHeaders, storageLease: lease };
    } catch (cause) {
      controller.abort(); cancelBody(); lease?.release();
      if (!reader) { try { Promise.resolve(responseBody?.cancel?.()).catch(() => {}); } catch { /* Failed headers do not own a body reader. */ } }
      if (cause instanceof ResourceLoadError) throw cause;
      if (cause?.name === 'ResourceBudgetError') throw error('budget', { cause });
      throw error(stopped || owner?.controller.signal.aborted || provider._disposed ? 'cancelled' : 'network', { cause });
    } finally {
      releaseUnallocated = null;
      try { reader?.releaseLock(); } catch { /* A pending native read retains its reservation until it settles. */ }
    }
  };
  const work = attempt();
  // A late response never publishes its allocation after the request retired.
  work.then(response => { if (stopped) response.storageLease?.release(); }, () => {});
  return Promise.race([work, retired]).finally(() => {
    clearTimeout(timer); provider._requests.delete(request);
    owner?.controller.signal.removeEventListener('abort', request.abort);
  });
}
