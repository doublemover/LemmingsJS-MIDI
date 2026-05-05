import assert from 'assert';
import { FileProvider } from '../js/data/FileProvider.js';
import { Lemmings, setDependency } from './helpers/lemmings.js';

class MockBinaryReader {}
class MockLogHandler {
  constructor() {
    this.logged = [];
    this.debugged = [];
  }
  log(msg) {
    this.logged.push(msg);
  }
  debug(msg) {
    this.debugged.push(msg);
  }
}
let origBR;
let origLog;
let origIndexedDb;

const createIndexedDb = ({ failOpen = false } = {}) => {
  const stores = new Map();
  const keyPaths = new Map();
  const indexes = new Map();
  const objectStoreNames = {
    contains(name) {
      return stores.has(name);
    }
  };

  const makeRequest = (result, error = null) => {
    const request = { result: undefined, error };
    setTimeout(() => {
      if (error) {
        request.onerror?.();
      } else {
        request.result = result;
        request.onsuccess?.();
      }
    }, 0);
    return request;
  };

  const makeCursorRequest = (map, field) => {
    const entries = Array.from(map.values())
      .slice()
      .sort((a, b) => (a?.[field] ?? 0) - (b?.[field] ?? 0));
    let idx = 0;
    const request = {};
    const cursor = {
      get value() {
        return entries[idx];
      },
      continue() {
        idx += 1;
        trigger();
      }
    };
    const trigger = () => {
      setTimeout(() => {
        request.result = idx < entries.length ? cursor : null;
        request.onsuccess?.();
      }, 0);
    };
    trigger();
    return request;
  };

  const ensureStore = (name, keyPath = 'id') => {
    if (!stores.has(name)) stores.set(name, new Map());
    if (!keyPaths.has(name)) keyPaths.set(name, keyPath);
    if (!indexes.has(name)) indexes.set(name, new Map());
  };

  const createStore = (name) => {
    ensureStore(name);
    const map = stores.get(name);
    const keyPath = keyPaths.get(name);
    const indexMap = indexes.get(name);
    return {
      get(key) {
        return makeRequest(map.get(key));
      },
      put(value) {
        const key = keyPath ? value?.[keyPath] : value?.key;
        map.set(key, value);
        return makeRequest(value);
      },
      delete(key) {
        map.delete(key);
        return makeRequest(undefined);
      },
      createIndex(indexName, field) {
        indexMap.set(indexName, { field });
        return {};
      },
      index(indexName) {
        const idx = indexMap.get(indexName);
        return {
          openCursor() {
            return makeCursorRequest(map, idx?.field);
          }
        };
      }
    };
  };

  const db = {
    objectStoreNames,
    createObjectStore(name, options = {}) {
      ensureStore(name, options.keyPath);
      return createStore(name);
    },
    transaction(storeNames) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      names.forEach((name) => ensureStore(name));
      return {
        objectStore(name) {
          return createStore(name);
        }
      };
    },
    close() {}
  };

  return {
    open() {
      const request = {};
      setTimeout(() => {
        if (failOpen) {
          request.error = new Error('indexeddb open failed');
          request.onerror?.();
          return;
        }
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
    _stores: stores
  };
};

describe('FileProvider', function () {
  const rootPath = '/base/';

  let provider;

  let requests;

  let restore;

  let origFetch;

  const makeUrl = (name) => rootPath + name;

  const cacheKey = (url) => `lem-cache:${url}`;

  const setCacheEntry = (url, entry) => {
    global.localStorage.setItem(cacheKey(url), JSON.stringify(entry));
  };

  const setCacheRaw = (url, raw) => {
    global.localStorage.setItem(cacheKey(url), raw);
  };

  const setBinaryCache = (url, buffer, hash) => {
    const entry = {
      type: 'binary',
      data: provider._arrayBufferToBase64(buffer),
      ...(hash ? { hash } : {})
    };
    setCacheEntry(url, entry);
  };

  const setTextCache = (url, data) => {
    setCacheEntry(url, { type: 'text', data });
  };

  const setupIndexedDb = ({
    loadFromIndexedDb = async () => null,
    loadFromLocalStorage
  } = {}) => {
    provider._canUseIndexedDb = () => true;
    provider._loadFromIndexedDb = loadFromIndexedDb;
    if (typeof loadFromLocalStorage === 'function') {
      provider._loadFromLocalStorage = loadFromLocalStorage;
    }
  };

  const makeFetchCounter = (impl) => {
    let calls = 0;
    const fn = async (...args) => {
      calls += 1;
      return impl(...args);
    };
    return { fn, get calls() { return calls; } };
  };

  beforeEach(function () {
    origBR = Lemmings.BinaryReader;
    origLog = Lemmings.LogHandler;
    origIndexedDb = global.indexedDB;
    setDependency('BinaryReader', MockBinaryReader);
    setDependency('LogHandler', MockLogHandler);
    provider = new FileProvider(rootPath);
    global.localStorage = new (class {
      constructor() { this.store = new Map(); }
      getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
      setItem(k, v) { this.store.set(k, v); }
      removeItem(k) { this.store.delete(k); }
      clear() { this.store.clear(); }
    })();
    origFetch = global.fetch;
    delete global.fetch; // disable HEAD requests
    requests = [];
    class FakeXHR {
      constructor() {
        this.status = 0;
        this.response = null;
        FakeXHR.instances.push(this);
      }
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      send() {}
      respond(status, body) {
        this.status = status;
        this.response = body;
        if (status >= 200 && status < 300) {
          if (this.onload) this.onload();
        } else {
          if (this.onerror) this.onerror();
        }
      }
    }
    FakeXHR.instances = [];
    requests = FakeXHR.instances;
    global.XMLHttpRequest = FakeXHR;
    restore = () => {
      delete global.XMLHttpRequest;
    };
  });

  afterEach(function () {
    restore();
    delete global.localStorage;
    if (origIndexedDb === undefined) {
      delete global.indexedDB;
    } else {
      global.indexedDB = origIndexedDb;
    }
    if (origFetch) {
      global.fetch = origFetch;
    }
    provider.clearCache();
    setDependency('BinaryReader', origBR);
    setDependency('LogHandler', origLog);
  });

  it('skips indexedDB entries with mismatched types or missing payloads', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    await provider._openIndexedDb();
    const entries = idb._stores.get('entries');
    const payloads = idb._stores.get('payloads');
    const url = rootPath + 'cached.bin';
    entries.set(url, { url, type: 'text', size: 1, lastAccess: 1 });
    payloads.set(url, { url, data: new ArrayBuffer(1) });

    const mismatch = await provider._loadFromIndexedDb(url, 'binary', 'data');
    assert.strictEqual(mismatch, null);

    entries.set(url, { url, type: 'binary', size: 1, lastAccess: 1 });
    payloads.delete(url);
    const missing = await provider._loadFromIndexedDb(url, 'binary', 'data');
    assert.strictEqual(missing, null);
  });

  it('loads text payloads from indexedDB', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    await provider._openIndexedDb();
    const entries = idb._stores.get('entries');
    const payloads = idb._stores.get('payloads');
    const url = makeUrl('cached.txt');
    entries.set(url, { url, type: 'text', size: 4, lastAccess: 1 });
    payloads.set(url, { url, data: 'ok' });

    const result = await provider._loadFromIndexedDb(url, 'text');
    assert.strictEqual(result.value, 'ok');
  });

  it('estimates entry sizes for buffers, views, and strings', function () {
    const buf = new ArrayBuffer(4);
    assert.strictEqual(provider._estimateEntrySize({ type: 'binary', data: buf }), 4);
    assert.strictEqual(provider._estimateEntrySize({
      type: 'binary',
      data: new Uint8Array([1, 2])
    }), 2);
    assert.ok(provider._estimateEntrySize({ type: 'text', data: 'abc' }) >= 3);
    assert.strictEqual(provider._estimateEntrySize(null), 0);
  });

  it('handles localStorage fallbacks and evictions', function () {
    delete global.localStorage;
    assert.deepStrictEqual(provider._getLocalStorageEntries(), []);
    assert.strictEqual(provider._storeInLocalStorage('url', { type: 'text', data: 'x' }), false);

    const store = new Map([
      ['lem-cache:' + rootPath + 'a', JSON.stringify({ lastAccess: 1, size: 20 })],
      ['lem-cache:' + rootPath + 'b', JSON.stringify({ lastAccess: 2, size: 20 })]
    ]);
    const removed = [];
    global.localStorage = {
      length: store.size,
      key(i) { return Array.from(store.keys())[i] ?? null; },
      getItem(key) { return store.get(key) ?? null; },
      removeItem(key) { removed.push(key); store.delete(key); },
      setItem(key, value) { store.set(key, value); }
    };
    provider._evictLocalStorage(4 * 1024 * 1024);
    assert.strictEqual(removed.length, 2);
  });

  it('stops evicting localStorage once under target', function () {
    const store = new Map([
      ['lem-cache:' + rootPath + 'a', JSON.stringify({ lastAccess: 1, size: 200 })],
      ['lem-cache:' + rootPath + 'b', JSON.stringify({ lastAccess: 2, size: 5 })]
    ]);
    let removed = 0;
    global.localStorage = {
      length: store.size,
      key(i) { return Array.from(store.keys())[i] ?? null; },
      getItem(key) { return store.get(key) ?? null; },
      removeItem(key) { removed += 1; store.delete(key); },
      setItem(key, value) { store.set(key, value); }
    };
    provider._evictLocalStorage(4 * 1024 * 1024 - 1);
    assert.strictEqual(removed, 1);
  });

  it('returns null when localStorage entries are wrong type', function () {
    const url = rootPath + 'wrong.bin';
    setTextCache(url, 'ok');
    const result = provider._loadFromLocalStorage(url, 'binary', 'data');
    assert.strictEqual(result, null);
  });

  it('honors explicit localStorage injection boundaries', function () {
    const isolated = new FileProvider(rootPath, { localStorage: null });
    global.localStorage.setItem(cacheKey(makeUrl('isolated.txt')), 'x');
    assert.deepStrictEqual(isolated._getLocalStorageEntries(), []);
    assert.strictEqual(isolated._loadFromLocalStorage(makeUrl('isolated.txt'), 'text'), null);
  });

  it('uses indexedDB cache when available', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    const url = provider._buildUrl('data', 'cached.bin');
    const buffer = new ArrayBuffer(4);
    await provider._storeInIndexedDb(url, { type: 'binary', data: buffer, hash: 'h' });

    const result = await provider.loadBinary('data', 'cached.bin');
    assert.ok(result instanceof MockBinaryReader);
    assert.strictEqual(requests.length, 0);
  });

  it('disables indexedDB on open errors', async function () {
    global.indexedDB = createIndexedDb({ failOpen: true });
    provider = new FileProvider(rootPath);
    const db = await provider._openIndexedDb();
    assert.strictEqual(db, null);
    assert.strictEqual(provider._idbDisabled, true);
  });

  it('enumerates localStorage entries using key/length', function () {
    const store = new Map([
      ['lem-cache:' + rootPath + 'a.txt', 'a'],
      ['other', 'skip']
    ]);
    global.localStorage = {
      length: store.size,
      key(i) { return Array.from(store.keys())[i] ?? null; },
      getItem(key) { return store.get(key) ?? null; },
      removeItem(key) { store.delete(key); },
      setItem(key, value) { store.set(key, value); }
    };
    const entries = provider._getLocalStorageEntries();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].key, 'lem-cache:' + rootPath + 'a.txt');
  });

  it('prunes indexedDB entries when over the limit', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    await provider._openIndexedDb();
    const entries = idb._stores.get('entries');
    const payloads = idb._stores.get('payloads');
    const meta = idb._stores.get('meta');
    const urlA = rootPath + 'a.bin';
    const urlB = rootPath + 'b.bin';
    entries.set(urlA, { url: urlA, size: 30 * 1024 * 1024, lastAccess: 1 });
    entries.set(urlB, { url: urlB, size: 30 * 1024 * 1024, lastAccess: 2 });
    payloads.set(urlA, { url: urlA, data: new ArrayBuffer(1) });
    payloads.set(urlB, { url: urlB, data: new ArrayBuffer(1) });
    meta.set('totalBytes', { key: 'totalBytes', value: 60 * 1024 * 1024 });

    await provider._pruneIndexedDb(60 * 1024 * 1024);
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.ok(entries.size < 2);
    const metaEntry = meta.get('totalBytes');
    assert.ok(metaEntry.value <= 60 * 1024 * 1024);
  });
});
