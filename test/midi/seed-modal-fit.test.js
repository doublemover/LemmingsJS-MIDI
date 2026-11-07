import { expect } from 'chai';
import { fitSoundSeedModes } from '../../js/app/resources/SeedModalFit.js';
import { createSoundSeedModalRecipe } from '../../js/midi/content/SoundSeedModalRecipe.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';
import { OwnedRadix2FFT } from '../../js/app/midi-ui/worklet/OwnedRadix2FFT.js';

const hash = 'a'.repeat(64);
const fixture = ({ frequencies = [750], decays = [0.7], frames = 48000, amplitude = 0.3, antiPhase = false, noise = 0 } = {}) => {
  const sampleRate = 48000, pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer); let seed = 12345;
  for (let frame = 0; frame < frames; frame++) {
    let value = 0;
    for (let mode = 0; mode < frequencies.length; mode++) value += amplitude / (mode + 1) * Math.exp(-Math.log(1000) * frame / sampleRate / decays[mode]) * Math.cos(2 * Math.PI * frequencies[mode] * frame / sampleRate + 0.4);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += ((seed / 4294967296) * 2 - 1) * noise;
    view.setFloat32(frame * 8, value, true); view.setFloat32(frame * 8 + 4, antiPhase ? -value : value * 0.7, true);
  }
  const manifest = { schema: 'lemmings-sound-seed/v1', frames, sampleRate, tap: 'fixture-frozen-contact', bakedEffects: 'none-declared', bakedCausePolicy: 'current-onset-distinct-from-baked-ancestry',
    coverage: { status: 'known-material', gaps: [] }, statistics: { silence: amplitude === 0, clippedSamples: 0 }, ancestry: [{ completeParentArtifactHash: 'b'.repeat(64), takeId: null, takeRevision: null,
      parentManifestHash: 'c'.repeat(64), immutableSourceRef: 'parent-contact', originKind: 'LIVE CAPTURE', sourceTap: 'post-protection-master' }] };
  return { manifest, input: { pcm, originBytes: canonicalDataText(manifest).bytes, source: { formatVersion: manifest.schema, sourceFrames: frames, sampleRate, immutableSourceRef: hash },
    firstFrame: 0, endFrame: frames, sampleRate, generation: 1, options: { observationFrames: Math.min(frames, 32768), fftSize: 65536, maxModes: 4 } } };
};
const analyze = input => fitSoundSeedModes(input, { estimatedPeakBytes: 256 * 1048576, yieldControl: async () => {} });
const rejected = async (promise, message) => { let error; try { await promise; } catch (caught) { error = caught; } expect(error?.message).to.include(message); };

