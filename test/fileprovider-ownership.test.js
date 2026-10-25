import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { FileProvider } from '../js/data/FileProvider.js';
import { BinaryReader } from '../js/data/BinaryReader.js';

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
  it('retires a canceled cache probe before it can send a network request', async () => {
    const { provider, requests } = fixture({ indexedDB: { open() {} } });
    let finishProbe;
    provider._loadFromIndexedDb = () => new Promise(resolve => { finishProbe = resolve; });
    const controller = new AbortController();
    const pending = provider.loadString('/assets/probe.txt', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    finishProbe(null);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests.length, 0); assert.equal(provider._acquisitions.size, 0);
    provider.dispose();
  });

  it('keeps cancellation attached to its request when a newer request has the same URL', async () => {
    const { provider, requests } = fixture(), oldOwner = new AbortController(), newOwner = new AbortController();
    const old = provider.loadString('/assets/same.txt', { signal: oldOwner.signal });
    provider.clearCache();
    const next = provider.loadString('/assets/same.txt', { signal: newOwner.signal });
    oldOwner.abort(); await assert.rejects(old, error => error.kind === 'cancelled');
    assert.equal(requests[0].onload, null); assert.equal(typeof requests[1].onload, 'function');
    requests[1].respond(200, 'current'); assert.equal(await next, 'current');
    provider.dispose();
  });

  it('retires verification on cancellation even when the crypto adapter never settles', async () => {
    const { provider, requests } = fixture({ crypto: { subtle: { digest: () => new Promise(() => {}) } } });
    const controller = new AbortController();
    const pending = provider.loadBinary('data', 'hash.bin', { signal: controller.signal, expectedHash: '0'.repeat(64) });
    requests[0].respond(200, Uint8Array.of(1).buffer);
    await Promise.resolve(); controller.abort();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(provider._acquisitions.size, 0); assert.equal(provider._requests.size, 0);
    assert.equal(provider._pendingCacheWrites.size, 0);
    provider.dispose();
  });

  it('retains provider resources until all transferred runtime leases release', async () => {
    const { provider, requests } = fixture();
    const first = provider.acquireLease(), second = provider.acquireLease();
    provider.dispose();
    assert.equal(provider._disposed, false); assert.equal(provider.getCacheStats().resourceLeases, 2);
    assert.throws(() => provider.acquireLease(), /retired/);
    const pending = provider.loadString('/assets/runtime.txt');
    first.release(); first.release(); assert.equal(provider._disposed, false);
    requests[0].respond(200, 'active'); assert.equal(await pending, 'active');
    second.release(); assert.equal(provider._disposed, true);
    assert.equal(provider.getCacheStats().resourceLeases, 0);
  });

  it('closes a disposed pending open immediately and ignores its late successful connection', async () => {
    let request, closes = 0;
    const { provider } = fixture({ indexedDB: { open() { request = {}; return request; } } });
    const opened = provider._openIndexedDb();
    provider.dispose(); assert.equal(await opened, null);
    request.result = { close() { closes++; } }; request.onsuccess();
    assert.equal(closes, 1); assert.equal(provider._idb, null);
    assert.equal(await provider._openIndexedDb(), null);
  });

  it('pins a raw handle and protects nested reader readiness and transferred copies', async () => {
    const { provider, requests } = fixture();
    const pending = provider.resolveAsset({ path: 'data', filename: 'handle.bin' });
    requests[0].respond(200, Uint8Array.from([11, 22, 33]).buffer);
    const handle = await pending;
    assert.equal(handle.identity.contentHash, createHash('sha256').update(Uint8Array.from([11, 22, 33])).digest('hex'));
    assert.equal(Object.isFrozen(handle.identity), true);
    const a = handle.createReader(), b = handle.createReader();
    const nested = new BinaryReader(a, 1, 1);
    (await nested.ready)[1] = 99;
    assert.equal(nested.readByte(), 22); assert.equal(b.readByte(), 11);
    const owned = handle.copyBytes(); structuredClone(owned, { transfer: [owned.buffer] });
    assert.equal(handle.createReader().readByte(), 11);
    const refresh = provider.loadBinary('data', 'handle.bin', { forceReload: true });
    requests[1].respond(200, Uint8Array.of(77).buffer); await refresh;
    assert.equal(handle.createReader().readByte(), 11);
    assert.equal((await provider.loadBinary('data', 'handle.bin')).readByte(), 77);
    provider.dispose();
  });

  it('hashes logical windows rather than unrelated bytes in the reader backing store', async () => {
    const { provider } = fixture();
    provider._fetchBinary = async () => new BinaryReader(Uint8Array.from([1, 11, 22, 3]), 1, 2);
    const hash = createHash('sha256').update(Uint8Array.from([11, 22])).digest('hex');
    const handle = await provider.resolveAsset('/window.bin', { expectedHash: hash });
    assert.equal(handle.identity.contentHash, hash); assert.deepEqual([...handle.copyBytes()], [11, 22]);
    assert.equal(handle.createReader().readByte(), 11); provider.dispose();
  });

  it('preserves the latest accepted generation when a required refresh hash fails', async () => {
    const { provider, requests } = fixture(), url = '/assets/pinned.txt';
    const old = provider.loadString(url); requests[0].respond(200, 'accepted'); await old;
    const next = provider.loadString(url, { forceReload: true, expectedHash: '0'.repeat(64) });
    requests[1].respond(200, 'mismatch');
    await assert.rejects(next, error => error.kind === 'integrity');
    assert.equal(await provider.loadString(url), 'accepted'); provider.dispose();
  });

  it('checks each consumer manifest independently while sharing raw acquisition', async () => {
    const { provider, requests } = fixture();
    const wrong = provider.loadBinary('data', 'shared-pin.bin', { expectedHash: '0'.repeat(64) });
    const correctHash = createHash('sha256').update(Uint8Array.of(4)).digest('hex');
    const correct = provider.loadBinary('data', 'shared-pin.bin', { expectedHash: correctHash });
    requests[0].respond(200, Uint8Array.of(4).buffer);
    await assert.rejects(wrong, error => error.kind === 'integrity');
    assert.equal((await correct).readByte(), 4); assert.equal(requests.length, 1);
    provider.dispose();
  });

  it('publishes only the latest of racing explicit refreshes and preserves probe-only isolation', async () => {
    const { provider, requests } = fixture(), url = '/assets/refresh.txt';
    const old = provider.loadString(url); requests[0].respond(200, 'old'); await old;
    const first = provider.loadString(url, { forceReload: true }), second = provider.loadString(url, { forceReload: true });
    const probe = provider.loadString(url, { probeOnly: true });
    requests[2].respond(200, 'second'); await second;
    requests[1].respond(200, 'first'); await first;
    requests[3].respond(200, 'probe'); assert.equal(await probe, 'probe');
    assert.equal(await provider.loadString(url), 'second'); provider.dispose();
  });

  it('bypasses both persistent and memory caches for explicit and HTTP no-store responses', async () => {
    const { provider, requests } = fixture(); let stores = 0;
    provider._storeInCache = async () => { stores++; };
    const explicit = provider.loadString('/private.txt', { cachePolicy: 'no-store' });
    requests[0].respond(200, 'private'); await explicit;
    const response = provider.loadString('/private.txt');
    requests[1].getResponseHeader = name => name === 'Cache-Control' ? 'no-store' : null;
    requests[1].respond(200, 'uncached'); await response;
    await provider.waitForCacheWrites(); assert.equal(stores, 0); assert.equal(provider._cache.size, 0);
    provider.dispose();
  });

  it('quarantines corrupt persistent bytes and fetches a fresh verified generation', async () => {
    const records = new Map(), storage = { getItem: key => records.get(key) || null,
      setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
    const { provider, requests } = fixture({ localStorage: storage, fetch: null });
    provider._storeInLocalStorage('/corrupt.txt', { type: 'text', data: 'corrupted', hash: createHash('sha256').update('original').digest('hex') });
    const pending = provider.loadString('/corrupt.txt');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(records.size, 0); assert.equal(requests.length, 1);
    requests[0].respond(200, 'recovered'); assert.equal(await pending, 'recovered');
    await provider.waitForCacheWrites(); provider.dispose();
  });

  it('does not classify unsuccessful HEAD responses as proof of freshness', async () => {
    for (const status of [404, 500]) {
      const { provider } = fixture({ fetch: async () => ({ status, ok: false, headers: { get: () => 'same' } }) });
      assert.equal(await provider._fetchHead('/head.txt'), null); provider.dispose();
    }
    const { provider } = fixture({ fetch: () => new Promise(() => {}), requestTimeoutMs: 1 });
    assert.equal(await provider._fetchHead('/stalled-head.txt'), null);
    assert.equal(provider._requests.size, 0); provider.dispose();
  });

  it('deduplicates content fingerprinting across raw handles and fresh reader cursors', async () => {
    const { provider, requests } = fixture();
    const before = provider._rawByteMetrics.hashInputCopies;
    const a = provider.resolveAsset('/shared.bin'), b = provider.resolveAsset('/shared.bin');
    requests[0].respond(200, Uint8Array.from([7, 8]).buffer);
    const [first, second] = await Promise.all([a, b]);
    assert.equal(first.identity.contentHash, second.identity.contentHash);
    await provider.resolveAsset('/shared.bin');
    assert.equal(requests.length, 1); assert.equal(provider._rawByteMetrics.hashInputCopies - before, 1);
    assert.equal(first.createReader().readByte(), second.createReader().readByte());
    provider.dispose();
  });

  it('does not publish stats or report a successful write when an IndexedDB transaction aborts', async () => {
    const { provider } = fixture(); let transaction;
    const request = result => { const pending = {}; queueMicrotask(() => { pending.result = result; pending.onsuccess?.(); }); return pending; };
    const db = { transaction() {
      transaction = { oncomplete: null, onabort: null, onerror: null, objectStore(name) {
        return { get() { return request(name === 'meta' ? { value: 0, accountingVersion: 2 } : null); }, put() {} };
      } }; return transaction;
    }, close() {} };
    provider._openIndexedDb = async () => db;
    provider._cacheStats.indexedDbBytes = 123;
    const pending = provider._storeInIndexedDb('abort', { type: 'text', data: 'payload' });
    await new Promise(resolve => setTimeout(resolve, 0));
    transaction.onabort();
    assert.equal(await pending, false); assert.equal(provider.getCacheStats().indexedDbBytes, 123);
    provider.dispose();
  });

  it('ignores stale format versions and mismatched payload generations', async () => {
    const { provider } = fixture();
    const entry = { type: 'text', formatVersion: 2, generation: 'accepted', size: 3 };
    const payload = { formatVersion: 2, generation: 'accepted', data: 'abc' };
    assert.equal(provider._isCacheRecordValid(entry, payload), true);
    assert.equal(provider._isCacheRecordValid({ ...entry, formatVersion: 1 }, payload), false);
    assert.equal(provider._isCacheRecordValid(entry, { ...payload, generation: 'retired' }), false);
    assert.equal(provider._isCacheRecordValid(entry, { ...payload, data: 'truncated' }), false);
    provider.dispose();
  });

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
    const { provider, requests } = fixture({ crypto: { subtle: { async digest(_algorithm, data) {
      return Uint8Array.from(createHash('sha256').update(new Uint8Array(data)).digest()).buffer;
    } } } });
    let completeWrite, markStarted;
    const writeStarted = new Promise(resolve => { markStarted = resolve; });
    provider._storeInCache = () => new Promise(resolve => { completeWrite = resolve; markStarted(); });
    const pending = provider.loadBinary('data', 'verified.bin');
    requests[0].respond(200, Uint8Array.from([11, 22]).buffer);
    assert.equal((await pending).readByte(), 11);
    await writeStarted; assert.equal(typeof completeWrite, 'function');
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

  it('does not rewrite warm localStorage payloads and enforces its UTF-16 byte cap', async () => {
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
    reads = 0;
    for (let index = 0; index < 8; index++) { provider.clearCache(); assert.equal(await provider.loadString('/assets/small.txt'), 'hello'); }
    assert.equal(writes, 0); assert.equal(reads, 8);
    assert.equal(provider._storeInLocalStorage('/assets/large.txt', { type: 'text', data: 'x'.repeat(2_100_000) }), false);
    assert.equal(entries.size, 1); provider.dispose();
  });

  it('touches only fresh IndexedDB metadata and prunes from the transactional total', async () => {
    const entry = { url: 'asset', type: 'binary', hash: 'new', size: 30_000_000, lastAccess: 1 };
    const records = new Map([['asset', entry], ['other', { url: 'other', size: 30_000_000, lastAccess: 2 }],
      ['third', { url: 'third', size: 30_000_000, lastAccess: 3 }]]);
    const payloads = new Map([...records].map(([key]) => [key, { url: key }]));
    const metadata = new Map([['totalBytes', { key: 'totalBytes', accountingVersion: 2, value: 90_000_000 }]]);
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
