import { expect } from 'chai';
import { createInstrumentNurseryScore } from '../js/app/procgen/workstation/InstrumentNurseryScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { hashDataText } from '../js/core/CanonicalData.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64);
describe('Instrument Nursery original pair (authored unrun; physical/audio qualification pending)', function() {
  this.timeout(120000); let engines, item, masks;
  before(async () => { engines = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-texture', 'worklet-wind'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); item = await createInstrumentNurseryScore({ sourceHash: h('b'), textureDescriptor: engines.find(engine => engine.engineId === 'worklet-texture'), windDescriptor: engines.find(engine => engine.engineId === 'worklet-wind') }); masks = await loadProcgenMasks(); });
  it('installs exact procedural body/template ancestry with two finite routes and four existing atomic macros', async () => {
    const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: engines }) }), row = catalog.registry.findSupported({ id: item.scene.id }); expect(row).not.to.equal(null);
    expect(catalog.registry.resolve(row)).to.deep.equal(item.scene); expect((await checkPerformanceSceneRequirements(item.scene, { resolveDependency: catalog.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await catalog.origin(item.scene), { sourceHash: h('b') });
    for (const asset of item.embeddedAssets) { const retained = catalog.getEmbeddedAsset(asset.hash); expect(retained.text).to.equal(asset.text); expect(await hashDataText(retained.text)).to.equal(asset.hash); }
    expect(item.recipe.initialReleaseGesture.finiteBurstCount).to.equal(2); expect(item.scene.cost).to.include({ lanes: 2, maximumVoices: 10, sharedBodies: 0 }); expect(item.scene.physicalControls.map(control => control.id)).to.deep.equal(['excite', 'body', 'damp', 'mix']); expect(item.scene.patchRefs.map(patch => patch.reference.definition.engineId)).to.deep.equal(['worklet-texture', 'worklet-wind']); expect(item.scene.patchRefs.every(patch => patch.reference.assetHashes.length === 0)).to.equal(true); expect(item.scene.initialTransport.playing).to.equal(false);
    expect(item.scene.description).to.include('asset-pin adapter'); expect(item.scene.description).to.include('qualification remain pending'); expect(item.scene.patchRefs.every(patch => patch.reference.definition.parameters.graftModeCount === 6)).to.equal(true);
  });
  const trace = async ({ paused = false, mix = 0.5 } = {}) => {
    const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'nursery-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 2), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2, laneHeight: 128, speed: 2, populationPolicy: item.recipe.settings.populationPolicy, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } }); world.configurePhysicalAuthoring(item.scene.causalMappings, []);
    const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings, getOnsetControls: () => ({ macros: { mix } }) }), facts = [], intents = [], motion = [];
    world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') motion.push([batch.tick, fact.actorId, fact.positionBefore, fact.positionAfter]); });
    try { for (let tick = 0; tick < 1200; tick++) world.step(); return { facts, intents, motion }; }
    finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
  it('authors actual travel, non-spawn flight, actor ownership and empty-world silence fixtures', async () => {
    const observed = await trace(), empty = await trace({ paused: true }); expect(observed.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(2); expect(empty.intents).to.have.length(0); expect(observed.facts.some(fact => fact.kind === 'FlightArcStarted' && fact.source !== 'spawn-fall' && fact.laneId === 1)).to.equal(true);
    const facts = new Map(observed.facts.map(fact => [fact.eventId, fact])), beginnings = observed.intents.filter(intent => intent.kind === 'begin'); expect(beginnings.length).to.be.greaterThan(0);
    for (const intent of beginnings) expect(intent.sourceEventIds.some(id => facts.has(id))).to.equal(true);
    const travel = beginnings.filter(intent => intent.mappingId === 'nursery-tin-travel'); expect(travel).to.have.length(1); const flights = beginnings.filter(intent => intent.mappingId === 'nursery-glass-flight'); expect(flights.length).to.be.greaterThan(0); for (const intent of flights) expect(intent.sourceEventIds.some(id => facts.get(id)?.kind === 'FlightArcStarted' && facts.get(id).source !== 'spawn-fall')).to.equal(true);
  });
  it('authors dry/body macro comparisons that preserve the physical trace and canonical source/pitch sequence', async () => {
    const dry = await trace({ mix: 0 }), body = await trace({ mix: 1 }); expect(dry.motion).to.deep.equal(body.motion); expect(dry.intents.map(intent => [intent.kind, intent.sourceEventIds, intent.pitch])).to.deep.equal(body.intents.map(intent => [intent.kind, intent.sourceEventIds, intent.pitch]));
  });
});
