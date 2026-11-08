import { expect } from 'chai';
import { freezeData, hashData } from '../../js/core/CanonicalData.js';
import { createOriginalAcousticMap } from '../../js/midi/content/OriginalAcousticMap.js';
import { validateMaterialResponseMap } from '../../js/midi/content/MaterialResponseMap.js';
import { validateSpatialPerformance } from '../../js/midi/content/SpatialPerformance.js';
import { createSoundSeedWarpRecipe } from '../../js/midi/content/SoundSeedWarpRecipe.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

const h = value => value.repeat(64);
describe('mutable preparation and immutable spatial/sound publication (#1270)', () => {
  it('admits and orders independent material selectors repeatedly without mutating the authored map', () => {
    const source = freezeData({ schema: 'lemmings-material-response-map/v1', id: 'audit-map', revision: 1, neutralPatchId: 'material.unclassified',
      entries: [{ selector: 'tag', value: 'slate', patchId: 'material.slate' }, { selector: 'materialId', value: 'timber', patchId: 'material.timber' }], articulation: 'hard', site01: 0.5 });
    const first = validateMaterialResponseMap(source), second = validateMaterialResponseMap(source);
    expect(first.entries.map(entry => entry.selector)).to.deep.equal(['materialId', 'tag']); expect(second).to.deep.equal(first);
    expect(source.entries.map(entry => entry.selector)).to.deep.equal(['tag', 'materialId']); expect(Object.isFrozen(first.entries[0])).to.equal(true);
    expect(() => validateMaterialResponseMap({ ...source, entries: [source.entries[0], source.entries[0]] })).to.throw('distinct');
  });
  it('admits repeated immutable prepared-map receipts and keeps failed retries separate from admitted evidence', async () => {
    const definition = createOriginalAcousticMap(), source = freezeData({ schema: 'lemmings-spatial-performance/v1', worldId: 'audit-world', generation: 1, sourceTick: 1, sourceTimeMs: 20, sourceTickDurationMs: 20,
      executionEpoch: null, sampleRate: null, acousticReceipt: false, kind: 'map', status: 'prepared', mapHash: await hashData(definition), definition });
    const first = validateSpatialPerformance(source); expect(validateSpatialPerformance(source)).to.deep.equal(first); expect(first.definition).to.deep.equal(definition); expect(Object.isFrozen(first.definition)).to.equal(true);
    expect(() => validateSpatialPerformance({ ...source, acousticReceipt: true })).to.throw('evidence'); expect(validateSpatialPerformance(source)).to.deep.equal(first);
    expect(source.definition).to.equal(definition);
  });
  it('derives and compiles the exact frozen streaming seed repeatedly without mutating its source or warp plan', async () => {
    const manifest = freezeData({ schema: 'lemmings-sound-seed/v1', frames: 24000, sampleRate: 48000, bakedEffects: 'none-declared', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ completeParentArtifactHash: h('b'), takeId: 'audit', takeRevision: 1, parentManifestHash: h('c'), immutableSourceRef: 'audit-master' }] });
    const warpPlan = freezeData({ schema: 'lemmings-buffered-warp-plan/v1', assetHash: h('a'), sourceRate: 48000, sourceFrames: 24000, sourceFrameRegion: [0, 24000], outputRate: 48000, rootPitch: { cents: 6000, referenceHz: 440 }, rateRatio: 1, pitchRatio: 1, formantPolicy: 'shift-with-pitch', loop: null, seekPolicy: 'reset-and-deterministic-preroll',
      algorithm: { id: 'fixture-owned-core', revision: 'fixture-v1', artifactHashes: [h('d')], configurationHash: h('e'), preparedRate: 48000, inputLatencyFrames: 256, outputLatencyFrames: 128, requiredPreparationLeadFrames: 1024, restoration: 'deterministicPreroll', qualification: 'unqualified' } });
    const input = { manifest, assetHash: h('a'), byteLength: 192044, warpPlan, pitch: { mode: 'pitched', rootCents: 6000 } }, before = JSON.stringify(input), first = await createSoundSeedWarpRecipe(input), second = await createSoundSeedWarpRecipe(input);
    expect(second).to.deep.equal(first); expect(JSON.stringify(input)).to.equal(before); expect(Object.isFrozen(first.source.recipes[0])).to.equal(true); expect(first.source.recipes[0].engine.id).to.equal('worklet-warp');
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-warp', engineVersion: 1, artifactHash: h('f') }]), compiled = await compileSoundContent(first.source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    expect(compiled.prepared.patches[0].definition.engineId).to.equal('worklet-warp'); expect(compiled.prepared.patches[0].definition.warpPlan).to.deep.equal(warpPlan);
    expect(compiled.qualification).to.equal('compiled-data-not-render-qualified');
  });
});
