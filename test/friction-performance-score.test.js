import { expect } from 'chai';
import { createFrictionPerformanceScore } from '../js/app/procgen/workstation/FrictionPerformanceScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { planFrictionTravel } from '../js/midi/content/FrictionTravel.js';
import { sampleMotionBatch } from './helpers/sampleTraversal.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), descriptors = () => describeNativeInstrumentEngines(['worklet-sine', 'worklet-friction'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') })));
describe('Bow Orchard authored score (runtime/browser/listening qualification deferred)', function() {
  this.timeout(60000);
  it('pins the two original bodies, long route, finite cohort, manual policy and complete source closure', async () => {
    const entries = await descriptors(), catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: entries }) }), scene = catalog.registry.resolve(catalog.registry.page({ limit: 64 }).rows.find(row => row.id === 'bow-orchard'));
    expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: catalog.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await catalog.origin(scene), { sourceHash: h('b') });
    const recipe = catalog.getRecipe(scene); expect(recipe.initialTerrainLayout.width).to.equal(1024); expect(recipe.assistPolicy).to.equal('manual-only'); expect(recipe.initialReleaseGesture.finiteBurstCount).to.equal(2); expect(scene.initialTransport.playing).to.equal(false);
    expect(scene.patchRefs.map(patch => patch.reference.definition.parameters.frictionKind)).to.deep.equal([0, 1]); expect(scene.patchRefs.every(patch => patch.reference.definition.sampleRefs.length === 0 && patch.reference.definition.macros.length === 1)).to.equal(true); expect(scene.causalMappings.instruments.every(value => value.articulation.sustain && value.articulation.lifetimeScope === 'actorJourney')).to.equal(true);
  });
  it('does not install an approximate replacement when the required source is absent', async () => {
    const entries = (await descriptors()).filter(value => value.engineId !== 'worklet-friction'), catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: entries }) }); expect(catalog.registry.page({ limit: 64 }).rows.some(row => row.id === 'bow-orchard')).to.equal(false);
    let error; try { await createFrictionPerformanceScore({ sourceHash: h('b'), descriptor: entries[0] }); } catch (value) { error = value; } expect(error?.message).to.include('Bow Orchard');
  });
  it('keeps one body through committed motion, stationary coverage and reversal', async () => {
    const item = await createFrictionPerformanceScore({ sourceHash: h('b'), descriptor: (await descriptors()).find(value => value.engineId === 'worklet-friction') }), engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }), intents = [];
    for (const [index, [from, to]] of [[0, 8], [8, 16], [16, 16], [16, 8]].entries()) intents.push(...engine.processBatch(sampleMotionBatch(index + 1, from, to, { physicalPayload: { pathEvidence: 'committed-coordinate-write', contactObserved: false } })));
    expect(intents.filter(intent => intent.kind === 'begin')).to.have.length(1); const travel = intents.filter(intent => intent.articulationState?.travel).map((intent, index) => planFrictionTravel(item.scene.patchRefs[0].reference.definition.parameters, intent, index * 2880, 48000)); expect(travel.some(value => value.from === value.to)).to.equal(true); expect(travel.some(value => value.to < value.from)).to.equal(true); expect(new Set(travel.map(value => value.ownerIdentity)).size).to.equal(1); engine.dispose();
  });
  it('authors the actual compiled-source physics and reverse observation acceptance fixture', async () => {
    const item = await createFrictionPerformanceScore({ sourceHash: h('b'), descriptor: (await descriptors()).find(value => value.engineId === 'worklet-friction') }), budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 2), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs });
    await terrain.prepare(); const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), terrain, laneCount: 2, laneHeight: 96, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: item.recipe.initialReleaseGesture, stallPolicy: { secondsWithoutProgress: 1000 } }), engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }); const facts = [], intents = [];
    world.configurePhysicalAuthoring(item.scene.causalMappings, []); world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); });
    try { for (let tick = 0; tick < 1000; tick++) world.step(); expect(facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(2); expect(facts.some(fact => fact.kind === 'MotionCommitted' && fact.positionBefore.x > 800 && fact.positionAfter.x < fact.positionBefore.x)).to.equal(true); const begins = intents.filter(intent => intent.kind === 'begin'); expect(begins).to.have.length(2); expect(new Set(begins.map(intent => intent.actorId)).size).to.equal(2); }
    finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
});
