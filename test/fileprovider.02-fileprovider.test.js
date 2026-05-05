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

  it('loadBinary uses localStorage fallback after indexedDB error', async function () {
    setupIndexedDb({
      loadFromIndexedDb: async () => { throw new Error('fail'); },
      loadFromLocalStorage: () => ({ value: new MockBinaryReader() })
    });
    provider._fetchBinary = async () => { throw new Error('should not fetch'); };

    const result = await provider.loadBinary('data', 'missing.bin');
    assert.ok(result instanceof MockBinaryReader);
  });

  it('loadBinary reads localStorage when indexedDB rejects', async function () {
    setupIndexedDb({ loadFromIndexedDb: async () => { throw new Error('fail'); } });
    const url = provider._buildUrl('data', 'cached.bin');
    const buf = Uint8Array.from([1, 2, 3]).buffer;
    setBinaryCache(url, buf);
    provider._fetchBinary = async () => { throw new Error('should not fetch'); };

    const result = await provider.loadBinary('data', 'cached.bin');
    assert.ok(result instanceof MockBinaryReader);
  });

  it('loadString uses indexedDB path when enabled and uncached', async function () {
    setupIndexedDb();
    const fetchText = makeFetchCounter(async () => 'ok');
    provider._fetchText = fetchText.fn;

    const result = await provider.loadString(makeUrl('missing.txt'));
    assert.strictEqual(result, 'ok');
    assert.strictEqual(fetchText.calls, 1);
  });

  it('loadString falls back when indexedDB rejects', async function () {
    setupIndexedDb({ loadFromIndexedDb: async () => { throw new Error('fail'); } });
    const fetchText = makeFetchCounter(async () => 'ok');
    provider._fetchText = fetchText.fn;

    const result = await provider.loadString(makeUrl('missing.txt'));
    assert.strictEqual(result, 'ok');
    assert.strictEqual(fetchText.calls, 1);
  });

  it('loadString uses cached indexedDB value', async function () {
    setupIndexedDb({ loadFromIndexedDb: async () => ({ value: 'cached' }) });
    provider._fetchText = async () => { throw new Error('should not fetch'); };
    const result = await provider.loadString(makeUrl('cached.txt'));
    assert.strictEqual(result, 'cached');
  });

  it('loadString uses localStorage fallback after indexedDB error', async function () {
    setupIndexedDb({
      loadFromIndexedDb: async () => { throw new Error('fail'); },
      loadFromLocalStorage: () => ({ value: 'cached' })
    });
    provider._fetchText = async () => { throw new Error('should not fetch'); };
    const result = await provider.loadString(makeUrl('cached.txt'));
    assert.strictEqual(result, 'cached');
  });

  it('loadString uses localStorage after indexedDB rejection', async function () {
    setupIndexedDb({ loadFromIndexedDb: async () => { throw new Error('fail'); } });
    const url = makeUrl('cached.txt');
    setTextCache(url, 'stored');
    provider._fetchText = async () => { throw new Error('should not fetch'); };
    const result = await provider.loadString(url);
    assert.strictEqual(result, 'stored');
  });

  it('refreshes cached text entries when headers change', async function () {
    let textFetched = 0;
    provider._fetchHead = async () => ({ etag: 'new' });
    provider._fetchText = async () => { textFetched++; };
    await provider._verifyCache('file.txt', { type: 'text', etag: 'old' });
    assert.strictEqual(textFetched, 1);
  });

  it('stores response headers when available for text and binary', async function () {
    class HeaderXHR {
      constructor() {
        this.status = 0;
        this.response = null;
        HeaderXHR.instances.push(this);
      }
      open(method, url) { this.method = method; this.url = url; }
      send() {}
      getResponseHeader(name) {
        if (name === 'ETag') return 'etag-value';
        if (name === 'Last-Modified') return 'modified';
        return null;
      }
      respond(status, body) {
        this.status = status;
        this.response = body;
        if (status >= 200 && status < 300) {
          if (this.onload) this.onload();
        } else if (this.onerror) {
          this.onerror();
        }
      }
    }
    HeaderXHR.instances = [];
    global.XMLHttpRequest = HeaderXHR;

    const textUrl = makeUrl('headers.txt');
    const textPromise = provider.loadString(textUrl);
    HeaderXHR.instances[0].respond(200, 'ok');
    await textPromise;
    const textEntry = JSON.parse(global.localStorage.getItem(cacheKey(textUrl)));
    assert.strictEqual(textEntry.etag, 'etag-value');

    const binPromise = provider.loadBinary('data', 'file.bin');
    const buffer = new ArrayBuffer(0);
    HeaderXHR.instances[1].respond(200, buffer);
    await binPromise;
    const binUrl = provider._buildUrl('data', 'file.bin');
    const binEntry = JSON.parse(global.localStorage.getItem(cacheKey(binUrl)));
    assert.strictEqual(binEntry.lastModified, 'modified');
  });

  it('requires Web Crypto hashing and reports unavailable runtimes', async function () {
    const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      await assert.rejects(provider._hashBuffer(new Uint8Array([4]).buffer), /crypto API not available/);
    } finally {
      if (origDescriptor) {
        Object.defineProperty(globalThis, 'crypto', origDescriptor);
      } else {
        delete globalThis.crypto;
      }
    }
  });

  it('stores response headers for binary entries when available', async function () {
    const p = provider.loadBinary('data', 'with-headers.bin');
    const url = provider._buildUrl('data', 'with-headers.bin');
    requests[0].getResponseHeader = key => (key === 'ETag' ? 'etag' : 'last');
    requests[0].respond(200, new ArrayBuffer(1));
    await p;
    const entry = JSON.parse(global.localStorage.getItem(cacheKey(url)));
    assert.strictEqual(entry.etag, 'etag');
    assert.strictEqual(entry.lastModified, 'last');
  });

  it('stores response headers for text entries when available', async function () {
    const url = makeUrl('with-headers.txt');
    const p = provider.loadString(url);
    requests[0].getResponseHeader = key => (key === 'ETag' ? 'etag' : 'last');
    requests[0].respond(200, 'ok');
    await p;
    const entry = JSON.parse(global.localStorage.getItem(cacheKey(url)));
    assert.strictEqual(entry.etag, 'etag');
    assert.strictEqual(entry.lastModified, 'last');
  });

  it('_verifyCache refreshes stale entries', async function () {
    let headCalls = 0;
    let fetchCalls = 0;
    provider._fetchHead = async () => {
      headCalls++;
      return { etag: 'new', lastModified: 'new' };
    };
    provider._fetchBinary = async () => {
      fetchCalls++;
      return new MockBinaryReader();
    };

    const entry = { type: 'binary', etag: 'old', lastModified: 'old' };
    await provider._verifyCache('some/url', entry);

    assert.strictEqual(headCalls, 1);
    assert.strictEqual(fetchCalls, 1);
  });
});
