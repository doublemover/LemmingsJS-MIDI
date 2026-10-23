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

const requestWithXhrUnbounded = (provider, url, responseType) => new Promise((resolve, reject) => {
  let xhr;
  try { xhr = provider._createXhr(); } catch (cause) { reject(new ResourceLoadError('unavailable', url, { cause })); return; }
  let settled = false;
  let deadlineTimer = null;
  const request = { key: responseType === 'arraybuffer' ? `binary:${url}` : url, abort() {
    if (settled) return;
    try { xhr.abort?.(); } catch { /* Reject this request even if the adapter cannot abort. */ }
    fail('cancelled');
  } };
  const finish = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(deadlineTimer);
    provider._requests.delete(request);
    xhr.onload = null; xhr.onerror = null; xhr.onabort = null; xhr.ontimeout = null;
    return true;
  };
  const fail = (kind, status = null, cause = null) => {
    if (!finish()) return;
    const error = new ResourceLoadError(kind, url, { status, cause });
    provider.log.log(error.message);
    reject(error);
  };
  xhr.onload = () => {
    if (provider._disposed) { fail('cancelled'); return; }
    if (xhr.status >= 200 && xhr.status < 300) {
      const bytes = responseType === 'arraybuffer' ? xhr.response?.byteLength : typeof xhr.response === 'string' ? xhr.response.length * 2 : 0;
      if (bytes > provider._maxResponseBytes) { fail('too-large'); return; }
      if (!finish()) return;
      resolve({ data: xhr.response, headers: {
        etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
        lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null
      } });
    } else fail(resourceKindFromStatus(xhr.status), xhr.status);
  };
  xhr.onerror = event => fail(xhr.status ? resourceKindFromStatus(xhr.status) : 'network', xhr.status || null, event instanceof Error ? event : null);
  xhr.onabort = () => fail('cancelled');
  xhr.ontimeout = () => fail('timeout');
  provider._requests.add(request);
  deadlineTimer = setTimeout(() => { fail('timeout'); try { xhr.abort?.(); } catch { /* Deadline already settled. */ } }, provider._requestTimeoutMs);
  try { xhr.open('GET', url); xhr.responseType = responseType; xhr.timeout = provider._requestTimeoutMs; xhr.send(); } catch (cause) { fail('network', null, cause); }
});
const requestWithXhr = (provider, url, responseType) => new Promise((resolve, reject) => {
  const key = responseType === 'arraybuffer' ? `binary:${url}` : url;
  const release = () => {
    provider._activeRequestCount--;
    const next = provider._requestQueue.shift();
    next?.run();
  };
  const run = () => {
    if (provider._disposed) { reject(new ResourceLoadError('cancelled', url)); return; }
    provider._activeRequestCount++;
    requestWithXhrUnbounded(provider, url, responseType).then(resolve, reject).finally(release);
  };
  if (provider._activeRequestCount < provider._maxConcurrentRequests) run();
  else {
    if (provider._requestQueue.length >= provider._maxQueuedRequests) { reject(new ResourceLoadError('busy', url)); return; }
    let timer;
    const queued = { key, run() { clearTimeout(timer); run(); }, abort(kind = 'cancelled') {
      const index = provider._requestQueue.indexOf(queued);
      if (index < 0) return;
      provider._requestQueue.splice(index, 1);
      clearTimeout(timer); reject(new ResourceLoadError(kind, url));
    } };
    provider._requestQueue.push(queued);
    timer = setTimeout(() => queued.abort('timeout'), provider._requestTimeoutMs);
  }
});
const fileProviderFetchMethods = {
  _withConsumerAbort(promise, signal, url, key = url) {
    if (signal?.aborted) return Promise.reject(new ResourceLoadError('cancelled', url));
    this._consumerCounts.set(key, (this._consumerCounts.get(key) || 0) + 1);
    return new Promise((resolve, reject) => {
      let released = false;
      const release = canceled => {
        if (released) return;
        released = true;
        signal?.removeEventListener('abort', cancel);
        const remaining = (this._consumerCounts.get(key) || 1) - 1;
        if (remaining) this._consumerCounts.set(key, remaining); else this._consumerCounts.delete(key);
        if (canceled && !remaining) {
          for (const request of [...this._requests]) if (request.key === key) request.abort();
          for (const queued of [...this._requestQueue]) if (queued.key === key) queued.abort();
        }
      };
      const cancel = () => { release(true); reject(new ResourceLoadError('cancelled', url)); };
      signal?.addEventListener('abort', cancel, { once: true });
      promise.then(value => { if (released) return; release(false); resolve(value); }, error => {
        if (released) return; release(false); reject(error);
      });
    });
  },

  _scheduleOptionalStore(url, entry, hashMethod, epoch = this._cacheEpoch) {
    const work = Promise.resolve().then(() => this._disposed || epoch !== this._cacheEpoch ? null : hashMethod()).catch(() => null).then(hash => {
      if (this._disposed || epoch !== this._cacheEpoch) return;
      return this._storeInCache(url, { ...entry, hash });
    }).catch(() => {});
    this._pendingCacheWrites.add(work);
    work.finally(() => this._pendingCacheWrites.delete(work));
  },

  _forkBinaryReader(source, url, path) {
    const Reader = getDependency('BinaryReader', BinaryReader);
    const reader = new Reader(source, 0, null, this._filenameFromUrl(url), path);
    if (reader instanceof BinaryReader) Object.defineProperty(reader, 'ready', { configurable: true,
      get: () => Promise.resolve(reader.data) });
    return reader;
  },

  async _verifyExpectedContent(value, type, expectedHash, url) {
    if (!expectedHash) return value;
    const bytes = type === 'binary' ? value?.data : typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value) : null;
    const actual = bytes && await this._tryHashBuffer(bytes);
    if (!actual || actual.toLowerCase() !== String(expectedHash).toLowerCase()) throw new ResourceLoadError('integrity', url);
    return value;
  },

  loadBinary(path, filename = null, opts = {}) {
    const url = this._buildUrl(path, filename);
    const key = `binary:${url}`;
    const requestEpoch = this._cacheEpoch;
    if (this._disposed) return Promise.reject(new ResourceLoadError('cancelled', url));
    if (opts.signal?.aborted) return Promise.reject(new ResourceLoadError('cancelled', url));
    if (!opts.forceReload && this._cache.has(key)) return this._withConsumerAbort(this._cache.get(key)
      .then(source => this._verifyExpectedContent(source, 'binary', opts.expectedHash, url))
      .then(source => this._forkBinaryReader(source, url, path)), opts.signal, url, key);
    const version = (this._requestVersions.get(key) || 0) + 1, epoch = this._cacheEpoch;
    this._requestVersions.set(key, version);

    let promise;
    if (!opts.forceReload) {
      if (this._canUseIndexedDb()) {
        promise = this._loadFromIndexedDb(url, 'binary', path)
          .catch(() => null)
          .then((cached) => {
            if (cached) return cached.value;
            const fallback = this._loadFromLocalStorage(url, 'binary', path);
            if (fallback) return fallback.value;
            this.log.debug('loading: ' + url);
            return this._fetchBinary(url, path, requestEpoch);
          });
      } else {
        const cached = this._loadFromLocalStorage(url, 'binary', path);
        if (cached) {
          promise = Promise.resolve(cached.value);
        }
      }
    }

    if (!promise) {
      this.log.debug('loading: ' + url);
      promise = this._fetchBinary(url, path, requestEpoch);
    }

    const guarded = promise.catch((err) => {
      if (this._cache.get(key) === guarded) this._cache.delete(key);
      throw err;
    });
    if (opts.forceReload) guarded.then(() => {
      if (!this._disposed && this._cacheEpoch === epoch && this._requestVersions.get(key) === version) this._cache.set(key, guarded);
    }, () => {});
    else this._cache.set(key, guarded);
    return this._withConsumerAbort(guarded.then(source => this._verifyExpectedContent(source, 'binary', opts.expectedHash, url))
      .then(source => this._forkBinaryReader(source, url, path)), opts.signal, url, key);
  },

  loadString(url, opts = {}) {
    const resolvedUrl = this._appendCacheBust(url);
    const requestEpoch = this._cacheEpoch;
    if (this._disposed) return Promise.reject(new ResourceLoadError('cancelled', resolvedUrl));
    if (opts.signal?.aborted) return Promise.reject(new ResourceLoadError('cancelled', resolvedUrl));
    if (!opts.forceReload && this._cache.has(resolvedUrl)) {
      return this._withConsumerAbort(this._cache.get(resolvedUrl)
        .then(value => this._verifyExpectedContent(value, 'text', opts.expectedHash, resolvedUrl)), opts.signal, resolvedUrl);
    }
    const version = (this._requestVersions.get(resolvedUrl) || 0) + 1, epoch = this._cacheEpoch;
    this._requestVersions.set(resolvedUrl, version);

    let promise;
    if (!opts.forceReload) {
      if (this._canUseIndexedDb()) {
        promise = this._loadFromIndexedDb(resolvedUrl, 'text')
          .catch(() => null)
          .then((cached) => {
            if (cached) return cached.value;
            const fallback = this._loadFromLocalStorage(resolvedUrl, 'text');
            if (fallback) return fallback.value;
            return this._fetchText(resolvedUrl, requestEpoch);
          });
      } else {
        const cached = this._loadFromLocalStorage(resolvedUrl, 'text');
        if (cached) {
          promise = Promise.resolve(cached.value);
        }
      }
    }

    if (!promise) {
      // this.log.debug('loading text: ' + url);
      promise = this._fetchText(resolvedUrl, requestEpoch);
    }

    const guarded = promise.catch((err) => {
      if (this._cache.get(resolvedUrl) === guarded) this._cache.delete(resolvedUrl);
      throw err;
    });
    if (opts.forceReload) guarded.then(() => {
      if (!this._disposed && this._cacheEpoch === epoch && this._requestVersions.get(resolvedUrl) === version) this._cache.set(resolvedUrl, guarded);
    }, () => {});
    else this._cache.set(resolvedUrl, guarded);
    return this._withConsumerAbort(guarded.then(value => this._verifyExpectedContent(value, 'text', opts.expectedHash, resolvedUrl)), opts.signal, resolvedUrl);
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

  async _fetchBinary(url, path, requestEpoch = this._cacheEpoch) {
    const response = await requestWithXhr(this, url, 'arraybuffer');
    if (this._disposed) throw new ResourceLoadError('cancelled', url);

    const buf = response.data;
    const Reader = getDependency('BinaryReader', BinaryReader);
    const reader = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
    this._scheduleOptionalStore(url, { type: 'binary', data: buf, ...response.headers }, () => this._tryHashBuffer(buf), requestEpoch);
    return reader;
  },

  async _fetchText(url, requestEpoch = this._cacheEpoch) {
    const response = await requestWithXhr(this, url, 'text');
    if (this._disposed) throw new ResourceLoadError('cancelled', url);

    const text = response.data;
    this._scheduleOptionalStore(url, { type: 'text', data: text, ...response.headers }, () => this._tryHashString(text), requestEpoch);
    return text;
  },

  async _fetchHead(url) {
    const fetchRef = this._hasFetchOverride
      ? this._fetch
      : (typeof fetch === 'function' ? fetch : null);
    if (typeof fetchRef !== 'function') return null;
    try {
      const resp = await fetchRef(url, { method: 'HEAD' });
      if (resp.ok === false || Number.isFinite(resp.status) && (resp.status < 200 || resp.status >= 300)) return null;
      return { etag: resp.headers.get('ETag'), lastModified: resp.headers.get('Last-Modified') };
    } catch (e) {
      return null;
    }
  }
};
export { fileProviderFetchMethods };
