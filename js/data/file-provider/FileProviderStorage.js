import {
  BaseLogger,
  BinaryReader,
  CACHE_FORMAT_VERSION,
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
const fileProviderStorageMethods = {
  _buildUrl(path, filename) {
    const raw = (
      this.rootPath +
        path +
        (filename == null ? '' : '/' + filename)
    );
    return this._appendCacheBust(raw);
  },

  _appendCacheBust(url) {
    return appendRevisionParam(url, this._cacheBustRevision);
  },

  _localStorageKey(url) {
    return LOCAL_STORAGE_PREFIX + url;
  },

  _canUseIndexedDb() {
    return !this._disposed && !this._idbDisabled && !!this._indexedDB?.open;
  },

  _getLocalStorage() {
    return this._storage === undefined
      ? getRuntimeDependency('localStorage', null)
      : this._storage;
  },

  _idbRequest(request) {
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); request.onsuccess = null; request.onerror = null; callback(value); };
      const timer = setTimeout(() => finish(reject, new Error('indexedDB request timed out')), this._cacheProbeMs);
      request.onsuccess = () => finish(resolve, request.result);
      request.onerror = () => finish(reject, request.error);
    });
  },

  _idbTransactionDone(tx) {
    if (!tx || !('oncomplete' in tx || 'onabort' in tx || 'onerror' in tx)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      this._cacheTransactions.add(tx);
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._cacheTransactions.delete(tx);
        tx.oncomplete = null; tx.onabort = null; tx.onerror = null;
        callback(value);
      };
      const timer = setTimeout(() => {
        finish(reject, new Error('indexedDB transaction timed out'));
        try { tx.abort?.(); } catch { /* The transaction may already be inactive. */ }
      }, this._cacheProbeMs);
      tx.oncomplete = () => finish(resolve, true);
      tx.onabort = () => finish(reject, tx.error || new Error('indexedDB transaction aborted'));
      tx.onerror = () => finish(reject, tx.error || new Error('indexedDB transaction failed'));
    });
  },

  _openIndexedDb() {
    if (!this._canUseIndexedDb()) return Promise.resolve(null);
    if (this._idb) return Promise.resolve(this._idb);
    if (this._idbPromise) return this._idbPromise;
    const openEpoch = ++this._idbOpenEpoch;
    let promise;
    promise = new Promise((resolve) => {
      let request, settled = false;
      const settle = db => {
        if (settled) { db?.close?.(); return; }
        settled = true; clearTimeout(timer);
        if (this._cancelIdbOpen === cancelOpen) this._cancelIdbOpen = null;
        if (this._idbPromise === promise && !db) this._idbPromise = null;
        resolve(db);
      };
      const cancelOpen = () => settle(null);
      this._cancelIdbOpen = cancelOpen;
      const timer = setTimeout(() => { this._idbDisabled = true; settle(null); }, this._cacheProbeMs);
      try { request = this._indexedDB.open(IDB_NAME, IDB_VERSION); }
      catch { this._idbDisabled = true; settle(null); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (settled || this._disposed || openEpoch !== this._idbOpenEpoch) { try { request.transaction?.abort?.(); } catch { /* Retired upgrade. */ } return; }
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
        if (settled || this._disposed || openEpoch !== this._idbOpenEpoch) { db?.close?.(); settle(null); return; }
        this._idb = db;
        db.onversionchange = () => {
          db.close();
          if (this._idb === db) { this._idb = null; if (this._idbPromise === promise) this._idbPromise = null; }
        };
        settle(db);
      };
      request.onerror = () => {
        this._idbDisabled = true;
        settle(null);
      };
      request.onblocked = () => { this._idbDisabled = true; settle(null); };
    });
    this._idbPromise = promise;
    return promise;
  },

  _isCacheRecordValid(entry, payload, type = entry?.type) {
    if (!entry || entry.formatVersion !== CACHE_FORMAT_VERSION || typeof entry.generation !== 'string' || !entry.generation || entry.type !== type ||
        !['binary', 'text'].includes(type) || !Number.isSafeInteger(entry.size) || entry.size < 0) return false;
    if (entry.hash != null && !/^[a-f0-9]{64}$/i.test(entry.hash)) return false;
    if (!payload || payload.formatVersion !== CACHE_FORMAT_VERSION || payload.generation !== entry.generation) return false;
    if (type === 'binary' && !(payload.data instanceof ArrayBuffer || payload.data instanceof Uint8Array &&
        payload.data.byteOffset === 0 && payload.data.byteLength === payload.data.buffer.byteLength)) return false;
    if (type === 'text' && typeof payload.data !== 'string') return false;
    return this._estimateEntrySize({ type, data: payload.data }) === entry.size;
  },

  async _loadFromIndexedDb(url, type, path = '') {
    const epoch = this._cacheEpoch, db = await this._openIndexedDb();
    if (!db || this._disposed || epoch !== this._cacheEpoch) return null;
    let storageLease;
    try {
      const tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS], 'readonly');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const entries = tx.objectStore(IDB_STORE_ENTRIES), payloads = tx.objectStore(IDB_STORE_PAYLOADS);
      const entry = await this._idbRequest(entries.get(url));
      if (!entry || entry.formatVersion !== CACHE_FORMAT_VERSION || entry.type !== type || !Number.isSafeInteger(entry.size) ||
          entry.size < 0 || entry.size > Math.min(IDB_MAX_BYTES, this._maxResponseBytes)) return null;
      if (type === 'binary') storageLease = this._reserveRawBytes(entry.size);
      const payload = await this._idbRequest(payloads.get(url));
      if (!await done || this._disposed || epoch !== this._cacheEpoch || !this._isCacheRecordValid(entry, payload, type)) return null;
      this._touchIndexedDbEntry(url);
      const Reader = getDependency('BinaryReader', BinaryReader);
      const value = type === 'binary' ? new Reader(payload.data, 0, null, this._filenameFromUrl(url), path) : payload.data;
      if (storageLease) value._attachStorageLease(storageLease, 'pending');
      return { value, entry };
    } catch { return null; }
    finally { storageLease?.release(); }
  },

  async _touchIndexedDbEntry(url) {
    const now = Date.now();
    if (now - (this._cacheTouchTimes.get(url) || 0) < 30000) return;
    this._cacheTouchTimes.set(url, now);
    const epoch = this._cacheEpoch, db = await this._openIndexedDb();
    if (!db || this._disposed || epoch !== this._cacheEpoch) return;
    try {
      const tx = db.transaction(IDB_STORE_ENTRIES, 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const store = tx.objectStore(IDB_STORE_ENTRIES);
      const current = await this._idbRequest(store.get(url));
      if (current) store.put({ ...current, lastAccess: now });
      await done;
    } catch { /* Recency is optional. */ }
  },

  async _visitIndexedDbEntries(entries, visit, useIndex = true, keysOnly = false) {
    if (keysOnly && this._budgetAdapter && typeof entries.openKeyCursor !== 'function') throw new Error('Bounded cache key scan is unavailable');
    const request = keysOnly && typeof entries.openKeyCursor === 'function' ? entries.openKeyCursor() :
      (!useIndex && typeof entries.openCursor === 'function' ? entries : entries.index('lastAccess')).openCursor();
    let count = 0, timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('indexedDB scan timed out')), this._cacheProbeMs);
        request.onerror = () => reject(request.error || new Error('indexedDB cursor failed'));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(); return; }
          if (++count > 10000) { reject(new Error('indexedDB reconciliation limit exceeded')); return; }
          try {
            const next = visit(keysOnly && typeof entries.openKeyCursor === 'function' ? { url: cursor.primaryKey ?? cursor.key } : cursor.value);
            if (next && typeof next.then === 'function') next.then(() => cursor.continue(), reject);
            else cursor.continue();
          } catch (error) { reject(error); }
        };
      });
    } finally { clearTimeout(timer); request.onerror = null; request.onsuccess = null; }
  },

  async _isStoredPayloadValid(payloads, entry) {
    if (!entry || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > IDB_MAX_BYTES) return false;
    const copyLease = entry.type === 'binary' ? this._reserveRawBytes(entry.size) : null;
    try { return this._isCacheRecordValid(entry, await this._idbRequest(payloads.get(entry.url))); }
    finally { copyLease?.release(); }
  },

  async _transactionalCacheTotal(entries, payloads, metaStore, reconcile = false) {
    const meta = await this._idbRequest(metaStore.get('totalBytes'));
    if (!reconcile && meta?.accountingVersion === CACHE_FORMAT_VERSION && Number.isSafeInteger(meta.value) && meta.value >= 0) return meta.value;
    let total = 0;
    await this._visitIndexedDbEntries(entries, async entry => {
      if (!await this._isStoredPayloadValid(payloads, entry)) { entries.delete(entry.url); payloads.delete(entry.url); }
      else total += entry.size;
    }, false);
    if (typeof payloads.openCursor === 'function') await this._visitIndexedDbEntries(payloads, async payload => {
      if (!await this._idbRequest(entries.get(payload.url))) payloads.delete(payload.url);
    }, false, true);
    return total;
  },

  async _evictIndexedDbToBudget(entries, payloads, total, protectedUrl = null) {
    if (total <= IDB_MAX_BYTES) return total;
    await this._visitIndexedDbEntries(entries, entry => {
      if (total <= IDB_MAX_BYTES || entry.url === protectedUrl) return;
      entries.delete(entry.url); payloads.delete(entry.url);
      total = Math.max(0, total - (Number.isFinite(entry.size) ? entry.size : 0));
    });
    return total;
  },

  async _storeInIndexedDb(url, entry, ownership = {}) {
    const size = this._estimateEntrySize(entry);
    if (size > IDB_MAX_BYTES || this._disposed) return false;
    if (entry.type === 'binary' && !(entry.data instanceof ArrayBuffer || entry.data instanceof Uint8Array &&
        entry.data.byteOffset === 0 && entry.data.byteLength === entry.data.buffer.byteLength)) return false;
    const epoch = ownership.epoch ?? this._cacheEpoch;
    const db = await this._openIndexedDb();
    if (!db || this._disposed || epoch !== this._cacheEpoch || ownership.owner?.controller.signal.aborted ||
        ownership.owner && this._requestVersions.get(ownership.owner.key) !== ownership.owner.version) return false;
    let tx, copyLease;
    try {
      tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const entries = tx.objectStore(IDB_STORE_ENTRIES), payloads = tx.objectStore(IDB_STORE_PAYLOADS), metaStore = tx.objectStore(IDB_STORE_META);
      const existing = await this._idbRequest(entries.get(url));
      const validExisting = await this._isStoredPayloadValid(payloads, existing);
      let total = await this._transactionalCacheTotal(entries, payloads, metaStore, !!existing && !validExisting);
      const generation = entry.generation || entry.hash || `${Date.now()}:${++this._nextRequestId}`;
      entries.put({ url, formatVersion: CACHE_FORMAT_VERSION, generation, type: entry.type, etag: entry.etag || null,
        lastModified: entry.lastModified || null, cacheControl: entry.cacheControl || null,
        hash: entry.hash || null, size, fetchedAt: Date.now(), lastAccess: Date.now() });
      if (entry.type === 'binary') copyLease = this._reserveRawBytes(size);
      payloads.put({ url, formatVersion: CACHE_FORMAT_VERSION, generation, data: entry.data });
      total = Math.max(0, total - (validExisting ? existing.size : 0) + size);
      total = await this._evictIndexedDbToBudget(entries, payloads, total, url);
      metaStore.put({ key: 'totalBytes', accountingVersion: CACHE_FORMAT_VERSION, value: total });
      if (!await done) return false;
      this._cacheStats.indexedDbBytes = total;
      return true;
    } catch {
      try { tx?.abort?.(); } catch { /* Failed transactions are already inactive. */ }
      return false;
    } finally { copyLease?.release(); }
  },

  async _pruneIndexedDb() {
    const db = await this._openIndexedDb();
    if (!db || this._disposed) return;
    let tx;
    try {
      tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const entries = tx.objectStore(IDB_STORE_ENTRIES), payloads = tx.objectStore(IDB_STORE_PAYLOADS), metaStore = tx.objectStore(IDB_STORE_META);
      let total = await this._transactionalCacheTotal(entries, payloads, metaStore);
      total = await this._evictIndexedDbToBudget(entries, payloads, total);
      metaStore.put({ key: 'totalBytes', accountingVersion: CACHE_FORMAT_VERSION, value: total });
      if (await done) this._cacheStats.indexedDbBytes = total;
    } catch { try { tx?.abort?.(); } catch { /* Failed optional prune. */ } }
  },

  async _refreshIndexedDbMetadata(url, expected, next, owner) {
    if (!expected?.generation || owner?.noStore || this._disposed) return false;
    const epoch = owner?.providerEpoch ?? this._cacheEpoch, db = await this._openIndexedDb();
    if (!db || this._disposed || epoch !== this._cacheEpoch || owner?.controller.signal.aborted ||
        owner && this._requestVersions.get(owner.key) !== owner.version) return false;
    try {
      const tx = db.transaction(IDB_STORE_ENTRIES, 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false), entries = tx.objectStore(IDB_STORE_ENTRIES);
      const current = await this._idbRequest(entries.get(url));
      if (current?.generation === expected.generation) entries.put({ ...current, etag: next.etag || null,
        lastModified: next.lastModified || null, cacheControl: next.cacheControl || null, fetchedAt: next.fetchedAt, lastAccess: Date.now() });
      return await done;
    } catch { return false; }
  },

  async reconcilePersistentCache() {
    const db = await this._openIndexedDb();
    if (!db || this._disposed) return false;
    let tx;
    try {
      tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const entries = tx.objectStore(IDB_STORE_ENTRIES), payloads = tx.objectStore(IDB_STORE_PAYLOADS), metaStore = tx.objectStore(IDB_STORE_META);
      let total = await this._transactionalCacheTotal(entries, payloads, metaStore, true);
      total = await this._evictIndexedDbToBudget(entries, payloads, total);
      metaStore.put({ key: 'totalBytes', accountingVersion: CACHE_FORMAT_VERSION, value: total });
      if (!await done) return false;
      this._cacheStats.indexedDbBytes = total;
      return true;
    } catch { try { tx?.abort?.(); } catch { /* Optional reconciliation is bounded. */ } return false; }
  },

  async _discardPersistentEntry(url, expected) {
    try {
      const storage = this._getLocalStorage(), key = this._localStorageKey(url), item = storage?.getItem?.(key);
      if (item) {
        const current = JSON.parse(item);
        if (!expected || current.generation === expected.generation) storage.removeItem?.(key);
      }
    } catch { /* Optional storage can be denied. */ }
    const db = await this._openIndexedDb();
    if (!db || this._disposed) return;
    try {
      const tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const entries = tx.objectStore(IDB_STORE_ENTRIES), payloads = tx.objectStore(IDB_STORE_PAYLOADS), metaStore = tx.objectStore(IDB_STORE_META);
      const total = await this._transactionalCacheTotal(entries, payloads, metaStore);
      const current = await this._idbRequest(entries.get(url));
      if (current && (!expected || current.generation === expected.generation)) {
        entries.delete(url); payloads.delete(url);
        metaStore.put({ key: 'totalBytes', accountingVersion: CACHE_FORMAT_VERSION, value: Math.max(0, total - current.size) });
      }
      if (await done && current && (!expected || current.generation === expected.generation)) this._cacheStats.indexedDbBytes = Math.max(0, total - current.size);
    } catch { /* A corrupt optional entry remains a cache miss. */ }
  },

  _getLocalStorageEntries() {
    const storage = this._getLocalStorage();
    if (!storage) return [];
    const entries = [];
    if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || !key.startsWith(LOCAL_STORAGE_PREFIX)) continue;
        const value = storage.getItem(key);
        entries.push({ key, value });
      }
      return entries;
    }
    if (storage.store && typeof storage.store.forEach === 'function') {
      storage.store.forEach((value, key) => {
        if (!String(key).startsWith(LOCAL_STORAGE_PREFIX)) return;
        entries.push({ key, value });
      });
    }
    return entries;
  },

  _getLocalStorageUsage() {
    return this._getLocalStorageEntries()
      .reduce((total, entry) => total + (entry.key.length + String(entry.value || '').length) * 2, 0);
  },

  _updateLocalStorageStats() {
    this._cacheStats.localStorageBytes = this._getLocalStorageUsage();
  },

  _serializeLocalStorageEntry(entry, key = '') {
    const next = { ...entry, lastAccess: entry.lastAccess || Date.now() };
    next.size = 0;
    let json = JSON.stringify(next);
    while (next.size !== (json.length + key.length) * 2) { next.size = (json.length + key.length) * 2; json = JSON.stringify(next); }
    return { entry: next, json };
  },

  _setLocalStorageItem(key, json) {
    try {
      const storage = this._getLocalStorage();
      if (!storage?.setItem) return false;
      storage.setItem(key, json);
      return true;
    } catch (e) {
      return false;
    }
  },

  _evictLocalStorage(requiredBytes = 0) {
    const entries = this._getLocalStorageEntries();
    if (!entries.length) return;
    let total = 0;
    const parsed = [];
    for (const entry of entries) {
      const raw = entry.value;
      total += (entry.key.length + String(raw || '').length) * 2;
      let parsedEntry = null;
      try {
        parsedEntry = raw ? JSON.parse(raw) : null;
      } catch (e) {
        parsedEntry = null;
      }
      parsed.push({
        key: entry.key,
        lastAccess: parsedEntry?.lastAccess || 0,
        size: (entry.key.length + String(raw || '').length) * 2
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
      this._getLocalStorage()?.removeItem?.(entry.key);
      total = Math.max(0, total - entry.size);
    }
    this._cacheStats.localStorageBytes = total;
  },

  _touchLocalStorageEntry() {
    // A warm read must not synchronously rewrite a base64 payload or scan the origin.
    // Local storage entries retain coarse insertion recency until replaced.
  },

  _loadFromLocalStorage(url, type, path = '') {
    let storageLease;
    try {
      const storage = this._getLocalStorage();
      if (!storage) return null;
      const item = storage.getItem(this._localStorageKey(url));
      if (!item) return null;
      const entry = JSON.parse(item);
      if (entry.formatVersion !== CACHE_FORMAT_VERSION || entry.type !== type || typeof entry.data !== 'string') return null;
      if (entry.hash != null && !/^[a-f0-9]{64}$/i.test(entry.hash)) return null;


      let value;
      if (type === 'binary') {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) return null;
        const bytes = entry.data.length / 4 * 3 - (entry.data.endsWith('==') ? 2 : entry.data.endsWith('=') ? 1 : 0);
        if (bytes > this._maxResponseBytes) return null;
        storageLease = this._reserveRawBytes(bytes * 3);
        const buf = this._base64ToArrayBuffer(entry.data);
        storageLease?.resize(bytes);
        const Reader = getDependency('BinaryReader', BinaryReader);
        value = new Reader(buf, 0, null, this._filenameFromUrl(url), path);
        if (storageLease) value._attachStorageLease(storageLease, 'pending');
      } else {
        value = entry.data;
      }
      this._touchLocalStorageEntry(url, entry);
      return { value, entry };
    } catch (e) {
      return null;
    } finally { storageLease?.release(); }
  },

  _storeInLocalStorage(url, entry) {
    let serializationLease;
    try {
      if (!this._getLocalStorage()) return false;
      const byteLength = entry.data?.byteLength;
      if (entry.type === 'binary' && Number.isFinite(byteLength) && Math.ceil(byteLength / 3) * 8 > LOCAL_STORAGE_MAX_BYTES ||
          entry.type === 'text' && typeof entry.data === 'string' && entry.data.length * 2 > LOCAL_STORAGE_MAX_BYTES) return false;
      if (entry.type === 'binary') serializationLease = this._reserveRawBytes((byteLength || 0) * 12 + 4096);
      const stored = { ...entry, formatVersion: CACHE_FORMAT_VERSION, generation: entry.generation || entry.hash || `${Date.now()}:${++this._nextRequestId}`, fetchedAt: Date.now() };
      if (stored.type === 'binary' && (stored.data instanceof ArrayBuffer || ArrayBuffer.isView(stored.data))) {
        stored.data = this._arrayBufferToBase64(stored.data);
      }
      stored.lastAccess = Date.now();
      const key = this._localStorageKey(url);
      const serialized = this._serializeLocalStorageEntry(stored, key);
      const previous = this._getLocalStorage()?.getItem?.(key);
      const previousSize = previous == null ? 0 : (key.length + String(previous).length) * 2;
      const required = (key.length + serialized.json.length) * 2;
      if (required > LOCAL_STORAGE_MAX_BYTES) return false;
      if (this._getLocalStorageUsage() - previousSize + required > LOCAL_STORAGE_MAX_BYTES) this._evictLocalStorage(required);
      const retained = this._getLocalStorage()?.getItem?.(key);
      if (this._getLocalStorageUsage() - (retained == null ? 0 : (key.length + retained.length) * 2) + required > LOCAL_STORAGE_MAX_BYTES) return false;
      if (!this._setLocalStorageItem(key, serialized.json)) {
        this._evictLocalStorage(required);
        if (!this._setLocalStorageItem(key, serialized.json)) {
          return false;
        }
      }
      this._updateLocalStorageStats();
      return true;
    } catch (e) {
      this.log.log('cache write error', { name: e?.name || 'Error' });
      return false;
    } finally { serializationLease?.release(); }
  },

  async _storeInLocalStorageCoordinated(url, entry, ownership = {}) {
    if (!this._getLocalStorage() || typeof this._cacheLockManager?.request !== 'function') return false;
    const controller = new AbortController(), epoch = ownership.epoch ?? this._cacheEpoch;
    let timer;
    try {
      return await Promise.race([
        this._cacheLockManager.request(`${LOCAL_STORAGE_PREFIX}admission`, { mode: 'exclusive', ifAvailable: true }, lock => {
          if (!lock || this._disposed || epoch !== this._cacheEpoch || controller.signal.aborted || ownership.owner?.controller.signal.aborted ||
              ownership.owner && this._requestVersions.get(ownership.owner.key) !== ownership.owner.version) return false;
          return this._storeInLocalStorage(url, entry);
        }),
        new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, this._cacheProbeMs); })
      ]);
    } catch { return false; }
    finally { clearTimeout(timer); controller.abort(); }
  }
};
export { fileProviderStorageMethods };
