import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EditorAssetCache } from '../../js/editor/EditorAssetCache.js';
import { BinaryReader } from '../../js/data/BinaryReader.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const fixture = () => {
  const requests = []; let decodes = 0;
  const provider = { loadBinary(root, filename, options) {
    return new Promise(resolve => { requests.push({ root, filename, signal: options.signal, resolve }); });
  } };
  class Container { getPart() { return null; } }
  class Ground {
    constructor() { decodes++; }
    getTerrainImages() { return [{ width: 1, height: 1, frames: [Uint8Array.of(1)] }]; }
    getObjectImages() { return []; }
  }
  const cache = new EditorAssetCache({ FileContainer: Container, GroundReader: Ground });
  return { cache, provider, requests, decodes: () => decodes };
};

describe('EditorAssetCache candidate ownership', () => {
  it('shares a pending decode while canceling only one consumer', async () => {
    const { cache, provider, requests, decodes } = fixture(), controller = new AbortController();
    const canceled = cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider, { signal: controller.signal });
    const survivor = cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider);
    await settle(); assert.equal(requests.length, 2);
    controller.abort(); await assert.rejects(canceled, error => error.kind === 'cancelled');
    assert.equal(requests[0].signal.aborted, false);
    for (const request of requests) request.resolve(Uint8Array.of(1));
    assert.equal((await survivor).terrainImages.length, 1); assert.equal(decodes(), 1);
    assert.equal(cache.pending.size, 0); cache.clear();
  });

  it('cancels all candidate siblings and prevents late decoding after the last owner releases', async () => {
    const { cache, provider, requests, decodes } = fixture(), controller = new AbortController();
    const pending = cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider, { signal: controller.signal });
    await settle(); controller.abort();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    assert.equal(requests.every(request => request.signal.aborted), true);
    for (const request of requests) request.resolve(Uint8Array.of(1));
    await settle(); assert.equal(decodes(), 0); assert.equal(cache.cache.size, 0); assert.equal(cache.pending.size, 0);
  });

  it('retains a newer pending decode when an old cache generation finishes late', async () => {
    const { cache, provider, requests, decodes } = fixture(), config = { path: 'lemmings' };
    const old = cache.loadStyleAssets('dirt', config, provider);
    await settle(); cache.clear(); await assert.rejects(old, error => error.kind === 'cancelled');
    const next = cache.loadStyleAssets('dirt', config, provider); await settle();
    for (const request of requests.slice(0, 2)) request.resolve(Uint8Array.of(1));
    await settle(); assert.equal(cache.pending.size, 1);
    for (const request of requests.slice(2)) request.resolve(Uint8Array.of(2));
    await next; assert.equal(decodes(), 1); assert.equal(cache.cache.size, 1);
    cache.clear();
  });

  it('verifies declared roots and hashes without substituting another style on mismatch', async () => {
    const { cache, decodes } = fixture(), calls = [];
    const provider = { loadBinary(root, filename) { calls.push({ root, filename }); return Promise.resolve(new BinaryReader(Uint8Array.of(1))); } };
    const hash = createHash('sha256').update(Uint8Array.of(1)).digest('hex');
    const config = { path: 'lemmings', resourcePins: { 'GROUND0O.DAT': { root: 'exact-source', sha256: hash } } };
    const valid = await cache.loadStyleAssets('dirt', config, provider);
    assert.equal(valid.resourceSources.ground.root, 'exact-source'); assert.equal(valid.resourceSources.ground.sha256, hash);
    config.resourcePins['GROUND0O.DAT'].sha256 = '0'.repeat(64);
    await assert.rejects(cache.loadStyleAssets('dirt', config, provider), error => error.kind === 'integrity');
    assert.equal(decodes(), 1);
    assert.equal(calls.filter(call => call.filename === 'GROUND0O.DAT').every(call => call.root === 'exact-source'), true);
    cache.clear();
  });

  it('keeps per-manager mutable decoded frames separate across independent caches', async () => {
    const first = fixture(), second = fixture();
    const a = first.cache.loadStyleAssets('dirt', { path: 'lemmings' }, first.provider);
    const b = second.cache.loadStyleAssets('dirt', { path: 'lemmings' }, first.provider);
    await settle(); for (const request of first.requests) request.resolve(Uint8Array.of(1));
    const [one, two] = await Promise.all([a, b]);
    one.terrainImages[0].frames[0][0] = 99;
    assert.equal(two.terrainImages[0].frames[0][0], 1);
    first.cache.clear(); second.cache.clear();
  });

  it('keeps unpinned local assets playable when hashing is unavailable without a second fetch', async () => {
    const { cache, provider, requests } = fixture(); let attempts = 0;
    provider.canVerifyContent = () => false;
    provider.resolveAsset = async () => { attempts++; throw new Error('Hashing is unavailable'); };
    const pending = cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider);
    await settle();
    for (const request of requests) request.resolve(Uint8Array.of(1));
    await pending;
    assert.equal(attempts, 0); assert.equal(requests.length, 2);
    cache.clear();
  });

  it('releases verified handles and their temporary readers after decoding', async () => {
    const { cache, decodes } = fixture(); let handlesReleased = 0, readersReleased = 0;
    const provider = { async resolveAsset() {
      return { identity: { contentHash: 'a'.repeat(64) }, release() { handlesReleased++; },
        createReader() { return { release() { readersReleased++; } }; } };
    } };
    await cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider);
    assert.equal(decodes(), 1); assert.equal(handlesReleased, 2); assert.equal(readersReleased, 2);
    cache.clear();
  });

  it('releases readers arriving after their canceled candidate has retired', async () => {
    const { cache, provider, requests, decodes } = fixture(), controller = new AbortController();
    const pending = cache.loadStyleAssets('dirt', { path: 'lemmings' }, provider, { signal: controller.signal });
    await settle(); controller.abort(); await assert.rejects(pending, error => error.kind === 'cancelled');
    let releases = 0;
    for (const request of requests) request.resolve({ release() { releases++; } });
    await settle();
    assert.equal(releases, 2); assert.equal(decodes(), 0); cache.clear();
  });
});
