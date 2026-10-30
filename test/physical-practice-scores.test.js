import { expect } from 'chai';
import { hashData } from '../js/core/CanonicalData.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { createInstalledPhysicalLessons } from '../js/app/procgen/workstation/PhysicalLessonCatalog.js';
import { validatePerformanceSceneRecipe, verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { createAdvancedPhysicalLessonObservation } from '../js/app/procgen/workstation/PhysicalLessonObservation.js';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { configurePhysicalJunctions } from '../js/app/procgen/PhysicalJunctions.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64);
const sourceContext = (world, graph, soundIdentity = h('f')) => ({ assists: world.assists, graph, soundIdentity, releaseGesture: world.population.releaseGesture, junctionDefinitions: world.physicalJunctions.definitions, junctionStates: world.physicalJunctions.definitions.map(value => world.queryJunction(value.id, { includeDefinition: false }).actual).filter(Boolean) });

describe('authored work, path and formation practice scores (runtime qualification deferred)', function() {
  this.timeout(60000); let library, lessons, masks;
  before(async () => {
    masks = await loadProcgenMasks();
    const descriptors = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-pluck'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') })));
    library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors }) }); lessons = await createInstalledPhysicalLessons(library);
  });
  const score = id => library.registry.resolve(library.registry.page({ limit: 64 }).rows.find(row => row.id === 'practice.' + id));
  const setup = async id => {
    const scene = score(id), recipe = library.getRecipe(scene), budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) });
    const terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], scene.cost.lanes), recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: scene.cost.lanes, laneHeight: 96, seed: scene.seed, maxActors: 16, cohorts: true, workstation: true, hazardSpacing: 1024, assists: false, initialReleaseGesture: recipe.initialReleaseGesture, stallPolicy: { secondsWithoutProgress: 1000 } });
    world.configurePhysicalAuthoring(scene.causalMappings, []); if (recipe.initialJunctions) configurePhysicalJunctions(world, recipe.initialJunctions, 1);
    const definition = lessons.find(value => value.setupScene.id === scene.id), observation = createAdvancedPhysicalLessonObservation({ definition, ...sourceContext(world, scene.causalMappings) }); let macro = 0.5, observed = null, failure = null;
    const batches = [], facts = [], intents = [], engine = createCausalMusicEngine({ getGraph: () => scene.causalMappings, getOnsetControls: () => ({ macros: { brightness: macro } }) });
    world.soundEvents.onBatch.on(batch => { batches.push(batch); const values = engine.processBatch(batch); facts.push(...batch.facts); intents.push(...values); if (!failure) try { observed = observation.observe({ batch, intents: values, context: sourceContext(world, scene.causalMappings) }); } catch (error) { failure = error; } });
    return { scene, recipe, world, terrain, jobs, budget, batches, facts, intents, observation, state: () => observed, failure: () => failure, setMacro(value) { macro = value; }, step(count) { for (let index = 0; index < count; index++) world.step(); }, async close() { world.dispose(); engine.dispose?.(); const receipt = terrain.dispose(); await receipt.completion; jobs.dispose(); expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0); } };
  };
  const release = (f, revision, spread = f.recipe.initialReleaseGesture.spreadTicks) => {
    const gesture = { ...f.recipe.initialReleaseGesture, revision, spreadTicks: spread, lanePhase: f.recipe.initialReleaseGesture.lanePhase.map(({ laneId }) => ({ laneId, offsetTicks: laneId * spread })) };
    f.world.enqueueIntervention({ id: 'release:' + revision, kind: 'set-release-gesture', origin: 'manual', target: { generation: f.world.generation }, parameters: { gesture } });
  };
  it('pins three distinct initial sources, manual policies, exact junction geometry and all five lesson manifests', async () => {
    expect(lessons).to.have.length(5); const hashes = new Set();
    for (const id of ['work-becomes-percussion', 'path-becomes-delay', 'crowd-becomes-harmony']) {
      const scene = score(id), origin = await library.origin(scene), recipe = origin.recipe; await verifyPerformanceSceneOrigin(origin, { sourceHash: h('b') }); hashes.add(await hashData(recipe.initialTerrainLayout));
      expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready'); expect(recipe.assistPolicy).to.equal('manual-only'); expect(recipe.initialReleaseGesture.finiteBurstCount).to.equal(scene.cost.lanes); expect(scene.initialTransport.playing).to.equal(false);
      expect(() => validatePerformanceSceneRecipe({ ...recipe, assistPolicy: 'automatic-lesson-success' })).to.throw();
      if (recipe.initialJunctions) { expect(recipe.initialJunctions[0].requiredAssets).to.deep.equal([await hashData(recipe.initialTerrainLayout)]); expect(recipe.initialJunctions[0].configurations.map(value => value.id)).to.deep.equal(['direct', 'stepped']); }
    }
    expect(hashes.size).to.equal(3);
    const graph = score('work-becomes-percussion').causalMappings; expect(graph.instruments.every(value => value.workChangePolicy === 'solid')).to.equal(true); expect(() => validateCausalInstrumentGraph({ ...graph, instruments: [{ ...graph.instruments[0], workChangePolicy: 'SFX' }] })).to.throw();
  });
  it('observes quiet actual walkers and accepted manual builder/miner operations without automatic work', async () => {
    const f = await setup('work-becomes-percussion');
    try {
      f.step(80); expect(f.failure()).to.equal(null); expect(f.state().phase).to.equal('perform-intervention'); expect(f.intents.filter(value => value.kind === 'begin')).to.have.length(0); expect(f.facts.some(value => value.kind === 'TerrainWorkCommitted')).to.equal(false);
      const actors = f.world.actors.filter(actor => actor.action.actionName === 'walk'); expect(actors).to.have.length(2);
      for (let lane = 0; lane < 2; lane++) f.world.enqueueIntervention({ id: 'manual-tool:' + lane, kind: 'assign-worker', origin: 'manual', target: { generation: f.world.generation, actorId: actors[lane].id }, parameters: { workerKind: lane ? 'miners' : 'builders', targetX: actors[lane].x } });
      f.step(72); expect(f.failure()).to.equal(null); expect(f.state().phase).to.equal('physical-evidence-observed');
      const operations = f.facts.filter(value => value.kind === 'TerrainWorkCommitted' && value.physicalPayload.changedSolidCells > 0); expect(operations.some(value => value.operationKind === 'build' && value.phase === 9)).to.equal(true); expect(operations.some(value => value.operationKind === 'mine' && [1, 2].includes(value.phase))).to.equal(true);
      const byId = new Map(f.facts.map(value => [value.eventId, value])); expect(f.intents.filter(value => value.kind === 'begin').every(value => value.sourceEventIds.every(id => byId.get(id)?.physicalPayload?.changedSolidCells > 0))).to.equal(true);
      expect(f.state().changed.every(value => value.commandId.startsWith('manual-tool:'))).to.equal(true);
    } finally { await f.close(); }
  });
  it('keeps successful-solid attacks distinct from appearance-only repaints of the same observed operation', async () => {
    const f = await setup('work-becomes-percussion'); let engine;
    try {
      f.step(80); const actor = f.world.actors.find(value => value.action.actionName === 'walk');
      f.world.enqueueIntervention({ id: 'repaint-control', kind: 'assign-worker', origin: 'manual', target: { generation: f.world.generation, actorId: actor.id }, parameters: { workerKind: 'builders', targetX: actor.x } }); f.step(24);
      const actual = f.batches.find(batch => batch.facts.some(fact => fact.kind === 'TerrainWorkCommitted' && fact.physicalPayload.changedSolidCells > 0)); expect(actual).not.to.equal(undefined);
      const appearanceOnly = { ...actual, facts: actual.facts.map(fact => fact.kind === 'TerrainWorkCommitted' ? { ...fact, physicalPayload: { ...fact.physicalPayload, changedSolidCells: 0, changedAppearanceCells: 6 } } : fact) };
      engine = createCausalMusicEngine({ getGraph: () => f.scene.causalMappings }); expect(engine.processBatch(appearanceOnly).filter(value => value.kind === 'begin')).to.have.length(0); engine.dispose?.();
      const appearanceGraph = { ...f.scene.causalMappings, instruments: f.scene.causalMappings.instruments.map(value => ({ ...value, workChangePolicy: 'appearance' })) };
      engine = createCausalMusicEngine({ getGraph: () => appearanceGraph }); expect(engine.processBatch(appearanceOnly).some(value => value.kind === 'begin')).to.equal(true);
    } finally { engine?.dispose?.(); await f.close(); }
  });
  it('makes the admitted stepped route change real travel and arrival of a fresh entrant', async () => {
    const f = await setup('path-becomes-delay');
    try {
      f.step(320); expect(f.failure()).to.equal(null); expect(f.state().baseline).to.have.length(1); const initial = f.state().baseline[0];
      f.world.enqueueIntervention({ id: 'manual-path', transactionId: 'manual-path', kind: 'junction-request', origin: 'manual', target: { generation: f.world.generation }, parameters: { request: { junctionId: 'practice-path', authoringRevision: 1, configurationId: 'stepped', policy: 'waitForSafeBoundary', expiryTick: f.world.tickIndex + 120 } } });
      f.step(2); expect(f.world.queryJunction('practice-path').actual.configurationId).to.equal('stepped'); release(f, 2); f.step(320);
      expect(f.failure()).to.equal(null); expect(f.state().phase).to.equal('physical-evidence-observed'); const changed = f.state().changed[0]; expect(changed.actorId).not.to.equal(initial.actorId); expect(changed.pathPixels).to.be.greaterThan(initial.pathPixels); expect(changed.travelTicks).not.to.equal(initial.travelTicks); expect(changed.routeCommandId).to.equal('manual-path');
    } finally { await f.close(); }
  });
  it('requires changed actual formation pitches and a later macro-bearing onset', async () => {
    const f = await setup('crowd-becomes-harmony');
    try {
      f.step(300); expect(f.failure()).to.equal(null); expect(f.state().phase).to.equal('perform-intervention'); expect(f.state().baseline).to.have.length(3);
      release(f, 2, 18); f.step(300); expect(f.failure()).to.equal(null); expect(f.state().phase).to.equal('perform-timbre'); expect(f.state().changed).to.have.length(3);
      expect(f.state().changed.map(value => value.pitchCents)).not.to.deep.equal(f.state().baseline.map(value => value.pitchCents)); expect(f.state().changed.some(value => value.fieldMemberCount >= 3)).to.equal(true);
      f.setMacro(0.85); release(f, 3, 18); f.step(180); expect(f.failure()).to.equal(null); expect(f.state().phase).to.equal('physical-evidence-observed'); expect(f.state().changed.at(-1)).to.include({ macroId: 'brightness', macroValue: 0.85, timbreIntervention: true });
      const tuning = f.scene.causalMappings.harmonicFields[0].tuning; expect(tuning.referenceCents).to.equal(6900); expect(tuning.referenceHz).to.equal(220); expect(tuning.values).to.deep.equal([[1, 1], [9, 8], [5, 4], [3, 2], [5, 3]]);
    } finally { await f.close(); }
  });
  it('retains complete source layout for an independent exact checkpoint continuation and rejects a forged layout', async () => {
    const f = await setup('path-becomes-delay'); let cloneSource;
    try {
      f.step(40); const checkpoint = captureProcgenCheckpoint(f.world); expect(checkpoint.terrainAssignments.sceneTerrain.layout).to.deep.equal(f.recipe.initialTerrainLayout);
      cloneSource = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 1), checkpoint.terrainAssignments.sceneTerrain.layout, { resourceBudget: f.budget, jobs: f.jobs }); await cloneSource.prepare();
      const clone = new ProcgenLaneWorld({ masks, terrain: cloneSource, laneCount: 1, laneHeight: 96, seed: f.scene.seed, maxActors: 16, cohorts: true, workstation: true, hazardSpacing: 1024, assists: false });
      try {
        restoreProcgenCheckpoint(clone, checkpoint); clone.soundEvents.onBatch.on(() => {}); expect(clone.assists).to.equal(false); expect(clone.physicalJunctions.definitions).to.deep.equal(f.recipe.initialJunctions);
        f.step(12); for (let tick = 0; tick < 12; tick++) clone.step(); expect(captureProcgenCheckpoint(clone)).to.deep.equal(captureProcgenCheckpoint(f.world));
        const forged = structuredClone(checkpoint); forged.terrainAssignments.sceneTerrain.layout.lanes[0].regions[0].y1++; const before = clone.tickIndex; expect(() => restoreProcgenCheckpoint(clone, forged)).to.throw(); expect(clone.tickIndex).to.equal(before);
      } finally { clone.dispose(); }
    } finally { if (cloneSource) { const receipt = cloneSource.dispose(); await receipt.completion; } await f.close(); }
  });
  it('does not grade timers, unrelated onsets, rejected skills or a changed sound as the declared intervention', async () => {
    const f = await setup('work-becomes-percussion');
    try {
      f.step(80); const context = sourceContext(f.world, f.scene.causalMappings), current = f.state();
      const batchId = f.world.worldId + ':' + f.world.generation + ':81:0', batch = { version: 1, worldId: f.world.worldId, generation: f.world.generation, tick: 81, batchId, facts: [], snapshot: { actors: [] } };
      const unrelated = { kind: 'begin', worldId: batch.worldId, generation: batch.generation, batchId, intentId: 'unrelated', mappingId: 'foreign', sourceEventIds: [], actorId: 1 };
      const observed = f.observation.observe({ batch, intents: [unrelated], context }); expect(observed.phase).to.equal('perform-intervention'); expect(observed.changed).to.have.length(0); expect(current.changed).to.have.length(0);
      expect(() => f.observation.observe({ batch, intents: [], context: { ...context, soundIdentity: h('e') } })).to.throw('sound');
      expect(() => createAdvancedPhysicalLessonObservation({ definition: lessons[2], ...context, assists: true })).to.throw('manual-only');
    } finally { await f.close(); }
  });
});
