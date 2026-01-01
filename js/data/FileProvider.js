import { BaseLogger } from '../util/LogHandler.js';
import { BinaryReader } from './BinaryReader.js';
import { getDependency } from '../core/dependencies.js';
import '../util/LogHandler.js';

const LOCAL_STORAGE_PREFIX = 'lem-cache:';
const LOCAL_STORAGE_MAX_BYTES = 4 * 1024 * 1024;
const IDB_NAME = 'lemmings-cache';
const IDB_VERSION = 1;
const IDB_STORE_ENTRIES = 'entries';
const IDB_STORE_PAYLOADS = 'payloads';
const IDB_STORE_META = 'meta';
const IDB_MAX_BYTES = 50 * 1024 * 1024;

/**
 * FileProvider with transparent in‑memory caching.
 */
class FileProvider extends BaseLogger {
  constructor(rootPath) {
    super();
    this.rootPath = rootPath;

    /**
     * Cache mapping full URL → Promise<BinaryReader> or Promise<string>.
     * Store the Promise itself so concurrent callers share one in‑flight XHR.
     * @type {Map<string, Promise<any>>}
     */
    this._cache = new Map();
    this._idbPromise = null;
    this._idbDisabled = false;
    this._cacheStats = { localStorageBytes: 0, indexedDbBytes: 0 };
  }

  /** Empty the cache (debug helper). */
  clearCache() {
    this._cache.clear();
  }

  /** Return cache size telemetry for debug/UI. */
  getCacheStats() {
    return {
      memoryEntries: this._cache.size,
      localStorageBytes: this._cacheStats.localStorageBytes,
      indexedDbBytes: this._cacheStats.indexedDbBytes
    };
  }

  /**
   * Load binary data from URL( rootPath + path + filename ).
   * Returns a Promise that resolves to BinaryReader.
   * @param {string} path    sub‑directory below rootPath (leading slash optional)
   * @param {?string} filename  optional file name; when omitted `path` is treated as full relative URL
   * @param {{forceReload?: boolean}} [opts]
   */
  loadBinary(path, filename = null, opts = {}) {
    const url = this._buildUrl(path, filename);
    if (!opts.forceReload && this._cache.has(url)) {
      return this._cache.get(url);
    }

    let promise;
    if (!opts.forceReload) {
      if (this._canUseIndexedDb()) {
        promise = this._loadFromIndexedDb(url, 'binary', path)
          .then((cached) => {
            if (cached) return cached.value;
            const fallback = this._loadFromLocalStorage(url, 'binary', path);
            if (fallback) return fallback.value;
            this.log.debug('loading: ' + url);
            return this._fetchBinary(url, path);
          })
          .catch(() => {
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
  }

  /**
   * Load text file as string; cached with the same rules as binary.
   */
  loadString(url, opts = {}) {
    if (!opts.forceReload && this._cache.has(url)) {
      return this._cache.get(url);
    }

    let promise;
    if (!opts.forceReload) {
      if (this._canUseIndexedDb()) {
        promise = this._loadFromIndexedDb(url, 'text')
          .then((cached) => {
            if (cached) return cached.value;
            const fallback = this._loadFromLocalStorage(url, 'text');
            if (fallback) return fallback.value;
            return this._fetchText(url);
          })
          .catch(() => {
            const fallback = this._loadFromLocalStorage(url, 'text');
            if (fallback) return fallback.value;
            return this._fetchText(url);
          });
      } else {
        const cached = this._loadFromLocalStorage(url, 'text');
        if (cached) {
          promise = Promise.resolve(cached.value);
        }
      }
    }

    if (!promise) {
      // this.log.debug('loading text: ' + url);
      promise = this._fetchText(url);
    }

    const guarded = promise.catch((err) => {
      if (!opts.forceReload) this._cache.delete(url);
      throw err;
    });

    if (!opts.forceReload) {
      this._cache.set(url, guarded);
    }
    return guarded;
  }

  _buildUrl(path, filename) {
    return (
      this.rootPath +
      path +
      (filename == null ? '' : '/' + filename)
    );
  }

  _filenameFromUrl(url) {
    if (!url) return '';
    url = url.split('#')[0].split('?')[0];
    return url.substring(url.lastIndexOf('/') + 1);
  }

  _localStorageKey(url) {
    return LOCAL_STORAGE_PREFIX + url;
  }

  _canUseIndexedDb() {
    return !this._idbDisabled && typeof indexedDB !== 'undefined';
  }

  _idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  _openIndexedDb() {
    if (!this._canUseIndexedDb()) return Promise.resolve(null);
    if (this._idbPromise) return this._idbPromise;
    this._idbPromise = new Promise((resolve) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_ENTRIES)) {
          const store = db.createObjectStore(IDB_STORE_ENTRIES, { keyPath: 'url' });
          store.createIndex('lastAccess', 'lastAccess', { unique: false });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_PAYLOADS)) {
          db.createObjectStore(IDB_STORE_PAYLOADS, { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_META)) {
          db.createObjectStore(IDB_STORE_META, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        this._idbDisabled = true;
        resolve(null);
      };
    });
    return this._idbPromise;
  }

  async _loadFromIndexedDb(url, type, path = '') {
    const db = await this._openIndexedDb();
    if (!db) return null;
    try {
      const tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS], 'readonly');
      const entries = tx.objectStore(IDB_STORE_ENTRIES);
      const payloads = tx.objectStore(IDB_STORE_PAYLOADS);
      const entry = await this._idbRequest(entries.get(url));
      if (!entry || entry.type !== type) return null;
      const payload = await this._idbRequest(payloads.get(url));
      if (!payload || payload.data == null) return null;
      this._verifyCache(url, entry);
      this._touchIndexedDbEntry(url, entry);
      let value;
      if (type === 'binary') {
        const Reader = getDependency('BinaryReader', BinaryReader);
        value = new Reader(payload.data, 0, null, this._filenameFromUrl(url), path);
      } else {
        value = payload.data;
      }
      return { value, entry };
    } catch (e) {
      return null;
    }
  }

