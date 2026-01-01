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

describe('FileProvider', function () {
  const rootPath = '/base/';
  let provider;
  let requests;
  let restore;
  let origFetch;

  beforeEach(function () {
    origBR = Lemmings.BinaryReader;
    origLog = Lemmings.LogHandler;
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
    const url = rootPath + 'text.txt';
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
    const url = rootPath + 'fail.txt';
    const promise = provider.loadString(url);
    assert.strictEqual(provider._cache.size, 1);
    requests[0].respond(500, 'err');
    await assert.rejects(promise);
    assert.strictEqual(provider._cache.has(url), false);
  });

  it('clearCache() empties the internal cache', async function () {
    const url = rootPath + 'file.txt';
    const p1 = provider.loadString(url);
    requests[0].respond(200, 'ok');
    await p1;
    assert.strictEqual(provider._cache.size, 1);
    provider.clearCache();
    assert.strictEqual(provider._cache.size, 0);
  });

  it('stores data in localStorage and reuses it', async function () {
    const url = rootPath + 'text.txt';
    const p1 = provider.loadString(url);
    requests[0].respond(200, 'hello');
    const result1 = await p1;
    assert.strictEqual(result1, 'hello');
    const stored = global.localStorage.getItem('lem-cache:' + url);
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
    const url = rootPath + 'data/file.bin';
    const entry = {
      type: 'binary',
      data: provider._arrayBufferToBase64(data),
      hash: 'h'
    };
    global.localStorage.setItem('lem-cache:' + url, JSON.stringify(entry));

    const result = await provider.loadBinary('data', 'file.bin');
    assert.ok(result instanceof MockBinaryReader);
    assert.strictEqual(requests.length, 0);
  });

  it('falls back to fetching when cached JSON is invalid', async function () {
    const url = rootPath + 'bad.txt';
    global.localStorage.setItem('lem-cache:' + url, '{bad');
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

    const textUrl = rootPath + 'headers.txt';
    const textPromise = provider.loadString(textUrl);
    HeaderXHR.instances[0].respond(200, 'ok');
    await textPromise;
    const textEntry = JSON.parse(global.localStorage.getItem('lem-cache:' + textUrl));
    assert.strictEqual(textEntry.etag, 'etag-value');

    const binPromise = provider.loadBinary('data', 'file.bin');
    const buffer = new ArrayBuffer(0);
    HeaderXHR.instances[1].respond(200, buffer);
    await binPromise;
    const binUrl = provider._buildUrl('data', 'file.bin');
    const binEntry = JSON.parse(global.localStorage.getItem('lem-cache:' + binUrl));
    assert.strictEqual(binEntry.lastModified, 'modified');
  });

  it('falls back to node crypto hashing and reports failures', async function () {
    const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const hash = await provider._hashBuffer(new Uint8Array([1, 2, 3]).buffer);
      assert.match(hash, /^[a-f0-9]{64}$/);

      provider._forceCryptoError = true;
      await assert.rejects(provider._hashBuffer(new Uint8Array([4]).buffer), /crypto API not available/);
      provider._forceCryptoError = false;
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
    const entry = JSON.parse(global.localStorage.getItem('lem-cache:' + url));
    assert.strictEqual(entry.etag, 'etag');
    assert.strictEqual(entry.lastModified, 'last');
  });

  it('stores response headers for text entries when available', async function () {
    const url = rootPath + 'with-headers.txt';
    const p = provider.loadString(url);
    requests[0].getResponseHeader = key => (key === 'ETag' ? 'etag' : 'last');
    requests[0].respond(200, 'ok');
    await p;
    const entry = JSON.parse(global.localStorage.getItem('lem-cache:' + url));
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
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    await provider._verifyCache('url', { type: 'text', etag: 'old' });
    console.log = orig;
    assert.ok(logs.length > 0);
  });

  it('_verifyCache refreshes stale text entries', async function () {
    let textCalls = 0;
    provider._fetchHead = async () => ({ etag: 'new', lastModified: 'new' });
    provider._fetchText = async () => { textCalls++; };
    await provider._verifyCache('url', { type: 'text', etag: 'old' });
    assert.strictEqual(textCalls, 1);
  });

  it('_hashBuffer falls back to node crypto when web crypto missing', async function () {
    provider = new FileProvider(rootPath);
    const buf = Uint8Array.from([1,2,3]).buffer;
    const orig = global.crypto;
    delete global.crypto;
    const hash = await provider._hashBuffer(buf);
    global.crypto = orig;
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(Buffer.from(buf)).digest('hex');
    assert.strictEqual(hash, expected);
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
    provider._hashString = async () => 'h';
    const url = rootPath + 'text.txt';
    const promise = provider._fetchText(url);
    requests[0].respond(200, 'hi');
    const result = await promise;
    assert.strictEqual(result, 'hi');
    const entry = JSON.parse(global.localStorage.getItem('lem-cache:' + url));
    assert.strictEqual(entry.type, 'text');
    assert.strictEqual(entry.data, 'hi');
    assert.strictEqual(entry.hash, 'h');
  });

  it('_fetchText logs and rejects on failure', async function () {
    const promise = provider._fetchText(rootPath + 'bad.txt');
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
    const promise = provider._fetchText(rootPath + 'bad2.txt');
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

  it('_storeInLocalStorage ignores write errors', function () {
    global.localStorage.setItem = () => { throw new Error('nope'); };
    const result = provider._storeInLocalStorage('url', { a: 1 });
    assert.strictEqual(result, false);
  });

});
