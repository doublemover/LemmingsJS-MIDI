import { expect } from 'chai';
import { createDubQuarryScores, DUB_QUARRY_ROUTES } from '../js/app/procgen/workstation/DubQuarryScore.js';
import { prepareSceneEffectRack } from '../js/app/procgen/workstation/SceneEffectRack.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { verifyPerformanceSceneOrigin, validatePerformanceSceneRecipe } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { createPerformanceSceneWorldAdapter } from '../js/app/procgen/workstation/PerformanceSceneWorldAdapter.js';
import { renderPerformanceSceneRehearsal } from '../js/app/procgen/workstation/PerformanceSceneRehearsalRender.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { createQuarryTape } from '../js/midi/content/DubQuarryRack.js';
import { effectGraphHash } from '../js/midi/content/EffectGraphRevision.js';
import { hashData } from '../js/core/CanonicalData.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { configurePhysicalJunctions } from '../js/app/procgen/PhysicalJunctions.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), buildId = h('b'), refuse = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); };
describe('finite Dub Quarry routes and explicit saved echo (qualification deferred)', function() {
  this.timeout(120000); let items, engines, masks, library;
  before(async () => { engines = await describeNativeInstrumentEngines(['worklet-sine', 'worklet-pluck'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') }))); items = await createDubQuarryScores({ sourceHash: buildId, descriptor: engines.find(value => value.engineId === 'worklet-pluck') }); masks = await loadProcgenMasks(); library = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId }, descriptors: engines }) }); });
  const worldFixture = async (item, paused = false) => {
    const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'quarry-source-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 3), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 3, laneHeight: 96, seed: item.scene.seed, maxActors: 16, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: { ...item.recipe.initialReleaseGesture, paused }, stallPolicy: { secondsWithoutProgress: 1000 } });
    world.configurePhysicalAuthoring(item.scene.causalMappings, []); configurePhysicalJunctions(world, item.recipe.initialJunctions, 1);
    return { world, terrain, budget, jobs, async close() { world.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); } };
  };
  it('installs distinct route lengths, actual junctions, finite sources and zero-send defaults without a hidden loop', async () => {
    expect(library.registry.page({ limit: 64 }).rows.filter(row => row.id.startsWith('dub-quarry.'))).to.have.length(3);
    expect(DUB_QUARRY_ROUTES.map(route => route.width)).to.deep.equal([512, 768, 1024]);
    for (const item of items) { expect((await checkPerformanceSceneRequirements(item.scene, { resolveDependency: library.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await library.origin(item.scene), { sourceHash: buildId }); expect(item.recipe.initialReleaseGesture.finiteBurstCount).to.equal(3); expect(item.scene.cost.maximumVoices).to.equal(12); expect(item.scene.initialTransport.playing).to.equal(false); expect(item.recipe.initialEffectRack.graph.nodes.find(node => node.id === 'send').parameters.gain01).to.equal(0); expect(item.scene.causalMappings.instruments.every(value => value.sourceKind === 'PickupCrossing')).to.equal(true); expect(item.recipe.initialJunctions[0].configurations.map(value => value.id)).to.deep.equal(['direct', 'stepped']); }
  });
  const trace = async (item, paused = false) => {
    const f = await worldFixture(item, paused), sceneHash = await performanceSceneHash(item.scene), engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }), facts = [], begins = [], prefix = []; let last;
    f.world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); const intents = engine.processBatch(batch); for (const intent of intents) if (intent.kind === 'begin') begins.push({ tick: batch.tick, intent }); if (batch.sourceTimeMs < 5000) { prefix.push(...intents); last = batch; } });
    try { for (let tick = 0; tick < 1200; tick++) f.world.step(); return { facts, begins, source: { schema: 'lemmings-scene-rehearsal-source/v1', sceneHash, initialTick: 0, ticks: last.tick, sourceTimeMs: 0, durationSeconds: (last.sourceTimeMs + last.tickDurationMs) / 1000, worldId: f.world.worldId, generation: f.world.generation, seed: f.world.seed, intents: prefix } }; }
    finally { engine.dispose(); await f.close(); }
  };
  it('authors actual longer-journey timing and empty-world silence fixtures without changing audio delay into actor travel', async () => {
    const a = await trace(items[0]), b = await trace(items[2]), empty = await trace(items[0], true);
    const firstReply = result => result.begins.find(row => row.intent.role === 'reply-arrival')?.tick; expect(firstReply(a)).to.be.a('number'); expect(firstReply(b)).to.be.greaterThan(firstReply(a));
    expect(a.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(3); expect(b.facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(3); expect(a.begins.every(row => row.intent.sourceEventIds.length && row.intent.physicalSourceKind === 'PickupCrossing')).to.equal(true); expect(empty.begins).to.have.length(0);
  });
  it('stages exact saved rack defaults in the existing project while leaving playback permission explicit', async () => {
    const item = items[0], f = await worldFixture(item), preflight = await checkPerformanceSceneRequirements(item.scene, { resolveDependency: library.resolveDependency }); let project, committed = false;
    const adapter = createPerformanceSceneWorldAdapter({ resourceBudget: f.budget, getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId }, descriptors: engines }), getOrigin: (scene, variants) => library.origin(scene, variants), prepareWorld: async ({ sceneRecipe }) => { project = sceneRecipe.project; return { world: f.world, isCurrent: () => true, commit() { committed = true; }, retire() { f.world.dispose(); return { outcome: 'complete' }; } }; } });
    let candidate;
    try { candidate = await adapter({ scene: item.scene, preflight, baseIdentity: 'quarry-doc', isCurrent: () => true }); expect(project.procgen.effectRack).to.deep.equal(item.recipe.initialEffectRack); expect(committed).to.equal(false); expect(f.world.tickIndex).to.equal(0); expect(f.world.activeCount).to.equal(0); }
    finally { if (candidate) await candidate.retire().completion; await f.close(); }
  });
  it('authors real-DSP private rack fixtures with actual source intents, exact processing hashes and explicit preview-tail limits', async () => {
    const item = items[0], source = (await trace(item)).source, sceneHash = await performanceSceneHash(item.scene), input = { scene: item.scene, sceneHash, source, recipe: item.recipe, sampleRate: 48000 }, before = JSON.stringify(source), result = await renderPerformanceSceneRehearsal(input, { descriptors: engines, buildId, yieldControl: async () => {} }), plan = prepareSceneEffectRack(item.recipe.initialEffectRack);
    expect(source.intents.some(intent => intent.kind === 'begin')).to.equal(true);
    expect(result.manifest.effects.graphHash).to.equal(await effectGraphHash(plan.plan)); expect(result.manifest.effects.definitionHash).to.equal(await hashData(plan.rack.graph, { maxBytes: 65536, maxNodes: 8192 })); expect(result.manifest.effects.semanticOnsetsAdded).to.equal(0); expect(result.manifest.effects.controls).to.include('no-replayed-throw'); expect(result.manifest.effects.tailFrames).to.equal(4 * 48000); expect(result.manifest.effects.declaredMaximumTailFrames).to.be.greaterThan(result.manifest.effects.tailFrames); expect(result.manifest.effects.tailTruncatedByPreviewBound).to.equal(true); expect(result.manifest.frames).to.equal(result.manifest.effects.sourceFrames + result.manifest.effects.tailFrames); expect(JSON.stringify(source)).to.equal(before);
    expect(result.manifest.lanes.reduce((sum, lane) => sum + lane.begins, 0)).to.equal(source.intents.filter(intent => intent.kind === 'begin').length); expect(result.bytes.byteLength).to.be.lessThan(16 * 1048576);
    expect((await refuse(renderPerformanceSceneRehearsal({ ...input, recipe: undefined }, { descriptors: engines, buildId }))).message).to.include('cannot be omitted');
    const changed = structuredClone(item.recipe); changed.initialEffectRack.graph.nodes.find(node => node.id === 'return').parameters.gain01 = 0.1; expect((await refuse(renderPerformanceSceneRehearsal({ ...input, recipe: changed }, { descriptors: engines, buildId }))).message).to.include('exact authored recipe');
  });
  it('rejects an unlisted rack, unsupported topology/bypass and combined shared mechanisms before publication', async () => {
    const rack = items[0].recipe.initialEffectRack; expect(() => prepareSceneEffectRack({ ...rack, bypass: 'neutral' })).to.throw(); expect(() => prepareSceneEffectRack({ ...rack, graph: createQuarryTape() })).to.throw();
    expect(() => validatePerformanceSceneRecipe({ ...items[0].recipe, initialMorphMechanism: {} })).to.throw(); const origin = await library.origin(items[0].scene), stripped = structuredClone(origin); stripped.manifest.requirements.required = stripped.manifest.requirements.required.filter(value => value.kind !== 'renderer'); expect(await refuse(verifyPerformanceSceneOrigin(stripped))).to.be.instanceOf(Error);
  });
});
