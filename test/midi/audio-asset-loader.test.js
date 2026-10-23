import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { createAudioAssetLoader, createAudioAssetSet } from '../../js/app/midi-ui/AudioAssetLoader.js';
import { validateAudioAssetRef, inspectWaveAudio, DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';
import { createAudioAssetStore } from '../../js/app/midi-ui/AudioAssetStore.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const fixture = ({ frames = 64, channels = 1, rate = 48000, marker = 1 } = {}) => {
  const bytes = new Uint8Array(44 + frames * channels * 2), view = new DataView(bytes.buffer);
  const four = (at, text) => { for (let n = 0; n < 4; n++) bytes[at + n] = text.charCodeAt(n); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); four(36, 'data');
  view.setUint32(40, frames * channels * 2, true); view.setInt16(44, marker, true);
  return { bytes, ref: { contentHash: hash(bytes), bytes: bytes.length, path: 'samples/tone.wav', mime: 'audio/wav', channels,
    sourceSampleRate: rate, frames, decodeVersion: DECODER_VERSION, licenseId: 'CC0-1.0', attribution: 'Original test fixture' } };
};
const context = (rate = 48000, decode = null) => ({ sampleRate: rate, state: 'running',
  decodeAudioData: decode || (async input => {
    const view = new DataView(input), channels = view.getUint16(22, true), sourceRate = view.getUint32(24, true);
    const length = Math.round(view.getUint32(40, true) / (channels * 2) * rate / sourceRate);
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, numberOfChannels: channels, sampleRate: rate, getChannelData: n => samples[n] };
  }) });
const makeLoader = (item, options = {}) => createAudioAssetLoader({ getContext: () => context(), fetchAsset: async () => item.bytes,
  digest: hash, ...options });
const rejection = async (promise, reason) => {
  try { await promise; throw new Error('Expected rejection: ' + reason); } catch (error) { expect(error.reason || error.message).to.equal(reason); }
};

