import { expect } from 'chai';
import { prepareOwnedPcmSet } from '../../js/app/midi-ui/OwnedPcmSet.js';
import { verifyOwnedPcmSetPayload } from '../../js/app/resources/OwnedPcmSetVerification.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';

const source = (hash, { frames = 8, channels = 1 } = {}) => {
  const planes = Array.from({ length: channels }, (_, channel) => new Float32Array(frames).fill(channel ? -0.25 : 0.25)), state = { retains: 0, releases: 0 };
  const ref = { contentHash: hash.repeat(64), kind: 'sample', frames, channels, sourceSampleRate: 48000 }, variant = { contentHash: ref.contentHash, frames, channels, targetSampleRate: 48000, decoderVersion: 'fixture-decoder-v1' }, buffer = { length: frames, sampleRate: 48000, numberOfChannels: channels, getChannelData: index => planes[index] };
  const pin = () => { let active = true; return { ref, variant, buffer, isActive: () => active, retain() { state.retains++; return pin(); }, release() { if (!active) return false; active = false; state.releases++; return true; } }; };
  return { pin: pin(), planes, state };
};
const denied = async (promise, code) => { let failure; try { await promise; } catch (error) { failure = error; } expect(failure).to.be.instanceOf(Error); if (code) expect(failure.code).to.equal(code); };

describe('aggregate attack/loop/release PCM ownership', () => {
  it('deduplicates exact assets, pins stable indices and keeps every stereo bank private through all readers', async () => {
    const a = source('a'), b = source('b', { channels: 2 }), resources = createAudioResourceLeases(), set = await prepareOwnedPcmSet([b.pin, a.pin, a.pin], { resources, owner: 'set-fixture' });
    expect(set.descriptor.assetHashes).to.deep.equal(['a'.repeat(64), 'b'.repeat(64)]); expect(set.descriptor.bytes).to.equal(96); expect(a.state).to.deep.equal({ retains: 1, releases: 1 }); expect(b.state).to.deep.equal({ retains: 1, releases: 1 });
    const first = await set.copyForProcessor(), second = await set.copyForProcessor();
    expect(first.payload.banks[1].planes[0].buffer).to.equal(first.payload.banks[1].planes[1].buffer);
    const verified = await verifyOwnedPcmSetPayload(first.payload, [{ sha256: a.pin.ref.contentHash }, { sha256: b.pin.ref.contentHash }], { yieldControl: async () => {} }); expect(verified.descriptor.bankHash).to.equal(set.descriptor.bankHash);
    first.payload.banks[0].planes[0][0] = 0.75; expect(second.payload.banks[0].planes[0][0]).to.equal(0.25); a.planes[0].fill(1); expect(second.payload.banks[0].planes[0][0]).to.equal(0.25);
    await denied(set.copyForProcessor(), 'owned-pcm-set'); const retirement = set.discard(); let done = false; retirement.completion.then(() => { done = true; }); await Promise.resolve(); expect(done).to.equal(false);
    await first.release().completion; await second.release().completion; await retirement.completion;
    expect(retirement.outcome).to.equal('complete'); expect(set.state().readers).to.equal(0); expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
  it('rejects aggregate oversize and contradictory aliases before retaining or copying source material', async () => {
    const a = source('a'), b = source('b'), resources = createAudioResourceLeases();
    const large = { ...a.pin, ref: { ...a.pin.ref, frames: 4194304 }, variant: { ...a.pin.variant, frames: 4194304 }, buffer: { ...a.pin.buffer, length: 4194304, getChannelData() { throw new Error('Oversized source was touched.'); } } };
    await denied(prepareOwnedPcmSet([large, b.pin], { resources, owner: 'too-large' }), 'owned-pcm-set'); expect(a.state.retains).to.equal(0); expect(b.state.retains).to.equal(0);
    await denied(prepareOwnedPcmSet([a.pin, { ...a.pin, variant: { ...a.pin.variant, decoderVersion: 'different' } }], { resources, owner: 'alias' }), 'owned-pcm-set'); expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
  it('retires an already prepared first bank when a later bank copy is canceled', async () => {
    const a = source('a'), b = source('b', { frames: 40000 }), resources = createAudioResourceLeases(), controller = new AbortController();
    await denied(prepareOwnedPcmSet([a.pin, b.pin], { resources, owner: 'cancel', signal: controller.signal, yieldTask: async () => controller.abort(new Error('Canceled later material.')) }));
    expect(a.state.releases).to.equal(1); expect(b.state.releases).to.equal(1); expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
  it('detects altered PCM, altered aggregate hashes and cross-asset buffer aliases without changing the retained source', async () => {
    const a = source('a'), b = source('b'), resources = createAudioResourceLeases(), set = await prepareOwnedPcmSet([a.pin, b.pin], { resources, owner: 'tamper' }), loan = await set.copyForProcessor(), refs = [{ sha256: a.pin.ref.contentHash }, { sha256: b.pin.ref.contentHash }];
    await denied(verifyOwnedPcmSetPayload({ ...loan.payload, descriptor: { ...loan.descriptor, bankHash: 'f'.repeat(64) } }, refs), 'pcm-set-identity-mismatch');
    const aliased = { ...loan.payload, banks: [loan.payload.banks[0], { ...loan.payload.banks[1], planes: loan.payload.banks[0].planes }] }; await denied(verifyOwnedPcmSetPayload(aliased, refs), 'pcm-set-identity-mismatch');
    loan.payload.banks[0].planes[0][0] = 0.9; await denied(verifyOwnedPcmSetPayload(loan.payload, refs), 'pcm-identity-mismatch'); await loan.release().completion;
    const clean = await set.copyForProcessor(); expect(clean.payload.banks[0].planes[0][0]).to.equal(0.25); await verifyOwnedPcmSetPayload(clean.payload, refs); await clean.release().completion; await set.discard().completion; expect(resources.diagnostics().reservations).to.equal(0); await resources.dispose().completion;
  });
});
