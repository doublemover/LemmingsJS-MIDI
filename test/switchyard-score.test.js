import { expect } from 'chai';
import { createSwitchyardScores, SWITCHYARD_ARRANGEMENTS } from '../js/app/procgen/workstation/SwitchyardScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { inspectSceneStationRehearsal } from '../js/app/procgen/workstation/SceneStationPolicy.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createPhysicalFeedbackController } from '../js/app/procgen/workstation/physical/PhysicalFeedback.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { configurePhysicalJunctions } from '../js/app/procgen/PhysicalJunctions.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64);
describe('finite dry FM Switchyard scores (runtime and listening qualification deferred)', function() {
  this.timeout(120000); let items, engines, masks;
  before(async () => { engines = await describeNativeInstrumentEngines(['worklet-sine', 'native-fm'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); items = await createSwitchyardScores({ sourceHash: h('b'), descriptor: engines.find(engine => engine.engineId === 'native-fm') }); masks = await loadProcgenMasks(); });
  it('pins distinct physical systems, finite crew, complete station ownership and separate dry/echo controls', async () => {
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: engines }) });
    expect(library.registry.page({ query: 'Switchyard Breakbeat', limit: 64 }).rows).to.have.length(3); expect(SWITCHYARD_ARRANGEMENTS.map(value => value.width)).to.deep.equal([512, 768, 640]);
    for (const item of items) {
      await verifyPerformanceSceneOrigin(await library.origin(item.scene), { sourceHash: h('b') }); expect((await checkPerformanceSceneRequirements(item.scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready');
      expect(item.recipe.initialReleaseGesture.finiteBurstCount).to.equal(item.scene.cost.lanes * 3); expect(item.recipe.assistPolicy).to.equal('manual-only'); expect(item.scene.initialTransport.playing).to.equal(false); expect(item.scene.description).to.include('named dry FM realization');
      expect(inspectSceneStationRehearsal(item.scene)).to.include({ available: true, maximumRequests: item.scene.cost.lanes === 2 ? 1 : 2 });
      expect(item.scene.causalMappings.instruments.map(value => value.sourceKind)).to.deep.equal(item.scene.cost.lanes === 2 ? ['FlightArc', 'TerrainWorkCommitted'] : ['FlightArc', 'TerrainWorkCommitted', 'RicochetResponse']);
      if (item.recipe.initialEffectRack) expect(item.recipe.initialEffectRack.graph.nodes.find(node => node.id === 'send').parameters.gain01).to.equal(0); else expect(item.scene.physicalControls.some(control => control.id === 'throw')).to.equal(false);
    }
    expect(items[1].recipe.initialJunctions[0].configurations.map(value => value.id)).to.deep.equal(['direct', 'stepped']);
  });
  const trace = async (index, { paused = false, armed = true, gap = null, snap = 0.3 } = {}) => {
    const item = items[index], budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'switchyard-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], item.scene.cost.lanes), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: item.scene.cost.lanes, laneHeight: 128, speed: item.recipe.settings.speed, populationPolicy: item.recipe.settings.populationPolicy, seed: item.scene.seed, maxActors: 16, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, workerLimits: item.recipe.settings.workerLimits,
      initialReleaseGesture: { ...item.recipe.initialReleaseGesture, ...(gap == null ? {} : { nominalGapTicks: gap }), paused }, stallPolicy: { secondsWithoutProgress: 1000 } });
    world.configurePhysicalAuthoring(item.scene.causalMappings, []); if (item.recipe.initialJunctions) configurePhysicalJunctions(world, item.recipe.initialJunctions, 1);
    const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings, getOnsetControls: () => ({ macros: { snap } }) }), facts = [], begins = [], motion = [], requests = [], feedback = createPhysicalFeedbackController({ world, getGraph: () => item.scene.causalMappings, resourceBudget: budget, recordInput: input => { requests.push(input); return { status: 'accepted' }; } });
    world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') motion.push([batch.tick, fact.actorId, fact.positionBefore, fact.positionAfter]); for (const intent of engine.processBatch(batch)) if (intent.kind === 'begin') begins.push({ tick: batch.tick, intent }); feedback.observe(batch, engine.physicalAnalysis()); }); if (armed) feedback.arm({ epoch: 'switchyard-fixture' });
    try { for (let tick = 0; tick < 1400; tick++) world.step(); return { facts, begins, motion, requests }; }
    finally { await feedback.dispose().completion; world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
  it('authors actual safe-landing, changed-build and blocker-contact cause fixtures without periodic filler', async () => {
    const result = await trace(1), facts = new Map(result.facts.map(fact => [fact.eventId, fact])); expect(result.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(9);
    for (const role of ['landing-kick', 'builder-hat', 'blocker-reply']) expect(result.begins.some(row => row.intent.role === role), role).to.equal(true);
    for (const row of result.begins) { const causes = row.intent.sourceEventIds.map(id => facts.get(id)).filter(Boolean); expect(causes).not.to.have.length(0);
      if (row.intent.role === 'landing-kick') expect(causes.some(fact => fact.kind === 'FlightArcEnded' && fact.terminationReason === 'safe-landing' && fact.source !== 'spawn-fall')).to.equal(true);
      if (row.intent.role === 'builder-hat') expect(causes.some(fact => fact.kind === 'TerrainWorkCommitted' && fact.operationKind === 'build' && fact.physicalPayload.changedSolidCells > 0)).to.equal(true);
      if (row.intent.role === 'blocker-reply') expect(causes.some(fact => fact.kind === 'ContactResolved' && fact.causeKind === 'blocker')).to.equal(true);
    }
    const blocked = await trace(2), empty = await trace(0, { paused: true }); expect(blocked.begins.some(row => row.intent.role === 'blocker-reply')).to.equal(false); expect(empty.begins).to.have.length(0);
  });
  it('authors physical spacing and sound-only control comparisons without changing or replaying missed causes', async () => {
    const baseline = await trace(0), spaced = await trace(0, { gap: 108 }), bright = await trace(0, { snap: 0.9 }); expect(bright.motion).to.deep.equal(baseline.motion); expect(bright.begins.map(row => row.intent.sourceEventIds)).to.deep.equal(baseline.begins.map(row => row.intent.sourceEventIds));
    const kicks = value => value.begins.filter(row => row.intent.role === 'landing-kick').map(row => row.tick); expect(kicks(baseline)).to.have.length(3); expect(kicks(spaced)).to.have.length(3); expect(kicks(spaced)[1] - kicks(spaced)[0]).not.to.equal(kicks(baseline)[1] - kicks(baseline)[0]);
  });
});
