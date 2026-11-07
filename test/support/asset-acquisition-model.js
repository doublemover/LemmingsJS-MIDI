import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FileProvider } from '../../js/data/FileProvider.js';
export const assetBytes = id => Uint8Array.of(id & 255, 11, 22, 33);
const digest = value => createHash('sha256').update(value).digest('hex');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Logical sources and consumer references, independent of the provider's maps.
export function acquisitionReference() {
  const state = { epoch: 0, requestedDispose: false, disposed: false, runtime: false, serial: 0, clears: 0,
    sources: new Map(), clients: new Map(), readers: new Map(), cache: new Map(), versions: new Map() };
  const fail = source => {
    source.state = 'canceled';
    if (state.cache.get(source.url) === source.id) state.cache.delete(source.url);
    for (const client of state.clients.values()) if (client.source === source.id && client.state === 'pending') { client.state = 'failed'; client.error = 'cancelled'; }
  };
  const settle = source => {
    for (const client of state.clients.values()) if (client.source === source.id && client.state === 'pending') {
      client.state = source.state === 'ready' && !client.badHash ? 'ready' : 'failed';
      client.error = client.badHash && source.state === 'ready' ? 'integrity' : source.state === 'failed' ? source.error : 'cancelled';
      client.handle = client.state === 'ready';
    }
  };
  const dispose = () => {
    if (state.disposed || state.runtime) return;
    state.disposed = true; state.epoch++; state.cache.clear();
    for (const source of state.sources.values()) if (source.state === 'pending') fail(source);
  };
  const apply = command => {
    const client = state.clients.get(command.id), source = state.sources.get(command.source);
    if (command.kind === 'load') {
      if (state.disposed || state.clients.has(command.id) || !['a', 'b'].includes(command.url) || !['normal', 'reload', 'probe'].includes(command.mode)) return false;
      let selected = command.mode === 'normal' && state.sources.get(state.cache.get(command.url));
      if (!selected) {
        if (state.sources.size >= 12) return false;
        const version = (state.versions.get(command.url) || 0) + Number(command.mode !== 'probe');
        if (command.mode !== 'probe') state.versions.set(command.url, version);
        selected = { id: ++state.serial, url: command.url, epoch: state.epoch, version, mode: command.mode, badRequiredHash: command.mode !== 'normal' && !!command.badHash, state: 'pending', delivered: false };
        state.sources.set(selected.id, selected);
        if (command.mode === 'normal') state.cache.set(command.url, selected.id);
      }
      state.clients.set(command.id, { id: command.id, source: selected.id, epoch: state.epoch, state: 'pending', handle: false, badHash: !!command.badHash });
      if (selected.state !== 'pending') settle(selected);
    } else if (command.kind === 'respond') {
      if (!source || source.delivered || ![200, 500].includes(command.status)) return false;
      source.delivered = true;
      if (source.state !== 'pending') return true;
      source.state = command.status === 200 && !source.badRequiredHash ? 'ready' : 'failed';
      source.error = command.status === 200 ? 'integrity' : 'server';
      if (source.state === 'failed') { if (state.cache.get(source.url) === source.id) state.cache.delete(source.url); }
      else if (source.mode !== 'probe' && source.epoch === state.epoch && source.version === state.versions.get(source.url)) state.cache.set(source.url, source.id);
      settle(source);
    } else if (command.kind === 'cancel') {
      if (client?.state !== 'pending') return false;
      client.state = 'failed'; client.error = 'cancelled';
      if (![...state.clients.values()].some(c => c.source === client.source && c.state === 'pending')) fail(state.sources.get(client.source));
    } else if (command.kind === 'release') {
      if (!client?.handle) return false; client.handle = false;
    } else if (command.kind === 'fork') {
      if (!client?.handle || state.readers.has(command.reader)) return false;
      state.readers.set(command.reader, { source: client.source, released: false });
    } else if (command.kind === 'release-reader') {
      const reader = state.readers.get(command.reader); if (!reader || reader.released) return false; reader.released = true;
    } else if (command.kind === 'transfer-copy') { if (!client?.handle) return false; }
    else if (command.kind === 'clear') {
      if (state.disposed) return false; state.epoch++; state.clears++; state.cache.clear();
    } else if (command.kind === 'borrow-runtime') {
      if (state.runtime || state.requestedDispose) return false; state.runtime = true;
    } else if (command.kind === 'release-runtime') {
      if (!state.runtime) return false; state.runtime = false; if (state.requestedDispose) dispose();
    } else if (command.kind === 'dispose') { state.requestedDispose = true; dispose(); }
    else return false;
    return true;
  };
  const bytes = () => {
    let resident = 0, pinned = 0, count = 0;
    for (const source of state.sources.values()) {
      const held = [...state.clients.values()].some(c => c.source === source.id && c.handle) || [...state.readers.values()].some(r => r.source === source.id && !r.released);
      const pending = source.state === 'pending', cached = source.state === 'ready' && state.cache.get(source.url) === source.id;
      const charge = pending ? 16 : source.state === 'ready' && (held || cached) ? 4 : 0;
      resident += charge; if (pending || held) pinned += charge; count += Number(charge > 0);
    }
    return { resident, pinned, count };
  };
  return { state, apply, bytes };
}