describe('Content addressed audio asset admission', () => {
  it('validates exact container metadata, relative identities, rights and source-frame loop bounds', () => {
    const item = fixture(), ref = validateAudioAssetRef({ ...item.ref, loopMarkers: { startFrame: 8, endFrame: 48, crossfadeFrames: 12 } });
    expect(Object.isFrozen(ref.loopMarkers)).to.equal(true);
    expect(inspectWaveAudio(item.bytes, ref)).to.include({ frames: 64, sampleRate: 48000 });
    for (const extra of [{ path: '../recording.wav' }, { path: 'blob:123' }, { mime: 'audio/mpeg' }, { licenseId: '' },
      { loopMarkers: { startFrame: 10, endFrame: 9 } }, { loopMarkers: { startFrame: 0, endFrame: 20, crossfadeFrames: 11 } }]) {
      expect(() => validateAudioAssetRef({ ...item.ref, ...extra })).to.throw();
    }
    expect(() => inspectWaveAudio(item.bytes, { ...ref, channels: 2 })).to.throw('asset-source-metadata-mismatch');
    expect(() => validateAudioAssetRef({ ...item.ref, kind: 'impulse-response', frames: 48000 * 31 })).to.throw('asset-duration-limit');
  });

  it('deduplicates two owners, cancels only one subscriber and reconciles shared backing once', async () => {
    const item = fixture(), fetch = deferred(), budget = createResourceBudget(), loader = makeLoader(item, { resourceBudget: budget,
      fetchAsset: () => fetch.promise, maxEntries: 1 });
    const cancel = new AbortController(), a = loader.acquire(item.ref, { owner: 'a', signal: cancel.signal }),
      b = loader.acquire(item.ref, { owner: 'b' });
    cancel.abort(); await rejection(a, 'asset-request-cancelled'); fetch.resolve(item.bytes);
    const pin = await b, second = pin.retain({ owner: 'render' });
    expect(pin.buffer).to.equal(second.buffer);
    expect(loader.diagnostics()).to.include({ fetches: 1, decodes: 1, decodedBytes: 64 * 4, activePins: 2 });
    expect(budget.diagnostics().residentBytes).to.equal(item.bytes.length + 256);
    pin.release(); loader.purge(); expect(loader.diagnostics().decodedBytes).to.equal(256);
    second.release(); loader.purge(); expect(budget.diagnostics().residentBytes).to.equal(0); loader.dispose();
  });

  it('retains live render pins through loader disposal and releases final storage exactly once', async () => {
    const item = fixture(), budget = createResourceBudget(), loader = makeLoader(item, { resourceBudget: budget });
    const pin = await loader.acquire(item.ref), buffer = pin.buffer;
    loader.dispose(); expect(pin.isActive()).to.equal(true); expect(pin.buffer).to.equal(buffer);
    expect(() => pin.retain()).to.throw('asset-pin-released');
    expect(loader.diagnostics()).to.include({ rawBytes: 0, decodedBytes: 256 });
    expect(pin.release()).to.equal(true); expect(pin.release()).to.equal(false);
    expect(() => pin.buffer).to.throw('asset-pin-released'); expect(budget.diagnostics().residentBytes).to.equal(0);
  });

  it('holds a canceled native decode reservation until the browser call returns', async () => {
    const item = fixture(), native = deferred(), budget = createResourceBudget(), loader = makeLoader(item, { resourceBudget: budget,
      getContext: () => context(48000, () => native.promise) });
    const controller = new AbortController(), request = loader.acquire(item.ref, { signal: controller.signal });
    while (!loader.diagnostics().decodes) await settle();
    const admitted = budget.diagnostics().residentBytes; expect(admitted).to.be.greaterThan(0);
    controller.abort(); await rejection(request, 'asset-request-cancelled'); loader.dispose();
    expect(budget.diagnostics().residentBytes).to.equal(admitted);
    native.resolve(await context().decodeAudioData(item.bytes.buffer)); await settle(); await settle();
    expect(budget.diagnostics().residentBytes).to.equal(0);
    expect(loader.diagnostics()).to.include({ rawBytes: 0, decodedBytes: 0, rawEntries: 0, decodedEntries: 0 });
  });

  it('cleans canceled queued tasks so a later retry can use their bounded slot', async () => {
    const first = fixture(), second = fixture({ marker: 2 }), native = deferred(), controller = new AbortController();
    let calls = 0;
    const loader = makeLoader(first, { maxEntries: 2, decodeConcurrency: 1,
      fetchAsset: ref => ref.contentHash === first.ref.contentHash ? first.bytes : second.bytes,
      getContext: () => context(48000, input => ++calls === 1 ? native.promise : context().decodeAudioData(input)) });
    const a = loader.acquire(first.ref); while (!loader.diagnostics().decodes) await settle();
    const b = loader.acquire(second.ref, { signal: controller.signal }); controller.abort();
    await rejection(b, 'asset-request-cancelled'); await settle();
    native.resolve(await context().decodeAudioData(first.bytes.buffer)); const pin = await a;
    const retry = await loader.acquire(second.ref); expect(loader.diagnostics().decodedEntries).to.equal(2);
    retry.release(); pin.release(); loader.dispose();
  });

  it('keys decoded variants by actual context rate while retaining a single raw source', async () => {
    const item = fixture({ rate: 44100 }), get = { rate: 48000 }, loader = makeLoader(item, { getContext: () => context(get.rate) });
    const a = await loader.acquire(item.ref); get.rate = 96000; const b = await loader.acquire(item.ref);
    expect(a.variant.targetSampleRate).to.equal(48000); expect(b.variant.targetSampleRate).to.equal(96000);
    expect(a.buffer).not.to.equal(b.buffer); expect(loader.diagnostics()).to.include({ fetches: 1, decodes: 2 });
    a.release(); b.release(); loader.dispose();
  });

  it('leaves the prepared patch intact on hash mismatch, offline, corrupt metadata and quota failures', async () => {
    const good = fixture(), bad = fixture({ marker: 3 }), budget = createResourceBudget(), loader = makeLoader(good, { resourceBudget: budget,
      fetchAsset: ref => ref.contentHash === good.ref.contentHash ? good.bytes : new Uint8Array(bad.bytes.length) });
    const set = createAudioAssetSet({ loader, owner: 'patch' }); await set.replace([good.ref]); const old = set.snapshot()[0];
    await rejection(set.replace([bad.ref]), 'asset-hash-mismatch'); expect(set.snapshot()[0]).to.equal(old); expect(old.isActive()).to.equal(true);
    const offline = makeLoader(good, { fetchAsset: () => { throw new Error('offline'); } });
    await rejection(offline.acquire(good.ref), 'offline'); offline.dispose();
    const wrong = makeLoader(good); await rejection(wrong.acquire({ ...good.ref, frames: 65 }), 'asset-source-metadata-mismatch'); wrong.dispose();
    const quota = makeLoader(good, { resourceBudget: createResourceBudget({ limitBytes: 4096 }) });
    try { await quota.acquire(good.ref); throw new Error('expected quota'); } catch (error) { expect(error.name).to.equal('ResourceBudgetError'); }
    expect(quota.diagnostics().resources.reservations).to.equal(0); quota.dispose(); set.dispose(); loader.dispose();
    expect(budget.diagnostics().residentBytes).to.equal(0);
  });

  it('does not activate a canceled scene when its deferred fetch completes', async () => {
    const first = fixture(), second = fixture({ marker: 4 }), fetch = deferred(), loader = makeLoader(first, {
      fetchAsset: ref => ref.contentHash === first.ref.contentHash ? first.bytes : fetch.promise });
    const set = createAudioAssetSet({ loader, owner: 'scene' }); await set.replace([first.ref]);
    const pending = set.replace([second.ref]); await settle();
    await set.replace([first.ref]); await rejection(pending, 'asset-preparation-cancelled'); fetch.resolve(second.bytes); await settle();
    expect(set.snapshot()[0].ref.contentHash).to.equal(first.ref.contentHash);
    expect(loader.diagnostics().activePins).to.equal(1); set.dispose(); loader.dispose();
  });

  it('checks stream lengths before decode and rejects nonfinite decoded PCM', async () => {
    const item = fixture(), loader = makeLoader(item, { fetchAsset: () => new globalThis.Response(item.bytes.slice(0, 50)) });
    await rejection(loader.acquire(item.ref), 'truncated-audio-asset'); expect(loader.diagnostics().decodes).to.equal(0); loader.dispose();
    const nonfinite = makeLoader(item, { getContext: () => context(48000, async input => {
      const buffer = await context().decodeAudioData(input); buffer.getChannelData(0)[2] = NaN; return buffer;
    }) });
    await rejection(nonfinite.acquire(item.ref), 'nonfinite-decoded-pcm'); expect(nonfinite.diagnostics().decodedBytes).to.equal(0); nonfinite.dispose();
  });

  it('provides bounded pack progress, shared-pack retention and explicit project removal consequences', async () => {
    const item = fixture(), storage = new Map(), progress = [], store = {
        get: key => storage.get(key), has: key => storage.has(key), put: (key, bytes) => storage.set(key, bytes.slice()), remove: key => storage.delete(key)
      }, loader = makeLoader(item, { rawStore: store });
    expect((await loader.inspectPack('one', [item.ref])).status).to.equal('missing-assets');
    await loader.downloadPack('one', [item.ref, item.ref], { onProgress: event => progress.push(event) });
    await loader.downloadPack('two', [item.ref]); expect(progress).to.have.length(1);
    expect(progress[0]).to.include({ completedBytes: item.bytes.length, totalBytes: item.bytes.length });
    expect((await loader.removePack('one', { referencedBy: ['project-1'] })).status).to.equal('referenced-by-project');
    await loader.removePack('one', { confirmReferenced: true }); expect(storage.size).to.equal(1);
    const pin = await loader.acquire(item.ref); await loader.removePack('two'); expect(storage.size).to.equal(0); expect(pin.isActive()).to.equal(true);
    pin.release(); loader.dispose();
  });

  it('removes corrupt persistent data and preserves the prior pack on interrupted replacement', async () => {
    const good = fixture(), next = fixture({ marker: 8 }), data = new Map([[good.ref.contentHash, new Uint8Array(good.bytes.length)]]), controller = new AbortController();
    const loader = makeLoader(good, { rawStore: { get: key => data.get(key), has: key => data.has(key), remove: key => data.delete(key),
      put: (key, bytes) => { data.set(key, bytes.slice()); if (key === next.ref.contentHash) controller.abort(); } },
    fetchAsset: ref => ref.contentHash === good.ref.contentHash ? good.bytes : next.bytes });
    await rejection(loader.acquire(good.ref), 'asset-hash-mismatch'); expect(data.size).to.equal(0);
    await loader.downloadPack('pack', [good.ref]);
    await rejection(loader.downloadPack('pack', [next.ref], { signal: controller.signal }), 'asset-request-cancelled');
    expect((await loader.inspectPack('pack')).bytes).to.equal(good.bytes.length); loader.dispose();
  });

  it('bounds a hundred transactional patch replacements and prunes only unpinned LRU storage', async () => {
    const items = Array.from({ length: 100 }, (_, marker) => fixture({ marker })), byHash = new Map(items.map(item => [item.ref.contentHash, item.bytes]));
    const loader = makeLoader(items[0], { maxEntries: 3, maxRawBytes: 4096, maxDecodedBytes: 4096, fetchAsset: ref => byHash.get(ref.contentHash) });
    const set = createAudioAssetSet({ loader, owner: 'soak' });
    for (const item of items) { await set.replace([item.ref]); expect(loader.diagnostics().activePins).to.equal(1); }
    expect(loader.diagnostics().rawEntries).to.be.at.most(3); expect(loader.diagnostics().decodedEntries).to.be.at.most(3);
    expect(loader.diagnostics().evictions).to.be.greaterThan(100); set.dispose(); loader.dispose();
    expect(loader.diagnostics().resources.reservations).to.equal(0);
  });

  it('uses a dedicated persistent namespace and opaque hash keys', async () => {
    const calls = [], values = new Map(), store = createAudioAssetStore({ baseUrl: 'https://example.test', cacheStorage: {
      open: async name => { calls.push(name); return { match: key => values.get(key), put: (key, value) => values.set(key, value), delete: key => values.delete(key) }; }
    } });
    const item = fixture(); await store.put(item.ref.contentHash, item.bytes); expect(await store.has(item.ref.contentHash)).to.equal(true);
    expect(new Uint8Array(await (await store.get(item.ref.contentHash)).arrayBuffer())).to.deep.equal(item.bytes);
    expect(calls.every(name => name === 'lemmings-audio-assets-v1')).to.equal(true);
    expect([...values.keys()][0]).to.equal('https://example.test/__audio_asset_cache__/' + item.ref.contentHash);
    await rejection(store.get('../recordings'), 'invalid-asset-store-key');
  });
});
