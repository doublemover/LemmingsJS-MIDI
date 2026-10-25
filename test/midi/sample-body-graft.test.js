import { expect } from 'chai';
import { createSoundSeedGraftRecipe } from '../../js/midi/content/SoundSeedGraftRecipe.js';
import { prepareFeedforwardGraftDescriptor } from '../../js/midi/content/InstrumentGraft.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { OwnedSampleKernel } from '../../js/app/midi-ui/worklet/OwnedSampleProcessor.js';
import { OWNED_SAMPLE_STATE_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSampleSource.js';
import { SAMPLE_LAYOUT } from '../../js/app/midi-ui/OwnedSourceLayout.js';
import { BEGIN, END, APPLIED, REJECTED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
import { computeOwnedSourceBank } from '../../js/app/resources/OwnedSourceBankComputation.js';
import { createOwnedPcmSetDescriptor } from '../../js/app/resources/OwnedPcmSetVerification.js';
import { ownedSourceStateBytes, writeOwnedSourceState, restoreOwnedSourceState } from '../../js/app/midi-ui/worklet/OwnedSourceState.js';
import { singleSampleMap } from '../helpers/sampleMap.js';

const hash = 'a'.repeat(64), identity = { engineArtifactHash: 'c'.repeat(64), patchDefinitionHash: 'd'.repeat(64), graphRevision: 1 };
const packet = (opcode, frame, sequence, values = {}) => Object.assign(new Array(SAMPLE_LAYOUT.width).fill(0), { 0: 1, 1: frame, 2: sequence, 3: opcode, 4: 0, 5: 1, 17: 1,
  ...(opcode === BEGIN ? { 6: 440, 7: 0.8, 8: 1, 12: 1, 13: 64, 16: 144000, 19: 42, 34: 1, 35: 0.7, 37: 1, 38: 0.5, 39: 4 } : { 13: 64 }), ...values });
const submit = (kernel, rows) => kernel.accept(Float64Array.from(rows.flat()), rows.length);
const render = (kernel, frames) => { const l = new Float32Array(frames), r = new Float32Array(frames); kernel.render(l, r, kernel.lastFrame); return [l, r]; };
const results = kernel => Array.from({ length: kernel.receiptCount }, (_, index) => Array.from(kernel.receipts.subarray(index * 6, index * 6 + 6)));

describe('finite sample excitation into an owned modal body (runtime qualification deferred)', () => {
  let bank, pcm, silent;
  before(async () => {
    bank = await computeOwnedSourceBank('sample-read-v1', { yieldControl: async () => {} });
    const make = async mute => {
      const planes = [new Float32Array(4096), new Float32Array(4096)]; if (!mute) { planes[0][8] = 0.8; planes[1][8] = -0.4; }
      const descriptor = { schema: 'lemmings-owned-pcm-bank/v1', assetHash: hash, pcmHash: hash, bankHash: hash, format: 'float32-planar-le', sourceFrames: 4096, sourceSampleRate: 48000,
        frames: 4096, sampleRate: 48000, channels: 2, bytes: 4096 * 8, decoderVersion: 'fixture-v1', peak: 0.8, sampleMagnitudeLimit: 16, evidence: 'fixture' };
      return { descriptor: await createOwnedPcmSetDescriptor([descriptor]), banks: [{ descriptor, planes }] };
    }; pcm = await make(false); silent = await make(true);
  });
  const patch = (energy = 1) => {
    const map = singleSampleMap(hash, { frames: 4096 }); map.rendererProfile = 'owned-sample-v1'; map.zones[0].pitchTracking = 'fixed'; map.zones[0].pitchRange = { minCents: 0, maxCents: 12700, maxTransposeCents: 0 };
    return { id: 'graft-fixture', revision: 1, sampleRefs: [{ id: 'source', sha256: hash, bytes: 32812, required: true }], sampleMap: map,
      parameters: { releaseSeconds: 0.01, graftModeCount: 4, graftEnergyBudget: energy, graftSupportSeconds: 0.25 }, voicePolicy: { maxVoices: 2 } };
  };
  const create = (material = pcm, energy = 1) => new OwnedSampleKernel(48000, material, patch(energy), 2, bank);
  it('has no backing oscillator for a silent source and rings after an actual source release', () => {
    const quiet = create(silent); submit(quiet, [packet(BEGIN, 0, 1), packet(END, 128, 2)]); expect(render(quiet, 5000).every(plane => plane.every(value => value === 0))).to.equal(true);
    const actual = create(); submit(actual, [packet(BEGIN, 0, 1), packet(END, 128, 2)]); render(actual, 3000); const [tail] = render(actual, 1000);
    expect(tail.some(value => Math.abs(value) > 1e-8)).to.equal(true); expect(actual.active[0]).to.equal(1); expect(actual.source.inspect().voices[0].body.active).to.equal(true);
    expect(results(actual).filter(receipt => receipt[0] === APPLIED)).to.have.length(2);
  });
  it('caps actual excitation energy and reports overflow while preserving a bounded tail', () => {
    const kernel = create(pcm, 1e-9); submit(kernel, [packet(BEGIN, 0, 1), packet(END, 128, 2)]); const audio = render(kernel, 6000), body = kernel.source.inspect().voices[0].body;
    expect(body.injectedEnergy).to.be.at.most(1e-9); expect(body.calibrationExceeded).to.equal(true); expect(audio.every(plane => plane.every(value => Number.isFinite(value) && Math.abs(value) <= 0.9))).to.equal(true);
  });
  it('keeps same-pitch actor bodies independent and clears exactly the forced owner', () => {
    const kernel = create(); submit(kernel, [packet(BEGIN, 0, 1), packet(BEGIN, 0, 2, { 4: 1, 5: 2 }), packet(END, 512, 3, { 20: 1 })]);
    render(kernel, 1000); expect(kernel.active[0]).to.equal(0); expect(kernel.active[1]).to.equal(1); expect(kernel.source.inspect().voices[0]).to.include({ slot: 1, token: 2 });
    expect(OWNED_SAMPLE_STATE_WIDTH).to.equal(SAMPLE_LAYOUT.state);
  });
  it('restores independent body/DC/calibration state before continuing identical PCM', () => {
    const first = create(), restored = create(); submit(first, [packet(BEGIN, 0, 1), packet(END, 128, 2)]); render(first, 3000);
    const bytes = new Uint8Array(ownedSourceStateBytes(first)); writeOwnedSourceState(first, bytes, identity); restoreOwnedSourceState(restored, bytes, identity);
    expect(render(restored, 4096)).to.deep.equal(render(first, 4096)); expect(restored.source.state.buffer).not.to.equal(first.source.state.buffer);
  });
  it('rejects an unsupported body register before mutating the selected source', () => {
    const kernel = create(); submit(kernel, [packet(BEGIN, 0, 1, { 6: 12000 })]); render(kernel, 1);
    expect(kernel.active[0]).to.equal(0); expect(results(kernel).some(receipt => receipt[0] === REJECTED)).to.equal(true);
  });
  it('compiles typed ordinary sampler patches with four real template macros and an independent body root', async () => {
    const manifest = { schema: 'lemmings-sound-seed/v1', frames: 12000, sampleRate: 48000, bakedEffects: 'none-declared', coverage: { status: 'known-material', gaps: [] }, statistics: { rms: 0.05, clippedSamples: 0, silence: false },
      ancestry: [{ completeParentArtifactHash: 'b'.repeat(64), takeId: null, takeRevision: null, parentManifestHash: 'c'.repeat(64), immutableSourceRef: 'source', originKind: 'LIVE CAPTURE', sourceTap: 'master' }] };
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'e'.repeat(64) }]);
    for (const graftBody of ['tin', 'wood']) {
      const recipe = await createSoundSeedGraftRecipe({ manifest, assetHash: hash, byteLength: 100000, pitch: { mode: 'pitched', rootCents: 6000 }, graftBody });
      const compiled = await compileSoundContent(recipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0].definition;
      expect(patch.engineId).to.equal('worklet-sample'); expect(patch.sampleMap.zones[0].pitchTracking).to.equal('fixed'); expect(patch.parameters.graftModeCount).to.equal(graftBody === 'tin' ? 6 : 4);
      expect(patch.macros.map(macro => macro.name)).to.deep.equal(['EXCITE', 'BODY', 'DAMP', 'MIX']); expect(recipe.contract.graft.articulationPolicy).to.include('one-semantic-source');
      expect(() => prepareFeedforwardGraftDescriptor({ ...recipe.contract.graft, exciterRef: { port: 'detector-envelope', assetHash: hash } })).to.throw('detector envelopes');
    }
  });
});
