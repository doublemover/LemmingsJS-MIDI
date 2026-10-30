import { expect } from 'chai';
import { createInstrumentNurseryScore } from '../js/app/procgen/workstation/InstrumentNurseryScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { bakeFiniteFmExcitation } from '../js/app/resources/FiniteFmExcitation.js';
import { createFiniteFmBodyGraftRecipe } from '../js/midi/content/FiniteFmBodyGraftRecipe.js';
import { compileSoundContent } from '../js/midi/content/SoundContentCompiler.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { hashData } from '../js/core/CanonicalData.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), refused = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
describe('three-template Nursery from an exact prepared finite strike (authored unrun)', function() {
  this.timeout(120000); let engines, strike, options, item, masks;
  const getCatalog = async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: engines });
  before(async () => {
    engines = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-texture', 'worklet-wind', 'worklet-sample'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') })));
    const parentManifest = { schema: 'lemmings-sound-seed/v1', revision: 'fixture-v1', frames: 128, sampleRate: 44100, channels: 2, tap: 'post-protection-shared-browser-master', bakedEffects: 'none-declared', bakedCausePolicy: 'baked-only;no-new-semantic-events', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ completeParentArtifactHash: h('c'), takeId: 'nursery-material', takeRevision: 1, parentManifestHash: h('d'), immutableSourceRef: 'master-fixture', originKind: 'LIVE CAPTURE', sourceTap: 'post-protection-shared-browser-master' }] }, material = await bakeFiniteFmExcitation({ parentManifest, parentAssetHash: h('c'), sampleRate: 48000 }, { estimatedPeakBytes: 32 * 1048576 }), recipe = await createFiniteFmBodyGraftRecipe({ manifest: material.manifest, assetHash: material.assetHash, byteLength: material.bytes.length, graftBody: 'wood', pitch: { mode: 'pitched', rootCents: 6000 } }), compiled = await compileSoundContent(recipe.source, { targets: [{ descriptor: engines.find(engine => engine.engineId === 'worklet-sample') }] }), patch = compiled.prepared.patches[0];
    strike = { schema: 'lemmings-sound-reference/v1', packHash: compiled.prepared.contentHash, patchId: patch.definition.id, revision: patch.definition.revision, definitionHash: patch.definitionHash, definition: patch.archivedDefinition, engineRequirement: patch.engineRequirement, assetHashes: patch.dependencies }; options = { sourceHash: h('b'), textureDescriptor: engines.find(engine => engine.engineId === 'worklet-texture'), windDescriptor: engines.find(engine => engine.engineId === 'worklet-wind'), sampleDescriptor: engines.find(engine => engine.engineId === 'worklet-sample'), strikeReference: strike }; item = await createInstrumentNurseryScore(options); masks = await loadProcgenMasks();
  });
  it('retains the exact strike/calibration/sample map and adds only an actual safe-landing route', async () => {
    expect(item.scene.cost).to.include({ lanes: 3, maximumVoices: 12, sharedBodies: 0 }); expect(item.scene.patchRefs[2].reference).to.deep.equal(strike); expect(item.scene.patchRefs[2].reference.definition.parameters.graftSupportSeconds).to.equal(0.012); expect(item.recipe.initialReleaseGesture.finiteBurstCount).to.equal(3); expect(item.recipe.initialTerrainLayout.lanes[2].regions[1].x2).to.equal(208);
    const mapping = item.scene.causalMappings.instruments[2]; expect(mapping).to.include({ sourceKind: 'FlightArc', role: 'finite-exciter-private-body' }); expect(mapping.response).to.include({ sustain: false, landingStrike: true, terminalStrike: false, spawnPolicy: 'exclude-spawn' }); expect(item.scene.description).to.include('explicit half-second preview tail'); expect(item.scene.initialTransport.playing).to.equal(false);
    const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog }), first = await catalog.addNurseryStrike(strike), again = await catalog.addNurseryStrike(strike); expect(again).to.equal(first); expect(catalog.registry.resolve(first)).to.deep.equal(item.scene); expect((await checkPerformanceSceneRequirements(item.scene, { resolveDependency: catalog.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await catalog.origin(item.scene), { sourceHash: h('b') });
    expect((await createInstrumentNurseryScore({ ...options, strikeReference: { ...strike, packHash: h('e') } })).scene.id).not.to.equal(item.scene.id);
  });
  it('refuses ungrafted, travel, looped or changed-build source references before constructing a score', async () => {
    const alter = async change => { const definition = structuredClone(strike.definition); change(definition); return { ...strike, definition, definitionHash: await hashData(definition) }; };
    for (const reference of [await alter(definition => { definition.parameters.graftModeCount = 0; }), await alter(definition => { definition.parameters.graftExcitationMode = 1; }), await alter(definition => { definition.sampleMap.zones[0].loop = { firstFrame: 0, endFrame: 32 }; })]) expect((await refused(() => createInstrumentNurseryScore({ ...options, strikeReference: reference }))).message).to.include('Choose an installed finite');
    expect((await refused(() => createInstrumentNurseryScore({ ...options, strikeReference: { ...strike, definitionHash: h('e') } }))).message).to.include('immutable hash'); expect((await refused(() => createInstrumentNurseryScore({ ...options, strikeReference: { ...strike, engineRequirement: { ...strike.engineRequirement, artifactHash: h('e') } } }))).message).to.include('current-build');
  });
  it('bounds dynamic strike scores and rejects canceled preparation without changing the active world', async () => {
    const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog }); for (let index = 1; index <= 8; index++) await catalog.addNurseryStrike({ ...strike, packHash: String(index).repeat(64) }); expect((await refused(() => catalog.addNurseryStrike({ ...strike, packHash: h('e') }))).message).to.include('at most eight'); const controller = new AbortController(); controller.abort(); expect((await refused(() => catalog.addNurseryStrike(strike, { signal: controller.signal }))).name).to.equal('AbortError');
  });
  it('authors a real three-actor trace with no phantom strike while actors are absent', async () => {
    for (const paused of [false, true]) {
      const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'nursery-strike-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 3), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare(); const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 3, laneHeight: 128, speed: 2, populationPolicy: item.recipe.settings.populationPolicy, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } }); world.configurePhysicalAuthoring(item.scene.causalMappings, []);
      const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }), facts = [], intents = []; world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); });
      try {
        for (let tick = 0; tick < 1200; tick++) world.step(); if (paused) { expect(intents).to.have.length(0); continue; } expect(facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(3); const roots = new Map(facts.map(fact => [fact.eventId, fact])), strikes = intents.filter(intent => intent.kind === 'begin' && intent.mappingId === 'nursery-strike-landing'); expect(strikes.length).to.be.greaterThan(0); for (const intent of strikes) expect(intent.sourceEventIds.some(id => roots.get(id)?.kind === 'FlightArcEnded' && roots.get(id).source !== 'spawn-fall' && roots.get(id).laneId === 2)).to.equal(true);
      } finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
    }
  });
});