export function generateAcquisitionTrace(seed, { steps = 64 } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(steps) || steps < 1 || steps > 256) throw new TypeError('Invalid acquisition model campaign.');
  let word = seed || 1, serial = 0, readerSerial = 0; const draw = count => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % count; };
  const model = acquisitionReference(), trace = [], add = command => { if (!model.apply(command)) throw new Error('Invalid generated acquisition precondition.'); trace.push(command); };
  if (seed % 2) add({ kind: 'borrow-runtime' });
  add({ kind: 'load', id: 'c' + serial++, url: 'a', mode: 'normal' });
  add({ kind: 'load', id: 'c' + serial++, url: 'a', mode: 'normal' });
  for (let step = 0; step < steps; step++) {
    const s = model.state, choices = [];
    if (!s.disposed && s.sources.size < 12) choices.push({ kind: 'load', id: 'c' + serial, url: ['a', 'b'][draw(2)], mode: ['normal', 'reload', 'probe'][draw(3)], badHash: draw(8) === 0 });
    for (const source of s.sources.values()) if (!source.delivered) choices.push({ kind: 'respond', source: source.id, status: draw(5) ? 200 : 500 });
    for (const client of s.clients.values()) {
      if (client.state === 'pending') choices.push({ kind: 'cancel', id: client.id });
      if (client.handle) choices.push({ kind: 'release', id: client.id }, { kind: 'fork', id: client.id, reader: 'r' + readerSerial }, { kind: 'transfer-copy', id: client.id });
    }
    for (const [reader, value] of s.readers) if (!value.released) choices.push({ kind: 'release-reader', reader });
    if (!s.disposed && s.clears < 3) choices.push({ kind: 'clear' });
    if (!s.requestedDispose && step > steps / 2) choices.push({ kind: 'dispose' });
    if (s.runtime && step > steps / 2) choices.push({ kind: 'release-runtime' });
    if (!choices.length) break;
    const next = choices[draw(choices.length)]; add(next); if (next.kind === 'load') serial++; if (next.kind === 'fork') readerSerial++;
  }
  for (const source of model.state.sources.values()) if (!source.delivered) add({ kind: 'respond', source: source.id, status: 200 });
  for (const client of model.state.clients.values()) if (client.handle) add({ kind: 'release', id: client.id });
  for (const [reader, value] of model.state.readers) if (!value.released) add({ kind: 'release-reader', reader });
  add({ kind: 'dispose' }); if (model.state.runtime) add({ kind: 'release-runtime' }); return trace;
}