describe('inspectable stereo modal estimation (numerical and listening qualification deferred)', () => {
  it('estimates a known damped mode, amplitude T60 and stereo phase while retaining its actual residual', async () => {
    const { input } = fixture({ antiPhase: true }), result = (await analyze(input)).value, mode = result.estimate.modes.find(mode => Math.abs(mode.frequencyHz - 750) < 2);
    expect(mode).not.to.equal(undefined); expect(mode.frequencyHz).to.be.closeTo(750, 1); expect(mode.t60Seconds).to.be.closeTo(0.7, 0.12);
    expect(mode.confidence.physicalMaterialInference).to.equal(false); expect(Math.cos(mode.channels[0].phase - mode.channels[1].phase)).to.be.closeTo(-1, 1e-6);
    expect(result.estimate.neutralComplementMaximumError).to.be.lessThan(1e-6); expect(result.estimate.relativeModelRmsError).to.be.lessThan(0.4);
    expect(result.recipe).to.include({ observationFrames: 32768, fftSize: 65536, zeroPaddingFrames: 32768, rootPitch: 'not-inferred' });
    expect(result.components.map(component => component.kind)).to.deep.equal(['modal-reconstruction', 'modal-residual']);
  });
  it('reports unresolved observation limits independently of FFT padding', async () => {
    const { input } = fixture({ frequencies: [440, 446], decays: [4, 3] }); input.options = { observationFrames: 2048, fftSize: 65536, maxModes: 8 };
    const result = (await analyze(input)).value;
    expect(result.recipe.resolutionHz).to.equal(2 * 48000 / 2048); expect(result.recipe.observationSeconds).to.equal(2048 / 48000);
    for (const mode of result.estimate.modes) expect(mode.confidence.closeModes).to.equal('not-guaranteed-resolved-below-observation-resolution');
  });
  it('declines silence and growing tracks and labels clipped observations separately', async () => {
    const silent = (await analyze(fixture({ amplitude: 0 }).input)).value;
    expect(silent.estimate).to.include({ status: 'declined', silence: true }); expect(silent.estimate.modes).to.have.length(0);
    const growing = (await analyze(fixture({ amplitude: 0.05, decays: [-8] }).input)).value;
    expect(growing.estimate.modes).to.have.length(0); expect(growing.estimate.declined.some(mode => mode.reason === 'nondecaying-or-growing-track')).to.equal(true);
    const clipped = (await analyze(fixture({ amplitude: 2 }).input)).value;
    expect(clipped.estimate.clippedSamples).to.be.greaterThan(0); expect(clipped.estimate.modes.every(mode => mode.confidence.level === 'low')).to.equal(true);
  });
  it('keeps explicit pinned modes and manual edits under a new fit receipt', async () => {
    const { input } = fixture(); input.options.pinnedModes = [{ id: 'chosen-mode', frequencyHz: 750, t60Seconds: 0.8, pinned: true }];
    const result = (await analyze(input)).value, chosen = result.estimate.modes.find(mode => mode.id === 'chosen-mode');
    expect(chosen).to.include({ frequencyHz: 750, t60Seconds: 0.8, pinned: true }); expect(chosen.confidence.level).to.equal('manual-selection;not-inferred-certainty');
    await rejected(analyze({ ...input, options: { ...input.options, manualModes: [{ id: 'bad', frequencyHz: 750, t60Seconds: -1, pinned: true }] } }), 'T60');
    const controller = new AbortController(); controller.abort(new Error('canceled modal fixture'));
    await rejected(fitSoundSeedModes(input, { signal: controller.signal, estimatedPeakBytes: 256 * 1048576 }), 'canceled modal fixture');
  });
  it('requires an explicit reference for a new modal body and refuses unsupported decay without clamping', async () => {
    const { input, manifest } = fixture(), result = (await analyze(input)).value;
    const modalFit = { parentAssetHash: hash, recipe: result.recipe, estimate: result.estimate };
    const options = { manifest, assetHash: hash, byteLength: input.pcm.length + 1000, modalFit, pitch: { mode: 'pitched', rootCents: 6900 } };
    const recipe = await createSoundSeedModalRecipe(options), descriptors = await describeNativeInstrumentEngines([{ engineId: 'native-modal', engineVersion: 1, artifactHash: 'd'.repeat(64) }]);
    const compiled = await compileSoundContent(recipe.source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    expect(compiled.prepared.patches[0].definition.engineId).to.equal('native-modal'); expect(compiled.prepared.patches[0].definition.sampleRefs).to.have.length(0);
    expect(recipe.contract.playbackMeaning).to.include('new-excitation'); expect(recipe.source.files[0].sha256).to.equal(hash);
    await rejected(createSoundSeedModalRecipe({ ...options, pitch: { mode: 'unpitched' } }), 'declare a root');
    const changed = structuredClone(modalFit); changed.estimate.modes[0].t60Seconds = 4;
    await rejected(createSoundSeedModalRecipe({ ...options, modalFit: changed }), 'no hidden decay');
  });
  it('keeps larger FFT preparation behind an explicit offline bound', () => {
    expect(() => new OwnedRadix2FFT(65536)).to.throw('unavailable'); expect(new OwnedRadix2FFT(65536, { offlineMaximumSize: 65536 }).size).to.equal(65536);
    expect(() => new OwnedRadix2FFT(131072, { offlineMaximumSize: 65536 })).to.throw('unavailable');
  });
});
