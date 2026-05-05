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
const fileProviderCacheMethods = {
  clearCache() {
    this._cache.clear();
  },

  async close() {
    const db = this._idb || await this._idbPromise?.catch?.(() => null);
    db?.close?.();
    this._idb = null;
    this._idbPromise = null;
  },

  dispose() {
    this._cache.clear();
    this._validationPromises.clear();
    this.close();
  },

  getCacheStats() {
    return {
      memoryEntries: this._cache.size,
      localStorageBytes: this._cacheStats.localStorageBytes,
      indexedDbBytes: this._cacheStats.indexedDbBytes
    };
  },

  async _storeInCache(url, entry) {
    const stored = await this._storeInIndexedDb(url, entry);
    if (!stored) {
      this._storeInLocalStorage(url, entry);
    }
  },

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
  },

  _estimateTextSize(text) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(text).length;
    }
    return text.length || 0;
  },

  _scheduleCacheValidation(url, entry) {
    if (!url || !entry || this._validationPromises.has(url)) return;
    const promise = this._verifyCache(url, entry)
      .catch(() => {})
      .finally(() => {
        if (this._validationPromises.get(url) === promise) {
          this._validationPromises.delete(url);
        }
      });
    this._validationPromises.set(url, promise);
  },

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
      this.log.log('cache update error', e);
    }
  }
};
export { fileProviderCacheMethods };