export async function replayAcquisitionTrace(trace, { providerFactory = options => new FileProvider('/', options), checkBudget = () => {} } = {}) {
  if (!Array.isArray(trace) || trace.length > 512) throw new TypeError('Invalid acquisition trace length.');
  if (!trace.length) return { valid: false, step: 0 };
  const model = acquisitionReference(), requests = [], clients = new Map(), readers = new Map(), reservations = new Map(), observations = []; let runtime = null, step = 0;
  class Xhr {
    constructor() { requests.push(this); }
    open(_method, url) { this.url = url; }
    send() { this.queuedLoad = this.onload; }
    abort() { this.onabort?.(); }
    getResponseHeader() { return null; }
    respond(status, bytes) { this.status = status; this.response = bytes.buffer; (this.onload || this.queuedLoad)?.(); }
  }
  const crypto = { subtle: { digest: async (_algorithm, value) => Uint8Array.from(createHash('sha256').update(new Uint8Array(value)).digest()).buffer } };
  const provider = providerFactory({ XMLHttpRequest: Xhr, binaryTransport: 'xhr', indexedDB: null, localStorage: null, crypto, maxResponseBytes: 16, requestTimeoutMs: 10000,
    backgroundJobs: { async compute({ prepareInput, releasePreparedInput }) { const input = prepareInput(); try { return { value: digest(input), release() {} }; } finally { releasePreparedInput(); } } },
    budgetAdapter: { reserve(request) { reservations.set(request.token, request.bytes); }, release({ token }) { return reservations.delete(token); } } });
  const settle = async () => { await flush(); await provider.waitForCacheWrites(); await flush(); };
  const inspect = () => {
    const expected = model.bytes(), stats = provider.getRawAssetStats();
    assert.equal(stats.residentBytes, expected.resident, 'acquisition-model:resident-bytes'); assert.equal(stats.pinnedBytes, expected.pinned, 'acquisition-model:pinned-bytes');
    assert.equal(stats.storageCount, expected.count, 'acquisition-model:storage-count');
    assert.equal([...reservations.values()].reduce((n, value) => n + value, 0), expected.resident, 'acquisition-model:accounted-bytes');
    assert.equal(provider.getCacheStats().resourceLeases, Number(model.state.runtime), 'acquisition-model:runtime-owner');
    assert.equal(provider._disposed, model.state.disposed, 'acquisition-model:provider-retirement');
    assert.equal(provider.getCacheStats().memoryEntries, model.state.cache.size, 'acquisition-model:cache-locators');
    assert.equal(requests.length, model.state.sources.size, 'acquisition-model:shared-request-count');
    for (const [id, expectedClient] of model.state.clients) {
      const actual = clients.get(id); assert.equal(actual.state, expectedClient.state, 'acquisition-model:consumer-outcome');
      if (expectedClient.state === 'failed') assert.equal(actual.error.kind, expectedClient.error, 'acquisition-model:consumer-failure');
      if (expectedClient.state === 'ready') {
        const expectedBytes = assetBytes(expectedClient.source), expectedHash = digest(expectedBytes);
        assert.equal(actual.handle.identity.contentHash, expectedHash, 'acquisition-model:content-hash');
        assert.equal(actual.handle.identity.providerEpoch, expectedClient.epoch, 'acquisition-model:request-epoch');
        assert.equal(actual.handle.released, !expectedClient.handle, 'acquisition-model:handle-retirement');
        if (expectedClient.handle) assert.deepEqual(actual.handle.copyBytes(), expectedBytes, 'acquisition-model:pinned-generation');
      }
    }
    for (const [id, expectedReader] of model.state.readers) {
      const reader = readers.get(id); if (!expectedReader.released) assert.deepEqual(reader.copyBytes(), assetBytes(expectedReader.source), 'acquisition-model:reader-generation');
      else assert.throws(() => reader.copyBytes(), /released/);
    }
    observations.push({ step, epoch: model.state.epoch, residentBytes: stats.residentBytes, pinnedBytes: stats.pinnedBytes, storageCount: stats.storageCount, requests: requests.length, memoryEntries: provider.getCacheStats().memoryEntries, disposed: provider._disposed });
  };
  try {
    for (const command of trace) {
      checkBudget(); if (!model.apply(command)) return { valid: false, step };
      if (command.kind === 'load') {
        const actual = { state: 'pending', controller: new AbortController(), handle: null, error: null }; clients.set(command.id, actual);
        actual.promise = provider.resolveAsset('/' + command.url + '.bin', { signal: actual.controller.signal, forceReload: command.mode === 'reload', probeOnly: command.mode === 'probe', expectedHash: command.badHash ? '0'.repeat(64) : undefined })
          .then(handle => { actual.state = 'ready'; actual.handle = handle; }, error => { actual.state = 'failed'; actual.error = error; });
      } else if (command.kind === 'respond') requests[command.source - 1].respond(command.status, assetBytes(command.source));
      else if (command.kind === 'cancel') clients.get(command.id).controller.abort();
      else if (command.kind === 'release') { clients.get(command.id).handle.release(); clients.get(command.id).handle.release(); }
      else if (command.kind === 'fork') readers.set(command.reader, clients.get(command.id).handle.createReader());
      else if (command.kind === 'release-reader') { readers.get(command.reader).release(); readers.get(command.reader).release(); }
      else if (command.kind === 'transfer-copy') { const copy = clients.get(command.id).handle.copyBytes(); copy[0] ^= 255; structuredClone(copy, { transfer: [copy.buffer] }); assert.equal(copy.byteLength, 0, 'acquisition-model:exclusive-transfer'); }
      else if (command.kind === 'clear') provider.clearCache();
      else if (command.kind === 'borrow-runtime') runtime = provider.acquireLease();
      else if (command.kind === 'release-runtime') { runtime.release(); runtime.release(); runtime = null; }
      else if (command.kind === 'dispose') provider.dispose();
      await settle(); inspect(); step++;
    }
    return { valid: true, transitions: step, observations, complete: model.state.disposed && model.bytes().resident === 0, sourceCount: model.state.sources.size };
  } catch (error) { error.modelTrace = trace.slice(0, step + 1); error.modelStep = step; error.modelObservations = observations; throw error; }
  finally {
    for (const client of clients.values()) client.controller.abort(); runtime?.release(); provider.dispose();
    for (const [index, request] of requests.entries()) request.respond(200, assetBytes(index + 1));
    await Promise.all([...clients.values()].map(client => client.promise));
    for (const client of clients.values()) client.handle?.release(); for (const reader of readers.values()) reader.release();
    await settle(); assert.equal(provider.getRawAssetStats().residentBytes, 0, 'acquisition-model:final-resident-bytes'); assert.equal(reservations.size, 0, 'acquisition-model:final-reservations');
  }
}
