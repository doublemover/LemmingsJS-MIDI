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

  it('_buildUrl() joins rootPath, path and filename', function () {
    const url = provider._buildUrl('path', 'file.bin');
    assert.strictEqual(url, rootPath + 'path' + '/' + 'file.bin');
    const noFile = provider._buildUrl('path', null);
    assert.strictEqual(noFile, rootPath + 'path');
  });

  it('applies cache-bust revision to binary and text urls', function () {
    provider = new FileProvider(rootPath, { cacheBustRevision: 'phase30a' });
    const binaryUrl = provider._buildUrl('path', 'file.bin');
    const textUrl = provider._appendCacheBust(makeUrl('config.json'));
    assert.strictEqual(binaryUrl, rootPath + 'path/file.bin?rev=phase30a');
    assert.strictEqual(textUrl, rootPath + 'config.json?rev=phase30a');
  });

  it('_filenameFromUrl strips query and handles empty', function () {
    const name = provider._filenameFromUrl('http://x/y/file.bin?x=1#hash');
    assert.strictEqual(name, 'file.bin');
    assert.strictEqual(provider._filenameFromUrl(''), '');
  });

  it('loadBinary caches identical requests', async function () {
    const p1 = provider.loadBinary('data', 'file.bin');
    const p2 = provider.loadBinary('data', 'file.bin');
    assert.strictEqual(p1, p2);
    assert.strictEqual(requests.length, 1);

    const buffer = new ArrayBuffer(0);
    requests[0].respond(200, buffer);
    const result = await p1;
    assert.ok(result instanceof MockBinaryReader);

    const p3 = provider.loadBinary('data', 'file.bin');
    assert.strictEqual(p1, p3);
    assert.strictEqual(requests.length, 1);
  });

  it('loadString caches identical requests', async function () {
    const url = makeUrl('text.txt');
    const p1 = provider.loadString(url);
    const p2 = provider.loadString(url);
    assert.strictEqual(p1, p2);
    assert.strictEqual(requests.length, 1);

    requests[0].respond(200, 'hello');
    const result = await p1;
    assert.strictEqual(result, 'hello');

    const p3 = provider.loadString(url);
    assert.strictEqual(p1, p3);
    assert.strictEqual(requests.length, 1);
  });

  it('loadString clears cache on failure', async function () {
    const url = makeUrl('fail.txt');
    const promise = provider.loadString(url);
    assert.strictEqual(provider._cache.size, 1);
    requests[0].respond(500, 'err');
    await assert.rejects(promise);
    assert.strictEqual(provider._cache.has(url), false);
  });

  it('clearCache() empties the internal cache', async function () {
    const url = makeUrl('file.txt');
    const p1 = provider.loadString(url);
    requests[0].respond(200, 'ok');
    await p1;
    assert.strictEqual(provider._cache.size, 1);
    provider.clearCache();
    assert.strictEqual(provider._cache.size, 0);
  });

  it('getCacheStats reports cache counters', function () {
    provider._cache.set('a', Promise.resolve('x'));
    provider._cacheStats.localStorageBytes = 12;
    provider._cacheStats.indexedDbBytes = 34;
    assert.deepStrictEqual(provider.getCacheStats(), {
      memoryEntries: 1,
      localStorageBytes: 12,
      indexedDbBytes: 34
    });
  });

  it('stores data in localStorage and reuses it', async function () {
    const url = makeUrl('text.txt');
    const p1 = provider.loadString(url);
    requests[0].respond(200, 'hello');
    const result1 = await p1;
    assert.strictEqual(result1, 'hello');
    const stored = global.localStorage.getItem(cacheKey(url));
    assert.ok(stored, 'entry stored');

    // new provider simulating page reload
    provider = new FileProvider(rootPath);
    const p2 = provider.loadString(url);
    assert.strictEqual(requests.length, 1, 'no new XHR');
    const result2 = await p2;
    assert.strictEqual(result2, 'hello');
  });

  it('loadBinary uses cached binary entries from localStorage', async function () {
    provider = new FileProvider(rootPath);
    const data = Uint8Array.from([1, 2, 3]).buffer;
    const url = makeUrl('data/file.bin');
    setBinaryCache(url, data, 'h');

    const result = await provider.loadBinary('data', 'file.bin');
    assert.ok(result instanceof MockBinaryReader);
    assert.strictEqual(requests.length, 0);
  });

  it('falls back to fetching when cached JSON is invalid', async function () {
    const url = makeUrl('bad.txt');
    setCacheRaw(url, '{bad');
    const promise = provider.loadString(url);
    requests[0].respond(200, 'ok');
    const result = await promise;
    assert.strictEqual(result, 'ok');
  });

  it('logs an error when binary load fails', async function () {
    const p = provider.loadBinary('data', 'file.bin');
    requests[0].respond(404, null);
    await assert.rejects(p);
    assert.ok(provider.log.logged.some(m => m.includes('error load file')));
  });

  it('loadBinary bypasses cache when forceReload is true', async function () {
    let calls = 0;
    provider._fetchBinary = async () => {
      calls++;
      return new MockBinaryReader();
    };
    const url = provider._buildUrl('data', 'file.bin');

    const p1 = provider.loadBinary('data', 'file.bin');
    assert.strictEqual(calls, 1);
    await p1;

    const p2 = provider.loadBinary('data', 'file.bin');
    assert.strictEqual(p2, p1);
    assert.strictEqual(calls, 1);
    await p2;

    const p3 = provider.loadBinary('data', 'file.bin', { forceReload: true });
    assert.notStrictEqual(p3, p1);
    assert.strictEqual(calls, 2);
    await p3;

    assert.strictEqual(provider._cache.get(url), p1);
  });

  it('loadBinary uses indexedDB path when enabled and uncached', async function () {
    setupIndexedDb();
    const fetchBinary = makeFetchCounter(async () => new MockBinaryReader());
    provider._fetchBinary = fetchBinary.fn;

    const result = await provider.loadBinary('data', 'missing.bin');
    assert.ok(result instanceof MockBinaryReader);
    assert.strictEqual(fetchBinary.calls, 1);
  });

  it('loadBinary falls back when indexedDB rejects', async function () {
    setupIndexedDb({ loadFromIndexedDb: async () => { throw new Error('fail'); } });
    const fetchBinary = makeFetchCounter(async () => new MockBinaryReader());
    provider._fetchBinary = fetchBinary.fn;

    const result = await provider.loadBinary('data', 'missing.bin');
    assert.ok(result instanceof MockBinaryReader);
    assert.strictEqual(fetchBinary.calls, 1);
  });
});
