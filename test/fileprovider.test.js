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
});
