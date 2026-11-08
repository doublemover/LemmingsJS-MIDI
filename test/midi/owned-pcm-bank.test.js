import { validOwnedPcmPlanes } from '../../js/midi/content/OwnedPcmFormat.js';
import { expect } from 'chai';
import { prepareOwnedPcmBank } from '../../js/app/midi-ui/OwnedPcmBank.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';

const source = (frames = 8) => {
  const samples = new Float32Array(frames).fill(0.25), buffer = { numberOfChannels: 1, length: frames, sampleRate: 48000, getChannelData: () => samples };
  const state = { retains: 0, releases: 0 }, ref = { contentHash: 'a'.repeat(64), kind: 'sample', frames, sourceSampleRate: 48000 },
    variant = { contentHash: ref.contentHash, frames, channels: 1, targetSampleRate: 48000, decoderVersion: 'test-explicit-decoded-source-v1' };
  const pin = () => {
    let active = true;
    return { ref, variant, buffer, isActive: () => active, retain: () => { state.retains++; return pin(); }, release: () => { if (!active) return false; active = false; state.releases++; return true; } };
  };
  return { pin: pin(), samples, state };
};
describe('owned immutable PCM bank preparation', () => {
  it('preserves an unknown decoded-pin retirement without repeating the native release attempt', async () => {
    const input = source(), retained = input.pin.retain(), resources = createAudioResourceLeases(); let attempts = 0, failure;
    retained.release = () => { attempts++; throw new Error('Native pin retirement unknown.'); }; input.pin.retain = () => retained;
    try { await prepareOwnedPcmBank(input.pin, { resources, owner: 'unknown-pin' }); } catch (error) { failure = error; }
    expect(failure.retirement.outcome).to.equal('partial'); expect(attempts).to.equal(1); expect(retained.isActive()).to.equal(true); expect(resources.diagnostics().reservations).to.equal(0);
  });
  it('hashes the copied planar source, isolates processor copies and holds storage through reader retirement', async () => {
    const input = source(), resources = createAudioResourceLeases(), bank = await prepareOwnedPcmBank(input.pin, { resources, owner: 'pcm-test' });
    expect(input.state).to.deep.equal({ retains: 1, releases: 1 }); expect(input.pin.isActive()).to.equal(true);
    expect(bank.descriptor).to.include({ frames: 8, channels: 1, bytes: 32, sampleRate: 48000, format: 'float32-planar-le' }); expect(bank.descriptor.pcmHash).to.match(/^[a-f0-9]{64}$/); expect(bank.descriptor.bankHash).to.match(/^[a-f0-9]{64}$/);
    input.samples.fill(0.9); const first = await bank.copyForProcessor(); expect(first.payload.planes[0][0]).to.equal(0.25); first.payload.planes[0][0] = 1;
    const second = await bank.copyForProcessor(); expect(second.payload.planes[0][0]).to.equal(0.25); expect(second.descriptor.pcmHash).to.equal(bank.descriptor.pcmHash);
    let denial; try { await bank.copyForProcessor(); } catch (error) { denial = error; } expect(denial.message).to.include('unavailable');
    const retirement = bank.discard(); expect(bank.state()).to.include({ retained: true, discarded: true, readers: 2 }); expect(resources.diagnostics().exactBytes).to.equal(96);
    await first.release().completion; expect(bank.state().retained).to.equal(true); await second.release().completion; await retirement.completion;
    expect(retirement.outcome).to.equal('complete'); expect(bank.state().retained).to.equal(false); expect(resources.diagnostics().reservations).to.equal(0);
  });
  it('keeps the source while an accepted chunked copy is running, then retires canceled preparation', async () => {
    const input = source(20000), resources = createAudioResourceLeases(); let block = false, finish, announce;
    const started = new Promise(resolve => { announce = resolve; }), gate = new Promise(resolve => { finish = resolve; });
    const bank = await prepareOwnedPcmBank(input.pin, { resources, owner: 'chunked', yieldTask: () => block ? (announce(), gate) : Promise.resolve() });
    block = true; const copying = bank.copyForProcessor(); await started; const stopped = bank.discard(); expect(resources.diagnostics().exactBytes).to.equal(160000);
    finish(); let failure; try { await copying; } catch (error) { failure = error; } expect(failure).to.be.instanceOf(Error); await stopped.completion;
    expect(resources.diagnostics().reservations).to.equal(0); expect(bank.state().retained).to.equal(false);
  });
  it('rejects nonfinite/over-range samples and absolute deadline exhaustion without leaking the decoded pin', async () => {
    for (const value of [NaN, Infinity, 17]) {
      const input = source(), resources = createAudioResourceLeases(); input.samples[3] = value;
      let failure; try { await prepareOwnedPcmBank(input.pin, { resources, owner: 'bad-pcm' }); } catch (error) { failure = error; }
      expect(failure.message).to.include('out-of-profile'); expect(input.state).to.deep.equal({ retains: 1, releases: 1 }); expect(resources.diagnostics().reservations).to.equal(0);
    }
    const input = source(20000), resources = createAudioResourceLeases(); let time = 0, failure;
    try { await prepareOwnedPcmBank(input.pin, { resources, owner: 'deadline', now: () => time, maxPrepareMs: 10, yieldTask: async () => { time = 10; } }); } catch (error) { failure = error; }
    expect(failure.message).to.include('deadline'); expect(resources.diagnostics().reservations).to.equal(0); expect(input.state.releases).to.equal(1);
  });
});

describe('private PCM plane ownership layout', () => {
  it('admits packed and independent stereo planes while rejecting overlap, hidden bytes and another bank', () => {
    const descriptor = { frames: 4, channels: 2, bytes: 32 }, buffer = new ArrayBuffer(32);
    const packed = [new Float32Array(buffer, 0, 4), new Float32Array(buffer, 16, 4)];
    expect(validOwnedPcmPlanes(packed, descriptor)).to.equal(true);
    expect(validOwnedPcmPlanes([new Float32Array(4), new Float32Array(4)], descriptor)).to.equal(true);
    expect(validOwnedPcmPlanes([packed[0], packed[0]], descriptor)).to.equal(false);
    expect(validOwnedPcmPlanes(packed, descriptor, new Set([buffer]))).to.equal(false);
    const oversized = new ArrayBuffer(64);
    expect(validOwnedPcmPlanes([new Float32Array(oversized, 0, 4), new Float32Array(oversized, 16, 4)], descriptor)).to.equal(false);
  });
});
