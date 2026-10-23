import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { FileProvider } from '../js/data/FileProvider.js';

function fixture(options = {}) {
  const requests = [];
  class Xhr {
    constructor() { requests.push(this); this.status = 0; }
    open(method, url) { this.method = method; this.url = url; }
    send() {}
    abort() { this.onabort?.(); }
    getResponseHeader() { return null; }
    respond(status, value) { this.status = status; this.response = value; this.onload?.(); }
  }
  const provider = new FileProvider('/assets/', { XMLHttpRequest: Xhr, indexedDB: null, localStorage: null, crypto: webcrypto, ...options });
  return { provider, requests };
}

describe('FileProvider request and byte ownership', () => {
  it('shares one binary acquisition but returns independent, externally immutable readers', async () => {
    const { provider, requests } = fixture();
    const first = provider.loadBinary('data', 'notes.bin'), second = provider.loadBinary('data', 'notes.bin');
    assert.equal(requests.length, 1);
    requests[0].respond(200, Uint8Array.from([11, 22]).buffer);
    const a = await first, b = await second;
    assert.notEqual(a, b);
    assert.equal(a.readByte(), 11); assert.equal(b.readByte(), 11);
    a.data[0] = 99;
    const exposed = await a.ready; exposed[0] = 88;
    assert.equal(b.readByte(0), 11);
    const c = await provider.loadBinary('data', 'notes.bin');
    assert.equal(c.readByte(), 11); assert.equal(requests.length, 1);
    provider.dispose();
  });

  it('keeps binary and text representations separate for one locator', async () => {
    const { provider, requests } = fixture(), url = '/assets/data/item.dat';
    const binary = provider.loadBinary('data', 'item.dat'), text = provider.loadString(url);
    assert.equal(requests.length, 2);
    requests[0].respond(200, Uint8Array.from([65]).buffer); requests[1].respond(200, 'A');
    assert.equal((await binary).readByte(), 65); assert.equal(await text, 'A');
    assert.equal(typeof await provider.loadString(url), 'string');
    assert.equal((await provider.loadBinary('data', 'item.dat')).readByte(), 65);
    provider.dispose();
  });

  it('cancels one consumer without aborting another and retires owned XHR on dispose', async () => {
    const { provider, requests } = fixture(), controller = new AbortController(), url = '/assets/shared.txt';
    const canceled = provider.loadString(url, { signal: controller.signal });
    const survivor = provider.loadString(url);
    controller.abort();
    await assert.rejects(canceled, error => error.kind === 'cancelled');
    assert.equal(requests[0].onload !== null, true);
    requests[0].respond(200, 'live'); assert.equal(await survivor, 'live');
    let writes = 0; provider._storeInCache = async () => { writes++; };
    const pending = provider.loadString('/assets/pending.txt');
    provider.dispose();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    requests[1].respond(200, 'too late');
    await Promise.resolve(); assert.equal(writes, 0);
  });

  it('aborts the underlying request after its final consumer cancels', async () => {
    const { provider, requests } = fixture(), controller = new AbortController();
    const pending = provider.loadString('/assets/abandoned.txt', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    assert.equal(requests[0].onload, null);
    assert.equal(provider._requests.size, 0); provider.dispose();
  });

  it('enforces independent response-size and request deadlines', async () => {
    const { provider, requests } = fixture({ maxResponseBytes: 2, requestTimeoutMs: 1 });
    const oversized = provider.loadString('/assets/large.txt');
    requests[0].respond(200, 'much too long');
    await assert.rejects(oversized, error => error.kind === 'too-large');
    const stalled = provider.loadString('/assets/stalled.txt');
    await assert.rejects(stalled, error => error.kind === 'timeout');
    provider.dispose();
  });

  it('bounds concurrent requests and admits queued work when a slot retires', async () => {
    const { provider, requests } = fixture({ maxConcurrentRequests: 1 });
    const first = provider.loadString('/assets/one.txt'), second = provider.loadString('/assets/two.txt');
    assert.equal(requests.length, 1);
    requests[0].respond(200, 'one'); assert.equal(await first, 'one');
    await Promise.resolve(); assert.equal(requests.length, 2);
    requests[1].respond(200, 'two'); assert.equal(await second, 'two');
    assert.equal(provider._activeRequestCount, 0); provider.dispose();
  });

  it('caps queued acquisitions without keeping unlimited pending consumers', async () => {
    const { provider, requests } = fixture({ maxConcurrentRequests: 1, maxQueuedRequests: 1 });
    const first = provider.loadString('/assets/one.txt'), second = provider.loadString('/assets/two.txt');
    const third = provider.loadString('/assets/three.txt');
    await assert.rejects(third, error => error.kind === 'busy' && error.retryable);
    assert.equal(requests.length, 1); assert.equal(provider._requestQueue.length, 1);
    requests[0].respond(200, 'one'); await first;
    await Promise.resolve(); requests[1].respond(200, 'two'); await second;
    provider.dispose();
  });

  it('does not let an old rejection remove a newer cache request', async () => {
    const { provider, requests } = fixture(), url = '/assets/race.txt';
    const old = provider.loadString(url);
    provider.clearCache();
    const next = provider.loadString(url);
    requests[0].respond(500, 'failed');
    await assert.rejects(old);
    requests[1].respond(200, 'new');
    assert.equal(await next, 'new');
    assert.equal(await provider.loadString(url), 'new');
    assert.equal(requests.length, 2);
    provider.dispose();
  });

  it('does not persist an old response after its cache generation retires', async () => {
    const { provider, requests } = fixture(), writes = [];
    provider._storeInCache = async (_url, entry) => { writes.push(entry.data); };
    const old = provider.loadString('/assets/version.txt');
    provider.clearCache();
    const next = provider.loadString('/assets/version.txt');
    requests[0].respond(200, 'old'); requests[1].respond(200, 'new');
    assert.equal(await old, 'old'); assert.equal(await next, 'new');
    await provider.waitForCacheWrites();
    assert.deepEqual(writes, ['new']); provider.dispose();
  });

  it('publishes a verified force refresh for future readers while prior readers stay pinned', async () => {
    const { provider, requests } = fixture();
    const first = provider.loadBinary('data', 'mutable.bin');
    requests[0].respond(200, Uint8Array.from([1]).buffer);
    const oldReader = await first;
    const refresh = provider.loadBinary('data', 'mutable.bin', { forceReload: true });
    requests[1].respond(200, Uint8Array.from([2]).buffer);
    assert.equal((await refresh).readByte(), 2);
    assert.equal((await provider.loadBinary('data', 'mutable.bin')).readByte(), 2);
    assert.equal(oldReader.readByte(), 1);
    assert.equal(requests.length, 2); provider.dispose();
  });

  it('does not retry a network failure merely because IndexedDB is enabled', async () => {
    const { provider, requests } = fixture({ indexedDB: { open() {} } });
    provider._loadFromIndexedDb = async () => null;
    const pending = provider.loadString('/assets/fails.txt');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    requests[0].respond(500, 'failed');
    await assert.rejects(pending, error => error.kind === 'server');
    assert.equal(requests.length, 1); provider.dispose();
  });

  it('bounds blocked IndexedDB and closes a late success without delaying required data', async () => {
    let openRequest, closed = 0;
    const indexedDB = { open() { openRequest = {}; return openRequest; } };
    const { provider, requests } = fixture({ indexedDB, cacheProbeMs: 1 });
    const pending = provider.loadString('/assets/needed.txt');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(requests.length, 1);
    requests[0].respond(200, 'ready'); assert.equal(await pending, 'ready');
    openRequest.result = { close() { closed++; } }; openRequest.onsuccess();
    assert.equal(closed, 1); provider.dispose();
  });

  it('bounds a stalled IndexedDB read before falling back to network', async () => {
    const request = {}, db = { transaction() { return { objectStore() { return { get() { return request; } }; } }; }, close() {} };
    const { provider, requests } = fixture({ indexedDB: { open() {} }, cacheProbeMs: 1 }); provider._idb = db;
    const pending = provider.loadString('/assets/stalled-cache.txt');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(requests.length, 1);
    requests[0].respond(200, 'network'); assert.equal(await pending, 'network'); provider.dispose();
  });

  it('delivers bytes before a stalled optional cache write and enforces expected hashes', async () => {
    const { provider, requests } = fixture();
    let completeWrite;
    provider._storeInCache = () => new Promise(resolve => { completeWrite = resolve; });
    const pending = provider.loadBinary('data', 'verified.bin');
    requests[0].respond(200, Uint8Array.from([11, 22]).buffer);
    assert.equal((await pending).readByte(), 11);
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(typeof completeWrite, 'function');
    const good = createHash('sha256').update(Uint8Array.from([11, 22])).digest('hex');
    assert.equal((await provider.loadBinary('data', 'verified.bin', { expectedHash: good })).readByte(), 11);
    await assert.rejects(provider.loadBinary('data', 'verified.bin', { expectedHash: '0'.repeat(64) }), error => error.kind === 'integrity');
    completeWrite(); await provider.waitForCacheWrites(); provider.dispose();
  });

  it('uses changed ETag over an unchanged date and publishes the validated refresh', async () => {
    const { provider } = fixture(), url = '/assets/changed.txt';
    provider._cache.set(url, Promise.resolve('old'));
    provider._requestVersions.set(url, 1);
    provider._fetchHead = async () => ({ etag: 'new', lastModified: 'same' });
    provider._fetchText = async () => 'new';
    await provider._verifyCache(url, { type: 'text', etag: 'old', lastModified: 'same' });
    assert.equal(await provider.loadString(url), 'new'); provider.dispose();
  });

  it('does not rewrite warm localStorage payloads and enforces its UTF-16 byte cap', () => {
    const entries = new Map(); let writes = 0, reads = 0;
    const storage = { getItem(key) { reads++; return entries.get(key) ?? null; },
      setItem(key, value) { writes++; entries.set(key, value); }, removeItem(key) { entries.delete(key); },
      get length() { return entries.size; }, key(index) { return [...entries.keys()][index]; } };
    const { provider } = fixture({ localStorage: storage, fetch: null });
    provider._scheduleCacheValidation = () => {};
    assert.equal(provider._storeInLocalStorage('/assets/small.txt', { type: 'text', data: 'hello' }), true);
    writes = 0; reads = 0;
    for (let index = 0; index < 8; index++) assert.equal(provider._loadFromLocalStorage('/assets/small.txt', 'text').value, 'hello');
    assert.equal(writes, 0); assert.equal(reads, 8);
    assert.equal(provider._storeInLocalStorage('/assets/large.txt', { type: 'text', data: 'x'.repeat(2_100_000) }), false);
    assert.equal(entries.size, 1); provider.dispose();
  });

  it('touches only fresh IndexedDB metadata and prunes from the transactional total', async () => {
    const entry = { url: 'asset', type: 'binary', hash: 'new', size: 30_000_000, lastAccess: 1 };
    const records = new Map([['asset', entry], ['other', { url: 'other', size: 30_000_000, lastAccess: 2 }],
      ['third', { url: 'third', size: 30_000_000, lastAccess: 3 }]]);
    const payloads = new Map([...records].map(([key]) => [key, { url: key }]));
    const metadata = new Map([['totalBytes', { key: 'totalBytes', value: 90_000_000 }]]);
    const request = value => {
      const result = { result: undefined };
      queueMicrotask(() => { result.result = value; result.onsuccess?.(); });
      return result;
    };
    const store = map => ({ get(key) { return request(map.get(key)); }, put(value) { map.set(value.url ?? value.key, value); },
      delete(key) { map.delete(key); }, index() { return { openCursor() {
        const cursorRequest = {}, sorted = [...map.values()].sort((a, b) => a.lastAccess - b.lastAccess); let index = 0;
        const advance = () => queueMicrotask(() => {
          cursorRequest.result = index < sorted.length ? { value: sorted[index], continue() { index++; advance(); } } : null;
          cursorRequest.onsuccess?.();
        });
        advance(); return cursorRequest;
      } }; } });
    const db = { transaction() { return { objectStore(name) { return store(name === 'entries' ? records : name === 'payloads' ? payloads : metadata); } }; }, close() {} };
    const { provider } = fixture({ indexedDB: { open() {} } }); provider._idb = db;
    await provider._touchIndexedDbEntry('asset', { hash: 'stale', size: 3 });
    assert.equal(records.get('asset').hash, 'new'); assert.equal(records.get('asset').size, 30_000_000);
    await provider._pruneIndexedDb(30_000_000);
    assert.equal(metadata.get('totalBytes').value, 30_000_000);
    assert.equal(records.size, 1); assert.equal(payloads.size, 1);
    provider.dispose();
  });
});
