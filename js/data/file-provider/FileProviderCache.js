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
    this._cacheEpoch++;
    for (const retire of this._retireCacheWrites) retire();
    this._cache.clear();
    this._clearRawCacheSources();
    this._refreshes.clear();
    this._cacheTouchTimes.clear();
    for (const tx of [...this._cacheTransactions]) { try { tx.abort?.(); } catch { /* Already committed. */ } }
  },

  async close() {
    this._idbOpenEpoch++;
    const db = this._idb;
    this._cancelIdbOpen?.();
    for (const tx of [...this._cacheTransactions]) { try { tx.abort?.(); } catch { /* Already committed. */ } }
    db?.close?.();
    this._idb = null;
    this._idbPromise = null;
  },

  dispose() {
    this._disposeRequested = true;
    if (this._resourceLeases.size) return;
    if (this._disposed) return;
    this._disposed = true;
    this._cacheEpoch++;
    for (const retire of this._retireCacheWrites) retire();
    for (const request of [...this._requests]) request.abort();
    for (const queued of [...this._requestQueue]) queued.abort();
    for (const record of this._acquisitions) record.controller.abort();
    this._cache.clear();
    this._clearRawCacheSources();
    this._unregisterBudgetEvictor?.();
    this._unregisterBudgetEvictor = null;
    this._validationPromises.clear();
    this._refreshes.clear();
    this.close().catch(() => {});
  },

  acquireLease() {
    if (this._disposed || this._disposeRequested) throw new Error('FileProvider has retired');
    let released = false;
    const lease = Object.freeze({ provider: this, release: () => {
      if (released) return;
      released = true;
      this._resourceLeases.delete(lease);
      if (this._disposeRequested && !this._resourceLeases.size) this.dispose();
    } });
    this._resourceLeases.add(lease);
    return lease;
  },

  getCacheStats() {
    return {
      memoryEntries: this._cache.size,
      localStorageBytes: this._cacheStats.localStorageBytes,
      indexedDbBytes: this._cacheStats.indexedDbBytes,
      ownedRequests: this._requests.size + this._requestQueue.length,
      resourceLeases: this._resourceLeases.size
    };
  },

  waitForCacheWrites() { return Promise.allSettled([...this._pendingCacheWrites]); },

  async _storeInCache(url, entry, ownership = {}) {
    if (/\bno-store\b/i.test(entry.cacheControl || '') || this._disposed || ownership.epoch != null && ownership.epoch !== this._cacheEpoch) return;
    const stored = await this._storeInIndexedDb(url, entry, ownership);
    if (this._disposed || ownership.epoch != null && ownership.epoch !== this._cacheEpoch || ownership.owner?.controller.signal.aborted ||
        ownership.owner && this._requestVersions.get(ownership.owner.key) !== ownership.owner.version) return;
    if (!stored) {
      await this._storeInLocalStorageCoordinated(url, entry, ownership);
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

  _scheduleCacheValidation(url, entry, value = null) {
    const key = `${entry?.type}:${url}`;
    if (!url || !entry || this._disposed || this._validationPromises.has(key) || /\bno-store\b/i.test(entry.cacheControl || '')) return;
    const maxAge = /\bmax-age=(\d+)/i.exec(entry.cacheControl || '');
    if (maxAge && Number.isFinite(entry.fetchedAt) && Date.now() - entry.fetchedAt < Number(maxAge[1]) * 1000) return;
    const promise = this._verifyCache(url, entry, value)
      .catch(() => {})
      .finally(() => {
        if (this._validationPromises.get(key) === promise) {
          this._validationPromises.delete(key);
        }
      });
    this._validationPromises.set(key, promise);
  },

  async _verifyCache(url, entry, value = null) {
    const type = entry.type, key = type === 'binary' ? `binary:${url}` : url;
    const epoch = this._cacheEpoch, version = this._requestVersions.get(key);
    if (value != null) {
      if (this._disposed) return;
      const ownedValue = type === 'binary' ? this._forkBinaryReader(value, url, '') : value;
      try {
        const reader = await this._loadResource(type, url, '', { cachePolicy: 'reload', validation: { value: ownedValue, entry, ownsValue: type === 'binary' } });
        if (type === 'binary') reader.release?.();
      }
      catch (error) { this.log.log('cache update error', { kind: error?.kind || 'unavailable', status: error?.status ?? null }); }
      return;
    }
    const head = await this._fetchHead(url);
    if (!head) return;
    if (entry.etag && head.etag && entry.etag === head.etag) return;
    if (!entry.etag && !head.etag && entry.lastModified && head.lastModified && entry.lastModified === head.lastModified) return;
    if (this._disposed || epoch !== this._cacheEpoch || this._requestVersions.get(key) !== version) return;
    try {
      await this._loadResource(type, url, '', { forceReload: true });
    } catch (e) {
      this.log.log('cache update error', { kind: e?.kind || 'unavailable', status: e?.status ?? null });
    }
  }
};
export { fileProviderCacheMethods };
