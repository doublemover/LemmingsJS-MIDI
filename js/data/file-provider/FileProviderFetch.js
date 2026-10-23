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

const requestWithXhrUnbounded = (provider, url, responseType, owner = null) => new Promise((resolve, reject) => {
  if (provider._disposed || owner?.controller.signal.aborted) { reject(new ResourceLoadError('cancelled', url)); return; }
  let xhr;
  try { xhr = provider._createXhr(); } catch (cause) { reject(new ResourceLoadError('unavailable', url, { cause })); return; }
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
      if (finish()) resolve({ notModified: true, headers: responseHeaders() });
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      const bytes = responseType === 'arraybuffer' ? xhr.response?.byteLength : typeof xhr.response === 'string' ? xhr.response.length * 2 : 0;
      if (responseType === 'arraybuffer' ? !(xhr.response instanceof ArrayBuffer) : typeof xhr.response !== 'string') { fail('decode'); return; }
      if (bytes > provider._maxResponseBytes) { fail('too-large'); return; }
      if (!finish()) return;
      resolve({ data: xhr.response, headers: responseHeaders() });
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
    requestWithXhrUnbounded(provider, url, responseType, owner).then(resolve, reject).finally(release);
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
  _withConsumerAbort(promise, signal, url, key = url, record = null) {
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
      };
      const cancel = () => { release(true); reject(new ResourceLoadError('cancelled', url)); };
      signal?.addEventListener('abort', cancel, { once: true });
      promise.then(value => { if (released) return; release(false); resolve(value); }, error => {
        if (released) return; release(false); reject(error);
      });
    });
  },

  _assertAcquisitionLive(record) {
    if (this._disposed || record?.controller.signal.aborted) throw new ResourceLoadError('cancelled', record?.url);
  },

  async _probePersistent(url, type, path, expectedHash, record) {
    let timer, expired = false;
    const probe = async () => {
      let cached = this._canUseIndexedDb() ? await this._loadFromIndexedDb(url, type, path).catch(() => null) : null;
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
        return cached.value;
      } catch (error) {
        if (error.kind === 'cancelled') throw error;
        await this._discardPersistentEntry(url, cached.entry);
        return null;
      }
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
    if (this._disposed || opts.signal?.aborted) return Promise.reject(new ResourceLoadError('cancelled', url));
    if (opts.cachePolicy === 'revalidate' && !opts.validation) {
      const existing = this._cache.get(key), owner = existing && this._acquisitionRecords.get(existing);
      if (!existing) return this._loadResource(type, url, path, { ...opts, cachePolicy: 'reload' });
      return this._withConsumerAbort(existing, opts.signal, url, key, owner).then(value => this._loadResource(type, url, path,
        { ...opts, cachePolicy: 'reload', validation: { value, entry: owner?.entry || {} } }));
    }
    const fresh = opts.forceReload || opts.cachePolicy === 'reload' || opts.cachePolicy === 'no-store' || opts.probeOnly;
    const refreshKey = opts.validation ? `${key}|${opts.expectedHash || ''}` : null;
    let source = refreshKey && this._refreshes.get(refreshKey) || !fresh && this._cache.get(key);
    let record = source && this._acquisitionRecords.get(source);
    if (!source) {
      const isolated = opts.probeOnly || opts.cachePolicy === 'no-store';
      const version = (this._requestVersions.get(key) || 0) + (isolated ? 0 : 1);
      if (!isolated) this._requestVersions.set(key, version);
      record = { key, url, requestId: ++this._nextRequestId, providerEpoch: this._cacheEpoch,
        controller: new AbortController(), consumers: 0, phase: 'cache', noStore: opts.cachePolicy === 'no-store' || opts.probeOnly,
        version, expectedHash: opts.expectedHash || null, operationId: opts.operationId ?? null, validation: opts.validation || null };
      this._acquisitions.add(record);
      const acquire = async () => {
        let hasPersistent = this._canUseIndexedDb();
        try { hasPersistent ||= !!this._getLocalStorage()?.getItem?.(this._localStorageKey(url)); } catch { /* Optional storage can be denied. */ }
        let value = !fresh && hasPersistent ? await this._probePersistent(url, type, path, opts.expectedHash, record) : null;
        this._assertAcquisitionLive(record);
        if (value == null) {
          record.phase = 'network';
          value = type === 'binary' ? await this._fetchBinary(url, path, record.providerEpoch, record) : await this._fetchText(url, record.providerEpoch, record);
        }
        record.phase = 'verification';
        if (fresh) await this._verifyExpectedContent(value, type, opts.expectedHash, url);
        this._assertAcquisitionLive(record);
        record.phase = 'ready';
        return value;
      };
      let deadlineTimer, abortListener;
      const retired = new Promise((resolve, reject) => {
        abortListener = () => reject(record.controller.signal.reason instanceof ResourceLoadError
          ? record.controller.signal.reason : new ResourceLoadError('cancelled', url));
        record.controller.signal.addEventListener('abort', abortListener, { once: true });
        deadlineTimer = setTimeout(() => record.controller.abort(new ResourceLoadError('timeout', url)), this._requestTimeoutMs);
      });
      source = Promise.race([acquire(), retired]).catch(error => {
        if (this._cache.get(key) === source) this._cache.delete(key);
        throw error;
      }).finally(() => {
        clearTimeout(deadlineTimer);
        record.controller.signal.removeEventListener('abort', abortListener);
        this._acquisitions.delete(record);
        if (refreshKey && this._refreshes.get(refreshKey) === source) this._refreshes.delete(refreshKey);
        if (record.noStore && this._cache.get(key) === source) this._cache.delete(key);
      });
      this._acquisitionRecords.set(source, record);
      if (refreshKey) this._refreshes.set(refreshKey, source);
      if (fresh) source.then(() => {
        if (!record.noStore && !this._disposed && record.providerEpoch === this._cacheEpoch && this._requestVersions.get(key) === version) this._cache.set(key, source);
      }, () => {});
      else this._cache.set(key, source);
    }
    const result = source.then(async value => {
      await this._verifyExpectedContent(value, type, opts.expectedHash, url);
      if (this._disposed || opts.signal?.aborted) throw new ResourceLoadError('cancelled', url);
      return type === 'binary' ? this._forkBinaryReader(value, url, path) : value;
    });
    return this._withConsumerAbort(result, opts.signal, url, key, record);
  },

  _scheduleOptionalStore(url, entry, hashMethod, epoch = this._cacheEpoch, owner = null) {
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
    const work = Promise.race([attempt().catch(() => {}), lifetime]).finally(() => {
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
    if (!hash) {
      hash = this._tryHashBuffer(value?.copyBytes?.());
      this._contentHashes.set(value, hash);
    }
    return hash;
  },

  async _verifyExpectedContent(value, type, expectedHash, url) {
    if (!expectedHash) return value;
    const hash = type === 'binary' && value && typeof value === 'object' ? this._hashBinaryContent(value) : this._tryHashString(value);
    const actual = await hash;
    if (!actual || actual.toLowerCase() !== String(expectedHash).toLowerCase()) throw new ResourceLoadError('integrity', url);
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
    if (!(source instanceof BinaryReader)) throw new ResourceLoadError('decode', url);
    const contentHash = await this._withConsumerAbort(this._hashBinaryContent(source), opts.signal, url, `handle:${url}`);
    if (this._disposed || opts.signal?.aborted) throw new ResourceLoadError('cancelled', url);
    if (!contentHash) throw new ResourceLoadError('unavailable', url);
    return new RawAssetHandle(source, { requestedUrl: url, contentHash, generation: contentHash, sourceRevision: opts.sourceRevision ?? this._cacheBustRevision,
      verification: 'sha256', providerEpoch: this._cacheEpoch });
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
    if (this._disposed) throw new ResourceLoadError('cancelled', url);
    if (owner && /\bno-store\b/i.test(response.headers.cacheControl || '')) owner.noStore = true;
    if (response.notModified) return this._acceptNotModified(url, response.headers, owner);

    const buf = response.data;
    const Reader = getDependency('BinaryReader', BinaryReader);
    const reader = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
    if (owner) owner.entry = { type: 'binary', ...response.headers, fetchedAt: Date.now() };
    this._scheduleOptionalStore(url, { type: 'binary', data: buf, ...response.headers }, () => this._hashBinaryContent(reader), requestEpoch, owner);
    return reader;
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
