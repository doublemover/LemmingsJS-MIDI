import { expect } from 'chai';
import { createRescueOrchestraScores } from '../js/app/procgen/workstation/RescueOrchestraScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createPhysicalFeedbackController } from '../js/app/procgen/workstation/physical/PhysicalFeedback.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64);
describe('fixed-cohort Rescue Orchestra studies (runtime and listening qualification deferred)', function() {
  this.timeout(120000); let items, modal, engines, masks;
  before(async () => { engines = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-pluck', 'worklet-choir', 'native-modal'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); items = await createRescueOrchestraScores({ sourceHash: h('b'), descriptor: engines.find(value => value.engineId === 'worklet-pluck') }); modal = await createRescueOrchestraScores({ sourceHash: h('b'), descriptor: engines.find(value => value.engineId === 'native-modal') }); masks = await loadProcgenMasks(); });
  it('pins the same three-person physical promise across named palettes and separate unresolved/loss systems', async () => {
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: engines }) }); expect(library.registry.page({ query: 'Rescue Orchestra', limit: 64 }).rows).to.have.length(9);
    for (let index = 0; index < items.length; index++) {
      const item = items[index]; await verifyPerformanceSceneOrigin(await library.origin(item.scene), { sourceHash: h('b') }); expect((await checkPerformanceSceneRequirements(item.scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready'); expect(item.recipe).to.deep.equal(modal[index].recipe); expect(item.scene.causalMappings).to.deep.equal(modal[index].scene.causalMappings);
      const policy = item.scene.causalMappings.activityWindows[0].completionPolicy; expect(policy.expectedCrew).to.equal(3); expect(policy.goalRegion).to.deep.equal({ x1: 132, x2: 208, y1: 64, y2: 112 }); expect(policy.intervals).to.have.length(3); expect(item.recipe.initialReleaseGesture.finiteBurstCount).to.equal(3); expect(item.scene.initialTransport.playing).to.equal(false);
      expect(item.scene.causalMappings.feedback.conductors[0].command.parameters.trackCrew).to.equal(true); expect(item.scene.causalMappings.instruments.some(mapping => mapping.sourceKind === 'ActorTerminated')).to.equal(false); expect(item.scene.cost.maximumVoices).to.equal(16);
    }
    expect(items[1].scene.causalMappings.feedback.conductors[0].enabled).to.equal(false); expect(items[2].recipe.initialTerrainLayout.lanes[0].regions.some(region => region.kind === 'air')).to.equal(true);
  });
  const trace = async (item, { roleBalance = 0.5, paused = false } = {}) => {
    const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'rescue-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 1), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 1, laneHeight: 128, speed: item.recipe.settings.speed, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, populationPolicy: item.recipe.settings.populationPolicy, workerLimits: item.recipe.settings.workerLimits, actorBirthAbilities: item.recipe.actorBirthAbilities,
      initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } }); world.configurePhysicalAuthoring(item.scene.causalMappings, []);
    const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings, getOnsetControls: () => ({ macros: { 'role-balance': roleBalance } }) }), facts = [], intents = [], motion = [], feedback = createPhysicalFeedbackController({ world, getGraph: () => item.scene.causalMappings, resourceBudget: budget, recordInput: () => ({ status: 'accepted' }) });
    world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') motion.push([batch.tick, fact.actorId, fact.positionBefore, fact.positionAfter]); feedback.observe(batch, engine.physicalAnalysis()); }); feedback.arm({ epoch: 'rescue-fixture' });
    try { for (let tick = 0; tick < 1800; tick++) world.step(); return { facts, intents, motion }; }
    finally { await feedback.dispose().completion; world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
  it('authors complete-passage, unresolved-delay, true-loss and empty-world fixtures through actual owners', async () => {
    const crossed = await trace(items[0]), delayed = await trace(items[1]), lost = await trace(items[2]), empty = await trace(items[0], { paused: true });
    expect(crossed.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(3); const completed = crossed.facts.filter(fact => fact.kind === 'RouteCompleted' && fact.completionCoverage === 'complete'); expect(completed).not.to.have.length(0);
    for (const completion of completed) { expect(completion.participants).to.have.length(3); expect(completion.admittedCrew).to.equal(3); expect(completion.prerequisiteSourceEventIds).to.have.length(5); expect(new Set(completion.prerequisiteSourceEventIds).size).to.equal(5); expect(completion.prerequisiteSourceEventIds.every(id => crossed.facts.some(fact => fact.eventId === id))).to.equal(true); }
    const resolutions = crossed.intents.filter(intent => intent.kind === 'begin' && intent.role === 'verified-passage-chord'); expect(resolutions).to.have.length(3); expect(new Set(resolutions.map(intent => JSON.stringify(intent.scoreTime))).size).to.equal(1); expect(resolutions.every(intent => intent.sourceEventIds.length >= 6)).to.equal(true);
    expect(delayed.intents.some(intent => intent.role === 'verified-passage-chord')).to.equal(false); expect(lost.facts.some(fact => fact.kind === 'ActorTerminated')).to.equal(true); expect(lost.intents.some(intent => intent.role === 'verified-passage-chord')).to.equal(false); expect(empty.intents).to.have.length(0);
  });
  it('authors palette/control comparisons with unchanged physical outcome accounting', async () => {
    const a = await trace(items[0]), b = await trace(modal[0], { roleBalance: 0.8 }); expect(a.motion).to.deep.equal(b.motion);
    const truth = value => value.facts.filter(fact => ['ActorBorn', 'ActorTerminated', 'RouteCompleted', 'RouteFailed', 'CrewMemberArrived'].includes(fact.kind)).map(fact => [fact.kind, fact.actorId, fact.crewProjectId, fact.completionId, fact.participants, fact.reason]); expect(truth(a)).to.deep.equal(truth(b));
  });
});
