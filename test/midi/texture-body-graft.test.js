import { expect } from 'chai';
import { SpatialTextureKernel } from '../../js/app/midi-ui/worklet/SpatialTextureKernel.js';
import { OwnedTextureSource } from '../../js/app/midi-ui/worklet/OwnedTextureProcessor.js';
import { validTextureBodyCommand, textureBodyCommandFields, prepareTextureBodyGraftDescriptor } from '../../js/midi/content/TextureBodyProfile.js';
import { createTextureBodyGraftRecipe, createTextureBodyTravelBinding } from '../../js/midi/content/TextureBodyGraftRecipe.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { hashDataText } from '../../js/core/CanonicalData.js';

const hash = 'a'.repeat(64), root = 261.6255653005986;
const binding = createTextureBodyTravelBinding({ id: 'ribbon', route: 'local', sourceKind: 'MotionCommitted', articulation: { sustain: true, lifetimeScope: 'actorJourney', metric: 'axis-projection', orientation: 'signedX', phaseMode: 'direction-reversing' } });
const origin = () => ({ schema: 'lemmings-sound-seed/v1', frames: 24000, sampleRate: 48000, bakedEffects: 'all-original-master-effects-and-protection', coverage: { status: 'known-material', gaps: [] }, statistics: { clippedSamples: 0, silence: false },
  ancestry: [{ completeParentArtifactHash: 'b'.repeat(64), takeId: 'take-a', takeRevision: 4, parentManifestHash: 'c'.repeat(64), immutableSourceRef: 'master-a', originKind: 'LIVE CAPTURE', sourceTap: 'post-protection-shared-browser-master' }] });
const options = () => ({ manifest: origin(), assetHash: hash, byteLength: 192064, pitch: { mode: 'pitched', rootCents: 6000 }, graftBody: 'tin', traversalBinding: binding });
const fields = (overrides = {}) => Object.assign(new Float64Array(80), textureBodyCommandFields({ graftModeCount: 2, graftMix01: 1, graftT60Seconds: 0.7, graftExcite01: 1, graftMode0Ratio: 1, graftMode1Ratio: 2.32, graftMode0PickupA: 0.7, graftMode0PickupB: -0.7, graftMode1PickupA: 0.3, graftMode1PickupB: 0.3, ...overrides }));
const rejected = async (promise, text) => { let failure; try { await promise; } catch (error) { failure = error; } expect(failure?.message).to.include(text); };

