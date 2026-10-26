import { expect } from 'chai';
import { GLASS_ORBIT_TUNINGS, createGlassOrbitScores } from '../js/app/procgen/workstation/GlassOrbitScore.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { tuningDegree, validatePhysicalTuning } from '../js/app/procgen/workstation/physical/Tuning.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { configurePhysicalJunctions } from '../js/app/procgen/PhysicalJunctions.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), hz = pitch => pitch.referenceHz * 2 ** ((pitch.cents - 6900) / 1200);
const descriptors = () => describeNativeInstrumentEngines(['worklet-sine', 'native-fm'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') })));

describe('Glass Orbit finite spatial-harp scores (qualification deferred)', function() {
  this.timeout(120000);
  let items, entries;
  before(async () => { entries = await descriptors(); items = await createGlassOrbitScores({ sourceHash: h('b'), descriptor: entries[1] }); });
  it('installs all nine exact source-bound arrangements with finite cohorts, physical return and reviewed requirements', async () => {
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: entries }) }), rows = library.registry.page({ limit: 64 }).rows.filter(row => row.id.startsWith('glass-orbit.'));
    expect(rows).to.have.length(9);
    for (const row of rows) { const scene = library.registry.resolve(row), recipe = library.getRecipe(scene); expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await library.origin(scene), { sourceHash: h('b') }); expect(recipe.initialReleaseGesture.finiteBurstCount).to.equal(recipe.settings.laneCount); expect(recipe.assistPolicy).to.equal('manual-only'); expect(scene.initialTransport.playing).to.equal(false); expect(scene.causalMappings.pickups).to.have.length(5); expect(scene.causalMappings.pickups.every(gate => gate.trigger === 'cross' && gate.retriggerOnEdit === false)).to.equal(true); expect(recipe.initialJunctions).to.have.length(recipe.settings.laneCount); expect(recipe.initialJunctions.every(junction => junction.configurations.map(value => value.id).join(',') === 'direct,stepped')).to.equal(true); expect(scene.cost.maximumVoices).to.equal(scene.cost.lanes * 8); }
  });
  it('preserves identical geometry and release timing across explicit tuning variants', () => {
    for (const arrangement of ['solo', 'duet', 'flock']) { const variants = items.filter(item => item.scene.id.startsWith('glass-orbit.' + arrangement + '.')); expect(new Set(variants.map(item => item.recipeHash)).size).to.equal(1); expect(variants[0].scene.causalMappings.pickups.map(gate => gate.geometry)).to.deep.equal(variants[2].scene.causalMappings.pickups.map(gate => gate.geometry)); expect(variants[0].scene.patchRefs).to.deep.equal(variants[2].scene.patchRefs); }
    const flock = items.find(item => item.scene.id === 'glass-orbit.flock.ratios').scene; expect(flock.causalMappings.formations).to.have.length(1); expect(flock.causalMappings.instruments.every(instrument => instrument.formationId === 'glass-orbit-formation' && instrument.sourceKind === 'PickupCrossing')).to.equal(true);
  });
  it('declares exact 220/275/330 Hz ratio targets and all nineteen equal octave divisions', () => {
    const ratio = validatePhysicalTuning(GLASS_ORBIT_TUNINGS[1].tuning); for (const [degree, target] of [[0, 220], [2, 275], [3, 330]]) expect(hz(tuningDegree(ratio, degree))).to.be.closeTo(target, 1e-10); const edo = validatePhysicalTuning(GLASS_ORBIT_TUNINGS[2].tuning); expect(edo.cents).to.have.length(19); expect(tuningDegree(edo, 19).cents - edo.referenceCents).to.equal(1200); expect(GLASS_ORBIT_TUNINGS[2].degrees).to.deep.equal([0, 3, 6, 11, 15]);
  });
  it('does not silently substitute another engine or source tier', async () => {
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: [entries[0]] }) }); expect(library.registry.page({ limit: 64 }).rows.some(row => row.id.startsWith('glass-orbit.'))).to.equal(false);
    let error; try { await createGlassOrbitScores({ sourceHash: h('b'), descriptor: { ...entries[1], maximumVoices: 2 } }); } catch (caught) { error = caught; } expect(error?.message).to.include('Glass Orbit');
  });
  const runWorld = async (item, masks, paused = false) => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'glass-orbit-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], item.scene.cost.lanes), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: item.scene.cost.lanes, laneHeight: 96, seed: item.scene.seed, maxActors: 16, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } }), engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }), motion = [], begins = [], born = [];
    world.configurePhysicalAuthoring(item.scene.causalMappings, []); configurePhysicalJunctions(world, item.recipe.initialJunctions, 1);
    world.soundEvents.onBatch.on(batch => { for (const fact of batch.facts) { if (fact.kind === 'ActorBorn') born.push(fact.actorId); if (fact.kind === 'MotionCommitted') motion.push([batch.tick, fact.actorId, fact.laneId, fact.positionBefore.x, fact.positionBefore.y, fact.positionAfter.x, fact.positionAfter.y]); } for (const intent of engine.processBatch(batch)) if (intent.kind === 'begin') begins.push({ tick: batch.tick, intent }); });
    try { for (let tick = 0; tick < 1200; tick++) world.step(); return { motion, begins, born }; }
    finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
  it('authors the real-world same-trace tuning, reverse-crossing and empty-world fixture', async () => {
    const masks = await loadProcgenMasks(), solo = id => items.find(item => item.scene.id === 'glass-orbit.solo.' + id), ratio = await runWorld(solo('ratios'), masks), equal = await runWorld(solo('pentatonic'), masks), empty = await runWorld(solo('ratios'), masks, true);
    expect(ratio.born).to.have.length(1); expect(ratio.motion).to.deep.equal(equal.motion); expect(ratio.begins.map(value => [value.tick, value.intent.observation?.gateId, value.intent.actorId])).to.deep.equal(equal.begins.map(value => [value.tick, value.intent.observation?.gateId, value.intent.actorId])); expect(ratio.begins.length).to.be.at.least(10); expect(ratio.motion.some(row => row[5] < row[3] && row[3] > 850)).to.equal(true); expect(ratio.begins.every(value => value.intent.sourceEventIds.length > 0 && value.intent.physicalSourceKind === 'PickupCrossing')).to.equal(true);
    for (const [gate, target] of [[0, 220], [2, 275], [3, 330]]) { const onset = ratio.begins.find(value => value.intent.observation?.gateId === 'glass-orbit-gate-' + gate); expect(onset).not.to.equal(undefined); expect(hz(onset.intent.pitch)).to.be.closeTo(target, 1e-8); }
    expect(empty.born).to.have.length(0); expect(empty.begins).to.have.length(0);
  });
});
