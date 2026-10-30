import { expect } from 'chai';
import { validateActorBirthAbilities } from '../js/app/procgen/ActorBirthAbilities.js';
import { createWindPerformanceScore } from '../js/app/procgen/workstation/WindPerformanceScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), descriptors = () => describeNativeInstrumentEngines(['worklet-sine', 'worklet-wind'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') })));
const batch = (tick, facts) => ({ version: 1, worldId: 'stairwell', generation: 1, tick, sourceTimeMs: (tick - 1) * 60, tickDurationMs: 60, batchId: 'stairwell:' + tick, completeness: { status: 'complete', dropped: 0 }, facts: facts.map((fact, index) => ({ actorId: 7, laneId: 0, eventId: 'event:' + tick + ':' + index, causalSequence: tick * 100 + index, ...fact })) });
const entry = (action, id) => ({ kind: 'ActionEntered', action, actionInstanceId: id }), exit = (action, id) => ({ kind: 'ActionExited', action, actionInstanceId: id }), motion = (action, id, y) => ({ kind: 'MotionCommitted', action, actionInstanceId: id, positionBefore: { x: 100, y: y + 1 }, positionAfter: { x: 100, y }, physicalPayload: { displacementPixels: 1 } });
describe('Breathing Stairwell authored held-action score (runtime/device/listening qualification deferred)', function() {
  this.timeout(60000); let item, masks;
  before(async () => { item = await createWindPerformanceScore({ sourceHash: h('b'), descriptor: (await descriptors()).find(engine => engine.engineId === 'worklet-wind') }); masks = await loadProcgenMasks(); });
  const setup = async (abilities = item.recipe.actorBirthAbilities) => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 2), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2, laneHeight: 128, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: item.recipe.initialReleaseGesture, actorBirthAbilities: abilities, stallPolicy: { secondsWithoutProgress: 1000 } }); world.configurePhysicalAuthoring(item.scene.causalMappings, []);
    return { world, budget, step(count) { for (let index = 0; index < count; index++) world.step(); }, async close() { world.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); } };
  };
  it('pins its source/geometry/abilities/content closure before any actors and starts paused', async () => {
    const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: await descriptors() }) }), scene = catalog.registry.resolve(catalog.registry.page({ limit: 64 }).rows.find(row => row.id === 'breathing-stairwell'));
    expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: catalog.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await catalog.origin(scene), { sourceHash: h('b') }); expect(scene.initialTransport.playing).to.equal(false); expect(catalog.getRecipe(scene).actorBirthAbilities).to.deep.equal([{ laneId: 0, climb: true, parachute: true }, { laneId: 1, climb: true, parachute: true }]); expect(scene.patchRefs.map(patch => patch.reference.definition.parameters.windKind)).to.deep.equal([0, 1]); expect(scene.causalMappings.instruments.every(mapping => mapping.actionVoicePolicy.beginCondition === 'motion')).to.equal(true);
  });
  it('does not turn a static action poll into an onset and uses real height pressure with one legato flight token', () => {
    const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }); expect(engine.processBatch(batch(1, [entry('falling', 'fall:7')]))).to.have.length(0); expect(engine.processBatch(batch(2, []))).to.have.length(0);
    const first = engine.processBatch(batch(3, [motion('falling', 'fall:7', 80)])), begin = first.find(intent => intent.kind === 'begin'); expect(begin).to.exist;
    const next = engine.processBatch(batch(4, [exit('falling', 'fall:7'), entry('floating', 'float:7'), motion('floating', 'float:7', 60)])); expect(next.filter(intent => intent.kind === 'begin')).to.have.length(0); expect(next.filter(intent => intent.kind === 'update').every(intent => intent.voiceId === begin.voiceId)).to.equal(true);
    const changed = engine.processBatch(batch(5, [motion('floating', 'float:7', 40)])); expect(changed.find(intent => intent.kind === 'update').expression.pressure01).to.equal(1 - 40 / 256);
    const landed = engine.processBatch(batch(6, [exit('floating', 'float:7'), entry('walking', 'walk:7')])); expect(landed.filter(intent => intent.kind === 'end')).to.have.length(1); expect(landed.filter(intent => intent.kind === 'begin')).to.have.length(0); expect(engine.processBatch(batch(7, [motion('walking', 'walk:7', 112)]))).to.have.length(0); engine.dispose();
  });
  it('bounds and freezes exact lane-indexed birth capabilities', () => { expect(validateActorBirthAbilities(null, 2)).to.equal(null); const value = validateActorBirthAbilities([{ laneId: 0, climb: true, parachute: false }], 1); expect(Object.isFrozen(value[0])).to.equal(true); for (const bad of [[], [{ laneId: 1, climb: true, parachute: true }], [{ laneId: 0, climb: 1, parachute: false }], [{ laneId: 0, climb: true, parachute: true, extra: 1 }]]) expect(() => validateActorBirthAbilities(bad, 1)).to.throw(); });
  it('retains pre-first-birth source policy in checkpoints and rejects incompatible/forged source before mutation', async () => {
    const f = await setup(), foreign = await setup([{ laneId: 0, climb: false, parachute: true }, { laneId: 1, climb: true, parachute: true }]);
    try { const initial = captureProcgenCheckpoint(f.world); expect(initial.physicsAlgorithms.actorBirthAbilities).to.equal(1); f.step(16); expect(f.world.actors.every(actor => actor.canClimb && actor.hasParachute)).to.equal(true); restoreProcgenCheckpoint(f.world, initial); expect(f.world.activeCount).to.equal(0); f.step(16); expect(f.world.actors.every(actor => actor.canClimb && actor.hasParachute)).to.equal(true); const before = captureProcgenCheckpoint(foreign.world); expect(() => restoreProcgenCheckpoint(foreign.world, initial)).to.throw('birth ability'); expect(captureProcgenCheckpoint(foreign.world)).to.deep.equal(before); expect(() => restoreProcgenCheckpoint(f.world, { ...initial, physicsAlgorithms: { ...initial.physicsAlgorithms, actorBirthAbilities: 99 } })).to.throw('birth ability'); }
    finally { await f.close(); await foreign.close(); }
  });
  it('authors the actual climbing, floating, landing and cause-linked held-expression physics fixture', async () => {
    const f = await setup(), engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }), facts = [], intents = [], batches = [];
    f.world.soundEvents.onBatch.on(batch => { batches.push(batch); facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); });
    try { f.step(1000); const births = facts.filter(fact => fact.kind === 'ActorBorn'); expect(births).to.have.length(2); expect(births.every(fact => fact.birthAbilities.climb && fact.birthAbilities.parachute)).to.equal(true); expect(facts.some(fact => fact.kind === 'ActionEntered' && fact.action === 'climbing')).to.equal(true); expect(facts.some(fact => fact.kind === 'ActionEntered' && fact.action === 'floating')).to.equal(true); const begins = intents.filter(intent => intent.kind === 'begin'); expect(begins.length).to.be.greaterThan(0); expect(begins.every(intent => ['climbing', 'hoisting', 'falling', 'floating'].includes(intent.physicalAction) && intent.sourceEventIds.length > 0)).to.equal(true); expect(intents.some(intent => intent.kind === 'end')).to.equal(true); expect(intents.some(intent => intent.kind === 'update' && Number.isFinite(intent.expression.pressure01))).to.equal(true); const actual = new Set(facts.map(fact => fact.eventId)); expect(begins.every(intent => intent.sourceEventIds.every(id => actual.has(id)))).to.equal(true); expect(batches.every(batch => batch.completeness.status === 'complete')).to.equal(true); }
    finally { engine.dispose(); await f.close(); }
  });
});
