import { RawByteLease } from './RawByteLease.js';

export const fileProviderBudgetMethods = {
  _reserveRawBytes(bytes) {
    if (!this._budgetAdapter) return null;
    let lease;
    try {
      lease = new RawByteLease(this._budgetAdapter, { owner: this._budgetOwner, generation: this._cacheEpoch,
        bytes, onResize: () => this._measureRawPeak(),
        onRelease: lease => { this._rawByteLeases.delete(lease); this._rawByteMetrics.retiredStorageCount++; } });
    } catch (error) { this._rawByteMetrics.denials++; throw error; }
    this._rawByteLeases.add(lease);
    this._rawByteMetrics.reservations++;
    this._measureRawPeak();
    return lease;
  },

  _measureRawPeak() {
    let reserved = 0; for (const live of this._rawByteLeases) reserved += live.bytes;
    this._rawByteMetrics.peakReservedBytes = Math.max(this._rawByteMetrics.peakReservedBytes, reserved);
  },

  setBudgetAdapter(adapter) {
    if (adapter === this._budgetAdapter) return;
    if (this._cacheSources.size || this._rawByteLeases.size || [...this._acquisitions].some(record => record.key.startsWith('binary:'))) throw new Error('Configure the asset budget before binary acquisition');
    if (!adapter || typeof adapter.reserve !== 'function' || typeof adapter.release !== 'function') throw new TypeError('A synchronous resource budget adapter is required');
    this._unregisterBudgetEvictor?.();
    this._budgetAdapter = adapter;
    this._unregisterBudgetEvictor = adapter.registerEvictor?.(this._budgetOwner, request => this._evictRawCache(request));
  },

  getRawAssetStats() {
    let residentBytes = 0, pinnedBytes = 0;
    for (const lease of this._rawByteLeases) { residentBytes += lease.bytes; if (lease.pinned) pinnedBytes += lease.bytes; }
    return Object.freeze({ storageCount: this._rawByteLeases.size, residentBytes, pinnedBytes, cacheBytes: residentBytes - pinnedBytes, ...this._rawByteMetrics });
  },

  _publishCacheSource(key, value) {
    const previous = this._cacheSources.get(key);
    if (previous && previous !== value) this._releaseCacheSource(previous);
    if (value?._setStorageLeaseRole) { value._setStorageLeaseRole('cache'); this._cacheSources.set(key, value); }
  },

  _dropCacheSource(key, value) {
    if (this._cacheSources.get(key) !== value) return;
    this._cacheSources.delete(key);
    this._releaseCacheSource(value);
  },

  _releaseCacheSource(value) {
    if (this._sourceRecords.get(value)?.consumers) return;
    value.release();
  },

  _retireRecordSource(record) {
    const value = record?.value;
    if (!value || record.consumers || this._cache.get(record.key) === record.promise || [...this._cacheSources.values()].includes(value)) return;
    value.release?.();
    record.value = null;
  },

  _clearRawCacheSources() {
    for (const source of new Set(this._cacheSources.values())) this._releaseCacheSource(source);
    this._cacheSources.clear();
  },

  _evictRawCache({ neededBytes = Infinity } = {}) {
    let released = 0;
    for (const [key, value] of this._cacheSources) {
      if (released >= neededBytes) break;
      if (value._isStoragePinned()) continue;
      this._cacheSources.delete(key); this._cache.delete(key);
      released += value.length;
      this._rawByteMetrics.evictedStorageCount++; this._rawByteMetrics.evictedBytes += value.length;
      value.release();
    }
    return released;
  }
};