  async _touchIndexedDbEntry(url, entry) {
    const db = await this._openIndexedDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE_ENTRIES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_ENTRIES);
      store.put({ ...entry, lastAccess: Date.now() });
    } catch (e) {
      // ignore
    }
  }

  async _storeInCache(url, entry) {
    const stored = await this._storeInIndexedDb(url, entry);
    if (!stored) {
      this._storeInLocalStorage(url, entry);
    }
  }

  async _storeInIndexedDb(url, entry) {
    const db = await this._openIndexedDb();
    if (!db) return false;
    try {
      const now = Date.now();
      const size = this._estimateEntrySize(entry);
      const tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      const entries = tx.objectStore(IDB_STORE_ENTRIES);
      const payloads = tx.objectStore(IDB_STORE_PAYLOADS);
      const metaStore = tx.objectStore(IDB_STORE_META);
      const existing = await this._idbRequest(entries.get(url));
      const prevSize = existing?.size || 0;
      entries.put({
        url,
        type: entry.type,
        etag: entry.etag || null,
        lastModified: entry.lastModified || null,
        hash: entry.hash || null,
        size,
        lastAccess: now
      });
      payloads.put({ url, data: entry.data });
      const meta = await this._idbRequest(metaStore.get('totalBytes'));
      const total = Math.max(0, (meta?.value || 0) - prevSize + size);
      metaStore.put({ key: 'totalBytes', value: total });
      this._cacheStats.indexedDbBytes = total;
      tx.oncomplete = () => {
        if (total > IDB_MAX_BYTES) {
          this._pruneIndexedDb(total);
        }
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  async _pruneIndexedDb(totalBytes) {
    const db = await this._openIndexedDb();
    if (!db) return;
    let remaining = totalBytes;
    if (remaining <= IDB_MAX_BYTES) return;
    try {
      const tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      const entries = tx.objectStore(IDB_STORE_ENTRIES);
      const payloads = tx.objectStore(IDB_STORE_PAYLOADS);
      const metaStore = tx.objectStore(IDB_STORE_META);
      const index = entries.index('lastAccess');
      const cursorRequest = index.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || remaining <= IDB_MAX_BYTES) {
          metaStore.put({ key: 'totalBytes', value: Math.max(0, remaining) });
          this._cacheStats.indexedDbBytes = Math.max(0, remaining);
          return;
        }
        const entry = cursor.value;
        const size = entry?.size || 0;
        entries.delete(entry.url);
        payloads.delete(entry.url);
        remaining = Math.max(0, remaining - size);
        cursor.continue();
      };
    } catch (e) {
      // ignore
    }
  }

  _estimateEntrySize(entry) {
    if (!entry) return 0;
    if (entry.type === 'binary') {
      if (entry.data instanceof ArrayBuffer) return entry.data.byteLength;
      if (ArrayBuffer.isView(entry.data)) return entry.data.byteLength;
    }
    if (typeof entry.data === 'string') {
      return this._estimateTextSize(entry.data);
    }
    return 0;
  }

  _estimateTextSize(text) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(text).length;
    }
    return text.length || 0;
  }

  _getLocalStorageEntries() {
    if (typeof localStorage === 'undefined') return [];
    const entries = [];
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(LOCAL_STORAGE_PREFIX)) continue;
        const value = localStorage.getItem(key);
        entries.push({ key, value });
      }
      return entries;
    }
    if (localStorage.store && typeof localStorage.store.forEach === 'function') {
      localStorage.store.forEach((value, key) => {
        if (!String(key).startsWith(LOCAL_STORAGE_PREFIX)) return;
        entries.push({ key, value });
      });
    }
    return entries;
  }

  _getLocalStorageUsage() {
    return this._getLocalStorageEntries()
      .reduce((total, entry) => total + (entry.value ? String(entry.value).length : 0), 0);
  }

  _updateLocalStorageStats() {
    this._cacheStats.localStorageBytes = this._getLocalStorageUsage();
  }

  _serializeLocalStorageEntry(entry) {
    const next = { ...entry, lastAccess: entry.lastAccess || Date.now() };
    let json = JSON.stringify({ ...next, size: 0 });
    next.size = json.length;
    json = JSON.stringify(next);
    next.size = json.length;
    return { entry: next, json };
  }

  _setLocalStorageItem(key, json) {
    try {
      localStorage.setItem(key, json);
      return true;
    } catch (e) {
      return false;
    }
  }

  _evictLocalStorage(requiredBytes = 0) {
    const entries = this._getLocalStorageEntries();
    if (!entries.length) return;
    let total = 0;
    const parsed = [];
    for (const entry of entries) {
      const raw = entry.value;
      total += raw ? String(raw).length : 0;
      let parsedEntry = null;
      try {
        parsedEntry = raw ? JSON.parse(raw) : null;
      } catch (e) {
        parsedEntry = null;
      }
      parsed.push({
        key: entry.key,
        lastAccess: parsedEntry?.lastAccess || 0,
        size: parsedEntry?.size || (raw ? String(raw).length : 0)
      });
    }
    const target = Math.max(0, LOCAL_STORAGE_MAX_BYTES - requiredBytes);
    if (total <= target) {
      this._cacheStats.localStorageBytes = total;
      return;
    }
    parsed.sort((a, b) => a.lastAccess - b.lastAccess);
    for (const entry of parsed) {
      if (total <= target) break;
      localStorage.removeItem(entry.key);
      total = Math.max(0, total - entry.size);
    }
    this._cacheStats.localStorageBytes = total;
  }

  _touchLocalStorageEntry(url, entry) {
    if (!entry) return;
    entry.lastAccess = Date.now();
    const key = this._localStorageKey(url);
    const serialized = this._serializeLocalStorageEntry(entry);
    if (this._setLocalStorageItem(key, serialized.json)) {
      this._cacheStats.localStorageBytes = Math.max(
        this._cacheStats.localStorageBytes,
        this._getLocalStorageUsage()
      );
    }
  }

  _loadFromLocalStorage(url, type, path = '') {
    try {
      if (typeof localStorage === 'undefined') return null;
      const item = localStorage.getItem(this._localStorageKey(url));
      if (!item) return null;
      const entry = JSON.parse(item);
      if (entry.type !== type) return null;

      // kick off async validation of cache
      this._verifyCache(url, entry);

      let value;
      if (type === 'binary') {
        const buf = this._base64ToArrayBuffer(entry.data);
        const Reader = getDependency('BinaryReader', BinaryReader);
        value = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
      } else {
        value = entry.data;
      }
      this._touchLocalStorageEntry(url, entry);
      return { value, entry };
    } catch (e) {
      return null;
    }
  }

  async _verifyCache(url, entry) {
    const head = await this._fetchHead(url);
    if (!head) return;
    if (entry.etag && head.etag && entry.etag === head.etag) return;
    if (entry.lastModified && head.lastModified && entry.lastModified === head.lastModified) return;
    try {
      if (entry.type === 'binary') {
        await this._fetchBinary(url, '');
      } else {
        await this._fetchText(url);
      }
    } catch (e) {
      console.log('cache update error', e);
    }
  }

  async _fetchBinary(url, path) {
    const response = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const headers = {
            etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
            lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null,
          };
          resolve({ buffer: xhr.response, headers });
        } else {
          const err = new Error('error load file: ' + url);
          this.log.log(err.message);
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error('error load file: ' + url);
        this.log.log(err.message);
        reject(err);
      };
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.send();
    });

    const buf = response.buffer;
    const Reader = getDependency('BinaryReader', BinaryReader);
    const reader = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
    const hash = await this._hashBuffer(buf);
    await this._storeInCache(url, { type: 'binary', data: buf, hash, ...response.headers });
    return reader;
  }

  async _fetchText(url) {
    const response = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const headers = {
            etag: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('ETag') : null,
            lastModified: typeof xhr.getResponseHeader === 'function' ? xhr.getResponseHeader('Last-Modified') : null,
          };
          resolve({ text: xhr.response, headers });
        } else {
          const err = new Error('error load file: ' + url);
          this.log.log(err.message);
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error('error load file: ' + url);
        this.log.log(err.message);
        reject(err);
      };
      xhr.open('GET', url);
      xhr.responseType = 'text';
      xhr.send();
    });

    const text = response.text;
    const hash = await this._hashString(text);
    await this._storeInCache(url, { type: 'text', data: text, hash, ...response.headers });
    return text;
  }

  async _fetchHead(url) {
    if (typeof fetch !== 'function') return null;
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      return { etag: resp.headers.get('ETag'), lastModified: resp.headers.get('Last-Modified') };
    } catch (e) {
      return null;
    }
  }

  _storeInLocalStorage(url, entry) {
    if (typeof localStorage === 'undefined') return false;
    try {
      const stored = { ...entry };
      if (stored.type === 'binary' && stored.data instanceof ArrayBuffer) {
        stored.data = this._arrayBufferToBase64(stored.data);
      }
      stored.lastAccess = Date.now();
      const serialized = this._serializeLocalStorageEntry(stored);
      const key = this._localStorageKey(url);
      if (!this._setLocalStorageItem(key, serialized.json)) {
        this._evictLocalStorage(serialized.entry.size);
        if (!this._setLocalStorageItem(key, serialized.json)) {
          return false;
        }
      }
      this._updateLocalStorageStats();
      return true;
    } catch (e) {
      console.log('cache write error', e);
      return false;
    }
  }

  async _hashBuffer(buffer) {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
      const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    try {
      if (this._forceCryptoError) throw new Error('forced');
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256');
      hash.update(Buffer.from(buffer));
      return hash.digest('hex');
    } catch (e) {
      throw new Error('crypto API not available');
    }
  }

  async _hashString(str) {
    const enc = new TextEncoder();
    return this._hashBuffer(enc.encode(str));
  }

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    const chunks = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      chunks.push(String.fromCharCode(...chunk));
    }
    return btoa(chunks.join(''));
  }

  _base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export { FileProvider };
