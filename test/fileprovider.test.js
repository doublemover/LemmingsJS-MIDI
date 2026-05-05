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

  it('_verifyCache returns early on matching headers', async function () {
    let fetchCalls = 0;
    provider._fetchHead = async () => ({ etag: 'same', lastModified: 'same' });
    provider._fetchBinary = async () => { fetchCalls++; return new MockBinaryReader(); };
    await provider._verifyCache('url', { type: 'binary', etag: 'same' });
    assert.strictEqual(fetchCalls, 0);

    provider._fetchHead = async () => ({ etag: 'other', lastModified: 'match' });
    await provider._verifyCache('url', { type: 'binary', lastModified: 'match' });
    assert.strictEqual(fetchCalls, 0);
  });

  it('_verifyCache swallows update errors', async function () {
    provider._fetchHead = async () => ({ etag: 'new', lastModified: 'new' });
    provider._fetchText = async () => { throw new Error('fail'); };
    await provider._verifyCache('url', { type: 'text', etag: 'old' });
    assert.ok(provider.log.logged.some(m => m.includes('cache update error')));
  });

  it('_verifyCache refreshes stale text entries', async function () {
    let textCalls = 0;
    provider._fetchHead = async () => ({ etag: 'new', lastModified: 'new' });
    provider._fetchText = async () => { textCalls++; };
    await provider._verifyCache('url', { type: 'text', etag: 'old' });
    assert.strictEqual(textCalls, 1);
  });

  it('_hashBuffer rejects when web crypto is missing', async function () {
    provider = new FileProvider(rootPath);
    const buf = Uint8Array.from([1,2,3]).buffer;
    const orig = global.crypto;
    delete global.crypto;
    await assert.rejects(provider._hashBuffer(buf), /crypto API not available/);
    global.crypto = orig;
  });

  it('_tryHashBuffer returns null when web crypto is missing', async function () {
    provider = new FileProvider(rootPath);
    const buf = Uint8Array.from([1, 2, 3]).buffer;
    const orig = global.crypto;
    delete global.crypto;
    const hash = await provider._tryHashBuffer(buf);
    global.crypto = orig;
    assert.strictEqual(hash, null);
  });

  it('_hashBuffer uses web crypto when available', async function () {
    const orig = global.crypto;
    global.crypto = {
      subtle: {
        digest: async () => Uint8Array.from([0, 255]).buffer
      }
    };
    const buf = Uint8Array.from([1, 2]).buffer;
    const hash = await provider._hashBuffer(buf);
    global.crypto = orig;
    assert.strictEqual(hash, '00ff');
  });

  it('_hashBuffer throws when crypto APIs are unavailable', async function () {
    const orig = global.crypto;
    delete global.crypto;
    provider._forceCryptoError = true;
    const buf = Uint8Array.from([1, 2]).buffer;
    await assert.rejects(provider._hashBuffer(buf), /crypto API not available/);
    provider._forceCryptoError = false;
    global.crypto = orig;
  });

  it('base64 conversion roundtrips', function () {
    provider = new FileProvider(rootPath);
    const buf = Uint8Array.from([65,66,67]).buffer;
    const b64 = provider._arrayBufferToBase64(buf);
    const out = provider._base64ToArrayBuffer(b64);
    assert.deepStrictEqual(Array.from(new Uint8Array(out)), [65,66,67]);
  });

  it('_fetchText stores data and headers in localStorage', async function () {
    provider._tryHashString = async () => 'h';
    const url = makeUrl('text.txt');
    const promise = provider._fetchText(url);
    requests[0].respond(200, 'hi');
    const result = await promise;
    assert.strictEqual(result, 'hi');
    const entry = JSON.parse(global.localStorage.getItem(cacheKey(url)));
    assert.strictEqual(entry.type, 'text');
    assert.strictEqual(entry.data, 'hi');
    assert.strictEqual(entry.hash, 'h');
  });

  it('_fetchText resolves when hashing and persistent cache writes fail', async function () {
    provider._tryHashString = async () => { throw new Error('hash failed'); };
    provider._storeInCache = async () => { throw new Error('cache failed'); };
    const url = makeUrl('text-no-cache.txt');
    const promise = provider._fetchText(url);
    requests[0].respond(200, 'hi');
    assert.strictEqual(await promise, 'hi');
  });

  it('_fetchText logs and rejects on failure', async function () {
    const promise = provider._fetchText(makeUrl('bad.txt'));
    requests[0].respond(404, 'err');
    await assert.rejects(promise);
    assert.ok(provider.log.logged.some(m => m.includes('error load file')));
  });

  it('_fetchBinary rejects when onload reports error status', async function () {
    const promise = provider._fetchBinary(rootPath + 'bad.bin', 'data');
    const xhr = requests[0];
    xhr.status = 500;
    xhr.response = new ArrayBuffer(0);
    xhr.onload();
    await assert.rejects(promise);
    assert.ok(provider.log.logged.some(m => m.includes('error load file')));
  });

  it('_fetchText rejects when onload reports error status', async function () {
    const promise = provider._fetchText(makeUrl('bad2.txt'));
    const xhr = requests[0];
    xhr.status = 500;
    xhr.response = 'err';
    xhr.onload();
    await assert.rejects(promise);
    assert.ok(provider.log.logged.some(m => m.includes('error load file')));
  });

  it('_fetchHead handles missing fetch', async function () {
    delete global.fetch;
    const result = await provider._fetchHead('url');
    assert.strictEqual(result, null);
  });

  it('_fetchHead returns headers and swallows errors', async function () {
    global.fetch = async () => {
      return { headers: { get: key => ({ ETag: 'v', 'Last-Modified': 'm' }[key]) } };
    };
    const success = await provider._fetchHead('url');
    assert.deepStrictEqual(success, { etag: 'v', lastModified: 'm' });
    global.fetch = async () => { throw new Error('fail'); };
    const failure = await provider._fetchHead('url');
    assert.strictEqual(failure, null);
  });

  it('honors injected fetch and XMLHttpRequest dependencies', async function () {
    const fetchCalls = [];
    class InjectedXHR {
      constructor() {
        this.status = 0;
        this.response = '';
        InjectedXHR.instances.push(this);
      }
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      send() {}
    }
    InjectedXHR.instances = [];
    const injectedProvider = new FileProvider(rootPath, {
      fetch: async (url, options) => {
        fetchCalls.push([url, options.method]);
        return { headers: { get: key => ({ ETag: 'etag-injected', 'Last-Modified': 'modified-injected' }[key]) } };
      },
      XMLHttpRequest: InjectedXHR
    });
    injectedProvider._hashString = async () => 'hash';

    const head = await injectedProvider._fetchHead('injected-url');
    assert.deepStrictEqual(fetchCalls, [['injected-url', 'HEAD']]);
    assert.deepStrictEqual(head, { etag: 'etag-injected', lastModified: 'modified-injected' });

    const promise = injectedProvider._fetchText(rootPath + 'injected.txt');
    const xhr = InjectedXHR.instances[0];
    xhr.status = 200;
    xhr.response = 'ok';
    xhr.getResponseHeader = () => null;
    xhr.onload();
    assert.strictEqual(await promise, 'ok');
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
