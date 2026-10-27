import { expect } from 'chai';
import { createGlacierChoirScores } from '../js/app/procgen/workstation/GlacierChoirScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64);
describe('finite Glacier Choir descents (runtime and listening qualification deferred)', function() {
  this.timeout(120000); let items, engines, masks;
  before(async () => { engines = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-choir', 'worklet-spectrum'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); items = await createGlacierChoirScores({ sourceHash: h('b'), descriptor: engines.find(value => value.engineId === 'worklet-choir'), spectrumDescriptor: engines.find(value => value.engineId === 'worklet-spectrum') }); masks = await loadProcgenMasks(); });
  it('pins one/two/three finite sources, birth abilities and a separately named Prism realization of the same physical score', async () => {
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: engines }) }); expect(library.registry.page({ query: 'Glacier Choir', limit: 64 }).rows).to.have.length(4);
    for (const item of items) {
      await verifyPerformanceSceneOrigin(await library.origin(item.scene), { sourceHash: h('b') }); expect((await checkPerformanceSceneRequirements(item.scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready');
      expect(item.recipe.initialReleaseGesture.finiteBurstCount).to.equal(item.scene.cost.lanes); expect(item.recipe.actorBirthAbilities.map(value => value.parachute)).to.deep.equal(Array.from({ length: item.scene.cost.lanes }, (_, lane) => lane === 1)); expect(item.scene.initialTransport.playing).to.equal(false); expect(item.recipe.initialEffectRack).to.equal(undefined);
      expect(item.scene.causalMappings.instruments.every(mapping => ['FlightArc', 'ContactSpanBegan'].includes(mapping.sourceKind))).to.equal(true); expect(item.scene.physicalControls.some(control => ['grain', 'hold'].includes(control.id))).to.equal(false);
    }
    expect(items[2].recipe).to.deep.equal(items[3].recipe); const physical = graph => ({ ...graph, instruments: graph.instruments.map(({ role, ...mapping }) => mapping) }); expect(physical(items[2].scene.causalMappings)).to.deep.equal(physical(items[3].scene.causalMappings)); expect(items[2].scene.patchRefs[1].reference.engineRequirement.engineId).to.equal('worklet-choir'); expect(items[3].scene.patchRefs[1].reference.engineRequirement.engineId).to.equal('worklet-spectrum');
  });
  const trace = async (index, { paused = false, air = 0.3, removeAirborne = false } = {}) => {
    const item = items[index], budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'glacier-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], item.scene.cost.lanes), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: item.scene.cost.lanes, laneHeight: 128, actorBirthAbilities: item.recipe.actorBirthAbilities, speed: item.recipe.settings.speed, populationPolicy: item.recipe.settings.populationPolicy, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } }); world.configurePhysicalAuthoring(item.scene.causalMappings, []);
    const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings, getOnsetControls: () => ({ macros: { air } }) }), facts = [], intents = [], motion = []; let removal = false;
    world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') motion.push([batch.tick, fact.actorId, fact.positionBefore, fact.positionAfter]);
      if (removeAirborne && !removal && batch.facts.some(fact => fact.kind === 'FlightArcStarted' && fact.source !== 'spawn-fall' && fact.laneId === 0)) { removal = true; world.enqueueIntervention({ id: 'glacier-remove-airborne', kind: 'nuke-lane', origin: 'manual', target: { generation: world.generation, laneId: 0 }, parameters: {} }); }
    });
    try { for (let tick = 0; tick < 1200; tick++) world.step(); return { facts, intents, motion }; }
    finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
  it('authors real flight/contact, empty-world and source-removal fixtures without camera or audio clocks as causes', async () => {
    const normal = await trace(1), removed = await trace(0, { removeAirborne: true }), empty = await trace(0, { paused: true }); expect(normal.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(2); expect(empty.intents).to.have.length(0);
    expect(normal.facts.some(fact => fact.kind === 'FlightArcStarted' && fact.source !== 'spawn-fall')).to.equal(true); const roots = new Map(normal.facts.map(fact => [fact.eventId, fact]));
    for (const intent of normal.intents.filter(intent => intent.kind === 'begin')) expect(intent.sourceEventIds.some(id => ['FlightArcStarted', 'FlightArcEnded', 'ContactSpanBegan'].includes(roots.get(id)?.kind))).to.equal(true);
    const ended = new Set(removed.intents.filter(intent => intent.kind === 'end').map(intent => intent.voiceId)); for (const begin of removed.intents.filter(intent => intent.kind === 'begin')) expect(ended.has(begin.voiceId)).to.equal(true);
    expect(removed.facts.some(fact => fact.kind === 'ActorTerminated')).to.equal(true);
  });
  it('authors a sound-control comparison with the identical physical motion trace', async () => { const a = await trace(0, { air: 0.1 }), b = await trace(0, { air: 0.8 }); expect(a.motion).to.deep.equal(b.motion); expect(a.intents.map(intent => [intent.kind, intent.sourceEventIds, intent.pitch])).to.deep.equal(b.intents.map(intent => [intent.kind, intent.sourceEventIds, intent.pitch])); });
});
