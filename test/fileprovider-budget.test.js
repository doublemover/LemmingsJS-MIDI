import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { FileProvider } from '../js/data/FileProvider.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(options = {}) {
  const budget = options.budgetAdapter || createResourceBudget({ limitBytes: 8192 });
  const requests = [];
  class Xhr {
    constructor() { requests.push(this); this.status = 0; this.headers = {}; }
    open(method, url) { this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send() {}
    abort() { this.onabort?.(); }
    getResponseHeader(name) { return name === 'ETag' ? 'asset-v1' : null; }
    respond(status, bytes = new ArrayBuffer(64)) { this.status = status; this.response = bytes; this.onload?.(); }
  }
  const provider = new FileProvider('/assets/', { XMLHttpRequest: Xhr, indexedDB: null, localStorage: null,
    crypto: webcrypto, maxResponseBytes: 4096, budgetAdapter: budget, ...options });
  return { budget, provider, requests };
}

describe('FileProvider raw byte budget and release', () => {
  it('denies background verification before making its raw input copy', async () => {
    const failure = Object.assign(new Error('Background hashing capacity is occupied.'), { name: 'ResourceBudgetError' });
    const { provider, budget, requests } = fixture({ backgroundJobs: { compute: async () => { throw failure; } } });
    const pending = provider.loadBinary('/denied.bin', null, { expectedHash: 'a'.repeat(64) }); requests[0].respond(200);
    await assert.rejects(pending, error => error.kind === 'budget');
    assert.equal(provider.getRawAssetStats().hashInputCopies, 0);
    await provider.waitForCacheWrites(); provider.dispose(); assert.equal(budget.diagnostics().residentBytes, 0);
  });
  it('releases the private bit-reader fork when a compressed part fails decoding', async () => {
    const { provider, budget, requests } = fixture();
    const pending = provider.loadBinary('/broken-part.bin');
    requests[0].respond(200, Uint8Array.from([8, 0, 0, 0, 0, 20, 0, 0, 0, 11, 0]).buffer);
    const reader = await pending, container = new FileContainer(reader);
    assert.throws(() => container.getPart(0), RangeError);
    await provider.waitForCacheWrites(); container.dispose(); reader.release(); provider.dispose();
    assert.equal(budget.diagnostics().residentBytes, 0);
  });

  it('reserves the bounded response before sending and keeps one charge across reader forks', async () => {
    const { provider, budget, requests } = fixture();
    const pending = provider.loadBinary('data', 'asset.bin');
    assert.equal(budget.diagnostics().residentBytes, 4096);
    requests[0].respond(200);
    const reader = await pending, nested = new BinaryReader(reader, 1, 2);
    await provider.waitForCacheWrites();
    assert.equal(budget.diagnostics().residentBytes, 64);
    const stats = provider.getRawAssetStats();
    assert.equal(stats.binaryNetworkResponses, 1); assert.equal(stats.binaryNetworkBytes, 64);
    assert.equal(stats.hashInputCopies, 1); assert.equal(stats.hashInputBytes, 64);
    provider.clearCache(); reader.release(); reader.release();
    assert.equal(budget.diagnostics().residentBytes, 64);
    assert.equal(nested.readByte(), 0);
    nested.release();
    assert.equal(budget.diagnostics().residentBytes, 0);
    assert.throws(() => reader.readByte(), /released/);
    provider.dispose();
  });

  it('keeps active generations charged while a reload publishes another generation', async () => {
    const { provider, budget, requests } = fixture();
    const first = provider.resolveAsset({ path: '', filename: 'generation.bin' }); requests[0].respond(200);
    const old = await first, fork = old.createReader();
    const reload = provider.loadBinary('', 'generation.bin', { forceReload: true });
    requests[1].respond(200, new ArrayBuffer(128)); const current = await reload;
    await provider.waitForCacheWrites();
    assert.equal(budget.diagnostics().residentBytes, 192);
    old.release(); assert.throws(() => old.createReader(), /released/);
    assert.equal(fork.readByte(), 0);
    provider.dispose(); current.release();
    assert.equal(budget.diagnostics().residentBytes, 64);
    fork.release(); assert.equal(budget.diagnostics().residentBytes, 0);
  });

  it('denies acquisition before constructing XHR when a pinned generation fills the budget', async () => {
    const { provider, budget, requests } = fixture({ budgetAdapter: createResourceBudget({ limitBytes: 4096 }) });
    const first = provider.loadBinary('/pinned.bin'); requests[0].respond(200);
    const reader = await first; await provider.waitForCacheWrites();
    await assert.rejects(provider.loadBinary('/second.bin'), error => error.kind === 'budget');
    assert.equal(requests.length, 1); assert.equal(reader.readByte(), 0);
    reader.release();
    const admitted = provider.loadBinary('/second.bin');
    assert.equal(requests.length, 2); assert.equal(budget.diagnostics().residentBytes, 4096);
    requests[1].respond(200); const second = await admitted;
    await provider.waitForCacheWrites(); second.release(); provider.dispose();
    assert.equal(budget.diagnostics().residentBytes, 0);
    const stats = provider.getRawAssetStats();
    assert.equal(stats.denials, 1); assert.equal(stats.evictedStorageCount, 1); assert.equal(stats.evictedBytes, 64);
    assert.equal(stats.peakReservedBytes, 4096); assert.equal(stats.storageCount, 0);
  });

  it('retires aborted requests and no-store readers without retaining a cache owner', async () => {
    const { provider, budget, requests } = fixture();
    const controller = new AbortController();
    const aborted = provider.loadBinary('/aborted.bin', null, { signal: controller.signal }); controller.abort();
    await assert.rejects(aborted, error => error.kind === 'cancelled');
    assert.equal(budget.diagnostics().residentBytes, 0);
    const pending = provider.loadBinary('/private.bin', null, { cachePolicy: 'no-store' }); requests[1].respond(200);
    const reader = await pending; await provider.waitForCacheWrites();
    assert.equal(provider._cacheSources.size, 0); assert.equal(budget.diagnostics().residentBytes, 64);
    reader.release(); assert.equal(budget.diagnostics().residentBytes, 0); provider.dispose();
  });

  it('retires the temporary cache owner for an HTTP no-store binary response', async () => {
    const { provider, budget, requests } = fixture();
    const pending = provider.loadBinary('/private-header.bin');
    requests[0].getResponseHeader = name => name === 'Cache-Control' ? 'no-store' : null;
    requests[0].respond(200); const reader = await pending; await provider.waitForCacheWrites();
    assert.equal(provider._cacheSources.size, 0); assert.equal(reader.length, 64);
    reader.release(); assert.equal(budget.diagnostics().residentBytes, 0); provider.dispose();
  });

  it('retains asynchronous digest bytes until the digest really settles after disposal', async () => {
    let finishHash;
    const { provider, budget, requests } = fixture({ crypto: { subtle: { digest: () => new Promise(resolve => { finishHash = resolve; }) } } });
    const pending = provider.loadBinary('/hash.bin'); requests[0].respond(200);
    const reader = await pending; await tick();
    assert.equal(budget.diagnostics().residentBytes, 192);
    reader.release(); provider.dispose(); await provider.waitForCacheWrites();
    assert.equal(budget.diagnostics().residentBytes, 192);
    finishHash(new ArrayBuffer(32)); await tick();
    assert.equal(budget.diagnostics().residentBytes, 0);
  });

  it('keeps a fulfilled cache consumer readable across synchronous cache retirement', async () => {
    const { provider, budget, requests } = fixture();
    const initial = provider.loadBinary('/retire.bin'); requests[0].respond(200);
    const first = await initial; first.release(); await provider.waitForCacheWrites();
    const second = provider.loadBinary('/retire.bin'); provider.clearCache();
    const reader = await second; assert.equal(reader.length, 64); reader.release();
    assert.equal(budget.diagnostics().residentBytes, 0); provider.dispose();
  });

  it('reuses the same raw storage for a 304 and releases redundant refresh pins', async () => {
    const { provider, budget, requests } = fixture();
    const first = provider.loadBinary('/same.bin'); requests[0].respond(200);
    const reader = await first; reader.release(); await provider.waitForCacheWrites();
    const a = provider.loadBinary('/same.bin', null, { cachePolicy: 'revalidate' });
    const b = provider.loadBinary('/same.bin', null, { cachePolicy: 'revalidate' });
    await tick(); assert.equal(requests.length, 2); requests[1].respond(304);
    const readers = await Promise.all([a, b]); await provider.waitForCacheWrites();
    assert.equal(budget.diagnostics().residentBytes, 64);
    provider.dispose(); readers.forEach(value => value.release());
    assert.equal(budget.diagnostics().residentBytes, 0);
  });

  it('admits fallback writes only while holding the shared lock and ignores a late grant', async () => {
    const storage = { store: new Map(), getItem(key) { return this.store.get(key) ?? null; },
      setItem(key, value) { this.store.set(key, value); }, removeItem(key) { this.store.delete(key); } };
    const { provider } = fixture({ localStorage: storage, cacheLockManager: null, cacheProbeMs: 5 });
    assert.equal(await provider._storeInLocalStorageCoordinated('/none', { type: 'text', data: 'none' }), false);
    let callback, options;
    provider._cacheLockManager = { request(_name, next, grant) { options = next; callback = grant; return new Promise(() => {}); } };
    assert.equal(await provider._storeInLocalStorageCoordinated('/late', { type: 'text', data: 'late' }), false);
    assert.equal(options.ifAvailable, true);
    assert.equal(callback({ name: 'late' }), false); assert.equal(storage.store.size, 0);
    provider._cacheLockManager = { request: async (_name, _options, grant) => grant(null) };
    assert.equal(await provider._storeInLocalStorageCoordinated('/busy', { type: 'text', data: 'busy' }), false);
    provider._cacheLockManager = { request: async (name, _options, grant) => grant({ name }) };
    assert.equal(await provider._storeInLocalStorageCoordinated('/admitted', { type: 'text', data: 'yes' }), true);
    assert.equal(storage.store.size, 1); provider.dispose();
  });
});