describe('spatial texture into a private calibrated modal body (runtime qualification deferred)', () => {
  it('keeps one source, gates external injection at rest and preserves a contractive body tail', () => {
    const kernel = new SpatialTextureKernel(48000); kernel.begin(0, 123, 0.4, 0.5, 0.5, 0.05, 0, 64, 0, 6000); expect(kernel.configureExternalBody(fields(), root)).to.equal(true);
    for (let frame = 0; frame < 6000; frame++) kernel.sample(frame);
    const energy = () => { let sum = 0; for (let mode = 0; mode < 2; mode++) for (let field = 4; field < 8; field++) sum += kernel.modes[mode * 8 + field] ** 2; return sum; };
    expect(energy()).to.be.greaterThan(0); let previous = energy(), peak = 0; const births = kernel.state[24];
    kernel.setSpan(64, 64, 6000, 10000);
    for (let frame = 6000; frame < 10000; frame++) { kernel.sample(frame); const next = energy(); expect(next).to.be.at.most(previous + 1e-25); previous = next; peak = Math.max(peak, Math.abs(kernel.leftSample)); }
    expect(peak).to.be.greaterThan(0); expect(kernel.state[24]).to.equal(births); expect(kernel.state[45]).to.equal(0); expect(kernel.state[47]).to.equal(root);
    kernel.end(10000); kernel.sample(10000); expect(energy()).to.be.lessThan(previous); expect(kernel.setSpan(64, 65, 10001, 11000)).to.equal(false);
  });
  it('keeps silent excitation silent, preserves old state on incompatible preparation and retires every private array', () => {
    const source = new OwnedTextureSource(48000, 1), packet = fields(); Object.assign(packet, { 18: 123, 19: 0, 20: 0.4, 21: 0, 22: 0.5, 23: 0.05, 34: 0, 35: 6000, 36: 0, 37: 0.5, 38: 1 });
    expect(source.begin(0, root, packet, 0)).to.equal(1);
    for (let frame = 0; frame < 6000; frame++) { source.sample(0, root, frame); expect(source.leftSample).to.equal(0); expect(source.rightSample).to.equal(0); }
    const state = source.state.slice(), modes = source.modes.slice(), bad = packet.slice(); bad[46] = 16; expect(source.begin(0, 2000, bad, 6000)).to.equal(0); expect(source.state).to.deep.equal(state); expect(source.modes).to.deep.equal(modes);
    source.retire(0); for (const array of [source.state, source.modes, source.pulses, source.observation]) expect(array.every(value => value === 0)).to.equal(true);
  });
  it('rejects detector/feedback ports, silent pickups and out-of-band modes before source mutation', () => {
    expect(() => prepareTextureBodyGraftDescriptor({ exciterRef: { port: 'detector-envelope', contentHash: hash } })).to.throw('incompatible');
    expect(validTextureBodyCommand(fields({ graftMode0PickupA: 0, graftMode0PickupB: 0, graftMode1PickupA: 0, graftMode1PickupB: 0 }), root, 48000)).to.equal(false);
    expect(validTextureBodyCommand(fields({ graftMode1Ratio: 16 }), 2000, 44100)).to.equal(false);
    expect(() => createTextureBodyTravelBinding({ id: 'poll', route: 'local', sourceKind: 'PositionPoll' })).to.throw('actual sustained');
  });
  it('compiles all four exciters with explicit EXCITE/BODY/DAMP/MIX and no audio sample playback', async () => {
    const targets = (await describeNativeInstrumentEngines([{ engineId: 'worklet-texture', engineVersion: 1, artifactHash: 'd'.repeat(64) }])).map(descriptor => ({ descriptor }));
    for (const textureKind of ['sand-drag', 'cloth-rub', 'crackle-skin', 'foam-air']) {
      const recipe = await createTextureBodyGraftRecipe({ ...options(), textureKind }), compiled = await compileSoundContent(recipe.source, { targets }), patch = compiled.prepared.patches[0];
      expect(patch.definition.sampleRefs).to.have.length(0); expect(patch.definition.sampleMap).not.to.exist; expect(patch.definition.engineId).to.equal('worklet-texture'); expect(patch.definition.parameters.graftModeCount).to.equal(6); expect(patch.definition.parameters.releaseSeconds).to.equal(4);
      expect(patch.definition.macros.map(macro => macro.name)).to.deep.equal(['EXCITE', 'BODY', 'DAMP', 'MIX'].sort()); expect(patch.dependencies).to.include.members([hash, recipe.contractHash]); expect(await hashDataText(recipe.contractText)).to.equal(recipe.contractHash);
      expect(recipe.contract.sourceMaterialRole).to.include('frozen-audio-not-played'); expect(recipe.contract.graft.transition).to.include('next-onset-only'); expect(recipe.source.realizationGroups[0].profiles).to.have.length(1);
    }
  });
  it('keeps the reviewed fitted body and its ancestry rather than silently clamping unsupported fits', async () => {
    const modalFit = { parentAssetHash: hash, recipe: { algorithmRevision: 'manual-reviewed-fit-v1', parentAssetHash: hash }, estimate: { modes: [{ frequencyHz: root, t60Seconds: 0.8, amplitude: 1 }, { frequencyHz: root * 2.17, t60Seconds: 0.2, amplitude: 0.4 }] } };
    const recipe = await createTextureBodyGraftRecipe({ ...options(), graftBody: 'fitted', modalFit }); expect(recipe.contract.body.analysis).to.deep.equal(modalFit); expect(recipe.source.recipes[0].components[1].parameters.graftMode1Ratio.value).to.equal(2.17);
    await rejected(createTextureBodyGraftRecipe({ ...options(), graftBody: 'fitted', modalFit: { ...modalFit, estimate: { modes: [{ frequencyHz: 20000, t60Seconds: 0.8, amplitude: 1 }] } } }), 'declared three-rate domain');
    await rejected(createTextureBodyGraftRecipe({ ...options(), pitch: { mode: 'unpitched' } }), 'Declare body tuning');
  });
});
