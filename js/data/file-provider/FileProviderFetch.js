import {
  BaseLogger,
  BinaryReader,
  IDB_MAX_BYTES,
  IDB_NAME,
  IDB_STORE_ENTRIES,
  IDB_STORE_META,
  IDB_STORE_PAYLOADS,
  IDB_VERSION,
  LOCAL_STORAGE_MAX_BYTES,
  LOCAL_STORAGE_PREFIX,
  appendRevisionParam,
  getDependency,
  getRuntimeDependency,
  sanitizeCacheBust
} from './FileProviderShared.js';
import { ResourceLoadError, resourceKindFromStatus } from './ResourceLoadError.js';
import { RawAssetHandle } from './RawAssetHandle.js';
import { requestBinaryStream } from './FileProviderStream.js';
import { backgroundJobService } from '../../app/resources/BackgroundJobService.js';

const requestWithXhrUnbounded = (provider, url, responseType, owner = null) => new Promise((resolve, reject) => {
  if (provider._disposed || owner?.controller.signal.aborted) { reject(new ResourceLoadError('cancelled', url)); return; }
  let storageLease = null;
  try { if (responseType === 'arraybuffer') storageLease = provider._reserveRawBytes(provider._maxResponseBytes); }
  catch (cause) { reject(new ResourceLoadError('budget', url, { cause, operationId: owner?.operationId ?? null })); return; }
  let xhr;
  try { xhr = provider._createXhr(); } catch (cause) { storageLease?.release(); reject(new ResourceLoadError('unavailable', url, { cause })); return; }
  let settled = false;
  let sentValidator = false;
  let deadlineTimer = null;
  const request = { key: responseType === 'arraybuffer' ? `binary:${url}` : url, owner, abort() {
    if (settled) return;
    try { xhr.abort?.(); } catch { /* Reject this request even if the adapter cannot abort. */ }
    fail('cancelled');
  } };
  const finish = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(deadlineTimer);
    provider._requests.delete(request);
    owner?.controller.signal.removeEventListener('abort', request.abort);
    xhr.onload = null; xhr.onerror = null; xhr.onabort = null; xhr.ontimeout = null; xhr.onprogress = null;
    return true;
  };
  const fail = (kind, status = null, cause = null) => {
    if (!finish()) return;
    storageLease?.release();
    const error = new ResourceLoadError(kind, url, { status, cause, operationId: owner?.operationId ?? null });
    provider.log.log(error.message);
    reject(error);
  };
  const responseHeaders = () => ({
    etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
    lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null,
    cacheControl: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Cache-Control') : null
  });
  xhr.onload = () => {
    if (provider._disposed || owner?.controller.signal.aborted) { fail('cancelled'); return; }
    if (xhr.status === 304 && sentValidator) {
      if (finish()) { storageLease?.release(); resolve({ notModified: true, headers: responseHeaders() }); }
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      const bytes = responseType === 'arraybuffer' ? xhr.response?.byteLength : typeof xhr.response === 'string' ? xhr.response.length * 2 : 0;
      if (responseType === 'arraybuffer' ? !(xhr.response instanceof ArrayBuffer) : typeof xhr.response !== 'string') { fail('decode'); return; }
      if (bytes > provider._maxResponseBytes) { fail('too-large'); return; }
      try { storageLease?.resize(bytes); } catch (cause) { fail('budget', null, cause); return; }
      if (!finish()) return;
      resolve({ data: xhr.response, headers: responseHeaders(), storageLease });
    } else fail(resourceKindFromStatus(xhr.status), xhr.status);
  };
  xhr.onerror = event => fail(xhr.status ? resourceKindFromStatus(xhr.status) : 'network', xhr.status || null, event instanceof Error ? event : null);
  xhr.onabort = () => fail('cancelled');
  xhr.ontimeout = () => fail('timeout');
  xhr.onprogress = event => {
    if (event.loaded > provider._maxResponseBytes || event.lengthComputable && event.total > provider._maxResponseBytes) {
      fail('too-large');
      try { xhr.abort?.(); } catch { /* The size limit already settled the request. */ }
    }
  };
  provider._requests.add(request);
  owner?.controller.signal.addEventListener('abort', request.abort, { once: true });
  deadlineTimer = setTimeout(() => { fail('timeout'); try { xhr.abort?.(); } catch { /* Deadline already settled. */ } }, provider._requestTimeoutMs);
  try {
    xhr.open('GET', url);
    const validators = owner?.validation?.entry;
    if (typeof xhr.setRequestHeader === 'function' && (validators?.etag || validators?.lastModified)) {
      xhr.setRequestHeader(validators.etag ? 'If-None-Match' : 'If-Modified-Since', validators.etag || validators.lastModified);
      sentValidator = true;
    }
    xhr.responseType = responseType; xhr.timeout = provider._requestTimeoutMs; xhr.send();
  } catch (cause) { fail('network', null, cause); }
});
const requestWithXhr = (provider, url, responseType, owner = null) => new Promise((resolve, reject) => {
  const key = responseType === 'arraybuffer' ? `binary:${url}` : url;
  const release = () => {
    provider._activeRequestCount--;
    const next = provider._requestQueue.shift();
    next?.run();
  };
  const run = () => {
    if (provider._disposed || owner?.controller.signal.aborted) { reject(new ResourceLoadError('cancelled', url)); return; }
    provider._activeRequestCount++;
    const fetchRef = provider._hasFetchOverride ? provider._fetch : globalThis.fetch;
    const stream = responseType === 'arraybuffer' && (provider._binaryTransport === 'stream' || provider._binaryTransport === 'auto' &&
      provider._budgetAdapter && !provider._hasXhrOverride && typeof fetchRef === 'function');
    const work = stream ? typeof fetchRef === 'function' ? requestBinaryStream(provider, url, owner, fetchRef) :
      Promise.reject(new ResourceLoadError('unavailable', url)) : requestWithXhrUnbounded(provider, url, responseType, owner);
    work.then(resolve, reject).finally(release);
  };
  if (provider._activeRequestCount < provider._maxConcurrentRequests) run();
  else {
    if (provider._requestQueue.length >= provider._maxQueuedRequests) { reject(new ResourceLoadError('busy', url)); return; }
    let timer;
    const onAbort = () => queued.abort();
    const queued = { key, owner, run() { clearTimeout(timer); owner?.controller.signal.removeEventListener('abort', onAbort); run(); }, abort(kind = 'cancelled') {
      const index = provider._requestQueue.indexOf(queued);
      if (index < 0) return;
      provider._requestQueue.splice(index, 1);
      clearTimeout(timer); owner?.controller.signal.removeEventListener('abort', onAbort); reject(new ResourceLoadError(kind, url));
    } };
    provider._requestQueue.push(queued);
    owner?.controller.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => queued.abort('timeout'), provider._requestTimeoutMs);
  }
});
const fileProviderFetchMethods = {
  _withConsumerAbort(promise, signal, url, key = url, record = null, releaseLateValue = false) {
    if (signal?.aborted) {
      if (record && !record.consumers) record.controller.abort();
      return Promise.reject(new ResourceLoadError('cancelled', url));
    }
    if (record) record.consumers++;
    this._consumerCounts.set(key, (this._consumerCounts.get(key) || 0) + 1);
    return new Promise((resolve, reject) => {
      let released = false;
      const timer = setTimeout(() => { release(true); reject(new ResourceLoadError('timeout', url)); }, this._requestTimeoutMs);
      const release = canceled => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        const remaining = (this._consumerCounts.get(key) || 1) - 1;
        if (remaining) this._consumerCounts.set(key, remaining); else this._consumerCounts.delete(key);
        if (record && --record.consumers === 0 && canceled && !record.controller.signal.aborted) record.controller.abort();
        this._retireRecordSource(record);
      };
      const cancel = () => { release(true); reject(new ResourceLoadError('cancelled', url)); };
      signal?.addEventListener('abort', cancel, { once: true });
      promise.then(value => { if (released) { if (releaseLateValue) value?.release?.(); return; } release(false); resolve(value); }, error => {
        if (released) return; release(false); reject(error);
      });
    });
  },

  _assertAcquisitionLive(record) {
    if (this._disposed || record?.controller.signal.aborted) throw new ResourceLoadError('cancelled', record?.url);
  },

  async _probePersistent(url, type, path, expectedHash, record, initialCached = null) {
    let timer, expired = false;
    const probe = async () => {
      let cached, accepted = false;
      try {
        cached = initialCached || (this._canUseIndexedDb() ? await this._loadFromIndexedDb(url, type, path).catch(() => null) : null);
        this._assertAcquisitionLive(record);
        if (expired) return null;
        if (!cached) cached = this._loadFromLocalStorage(url, type, path);
        if (!cached) return null;
        try {
          await this._verifyExpectedContent(cached.value, type, cached.entry?.hash, url);
          await this._verifyExpectedContent(cached.value, type, expectedHash, url);
          this._assertAcquisitionLive(record);
          if (expired) return null;
          if (cached.entry) {
            record.entry = cached.entry;
            this._scheduleCacheValidation(url, cached.entry, cached.value);
          }
          accepted = true; return cached.value;
        } catch (error) {
          if (error.kind === 'cancelled') throw error;
          if (error.kind === 'integrity') await this._discardPersistentEntry(url, cached.entry);
          return null;
        }
      } finally { if (!accepted && type === 'binary') cached?.value?.release?.(); }
    };
    try {
      return await Promise.race([probe(), new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, this._cacheProbeMs); })]);
    } catch (error) {
      if (error.kind === 'cancelled') throw error;
      return null;
    } finally { clearTimeout(timer); }
  },

  _loadResource(type, url, path, opts) {
    const key = type === 'binary' ? `binary:${url}` : url;
    if (this._disposed || opts.signal?.aborted) {
      if (opts.validation?.ownsValue) opts.validation.value.release?.();
      return Promise.reject(new ResourceLoadError('cancelled', url));
    }
    if (opts.cachePolicy === 'revalidate' && !opts.validation) {
      const existing = this._cache.get(key), owner = existing && this._acquisitionRecords.get(existing);
      if (!existing) return this._loadResource(type, url, path, { ...opts, cachePolicy: 'reload' });
      let ownedPin = type === 'binary' && this._cacheSources.has(key) ? this._forkBinaryReader(this._cacheSources.get(key), url, path) : null;
      let transferred = false;
      const pinned = existing.then(value => {
        if (opts.signal?.aborted || this._disposed) throw new ResourceLoadError('cancelled', url);
        if (type === 'binary') return ownedPin ||= this._forkBinaryReader(value, url, path);
        return value;
      });
      return this._withConsumerAbort(pinned, opts.signal, url, key, owner).then(value => {
        transferred = true;
        return this._loadResource(type, url, path, { ...opts, cachePolicy: 'reload',
          validation: { value, entry: owner?.entry || {}, ownsValue: type === 'binary' } });
      }).finally(() => { if (!transferred) ownedPin?.release(); });
    }
    const fresh = opts.forceReload || opts.cachePolicy === 'reload' || opts.cachePolicy === 'no-store' || opts.probeOnly;
    const refreshKey = opts.validation ? `${key}|${opts.expectedHash || ''}` : null;
    let source = refreshKey && this._refreshes.get(refreshKey) || !fresh && this._cache.get(key);
    let record = source && this._acquisitionRecords.get(source);
    if (source && opts.validation?.ownsValue && record?.validation?.value !== opts.validation.value) opts.validation.value.release();
    if (!source) {
      const isolated = opts.probeOnly || opts.cachePolicy === 'no-store';
      const version = (this._requestVersions.get(key) || 0) + (isolated ? 0 : 1);
      if (!isolated) this._requestVersions.set(key, version);
      record = { key, url, requestId: ++this._nextRequestId, providerEpoch: this._cacheEpoch,
        controller: new AbortController(), consumers: 0, phase: 'cache', noStore: opts.cachePolicy === 'no-store' || opts.probeOnly,
        version, expectedHash: opts.expectedHash || null, operationId: opts.operationId ?? null, validation: opts.validation || null };
      this._acquisitions.add(record);
      const acquire = async () => {
        let value;
        try {
          const hasIndexedDb = !fresh && this._canUseIndexedDb();
          const localCached = !fresh && !hasIndexedDb ? this._loadFromLocalStorage(url, type, path) : null;
          value = hasIndexedDb || localCached ? await this._probePersistent(url, type, path, opts.expectedHash, record, localCached) : null;
          this._assertAcquisitionLive(record);
          if (value == null) {
            record.phase = 'network';
            value = type === 'binary' ? await this._fetchBinary(url, path, record.providerEpoch, record) : await this._fetchText(url, record.providerEpoch, record);
          }
          record.phase = 'verification';
          if (fresh) await this._verifyExpectedContent(value, type, opts.expectedHash, url);
          this._assertAcquisitionLive(record);
          record.phase = 'ready'; record.value = value;
          if (type === 'binary') this._sourceRecords.set(value, record);
          return value;
        } catch (error) { if (type === 'binary') value?.release?.(); throw error; }
      };
      let deadlineTimer, abortListener;
      const retired = new Promise((resolve, reject) => {
        abortListener = () => reject(record.controller.signal.reason instanceof ResourceLoadError
          ? record.controller.signal.reason : new ResourceLoadError('cancelled', url));
        record.controller.signal.addEventListener('abort', abortListener, { once: true });
        deadlineTimer = setTimeout(() => record.controller.abort(new ResourceLoadError('timeout', url)), this._requestTimeoutMs);
      });
      source = Promise.race([acquire(), retired]).then(value => {
        if (this._cache.get(key) === source) this._publishCacheSource(key, value);
        return value;
      }).catch(error => {
        if (this._cache.get(key) === source) this._cache.delete(key);
        throw error;
      }).finally(() => {
        clearTimeout(deadlineTimer);
        record.controller.signal.removeEventListener('abort', abortListener);
        this._acquisitions.delete(record);
        if (refreshKey && this._refreshes.get(refreshKey) === source) this._refreshes.delete(refreshKey);
        if (record.noStore && this._cache.get(key) === source) {
          this._cache.delete(key); this._dropCacheSource(key, record.value);
        }
        if (record.validation?.ownsValue && record.validation.value !== record.value) record.validation.value.release?.();
        this._retireRecordSource(record);
      });
      record.promise = source;
      this._acquisitionRecords.set(source, record);
      if (refreshKey) this._refreshes.set(refreshKey, source);
      if (fresh) source.then(value => {
        if (!record.noStore && !this._disposed && !record.controller.signal.aborted && record.providerEpoch === this._cacheEpoch && this._requestVersions.get(key) === version) {
          this._cache.set(key, source); this._publishCacheSource(key, value);
        }
      }, () => {});
      else this._cache.set(key, source);
    }
    const immediate = type === 'binary' && source === this._cache.get(key) && this._cacheSources.has(key) ? this._forkBinaryReader(this._cacheSources.get(key), url, path) : null;
    const result = source.then(async value => {
      const consumer = type === 'binary' ? immediate || this._forkBinaryReader(value, url, path) : value;
      try {
        await this._verifyExpectedContent(consumer, type, opts.expectedHash, url);
        if (this._disposed || opts.signal?.aborted) throw new ResourceLoadError('cancelled', url);
        return consumer;
      } catch (error) { if (type === 'binary') consumer.release?.(); throw error; }
    });
    return this._withConsumerAbort(result, opts.signal, url, key, record, type === 'binary');
  },

  _scheduleOptionalStore(url, entry, hashMethod, epoch = this._cacheEpoch, owner = null, sourceReader = null) {
    const storageReference = sourceReader?._retainStorageLease?.('persistence');
    let retired = false, timer, retire;
    const lifetime = new Promise(resolve => {
      retire = () => { retired = true; resolve(); };
      timer = setTimeout(retire, this._cacheProbeMs * 2);
      owner?.controller.signal.addEventListener('abort', retire, { once: true });
    });
    this._retireCacheWrites.add(retire);
    const attempt = async () => {
      if (retired || this._disposed || epoch !== this._cacheEpoch || owner?.noStore || owner?.controller.signal.aborted) return;
      const hash = await Promise.resolve().then(hashMethod).catch(() => null);
      if (retired || this._disposed || epoch !== this._cacheEpoch || owner?.noStore || owner?.controller.signal.aborted ||
          owner && this._requestVersions.get(owner.key) !== owner.version) return;
      if (owner?.expectedHash && hash?.toLowerCase() !== owner.expectedHash.toLowerCase()) return;
      const generation = hash || `${Date.now()}:${++this._nextRequestId}`;
      if (owner) owner.entry = { ...owner.entry, hash, generation };
      return this._storeInCache(url, { ...entry, hash, generation }, { epoch, owner });
    };
    const pendingAttempt = attempt().catch(() => {}).finally(() => storageReference?.release());
    const work = Promise.race([pendingAttempt, lifetime]).finally(() => {
      clearTimeout(timer);
      owner?.controller.signal.removeEventListener('abort', retire);
      this._retireCacheWrites.delete(retire);
      this._pendingCacheWrites.delete(work);
    });
    this._pendingCacheWrites.add(work);
  },

  _forkBinaryReader(source, url, path) {
    const Reader = getDependency('BinaryReader', BinaryReader);
    const reader = new Reader(source, 0, null, this._filenameFromUrl(url), path);
    const hash = this._contentHashes.get(source);
    if (hash) this._contentHashes.set(reader, hash);
    return reader;
  },

  _hashBinaryContent(value) {
    let hash = this._contentHashes.get(value);
    if (hash && this._failedHashPromises.has(hash)) hash = null;
    if (!hash) {
      hash = (async () => {
        let reservation = null, computed = null;
        const epoch = this._cacheEpoch, source = this._sourceRecords.get(value);
        const crypto = this._crypto || globalThis.crypto;
        if (!crypto?.subtle) return null;
        try {
          computed = await (this._backgroundJobs || backgroundJobService).compute({ kind: 'asset-hash', ownerId: this._budgetOwner || 'file-provider', ownerEpoch: epoch,
            sourceRevision: `raw:${epoch}:${value.length}`, inputBytes: value.length, estimatedPeakBytes: Math.max(4096, value.length * 6),
            signal: source?.controller?.signal, crypto, priority: 'interactive', isCurrent: () => !this._disposed,
            prepareInput: () => {
              reservation = this._reserveRawBytes(value.length * 2);
              const copy = value.copyBytes();
              this._rawByteMetrics.hashInputCopies++; this._rawByteMetrics.hashInputBytes += copy.byteLength; return copy;
            }, releasePreparedInput: () => reservation?.release() });
          return computed.value;
        }
        finally { computed?.release(); }
      })();
      this._contentHashes.set(value, hash);
      hash.then(value => { if (!value) this._failedHashPromises.add(hash); }, () => this._failedHashPromises.add(hash));
    }
    return hash;
  },

  async _verifyExpectedContent(value, type, expectedHash, url) {
    if (!expectedHash) return value;
    const hash = type === 'binary' && value && typeof value === 'object' ? this._hashBinaryContent(value) : this._tryHashString(value);
    let actual;
    try { actual = await hash; }
    catch (cause) {
      if (cause?.name === 'ResourceBudgetError' || cause?.name === 'BackgroundJobAdmissionError' || cause?.code === 'memory-capacity') throw new ResourceLoadError('budget', url, { cause });
      if (cause?.name === 'AbortError' || ['cancelled', 'stale-owner', 'service-retired', 'ownership-retired'].includes(cause?.code)) throw new ResourceLoadError('cancelled', url, { cause });
      if (cause?.code === 'input-capacity') throw new ResourceLoadError('too-large', url, { cause });
      throw new ResourceLoadError('unavailable', url, { cause });
    }
    if (!actual) throw new ResourceLoadError('unavailable', url);
    if (actual.toLowerCase() !== String(expectedHash).toLowerCase()) throw new ResourceLoadError('integrity', url);
    return value;
  },

  loadBinary(path, filename = null, opts = {}) {
    return this._loadResource('binary', this._buildUrl(path, filename), path, opts);
  },

  loadString(url, opts = {}) {
    return this._loadResource('text', this._appendCacheBust(url), '', opts);
  },

  async resolveAsset(locator, opts = {}) {
    const url = typeof locator === 'string' ? this._appendCacheBust(locator) : this._buildUrl(locator.path, locator.filename);
    const source = await this._loadResource('binary', url, typeof locator === 'string' ? '' : locator.path, opts);
    try {
      if (!(source instanceof BinaryReader)) throw new ResourceLoadError('decode', url);
      const contentHash = await this._withConsumerAbort(this._hashBinaryContent(source), opts.signal, url, `handle:${url}`);
      if (this._disposed || opts.signal?.aborted) throw new ResourceLoadError('cancelled', url);
      if (!contentHash) throw new ResourceLoadError('unavailable', url);
      return new RawAssetHandle(source, { requestedUrl: url, contentHash, generation: contentHash, sourceRevision: opts.sourceRevision ?? this._cacheBustRevision,
        verification: 'sha256', providerEpoch: this._cacheEpoch });
    } catch (error) {
      source?.release?.();
      if (error?.name === 'ResourceBudgetError') throw new ResourceLoadError('budget', url, { cause: error, operationId: opts.operationId ?? null });
      throw error;
    }
  },

  _createXhr() {
    if (this._createXMLHttpRequest) {
      return this._createXMLHttpRequest();
    }
    const XhrCtor = this._hasXhrOverride
      ? this._XMLHttpRequest
      : (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null);
    if (typeof XhrCtor !== 'function') {
      throw new Error('XMLHttpRequest API not available');
    }
    return new XhrCtor();
  },

  async _fetchBinary(url, path, requestEpoch = this._cacheEpoch, owner = null) {
    const response = await requestWithXhr(this, url, 'arraybuffer', owner);
    try {
      if (this._disposed) throw new ResourceLoadError('cancelled', url);
      if (owner && /\bno-store\b/i.test(response.headers.cacheControl || '')) owner.noStore = true;
      if (response.notModified) return this._acceptNotModified(url, response.headers, owner);

      const buf = response.data;
      this._rawByteMetrics.binaryNetworkResponses++; this._rawByteMetrics.binaryNetworkBytes += buf.byteLength;
      const Reader = getDependency('BinaryReader', BinaryReader);
      const reader = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
      if (response.storageLease) reader._attachStorageLease(response.storageLease, 'pending');
      if (owner) owner.entry = { type: 'binary', ...response.headers, fetchedAt: Date.now() };
      this._scheduleOptionalStore(url, { type: 'binary', data: buf, ...response.headers }, () => this._hashBinaryContent(reader), requestEpoch, owner, reader);
      return reader;
    } finally { response.storageLease?.release(); }
  },

  async _fetchText(url, requestEpoch = this._cacheEpoch, owner = null) {
    const response = await requestWithXhr(this, url, 'text', owner);
    if (this._disposed) throw new ResourceLoadError('cancelled', url);
    if (owner && /\bno-store\b/i.test(response.headers.cacheControl || '')) owner.noStore = true;
    if (response.notModified) return this._acceptNotModified(url, response.headers, owner);

    const text = response.data;
    if (owner) owner.entry = { type: 'text', ...response.headers, fetchedAt: Date.now() };
    this._scheduleOptionalStore(url, { type: 'text', data: text, ...response.headers }, () => this._tryHashString(text), requestEpoch, owner);
    return text;
  },

  _acceptNotModified(url, headers, owner) {
    if (!owner?.validation || owner.validation.value == null) throw new ResourceLoadError('http', url, { status: 304 });
    owner.entry = { ...owner.validation.entry, ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value != null)), fetchedAt: Date.now() };
    const work = this._refreshIndexedDbMetadata(url, owner.validation.entry, owner.entry, owner).catch(() => {});
    this._pendingCacheWrites.add(work);
    work.finally(() => this._pendingCacheWrites.delete(work));
    return owner.validation.value;
  },

  async _fetchHead(url) {
    const fetchRef = this._hasFetchOverride ? this._fetch : typeof fetch === 'function' ? fetch : null;
    if (typeof fetchRef !== 'function' || this._disposed) return null;
    const controller = new AbortController();
    let timer, cancel;
    const request = { key: `head:${url}`, abort: () => { controller.abort(); cancel?.(null); } };
    this._requests.add(request);
    try {
      const result = Promise.resolve(fetchRef(url, { method: 'HEAD', signal: controller.signal }));
      const response = await Promise.race([result, new Promise(resolve => {
        cancel = resolve;
        timer = setTimeout(() => { controller.abort(); resolve(null); }, this._requestTimeoutMs);
      })]);
      if (!response || this._disposed || response.ok === false || Number.isFinite(response.status) && (response.status < 200 || response.status >= 300)) return null;
      return { etag: response.headers.get('ETag'), lastModified: response.headers.get('Last-Modified') };
    } catch { return null; }
    finally { clearTimeout(timer); this._requests.delete(request); }
  }

};
export { fileProviderFetchMethods };
