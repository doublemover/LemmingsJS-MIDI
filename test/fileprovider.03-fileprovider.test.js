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
});
