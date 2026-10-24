import { expect } from 'chai';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { OwnedPluckKernel } from '../../js/app/midi-ui/worklet/OwnedPluckProcessor.js';
import { OwnedChoirKernel } from '../../js/app/midi-ui/worklet/OwnedChoirProcessor.js';
import { OwnedSpectrumKernel } from '../../js/app/midi-ui/worklet/OwnedSpectrumProcessor.js';
import { OwnedGranularKernel } from '../../js/app/midi-ui/worklet/OwnedGranularProcessor.js';
import { getOwnedSourceProfile } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { BEGIN, UPDATE, END } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { OWNED_SOURCE_STATE_ABI } from '../../js/app/midi-ui/worklet/OwnedSourceState.js';

const identity = Object.freeze({ engineArtifactHash: 'a'.repeat(64), patchDefinitionHash: 'b'.repeat(64), graphRevision: 4 });
const material = () => ({ descriptor: { schema: 'lemmings-owned-pcm-bank/v1', assetHash: 'a'.repeat(64), pcmHash: 'b'.repeat(64), bankHash: 'c'.repeat(64), format: 'float32-planar-le',
  sampleRate: 32000, sourceSampleRate: 32000, sourceFrames: 16000, frames: 16000, channels: 2, bytes: 128000, peak: 0.2 },
planes: [Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * 0.05) * 0.2), Float32Array.from({ length: 16000 }, (_, i) => Math.cos(i * 0.05) * 0.2)] });
const create = (id, rate, pcm) => id === 'worklet-pluck' ? new OwnedPluckKernel(rate, 4) : id === 'worklet-choir' ? new OwnedChoirKernel(rate, 4, fixedSourceBank('choir-v1')) :
  id === 'worklet-spectrum' ? new OwnedSpectrumKernel(rate, 4, fixedSourceBank('spectrum-v1')) : new OwnedGranularKernel(rate, pcm, 4, fixedSourceBank('grain-window-v1'));
const render = (kernel, count) => { const left = new Float32Array(count), right = new Float32Array(count); kernel.render(left, right, kernel.lastFrame); return [left, right]; };
const prepare = (id, rate, pcm) => {
  const kernel = create(id, rate, pcm), profile = getOwnedSourceProfile(id), parameters = Object.fromEntries(Object.entries(profile.fields).map(([key, spec]) => [key, spec[2]]));
  if (id === 'worklet-granular') { parameters.densityHz = 48; parameters.grainMilliseconds = 100; parameters.activity01 = 1; }
  const begin = new Float64Array(profile.width); begin.set([1, 0, 1, BEGIN, 0, 1, 220, 0.5, 1, 0, Math.round(rate * 0.01), Math.round(rate * 0.03), 0.7, Math.round(rate * 0.02), 0, 0, rate * 2, 1]);
  for (const [field, value] of Object.entries(profile.beginFields(parameters, 0xeeeeeeee, pcm?.descriptor))) begin[Number(field)] = value;
  const update = new Float64Array(profile.width); update.set([1, Math.round(rate * 0.025), 2, UPDATE, 0, 1]);
  update[6] = 224.0123; update[8] = 0.35; update[9] = -0.3; update[14] = Math.round(rate * 0.02); update[15] = 7;
  const end = new Float64Array(profile.width); end.set([1, Math.round(rate * 0.12), 3, END, 0, 1]); end[13] = Math.round(rate * 0.02);
  const commands = new Float64Array(profile.width * 3); commands.set(begin); commands.set(update, profile.width); commands.set(end, profile.width * 2);
  kernel.accept(commands, 3, 1); return kernel;
};

describe('complete custom-source state cuts (deferred PCM equivalence qualification)', () => {
  for (const id of ['worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular']) for (const rate of [44100, 48000, 96000]) {
    it('restores independent ' + id + ' state at attack, interpolation, held and release boundaries at ' + rate, () => {
      const pcm = material();
      for (const seconds of [0.005, 0.035, 0.11, 0.13]) {
        const original = prepare(id, rate, pcm); render(original, Math.round(seconds * rate));
        const bytes = new Uint8Array(original.stateByteLength()), cut = original.snapshotInto(bytes, identity), next = create(id, rate, pcm);
        expect(cut).to.include({ abi: OWNED_SOURCE_STATE_ABI, engineId: id, frame: original.lastFrame });
        next.restoreFrom(bytes, identity); expect(next.source.state.buffer).not.to.equal(original.source.state.buffer);
        const repeated = new Uint8Array(original.stateByteLength()); original.snapshotInto(repeated, identity); expect(repeated).to.deep.equal(bytes);
        expect(render(next, Math.round(rate * 0.17))).to.deep.equal(render(original, Math.round(rate * 0.17)));
        expect(Array.from(next.receipts.subarray(0, next.receiptCount * 6))).to.deep.equal(Array.from(original.receipts.subarray(0, original.receiptCount * 6)));
        expect(next.source.state).to.deep.equal(original.source.state); expect(next.queue).to.deep.equal(original.queue);
      }
    });
  }
  it('rejects corruption, mismatched immutable assets and engine/graph identities before changing a staged kernel', () => {
    const pcm = material(), original = prepare('worklet-granular', 48000, pcm); render(original, 4096);
    const bytes = new Uint8Array(original.stateByteLength()); original.snapshotInto(bytes, identity);
    const destination = create('worklet-granular', 48000, pcm), corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
    expect(() => destination.restoreFrom(corrupt, identity)).to.throw('checksum');
    expect(() => destination.restoreFrom(bytes, { ...identity, graphRevision: 5 })).to.throw('graph');
    const otherPcm = { ...pcm, descriptor: { ...pcm.descriptor, bankHash: 'd'.repeat(64) } };
    expect(() => create('worklet-granular', 48000, otherPcm).restoreFrom(bytes, identity)).to.throw('hash');
    expect(destination.lastFrame).to.equal(0); expect(destination.active.some(Boolean)).to.equal(false);
    expect(destination.source.grains.every(value => value === 0)).to.equal(true);
  });
  it('requires exact exclusive transfer storage and creates fresh observation state', () => {
    const original = prepare('worklet-pluck', 48000); render(original, 512); const length = original.stateByteLength();
    expect(() => original.snapshotInto(new Uint8Array(length - 1), identity)).to.throw('exact-size');
    if (typeof SharedArrayBuffer === 'function') expect(() => original.snapshotInto(new Uint8Array(new SharedArrayBuffer(length)), identity)).to.throw('exclusively owned');
    const bytes = new Uint8Array(length); original.snapshotInto(bytes, identity); const next = create('worklet-pluck', 48000);
    next.displayEnabled = true; next.displayReady = true; next.restoreFrom(bytes, identity);
    expect(next.displayEnabled).to.equal(false); expect(next.displayReady).to.equal(false);
  });
});
