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

  it('prunes indexedDB entries with missing size metadata', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    await provider._openIndexedDb();
    const entries = idb._stores.get('entries');
    const payloads = idb._stores.get('payloads');
    const meta = idb._stores.get('meta');
    const url = rootPath + 'nosize.bin';
    entries.set(url, { url, lastAccess: 1 });
    payloads.set(url, { url, data: new ArrayBuffer(1) });
    meta.set('totalBytes', { key: 'totalBytes', value: 60 * 1024 * 1024 });

    await provider._pruneIndexedDb(60 * 1024 * 1024);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(entries.size < 1);
  });

  it('_storeInLocalStorage ignores write errors', function () {
    global.localStorage.setItem = () => { throw new Error('nope'); };
    const result = provider._storeInLocalStorage('url', { a: 1 });
    assert.strictEqual(result, false);
  });

  it('falls back to localStorage when indexedDB misses', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);

    const binUrl = provider._buildUrl('data', 'fallback.bin');
    const buf = Uint8Array.from([1]).buffer;
    setBinaryCache(binUrl, buf);

    const bin = await provider.loadBinary('data', 'fallback.bin');
    assert.ok(bin instanceof MockBinaryReader);
    assert.strictEqual(requests.length, 0);

    const textUrl = makeUrl('fallback.txt');
    setTextCache(textUrl, 'hello');
    const text = await provider.loadString(textUrl);
    assert.strictEqual(text, 'hello');
  });

  it('handles indexedDB failures in load and touch paths', async function () {
    provider._openIndexedDb = async () => null;
    const missing = await provider._loadFromIndexedDb('url', 'text');
    assert.strictEqual(missing, null);
    await provider._touchIndexedDbEntry('url', { url: 'url' });

    provider._openIndexedDb = async () => ({ transaction() { throw new Error('fail'); } });
    const failed = await provider._loadFromIndexedDb('url', 'text');
    assert.strictEqual(failed, null);
    await provider._touchIndexedDbEntry('url', { url: 'url' });
  });

  it('_idbRequest rejects when a request fails', async function () {
    const request = { error: new Error('fail') };
    const promise = provider._idbRequest(request);
    request.onerror();
    await assert.rejects(promise, /fail/);
  });

  it('closes indexedDB on version changes', async function () {
    const closeCalls = [];
    global.indexedDB = {
      open() {
        const request = {};
        setTimeout(() => {
          request.result = {
            objectStoreNames: { contains() { return true; } },
            close() { closeCalls.push(true); }
          };
          request.onsuccess?.();
        }, 0);
        return request;
      }
    };
    provider = new FileProvider(rootPath);
    const db = await provider._openIndexedDb();
    db.onversionchange();
    assert.strictEqual(closeCalls.length, 1);
  });

  it('closes an open indexedDB handle on close()', async function () {
    let closeCalls = 0;
    provider._idb = {
      close() {
        closeCalls += 1;
      }
    };
    provider._idbPromise = Promise.resolve(provider._idb);
    await provider.close();
    assert.strictEqual(closeCalls, 1);
    assert.strictEqual(provider._idb, null);
    assert.strictEqual(provider._idbPromise, null);
  });

  it('updates indexedDB sizes when entries already exist', async function () {
    const idb = createIndexedDb();
    global.indexedDB = idb;
    provider = new FileProvider(rootPath);
    await provider._openIndexedDb();
    const entries = idb._stores.get('entries');
    const meta = idb._stores.get('meta');
    const url = rootPath + 'cached.bin';
    entries.set(url, { url, type: 'binary', size: 10, lastAccess: 1 });
    meta.set('totalBytes', { key: 'totalBytes', value: 10 });

    const stored = await provider._storeInIndexedDb(url, { type: 'binary', data: new ArrayBuffer(2) });
    assert.strictEqual(stored, true);
    const updated = meta.get('totalBytes');
    assert.strictEqual(updated.value, 2);
  });

  it('returns false when indexedDB storage fails', async function () {
    provider._openIndexedDb = async () => ({ transaction() { throw new Error('fail'); } });
    const stored = await provider._storeInIndexedDb('url', { type: 'text', data: 'x' });
    assert.strictEqual(stored, false);
  });

  it('falls back to localStorage when an indexedDB transaction aborts', async function () {
    const request = (result) => {
      const req = {};
      setTimeout(() => {
        req.result = result;
        req.onsuccess?.();
      }, 0);
      return req;
    };
    provider._openIndexedDb = async () => ({
      transaction() {
        const tx = {
          error: new Error('abort'),
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
        setTimeout(() => tx.onabort?.(), 5);
        return tx;
      }
    });

    const url = makeUrl('idb-abort.txt');
    await provider._storeInCache(url, { type: 'text', data: 'ok' });
    const entry = JSON.parse(global.localStorage.getItem(cacheKey(url)));
    assert.strictEqual(entry.data, 'ok');
  });
});
