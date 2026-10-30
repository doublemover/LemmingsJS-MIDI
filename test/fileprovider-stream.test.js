import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { FileProvider } from '../js/data/FileProvider.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

function byteBody(bytes, { chunkBytes = 7, onPull = () => {} } = {}) {
  let offset = 0;
  return new globalThis.ReadableStream({ type: 'bytes', pull(controller) {
    onPull();
    if (offset === bytes.length) { controller.close(); controller.byobRequest?.respond(0); return; }
    const view = controller.byobRequest.view;
    const count = Math.min(view.byteLength, chunkBytes, bytes.length - offset);
    view.set(bytes.subarray(offset, offset + count)); offset += count;
    controller.byobRequest.respond(count);
  } });
}

function fixture(fetchRef, options = {}) {
  const budget = options.budgetAdapter || createResourceBudget({ limitBytes: 65536 });
  const provider = new FileProvider('/', { indexedDB: null, localStorage: null, crypto: webcrypto,
    binaryTransport: 'stream', binaryChunkBytes: 32, maxResponseBytes: 4096, requireByob: true,
    fetch: fetchRef, budgetAdapter: budget, ...options });
  return { provider, budget };
}

const response = (bytes, options = {}) => ({ status: options.status || 200, headers: new globalThis.Headers(options.headers),
  body: options.body || byteBody(bytes, options) });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('FileProvider admitted binary streaming', () => {
  it('accepts native default-stream empty chunks before bytes and during the exact-capacity EOF probe', async () => {
    for (const size of [3, 32, 64]) {
      const expected = Uint8Array.from({ length: size }, (_, index) => index);
      const { provider, budget } = fixture(async () => new globalThis.Response(new globalThis.ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(0)); controller.enqueue(expected); controller.enqueue(new Uint8Array(0)); controller.close();
      } })), { requireByob: false, maxResponseBytes: size === 64 ? 64 : 4096 });
      try { const reader = await provider.loadBinary('', 'empty-chunks.bin'); await provider.waitForCacheWrites(); assert.deepEqual(reader.copyBytes(), expected); reader.release(); }
      finally { provider.dispose(); }
      assert.equal(budget.diagnostics().accountedBytes, 0);
    }
  });
  it('bounds consecutive empty reads and retires the native default reader and reservation', async () => {
    let pulls = 0, cancels = 0;
    const { provider, budget } = fixture(async () => new globalThis.Response(new globalThis.ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(0)); }, cancel() { cancels++; } })), { requireByob: false });
    await assert.rejects(provider.loadBinary('', 'no-progress.bin'), error => error.kind === 'decode' && /empty-read/.test(error.cause?.message));
    await tick(); provider.dispose(); assert.ok(pulls <= 35); assert.equal(cancels, 1); assert.equal(budget.diagnostics().accountedBytes, 0);
  });
  it('reads a BYOB response in bounded growth buffers and assembles exact bytes', async () => {
    const bytes = Uint8Array.from({ length: 257 }, (_value, index) => index % 256);
    let fetches = 0, pulls = 0;
    const { provider, budget } = fixture(async () => { fetches++; return response(bytes, { onPull: () => pulls++ }); });
    const reader = await provider.loadBinary('', 'stream.bin'); await provider.waitForCacheWrites();
    assert.deepEqual(reader.copyBytes(), bytes); assert.equal(fetches, 1); assert.ok(pulls > 1);
    assert.equal(provider.getRawAssetStats().byobResponses, 1); assert.equal(provider.getRawAssetStats().estimatedStreamResponses, 0);
    assert.equal(budget.diagnostics().residentBytes, bytes.length);
    assert.ok(provider.getRawAssetStats().peakReservedBytes >= 512 + 257);
    assert.ok(budget.diagnostics().peakAccountedBytes <= 65536);
    reader.release(); provider.dispose(); assert.equal(budget.diagnostics().residentBytes, 0);
  });

  it('treats missing/lying small Content-Length as a hint and refuses actual excess', async () => {
    for (const headers of [{}, { 'Content-Length': '1', 'Content-Encoding': 'gzip' }]) {
      let fetches = 0;
      const { provider, budget } = fixture(async () => { fetches++; return response(new Uint8Array(65), { headers }); }, { maxResponseBytes: 64 });
      await assert.rejects(provider.loadBinary('', 'oversized.bin'), error => error.kind === 'too-large');
      assert.equal(fetches, 1); assert.equal(budget.diagnostics().residentBytes, 0);
      assert.equal(provider.getCacheStats().ownedRequests, 0); provider.dispose();
    }
  });

  it('accepts an exact response ceiling after an admitted EOF probe', async () => {
    const { provider, budget } = fixture(async () => response(new Uint8Array(64)), { maxResponseBytes: 64 });
    const reader = await provider.loadBinary('', 'exact.bin'); await provider.waitForCacheWrites();
    assert.equal(reader.length, 64); reader.release(); provider.dispose(); assert.equal(budget.diagnostics().residentBytes, 0);
  });

  it('denies before fetch when even the first admitted buffer cannot fit', async () => {
    let fetches = 0;
    const budget = createResourceBudget({ limitBytes: 4096 });
    const token = {}; budget.reserve({ token, owner: 'performance', category: 'pixels', bytes: 4096 });
    const { provider } = fixture(async () => { fetches++; }, { budgetAdapter: budget });
    await assert.rejects(provider.loadBinary('', 'denied.bin'), error => error.kind === 'budget');
    assert.equal(fetches, 0); assert.equal(budget.diagnostics().residentBytes, 4096);
    provider.dispose(); budget.release({ token, owner: 'performance' });
  });

  it('rejects growth before allocating a replacement while the active reservation stays intact', async () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), token = {};
    budget.reserve({ token, owner: 'performance', category: 'pixels', bytes: 4000 });
    const { provider } = fixture(async () => response(new Uint8Array(65)), { budgetAdapter: budget });
    await assert.rejects(provider.loadBinary('', 'growth.bin'), error => error.kind === 'budget');
    assert.equal(budget.diagnostics().residentBytes, 4000); provider.dispose(); budget.release({ token, owner: 'performance' });
  });

  it('admits the final exact-size copy before allocating it', async () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), token = {};
    budget.reserve({ token, owner: 'performance', category: 'pixels', bytes: 4032 });
    const { provider } = fixture(async () => response(new Uint8Array(1)), { budgetAdapter: budget, binaryChunkBytes: 64 });
    await assert.rejects(provider.loadBinary('', 'assembly.bin'), error => error.kind === 'budget');
    assert.equal(provider.getRawAssetStats().streamBufferAllocations, 1);
    assert.equal(provider.getRawAssetStats().streamBufferCopies, 0);
    assert.equal(budget.diagnostics().residentBytes, 4032); provider.dispose(); budget.release({ token, owner: 'performance' });
  });

  it('retires an uncooperative late header response without allocating its body', async () => {
    let finish, reads = 0, cancels = 0;
    const { provider, budget } = fixture(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = provider.loadBinary('', 'late.bin', { signal: controller.signal }); controller.abort();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    assert.equal(budget.diagnostics().residentBytes, 0);
    finish({ status: 200, headers: new globalThis.Headers(), body: { cancel() { cancels++; }, getReader() { reads++; } } });
    await tick(); assert.equal(reads, 0); assert.equal(cancels, 1); assert.equal(budget.diagnostics().residentBytes, 0);
    provider.dispose();
  });

  it('times out uncooperative headers and returns the unused reservation promptly', async () => {
    const { provider, budget } = fixture(() => new Promise(() => {}), { requestTimeoutMs: 5 });
    await assert.rejects(provider.loadBinary('', 'timeout.bin'), error => error.kind === 'timeout');
    await tick(); assert.equal(provider.getCacheStats().ownedRequests, 0); assert.equal(budget.diagnostics().residentBytes, 0);
    assert.equal(provider.getRawAssetStats().streamBufferAllocations, 0); provider.dispose();
  });

  it('keeps a transferred pending read charged until its late completion retires', async () => {
    let finish, view;
    const body = { getReader() { return { read(next) { view = next; return new Promise(resolve => { finish = resolve; }); }, cancel() {}, releaseLock() {} }; } };
    const { provider, budget } = fixture(async () => response(new Uint8Array(), { body }));
    const controller = new AbortController(), pending = provider.loadBinary('', 'late-read.bin', { signal: controller.signal });
    await tick(); controller.abort(); await assert.rejects(pending, error => error.kind === 'cancelled');
    assert.equal(provider.getCacheStats().ownedRequests, 0); assert.equal(budget.diagnostics().residentBytes, 32);
    finish({ value: view.subarray(0, 1), done: false }); await tick();
    assert.equal(budget.diagnostics().residentBytes, 0); assert.equal(provider.getCacheStats().memoryEntries, 0); provider.dispose();
  });

  it('bounds four concurrent oversized bodies under one aggregate budget', async () => {
    let fetches = 0;
    const budget = createResourceBudget({ limitBytes: 4096 });
    const { provider } = fixture(async () => { fetches++; return response(new Uint8Array(129)); },
      { budgetAdapter: budget, maxResponseBytes: 128, maxConcurrentRequests: 2 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_unused, index) => provider.loadBinary('', `excess-${index}.bin`)));
    assert.equal(results.every(result => result.status === 'rejected' && result.reason.kind === 'too-large'), true);
    await tick(); assert.equal(fetches, 4); assert.equal(provider.getCacheStats().ownedRequests, 0);
    assert.equal(budget.diagnostics().residentBytes, 0); assert.ok(budget.diagnostics().peakAccountedBytes <= 4096); provider.dispose();
  });

  it('rejects a missing BYOB boundary in strict mode and labels estimated fallback explicitly', async () => {
    const makeDefaultBody = () => new globalThis.ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(2, 3)); controller.close(); } });
    const strict = fixture(async () => response(new Uint8Array(), { body: makeDefaultBody() }));
    await assert.rejects(strict.provider.loadBinary('', 'strict.bin'), error => error.kind === 'unavailable');
    assert.equal(strict.provider.getRawAssetStats().streamBufferAllocations, 0);
    assert.equal(strict.budget.diagnostics().residentBytes, 0); strict.provider.dispose();
    const fallback = fixture(async () => response(new Uint8Array(), { body: makeDefaultBody() }), { requireByob: false });
    const reader = await fallback.provider.loadBinary('', 'estimated.bin'); await fallback.provider.waitForCacheWrites();
    assert.deepEqual([...reader.copyBytes()], [2, 3]);
    assert.equal(fallback.provider.getRawAssetStats().estimatedStreamResponses, 1); assert.equal(fallback.provider.getRawAssetStats().byobResponses, 0);
    reader.release(); fallback.provider.dispose(); assert.equal(fallback.budget.diagnostics().residentBytes, 0);
  });

  it('preserves typed HTTP failure and never retries a failed streaming response', async () => {
    let fetches = 0;
    const { provider, budget } = fixture(async () => { fetches++; return response(new Uint8Array(), { status: 429 }); });
    await assert.rejects(provider.loadBinary('', 'rate.bin'), error => error.kind === 'rate-limit' && error.status === 429);
    assert.equal(fetches, 1); assert.equal(budget.diagnostics().residentBytes, 0); provider.dispose();
  });

  it('uses conditional validators and preserves the old byte allocation on a 304', async () => {
    const seen = [];
    const { provider, budget } = fixture(async (_url, options) => {
      seen.push(options.headers);
      return response(Uint8Array.of(4, 5, 6), { status: seen.length === 1 ? 200 : 304, headers: { ETag: 'stream-v1' } });
    });
    const old = await provider.loadBinary('', 'same.bin'); await provider.waitForCacheWrites();
    const current = await provider.loadBinary('', 'same.bin', { cachePolicy: 'revalidate' });
    assert.deepEqual(seen, [{}, { 'If-None-Match': 'stream-v1' }]);
    assert.equal(old.readByte(), 4); assert.equal(current.readByte(), 4);
    assert.equal(budget.diagnostics().residentBytes, 3); assert.equal(provider.getRawAssetStats().binaryNetworkResponses, 1);
    old.release(); current.release(); provider.dispose(); assert.equal(budget.diagnostics().residentBytes, 0);
  });
});
