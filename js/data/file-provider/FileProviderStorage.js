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
    return !this._idbDisabled && !!this._indexedDB?.open;
  },

  _getLocalStorage() {
    return this._storage === undefined
      ? getRuntimeDependency('localStorage', null)
      : this._storage;
  },

  _idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  _idbTransactionDone(tx) {
    if (!tx || !('oncomplete' in tx || 'onabort' in tx || 'onerror' in tx)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(tx.error || new Error('indexedDB transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('indexedDB transaction failed'));
    });
  },

  _openIndexedDb() {
    if (!this._canUseIndexedDb()) return Promise.resolve(null);
    if (this._idb) return Promise.resolve(this._idb);
    if (this._idbPromise) return this._idbPromise;
    this._idbPromise = new Promise((resolve) => {
      const request = this._indexedDB.open(IDB_NAME, IDB_VERSION);
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
        this._idb = db;
        db.onversionchange = () => {
          db.close();
          if (this._idb === db) this._idb = null;
          this._idbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        this._idbDisabled = true;
        this._idbPromise = null;
        resolve(null);
      };
    });
    return this._idbPromise;
  },

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
      this._scheduleCacheValidation(url, entry);
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
  },

  async _touchIndexedDbEntry(url, entry) {
    const db = await this._openIndexedDb();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE_ENTRIES, 'readwrite');
      const done = this._idbTransactionDone(tx).catch(() => false);
      const store = tx.objectStore(IDB_STORE_ENTRIES);
      store.put({ ...entry, lastAccess: Date.now() });
      await done;
    } catch (e) {
      // ignore
    }
  },

  async _storeInIndexedDb(url, entry) {
    const db = await this._openIndexedDb();
    if (!db) return false;
    try {
      const now = Date.now();
      const size = this._estimateEntrySize(entry);
      const tx = db.transaction([IDB_STORE_ENTRIES, IDB_STORE_PAYLOADS, IDB_STORE_META], 'readwrite');
      let transactionError = null;
      const done = this._idbTransactionDone(tx).catch((err) => {
        transactionError = err;
        return false;
      });
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
      const committed = await done;
      if (!committed) {
        throw transactionError || new Error('indexedDB transaction failed');
      }
      this._cacheStats.indexedDbBytes = total;
      if (total > IDB_MAX_BYTES) {
        this._pruneIndexedDb(total);
      }
      return true;
    } catch (e) {
      return false;
    }
  },

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
      .reduce((total, entry) => total + (entry.value ? String(entry.value).length : 0), 0);
  },

  _updateLocalStorageStats() {
    this._cacheStats.localStorageBytes = this._getLocalStorageUsage();
  },

  _serializeLocalStorageEntry(entry) {
    const next = { ...entry, lastAccess: entry.lastAccess || Date.now() };
    let json = JSON.stringify({ ...next, size: 0 });
    next.size = json.length;
    json = JSON.stringify(next);
    next.size = json.length;
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
      this._getLocalStorage()?.removeItem?.(entry.key);
      total = Math.max(0, total - entry.size);
    }
    this._cacheStats.localStorageBytes = total;
  },

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
  },

  _loadFromLocalStorage(url, type, path = '') {
    try {
      const storage = this._getLocalStorage();
      if (!storage) return null;
      const item = storage.getItem(this._localStorageKey(url));
      if (!item) return null;
      const entry = JSON.parse(item);
      if (entry.type !== type) return null;
  
      this._scheduleCacheValidation(url, entry);
  
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
  },

  _storeInLocalStorage(url, entry) {
    if (!this._getLocalStorage()) return false;
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
      this.log.log('cache write error', e);
      return false;
    }
  }
};
export { fileProviderStorageMethods };