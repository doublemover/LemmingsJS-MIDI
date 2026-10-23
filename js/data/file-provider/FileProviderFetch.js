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

const requestWithXhr = (provider, url, responseType) => new Promise((resolve, reject) => {
  let xhr;
  try { xhr = provider._createXhr(); } catch (cause) { reject(new ResourceLoadError('unavailable', url, { cause })); return; }
  const fail = (kind, status = null, cause = null) => {
    const error = new ResourceLoadError(kind, url, { status, cause });
    provider.log.log(error.message);
    reject(error);
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      resolve({ data: xhr.response, headers: {
        etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
        lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null
      } });
    } else fail(resourceKindFromStatus(xhr.status), xhr.status);
  };
  xhr.onerror = event => fail('network', null, event instanceof Error ? event : null);
  xhr.onabort = () => fail('cancelled');
  xhr.ontimeout = () => fail('timeout');
  try { xhr.open('GET', url); xhr.responseType = responseType; xhr.send(); } catch (cause) { fail('network', null, cause); }
});
const fileProviderFetchMethods = {
  loadBinary(path, filename = null, opts = {}) {
    const url = this._buildUrl(path, filename);
    if (!opts.forceReload && this._cache.has(url)) {
      return this._cache.get(url);
    }

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
            return this._fetchBinary(url, path);
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
      promise = this._fetchBinary(url, path);
    }

    const guarded = promise.catch((err) => {
      if (!opts.forceReload) this._cache.delete(url);
      throw err;
    });

    if (!opts.forceReload) {
      this._cache.set(url, guarded);
    }
    return guarded;
  },

  loadString(url, opts = {}) {
    const resolvedUrl = this._appendCacheBust(url);
    if (!opts.forceReload && this._cache.has(resolvedUrl)) {
      return this._cache.get(resolvedUrl);
    }

    let promise;
    if (!opts.forceReload) {
      if (this._canUseIndexedDb()) {
        promise = this._loadFromIndexedDb(resolvedUrl, 'text')
          .catch(() => null)
          .then((cached) => {
            if (cached) return cached.value;
            const fallback = this._loadFromLocalStorage(resolvedUrl, 'text');
            if (fallback) return fallback.value;
            return this._fetchText(resolvedUrl);
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
      promise = this._fetchText(resolvedUrl);
    }

    const guarded = promise.catch((err) => {
      if (!opts.forceReload) this._cache.delete(resolvedUrl);
      throw err;
    });

    if (!opts.forceReload) {
      this._cache.set(resolvedUrl, guarded);
    }
    return guarded;
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

  async _fetchBinary(url, path) {
    const response = await requestWithXhr(this, url, 'arraybuffer');

    const buf = response.data;
    const Reader = getDependency('BinaryReader', BinaryReader);
    const reader = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
    let hash = null;
    try {
      hash = await this._tryHashBuffer(buf);
    } catch (e) {
      hash = null;
    }
    await this._storeInCache(url, { type: 'binary', data: buf, hash, ...response.headers })
      .catch(() => {});
    return reader;
  },

  async _fetchText(url) {
    const response = await requestWithXhr(this, url, 'text');

    const text = response.data;
    let hash = null;
    try {
      hash = await this._tryHashString(text);
    } catch (e) {
      hash = null;
    }
    await this._storeInCache(url, { type: 'text', data: text, hash, ...response.headers })
      .catch(() => {});
    return text;
  },

  async _fetchHead(url) {
    const fetchRef = this._hasFetchOverride
      ? this._fetch
      : (typeof fetch === 'function' ? fetch : null);
    if (typeof fetchRef !== 'function') return null;
    try {
      const resp = await fetchRef(url, { method: 'HEAD' });
      return { etag: resp.headers.get('ETag'), lastModified: resp.headers.get('Last-Modified') };
    } catch (e) {
      return null;
    }
  }
};
export { fileProviderFetchMethods };
