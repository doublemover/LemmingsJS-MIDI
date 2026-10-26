import { expect } from 'chai';
import { BUILDER_MINER_ARRANGEMENTS, createBuilderMinerScores } from '../js/app/procgen/workstation/BuilderMinerScore.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
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
describe('finite Builder-Miner contact scores (runtime/listening qualification deferred)', function() {
  this.timeout(120000); let items, entries, masks;
  before(async () => { entries = await describeNativeInstrumentEngines(['worklet-sine', 'native-fm'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); items = await createBuilderMinerScores({ sourceHash: h('b'), descriptor: entries.find(value => value.engineId === 'native-fm') }); masks = await loadProcgenMasks(); });
  it('pins three finite work systems, exact command stations, changed-solid mappings and independent dry recipes', async () => {
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: entries }) });
    const rows = library.registry.page({ limit: 64 }).rows.filter(row => row.id.startsWith('builder-miner.')); expect(rows).to.have.length(3);
    for (const row of rows) {
      const scene = library.registry.resolve(row), recipe = library.getRecipe(scene), graph = scene.causalMappings;
      await verifyPerformanceSceneOrigin(await library.origin(scene), { sourceHash: h('b') }); expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready');
      expect(recipe.initialReleaseGesture.finiteBurstCount).to.equal(scene.cost.lanes); expect(recipe.assistPolicy).to.equal('manual-only'); expect(scene.initialTransport.playing).to.equal(false);
      expect(graph.instruments.every(value => value.sourceKind === 'TerrainWorkCommitted' && value.workChangePolicy === 'solid' && value.changedOnly)).to.equal(true);
      expect(graph.feedback.conductors.every(rule => rule.fuel === 1 && rule.source.kind === 'PickupCrossing' && rule.target.kind === 'source-actor' && rule.command.kind === 'assign-worker')).to.equal(true);
      expect(new Set(scene.patchRefs.map(value => value.reference.definitionHash)).size).to.equal(scene.cost.lanes); expect(scene.cost.sharedBodies).to.equal(0);
    }
    expect(BUILDER_MINER_ARRANGEMENTS.map(value => value.workers.length)).to.deep.equal([2, 2, 3]);
    expect(items[0].recipe.initialTerrainLayout.lanes).to.deep.equal(items[1].recipe.initialTerrainLayout.lanes);
  });
  const run = async (index, { armed = true, paused = false, sound = 'a' } = {}) => {
    const item = items[index], budget = createResourceBudget({ limitBytes: 96 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'builder-miner-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], item.scene.cost.lanes), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: item.scene.cost.lanes, laneHeight: 128, seed: item.scene.seed, maxActors: 16, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, workerLimits: item.recipe.settings.workerLimits, initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } });
    world.configurePhysicalAuthoring(item.scene.causalMappings, []);
    const engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings, getOnsetControls: () => ({ macros: { hardness: sound === 'a' ? 0.2 : 0.8 } }) }), records = [], facts = [], begins = [], motion = [], feedback = createPhysicalFeedbackController({ world, getGraph: () => item.scene.causalMappings, resourceBudget: budget, recordInput: input => { records.push(input); return { status: 'accepted' }; } });
    world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') motion.push([batch.tick, fact.actorId, fact.laneId, fact.positionBefore, fact.positionAfter]); for (const intent of engine.processBatch(batch)) if (intent.kind === 'begin') begins.push({ tick: batch.tick, intent }); feedback.observe(batch, engine.physicalAnalysis()); });
    if (armed) feedback.arm({ epoch: 'builder-miner:fixture' });
    try { for (let tick = 0; tick < 700; tick++) world.step(); return { facts, begins, motion, records }; }
    finally { await feedback.dispose().completion; world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  };
  it('authors a real operation-phase/contact-ratio and finite-command fixture without timer onsets', async () => {
    const result = await run(0), facts = new Map(result.facts.map(fact => [fact.eventId, fact])), work = result.facts.filter(fact => fact.kind === 'TerrainWorkCommitted' && fact.physicalPayload.changedSolidCells > 0);
    expect(result.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(2); expect(result.facts.filter(fact => fact.kind === 'CommandApplied' && fact.requestedCommand?.kind === 'assign-worker')).to.have.length(2);
    expect(work.some(fact => fact.operationKind === 'build')).to.equal(true); expect(work.some(fact => fact.operationKind === 'mine')).to.equal(true); expect(result.begins).to.have.length(work.length);
    for (const { intent } of result.begins) { const source = intent.sourceEventIds.map(id => facts.get(id)).find(fact => fact?.kind === 'TerrainWorkCommitted'); expect(source).not.to.equal(undefined); expect(source.workVersion).to.equal(2); expect(source.outcome).to.equal('changed'); expect(source.physicalPayload.changedSolidCells).to.be.greaterThan(0); expect(source.parentCauseIds.some(id => result.facts.some(fact => fact.kind === 'CommandApplied' && fact.commandId === id))).to.equal(true); expect(source.phase).to.be.oneOf(source.operationKind === 'build' ? [9] : [1, 2]); }
    const build = result.begins.filter(row => row.intent.role === 'successful-tool-contact' && row.intent.laneId === 0).map(row => row.tick), mine = result.begins.filter(row => row.intent.laneId === 1).map(row => row.tick);
    expect(build.length).to.be.greaterThan(1); expect(mine.length).to.be.greaterThan(1); expect(build[1] - build[0]).not.to.equal(mine[1] - mine[0]);
    expect(result.records.some(input => input.commands?.length)).to.equal(true);
  });
  it('keeps unarmed walkers and empty-world controls silent, and sound edits preserve the complete physical motion', async () => {
    const unarmed = await run(0, { armed: false }), empty = await run(0, { paused: true }), a = await run(1), b = await run(1, { sound: 'b' });
    expect(unarmed.begins).to.have.length(0); expect(empty.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(0); expect(empty.begins).to.have.length(0); expect(b.motion).to.deep.equal(a.motion); expect(b.begins.map(row => [row.tick, row.intent.laneId, row.intent.physicalSourceKind])).to.deep.equal(a.begins.map(row => [row.tick, row.intent.laneId, row.intent.physicalSourceKind]));
  });
  it('authors the third-worker bounded-material fixture and declines a missing engine instead of substituting a kit', async () => {
    const result = await run(2); expect(result.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(3); expect(result.facts.some(fact => fact.kind === 'TerrainWorkCommitted' && fact.operationKind === 'bash' && fact.physicalPayload.changedSolidCells > 0)).to.equal(true);
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: [entries[0]] }) }); expect(library.registry.page({ limit: 64 }).rows.some(row => row.id.startsWith('builder-miner.'))).to.equal(false);
  });
  it('keeps modal and FM realizations explicitly named over identical physical score recipes', async () => {
    const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'native-modal', engineVersion: 1, artifactHash: h('c') }]), modal = await createBuilderMinerScores({ sourceHash: h('b'), descriptor });
    for (let index = 0; index < modal.length; index++) {
      expect(modal[index].scene.id).to.equal(items[index].scene.id.replace('.dry-fm', '.dry-modal')); expect(modal[index].recipeHash).to.equal(items[index].recipeHash); expect(modal[index].scene.causalMappings).to.deep.equal(items[index].scene.causalMappings);
      for (const { reference } of modal[index].scene.patchRefs) { const parameters = reference.definition.parameters; expect(reference.engineRequirement.engineId).to.equal('native-modal'); expect(parameters.modeCount).to.equal(4); expect(parameters.bodyT60Seconds).to.be.greaterThan(0); for (let mode = 0; mode < 4; mode++) expect(parameters['mode' + mode + 'T60Scale']).to.be.greaterThan(0); expect(parameters.mode0GainA).not.to.equal(parameters.mode0GainB); }
    }
    const library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: [...entries, descriptor] }) }); expect(library.registry.page({ limit: 64 }).rows.filter(row => row.id.startsWith('builder-miner.'))).to.have.length(6);
  });
});
