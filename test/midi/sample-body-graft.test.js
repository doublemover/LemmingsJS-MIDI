import { expect } from 'chai';
import { createSoundSeedGraftRecipe } from '../../js/midi/content/SoundSeedGraftRecipe.js';
import { prepareFeedforwardGraftDescriptor, prepareObservedMotionGraftDescriptor, createMotionBodyTraversalBinding } from '../../js/midi/content/InstrumentGraft.js';
import { sampleTraversalBinding, sampleTravelGraph } from '../helpers/sampleTraversal.js';
import { prepareSampleBodyProfile } from '../../js/midi/content/SampleBodyProfile.js';
import { OwnedSampleBody } from '../../js/app/midi-ui/worklet/OwnedSampleBody.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { OwnedSampleKernel } from '../../js/app/midi-ui/worklet/OwnedSampleProcessor.js';
import { OWNED_SAMPLE_STATE_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSampleSource.js';
import { SAMPLE_LAYOUT } from '../../js/app/midi-ui/OwnedSourceLayout.js';
import { BEGIN, UPDATE, END, APPLIED, REJECTED } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';
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
        frames: 4096, sampleRate: 48000, channels: 2, bytes: 4096 * 8, decoderVersion: 'fixture-v1', peak: 0.8, sampleMagnitudeLimit: 16, evidence: 'copied-decoded-pcm-not-acoustic-qualification' };
      return { descriptor: await createOwnedPcmSetDescriptor([descriptor]), banks: [{ descriptor, planes }] };
    }; pcm = await make(false); silent = await make(true);
  });
  const patch = (energy = 1) => {
    const map = singleSampleMap(hash, { frames: 4096 }); map.rendererProfile = 'owned-sample-v1'; map.zones[0].pitchTracking = 'fixed'; map.zones[0].pitchRange = { minCents: 0, maxCents: 12700, maxTransposeCents: 0 };
    return { id: 'graft-fixture', revision: 1, sampleRefs: [{ id: 'source', sha256: hash, bytes: 32812, required: true }], sampleMap: map,
      parameters: { releaseSeconds: 0.01, graftModeCount: 4, graftEnergyBudget: energy, graftSupportSeconds: 0.25 }, voicePolicy: { maxVoices: 2 } };
  };
  const create = (material = pcm, energy = 1) => new OwnedSampleKernel(48000, material, patch(energy), 2, bank);
  const motionPatch = () => { const value = patch(); value.parameters.graftExcitationMode = 1; value.sampleMap.zones[0].playbackMode = 'positionDriven'; value.sampleMap.zones[0].positionPolicy = { boundary: 'reflect', interpolation: 'linear', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 0, gainLaw: 'linear', traversal: sampleTraversalBinding() }; return value; };
  const moving = (material = pcm) => new OwnedSampleKernel(48000, material, motionPatch(), 2, bank);
  const position = (frame, end, sequence = 2, from = 0, to = 4096) => packet(UPDATE, frame, sequence, { 15: 8, 18: frame, 19: end, 20: from, 21: to, 22: sequence - 1, 23: 0 });
  it('waits silently for actual cursor input beyond finite support and retains only the admitted body tail at rest', () => {
    const kernel = moving(); submit(kernel, [packet(BEGIN, 0, 1), position(50000, 52048), packet(END, 60000, 3)]);
    expect(render(kernel, 50000).every(plane => plane.every(value => value === 0))).to.equal(true); const driven = render(kernel, 2400);
    expect(driven.some(plane => plane.some(value => Math.abs(value) > 1e-10))).to.equal(true); const before = kernel.source.inspect().voices[0].body;
    expect(before).to.include({ excitationMode: 1, injectedEnergy: null, energyBudget: null, calibrationExceeded: false }); expect(before.maximumObservedInputPeak).to.be.at.most(1);
    const tail = render(kernel, 3000); expect(tail.some(plane => plane.some(value => Math.abs(value) > 1e-12))).to.equal(true);
    const quiet = moving(silent); submit(quiet, [packet(BEGIN, 0, 1), position(0, 2048), packet(END, 3000, 3)]); expect(render(quiet, 6000).every(plane => plane.every(value => value === 0))).to.equal(true);
  });
  it('restores moving source, DC and private modal state without changing future PCM', () => {
    const first = moving(), restored = moving(); submit(first, [packet(BEGIN, 0, 1), position(0, 2048), position(2048, 4096, 3, 4096, 0), packet(END, 5000, 4)]); render(first, 1234);
    const bytes = new Uint8Array(ownedSourceStateBytes(first)); writeOwnedSourceState(first, bytes, identity); restoreOwnedSourceState(restored, bytes, identity); expect(render(restored, 8192)).to.deep.equal(render(first, 8192));
  });
  it('keeps two same-pitch journey bodies independent when only one has observed input', () => {
    const kernel = moving(); submit(kernel, [packet(BEGIN, 0, 1), packet(BEGIN, 0, 2, { 4: 1, 5: 2 }), position(0, 2048, 3)]); render(kernel, 1000);
    const voices = kernel.source.inspect().voices; expect(voices).to.have.length(2); expect(voices.find(voice => voice.slot === 0).body.maximumObservedInputPeak).to.be.greaterThan(0); expect(voices.find(voice => voice.slot === 1).body.maximumObservedInputPeak).to.equal(0);
    expect(results(kernel).filter(receipt => receipt[0] === APPLIED && receipt[1] <= 2)).to.have.length(2);
  });
  it('stops a violated normalized input contract without erasing the already excited body', () => {
    const profile = prepareSampleBodyProfile({ graftModeCount: 4, graftExcitationMode: 1 }, 48000), state = new Float64Array(OWNED_SAMPLE_STATE_WIDTH), body = new OwnedSampleBody(profile, state, OWNED_SAMPLE_STATE_WIDTH, 1); body.begin(0, 440, packet(BEGIN, 0, 1), 0);
    body.sample(0, 0, 0.8, -0.4, true); body.sample(0, 1, 1.1, 0, true); expect(body.inspect(0, 2).calibrationExceeded).to.equal(true); let amplitude = 0;
    for (let frame = 2; frame < 100; frame++) { body.sample(0, frame, 0, 0, true); amplitude += Math.abs(body.left) + Math.abs(body.right); } expect(amplitude).to.be.greaterThan(0); expect(body.inspect(0, 100).maximumObservedInputPeak).to.be.at.most(1);
    body.validate(0, index => state[index]);
  });
  it('retains a canonical release frontier after a finite body has expired and accepts the exact damping endpoint', () => {
    const profile = prepareSampleBodyProfile({ graftModeCount: 4 }, 48000), state = new Float64Array(OWNED_SAMPLE_STATE_WIDTH), body = new OwnedSampleBody(profile, state, OWNED_SAMPLE_STATE_WIDTH, 1);
    body.begin(0, 440, packet(BEGIN, 0, 1, { 35: 0.02, 36: 1 }), 0); expect(() => body.validate(0, index => state[index])).not.to.throw();
    const last = profile.supportFrames + profile.maximumTailFrames + 100; body.sample(0, last, 0, 0); body.release(0, 64, last + 1, false, last + 1000);
    expect(() => body.validate(0, index => state[index], { released: true, releaseFrame: last + 1 })).not.to.throw();
  });
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
      expect(patch.macros.map(macro => macro.name)).to.deep.equal(['EXCITE', 'BODY', 'DAMP', 'MIX'].sort()); expect(recipe.contract.graft.articulationPolicy).to.include('one-semantic-source');
      expect(() => prepareFeedforwardGraftDescriptor({ ...recipe.contract.graft, exciterRef: { port: 'detector-envelope', assetHash: hash } })).to.throw('detector envelopes');
    }
    const traversalBinding = createMotionBodyTraversalBinding(sampleTravelGraph().instruments[0], { framesPerWorldPixel: 20 }), movingRecipe = await createSoundSeedGraftRecipe({ manifest, assetHash: hash, byteLength: 100000, pitch: { mode: 'pitched', rootCents: 6000 }, graftBody: 'wood', transform: 'motion-body-graft', traversalBinding });
    const result = await compileSoundContent(movingRecipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) }), definition = result.prepared.patches[0].definition;
    expect(definition.parameters.graftExcitationMode).to.equal(1); expect(definition.sampleMap.zones[0].playbackMode).to.equal('positionDriven'); expect(definition.sampleMap.zones[0].positionPolicy.traversal).to.deep.equal(traversalBinding); expect(movingRecipe.contract.graft.requiredCapabilities).to.include('feedforwardMotionBody');
    expect(() => prepareObservedMotionGraftDescriptor({ ...movingRecipe.contract.graft, exciterRef: { port: 'detector-envelope', assetHash: hash } })).to.throw('Detector');
    expect(() => createMotionBodyTraversalBinding({ ...sampleTravelGraph().instruments[0], route: 'midi' })).to.throw('actual local');
  });
});
