import assert from 'assert';
import { FileProvider } from '../js/FileProvider.js';
import { Lemmings } from '../js/LemmingsNamespace.js';

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
    Lemmings.BinaryReader = MockBinaryReader;
    Lemmings.LogHandler = MockLogHandler;
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
    Lemmings.BinaryReader = origBR;
    Lemmings.LogHandler = origLog;
  });

  it('_buildUrl() joins rootPath, path and filename', function () {
    const url = provider._buildUrl('path', 'file.bin');
    assert.strictEqual(url, rootPath + 'path' + '/' + 'file.bin');
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
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    provider._storeInLocalStorage('url', { a: 1 });
    console.log = orig;
    assert.ok(logs.length > 0);
  });

  it('_hashBuffer throws when crypto unavailable', async function () {
    provider = new FileProvider(rootPath);
    const buf = Uint8Array.from([1]).buffer;
    const origCrypto = global.crypto;
    delete global.crypto;
    const cryptoMod = await import('node:crypto');
    const origCreate = cryptoMod.createHash;
    cryptoMod.createHash = () => { throw new Error('x'); };
    await assert.rejects(provider._hashBuffer(buf), /crypto API not available/);
    cryptoMod.createHash = origCreate;
    global.crypto = origCrypto;
  });
});
