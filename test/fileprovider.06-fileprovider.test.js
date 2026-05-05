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

  it('reports indexedDB write success only after transaction commit', async function () {
    const request = (result) => {
      const req = {};
      setTimeout(() => {
        req.result = result;
        req.onsuccess?.();
      }, 0);
      return req;
    };
    let completeTransaction = null;
    provider._openIndexedDb = async () => ({
      transaction() {
        const tx = {
          oncomplete: null,
          onabort: null,
          onerror: null,
          objectStore() {
            return {
              get() { return request(null); },
              put() {}
            };
          }
        };
        completeTransaction = () => tx.oncomplete?.();
        return tx;
      }
    });

    let settled = false;
    const promise = provider
      ._storeInIndexedDb('commit-url', { type: 'text', data: 'ok' })
      .then((value) => {
        settled = true;
        return value;
      });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(settled, false);

    completeTransaction();
    assert.strictEqual(await promise, true);
    assert.ok(provider.getCacheStats().indexedDbBytes > 0);
  });

  it('triggers indexedDB pruning after oversized writes', async function () {
    let pruneCalls = 0;
    provider._estimateEntrySize = () => 60 * 1024 * 1024;
    let idbCalls = 0;
    provider._idbRequest = async () => {
      idbCalls++;
      if (idbCalls === 1) return null;
      return { value: 0 };
    };
    provider._openIndexedDb = async () => ({
      transaction() {
        const tx = {
          objectStore() {
            return {
              get() { return {}; },
              put() {}
            };
          }
        };
        setTimeout(() => tx.oncomplete?.(), 0);
        return tx;
      }
    });
    provider._pruneIndexedDb = () => { pruneCalls++; };

    const stored = await provider._storeInIndexedDb('url', { type: 'text', data: 'x' });
    assert.strictEqual(stored, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(pruneCalls, 1);
  });

  it('prunes indexedDB only when over the limit', async function () {
    provider._openIndexedDb = async () => null;
    await provider._pruneIndexedDb(10);

    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    await provider._openIndexedDb();
    await provider._pruneIndexedDb(1024);
  });

  it('swallows pruning errors when indexedDB transactions fail', async function () {
    provider._openIndexedDb = async () => ({ transaction() { throw new Error('fail'); } });
    await provider._pruneIndexedDb(60 * 1024 * 1024);
  });

  it('estimates sizes without TextEncoder and ignores unknown data', function () {
    const orig = global.TextEncoder;
    global.TextEncoder = undefined;
    assert.strictEqual(provider._estimateTextSize('abcd'), 4);
    assert.strictEqual(provider._estimateTextSize(''), 0);
    global.TextEncoder = orig;

    assert.strictEqual(provider._estimateEntrySize({ type: 'binary', data: 5 }), 0);
  });

  it('enumerates localStorage entries using store.forEach', function () {
    const store = new Map([
      ['lem-cache:' + rootPath + 'a.txt', 'a'],
      ['other', 'skip']
    ]);
    global.localStorage = { store };
    const entries = provider._getLocalStorageEntries();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].key, 'lem-cache:' + rootPath + 'a.txt');
  });

  it('evicts localStorage safely with malformed entries', function () {
    const store = new Map([
      ['lem-cache:' + rootPath + 'bad', '{bad'],
      ['lem-cache:' + rootPath + 'empty', null]
    ]);
    global.localStorage = {
      length: store.size,
      key(i) { return Array.from(store.keys())[i] ?? null; },
      getItem(key) { return store.get(key) ?? null; },
      removeItem(key) { store.delete(key); },
      setItem(key, value) { store.set(key, value); }
    };

    const usage = provider._getLocalStorageUsage();
    provider._evictLocalStorage();
    assert.strictEqual(provider._cacheStats.localStorageBytes, usage);
  });

  it('handles missing localStorage in touch and load paths', function () {
    delete global.localStorage;
    assert.strictEqual(provider._loadFromLocalStorage('url', 'text'), null);
    provider._touchLocalStorageEntry('url', null);
  });

  it('logs and returns false when localStorage serialization fails', function () {
    const original = provider._serializeLocalStorageEntry;
    provider._serializeLocalStorageEntry = () => { throw new Error('fail'); };
    const result = provider._storeInLocalStorage('url', { type: 'text', data: 'x' });
    provider._serializeLocalStorageEntry = original;
    assert.strictEqual(result, false);
    assert.ok(provider.log.logged.some(m => m.includes('cache write error')));
  });

  it('serializes localStorage entries with default access times', function () {
    const serialized = provider._serializeLocalStorageEntry({ type: 'text', data: 'x' });
    assert.ok(serialized.entry.lastAccess > 0);
    assert.ok(serialized.entry.size > 0);
  });

  it('coalesces cache validation per URL', async function () {
    let calls = 0;
    provider._verifyCache = async () => {
      calls += 1;
    };

    provider._scheduleCacheValidation('same-url', { type: 'text' });
    provider._scheduleCacheValidation('same-url', { type: 'text' });
    assert.strictEqual(calls, 1);
    await Promise.all(Array.from(provider._validationPromises.values()));
    assert.strictEqual(provider._validationPromises.size, 0);
  });
});
