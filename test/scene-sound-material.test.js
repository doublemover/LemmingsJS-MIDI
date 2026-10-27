import { expect } from 'chai';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { createPerformanceSceneWorldAdapter } from '../js/app/procgen/workstation/PerformanceSceneWorldAdapter.js';
import { validatePerformanceScene, performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createSoundSeedRecipe } from '../js/midi/content/SoundSeedRecipe.js';
import { compileSoundContent } from '../js/midi/content/SoundContentCompiler.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../js/app/procgen/ProcgenRetirement.js';
import { WAVE_SOURCE_DECODER_VERSION } from '../js/app/midi-ui/WaveSourceProfile.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const h = value => value.repeat(64), refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
describe('scene source-rate PCM pin preparation (authored unrun; audible scene qualification pending)', function() {
  this.timeout(120000); let descriptors, scene, recipe, preflight, sceneHash, masks, reference;
  const getCatalog = async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors });
  before(async () => {
    descriptors = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-sample'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog }), base = catalog.registry.resolve(catalog.registry.page().rows[0]); recipe = catalog.getRecipe(base);
    const seed = await createSoundSeedRecipe({ manifest: { schema: 'lemmings-sound-seed/v1', frames: 128, sampleRate: 44100, bakedEffects: 'none-declared', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ completeParentArtifactHash: h('c'), takeId: 'scene-fixture', takeRevision: 1, parentManifestHash: h('d'), immutableSourceRef: 'master-fixture' }] }, assetHash: h('f'), byteLength: 1100 }), compiled = await compileSoundContent(seed.source, { targets: [{ descriptor: descriptors[1] }] }), patch = compiled.prepared.patches[0];
    reference = { schema: 'lemmings-sound-reference/v1', packHash: compiled.prepared.contentHash, patchId: patch.definition.id, revision: patch.definition.revision, definitionHash: patch.definitionHash, definition: patch.archivedDefinition, engineRequirement: patch.engineRequirement, assetHashes: patch.dependencies };
    scene = validatePerformanceScene({ ...base, id: 'scene.sample-pins.fixture', patchRefs: [{ ...base.patchRefs[0], reference }, ...base.patchRefs.slice(1)] }); sceneHash = await performanceSceneHash(scene); preflight = await checkPerformanceSceneRequirements(scene, { resolveDependency: async dependency => ({ ...dependency, status: 'available', storage: 'pinned-external' }) }); masks = await loadProcgenMasks();
  });
  const fixture = ({ noProvider = false, wrongRate = false, inactive = false, stale = false, unknownRelease = false } = {}) => {
    const budget = createResourceBudget(), events = []; let current = true, world = null, committed = false, alive = true, acquisitions = 0;
    const buffer = { sampleRate: wrongRate ? 48000 : 44100, length: 128, numberOfChannels: 2 }, pin = { ref: { contentHash: h('f'), bytes: 1100, sourceSampleRate: 44100, frames: 128, channels: 2 }, variant: { contentHash: h('f'), targetSampleRate: wrongRate ? 48000 : 44100, decoderVersion: WAVE_SOURCE_DECODER_VERSION }, buffer, isActive: () => alive && !inactive }, scope = createProcgenRetirementScope();
    const provider = { async acquire(options) { acquisitions++; events.push(['acquire', options.decodeProfile]); if (stale) current = false; return { assets: [pin], availableHashes: reference.assetHashes, release() { events.push(['material-release']); return scope.retire([{ name: 'fixture-source-pin', run: () => { if (unknownRelease) throw new Error('Pin reader unknown'); alive = false; } }]); } }; } };
    const adapter = createPerformanceSceneWorldAdapter({ resourceBudget: budget, getCatalog, getMaterialProvider: noProvider ? null : () => provider, getOrigin: () => ({ schema: 'lemmings-performance-scene-origin/v1', manifest: scene, sceneHash, recipe, variants: [] }),
      prepareWorld: async input => { events.push(['world']); const value = input.sceneRecipe; world = new ProcgenLaneWorld({ masks, laneCount: value.settings.laneCount, laneHeight: value.settings.laneHeight, seed: value.settings.seed }); world.configurePhysicalAuthoring(value.project.procgen.physicalGraph, []);
        return { world, isCurrent: () => !committed, commit({ isCurrent }) { isCurrent(); committed = true; events.push(['commit']); }, retire() { events.push(['world-retire']); if (!committed) world.dispose(); return createProcgenRetirementScope().retire([]); } };
      } });
    return { budget, events, prepare: () => adapter({ scene, preflight, baseIdentity: 'scene-doc:1', isCurrent: () => current }), isPinned: () => alive, acquisitions: () => acquisitions, world: () => world };
  };
  it('holds exact 44.1k source pins without audio-context decoding until a fenced paused commit and candidate retirement', async () => {
    const f = fixture(), candidate = await f.prepare(); expect(f.acquisitions()).to.equal(1); expect(f.events[0]).to.deep.equal(['acquire', 'source-pcm']); expect(f.isPinned()).to.equal(true); expect(candidate.admission.materials[0]).to.include({ decodedSourceBytes: 1024, verifiedDependencyCount: 2 }); expect(candidate.admission.materials[0].playbackSampleHashes).to.deep.equal([h('f')]); expect(f.world().tickIndex).to.equal(0);
    expect(candidate.commit({ policy: 'stopped-replacement', isCurrent: () => true }).localAudioEnabledByScene).to.equal(false); expect(f.isPinned()).to.equal(true); const retired = candidate.retire(); await retired.completion; expect(retired.outcome).to.equal('complete'); expect(f.isPinned()).to.equal(false); expect(f.events.slice(-2)).to.deep.equal([['world-retire'], ['material-release']]); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.world().dispose();
  });
  it('does not accept metadata alone, stale owners, dead pins or device-rate PCM as prepared source material', async () => {
    for (const [options, code] of [[{ noProvider: true }, 'scene-asset-adapter-unavailable'], [{ stale: true }, 'stale-scene-operation'], [{ inactive: true }, 'scene-material-pin-unbound'], [{ wrongRate: true }, 'scene-material-pin-unbound']]) {
      const f = fixture(options), error = await refused(() => f.prepare()); expect(error.code).to.equal(code); expect(f.world()).to.equal(null); if (!options.noProvider) expect(f.isPinned()).to.equal(false); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    }
  });
  it('retires an unpublished world before dropping its pins and keeps the plan charged on unknown material retirement', async () => {
    for (const unknownRelease of [false, true]) {
      const f = fixture({ unknownRelease }), candidate = await f.prepare(), retired = candidate.retire(); await retired.completion; expect(f.events.slice(-2)).to.deep.equal([['world-retire'], ['material-release']]); if (unknownRelease) { expect(retired.outcome).not.to.equal('complete'); expect(f.isPinned()).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); } else { expect(retired.outcome).to.equal('complete'); expect(f.isPinned()).to.equal(false); expect(f.budget.diagnostics().accountedBytes).to.equal(0); }
    }
  });
});
