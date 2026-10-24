import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { FileProvider } from '../js/data/FileProvider.js';

const fixture = () => {
  const requests = [];
  class Xhr {
    constructor() { this.headers = {}; requests.push(this); }
    open(method, url) { this.url = url; this.method = method; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    getResponseHeader(key) { return this.responseHeaders?.[key] ?? null; }
    send() {}
    abort() { this.onabort?.(); }
    respond(status, data, headers = {}) { this.status = status; this.response = data; this.responseHeaders = headers; this.onload?.(); }
  }
  const provider = new FileProvider('/', { indexedDB: null, localStorage: null, crypto: webcrypto, XMLHttpRequest: Xhr });
  return { provider, requests };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('FileProvider conditional generation revalidation', () => {
  it('uses ETag precedence and retains pinned bytes on 304 without rewriting the payload', async () => {
    const { provider, requests } = fixture(); let stores = 0;
    provider._storeInCache = async () => { stores++; };
    const first = provider.resolveAsset('/sample.bin');
    requests[0].respond(200, Uint8Array.of(7).buffer, { ETag: '"v1"', 'Last-Modified': 'date' });
    const pinned = await first; await provider.waitForCacheWrites();
    stores = 0;
    const refreshed = provider.resolveAsset('/sample.bin', { cachePolicy: 'revalidate' });
    await settle();
    assert.deepEqual(requests[1].headers, { 'If-None-Match': '"v1"' });
    requests[1].respond(304, null, { ETag: '"v1"', 'Last-Modified': 'new date' });
    assert.equal((await refreshed).identity.contentHash, pinned.identity.contentHash);
    await provider.waitForCacheWrites();
    assert.equal(stores, 0); assert.equal(pinned.createReader().readByte(), 7);
    assert.equal((await provider.loadBinary('sample.bin')).readByte(), 7);
    provider.dispose();
  });

  it('publishes changed ETag bytes even when Last-Modified remains unchanged', async () => {
    const { provider, requests } = fixture(), url = '/changed.txt';
    const first = provider.loadString(url); requests[0].respond(200, 'old', { ETag: '"old"', 'Last-Modified': 'same' }); await first;
    const refresh = provider.loadString(url, { cachePolicy: 'revalidate' }); await settle();
    requests[1].respond(200, 'new', { ETag: '"new"', 'Last-Modified': 'same' });
    assert.equal(await refresh, 'new'); assert.equal(await provider.loadString(url), 'new');
    provider.dispose();
  });

  it('uses Last-Modified only in the absence of an ETag and fetches unconditionally without validators', async () => {
    for (const headers of [{ 'Last-Modified': 'date' }, {}]) {
      const { provider, requests } = fixture(), url = '/modified.txt';
      const first = provider.loadString(url); requests[0].respond(200, 'old', headers); await first;
      const refresh = provider.loadString(url, { cachePolicy: 'revalidate' }); await settle();
      assert.deepEqual(requests[1].headers, headers['Last-Modified'] ? { 'If-Modified-Since': 'date' } : {});
      requests[1].respond(200, 'new'); assert.equal(await refresh, 'new');
      provider.dispose();
    }
  });

  it('coalesces a refresh while keeping the cancellation of each consumer independent', async () => {
    const { provider, requests } = fixture(), url = '/shared.txt', controller = new AbortController();
    const first = provider.loadString(url); requests[0].respond(200, 'old', { ETag: '"same"' }); await first;
    const canceled = provider.loadString(url, { cachePolicy: 'revalidate', signal: controller.signal });
    const survivor = provider.loadString(url, { cachePolicy: 'revalidate' }); await settle();
    assert.equal(requests.length, 2);
    controller.abort(); await assert.rejects(canceled, error => error.kind === 'cancelled');
    requests[1].respond(304, null); assert.equal(await survivor, 'old');
    assert.equal(provider._refreshes.size, 0); provider.dispose();
  });

  it('does not replace a more recent generation when an older conditional refresh finishes late', async () => {
    const { provider, requests } = fixture(), url = '/race.txt';
    const first = provider.loadString(url); requests[0].respond(200, 'old', { ETag: '"old"' }); await first;
    const refresh = provider.loadString(url, { cachePolicy: 'revalidate' }); await settle();
    const latest = provider.loadString(url, { forceReload: true });
    requests[2].respond(200, 'latest', { ETag: '"latest"' }); await latest;
    requests[1].respond(304, null); assert.equal(await refresh, 'old');
    assert.equal(await provider.loadString(url), 'latest'); provider.dispose();
  });

  it('retains the last accepted generation when revalidation is unavailable or denied', async () => {
    for (const status of [404, 403, 500, 304]) {
      const { provider, requests } = fixture(), url = '/failure.txt';
      const first = provider.loadString(url); requests[0].respond(200, 'accepted'); await first;
      const refresh = provider.loadString(url, { cachePolicy: 'revalidate' }); await settle();
      requests[1].respond(status, null);
      await assert.rejects(refresh, error => error.status === status);
      assert.equal(await provider.loadString(url), 'accepted'); provider.dispose();
    }
  });

  it('cannot start a late background refresh after an optional cache probe deadline', async () => {
    const { provider, requests } = fixture(); let finishHash, cacheChecks = 0, validations = 0;
    provider._cacheProbeMs = 1;
    provider._canUseIndexedDb = () => true;
    provider._loadFromIndexedDb = async () => ({ value: 'cached', entry: { type: 'text' } });
    provider._verifyExpectedContent = async value => {
      if (value === 'cached' && cacheChecks++ === 0) await new Promise(resolve => { finishHash = resolve; });
      return value;
    };
    provider._scheduleCacheValidation = () => { validations++; };
    const pending = provider.loadString('/slow-cache.txt');
    await new Promise(resolve => setTimeout(resolve, 5));
    requests[0].respond(200, 'network'); assert.equal(await pending, 'network');
    finishHash(); await settle();
    assert.equal(validations, 0); assert.equal(requests.length, 1);
    provider.dispose();
  });
});
