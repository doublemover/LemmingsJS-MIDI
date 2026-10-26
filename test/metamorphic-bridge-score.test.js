import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createMetamorphicBridgeScore } from '../js/app/procgen/workstation/MetamorphicBridgeScore.js';
import { createOriginalResonatorMorphProof } from '../js/midi/content/OriginalResonatorMorphProof.js';
import { createInstalledPerformanceSceneCatalog } from '../js/app/procgen/workstation/PerformanceSceneInstalledCatalog.js';
import { verifySceneMorphMechanism, createSceneMorphMechanism, validateSceneMorphMechanism, sceneMorphMechanismCost } from '../js/app/procgen/workstation/SceneMorphMechanism.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { checkPerformanceSceneRequirements } from '../js/app/procgen/workstation/PerformanceSceneRequirements.js';
import { verifyPerformanceSceneOrigin } from '../js/app/procgen/workstation/PerformanceSceneRecipe.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), descriptors = () => describeNativeInstrumentEngines(['worklet-sine', 'worklet-friction'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: h('a') })));
const item = async () => createMetamorphicBridgeScore({ sourceHash: h('b'), descriptor: (await descriptors()).find(value => value.engineId === 'worklet-friction') });
const refusal = async operation => { try { await operation(); } catch (caught) { return caught; } throw new Error('Expected refusal.'); };

describe('Metamorphic Bridge score and initial canonical body (qualification deferred)', function() {
  this.timeout(120000);
  it('pins the original reviewed proof and complete finite score closure', async () => {
    const proof = await createOriginalResonatorMorphProof(), file = JSON.parse(await fs.readFile(new URL('../content/morphs/dry-bright-proof.json', import.meta.url), 'utf8')); expect(proof.a).to.deep.equal(file.input.a); expect(proof.b).to.deep.equal(file.input.b); expect(proof.map.pairs).to.deep.equal(file.input.anchors); expect(proof.map.unmatchedBIds).to.have.length(2);
    const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: await descriptors() }) }), row = catalog.registry.page({ limit: 64 }).rows.find(value => value.id === 'metamorphic-bridge'), scene = catalog.registry.resolve(row), origin = await catalog.origin(scene);
    expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: catalog.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(origin, { sourceHash: h('b') }); expect(scene.cost).to.include({ lanes: 1, sharedBodies: 1 }); expect(scene.initialTransport.playing).to.equal(false); expect(origin.recipe.initialReleaseGesture.finiteBurstCount).to.equal(1); await verifySceneMorphMechanism(origin.recipe.initialMorphMechanism, scene.causalMappings.instruments);
    expect((await refusal(() => verifySceneMorphMechanism(origin.recipe.initialMorphMechanism, []))).code).to.equal('scene-morph-unavailable');
  });
  it('prepares the explicitly named two-body strategy with unchanged world, source and signed travel', async () => {
    const engines = await descriptors(), paired = await item(), blend = await createMetamorphicBridgeScore({ sourceHash: h('b'), descriptor: engines.find(value => value.engineId === 'worklet-friction'), strategy: 'blend' }), mechanism = blend.recipe.initialMorphMechanism;
    expect(blend.scene.id).to.equal('metamorphic-bridge.blend'); expect(blend.scene.cost.sharedBodies).to.equal(2); expect(sceneMorphMechanismCost(mechanism)).to.deep.equal({ bodyCount: 2, modeCount: 10, strategy: 'prepared-endpoint-audio-blend' }); expect(blend.recipe.initialTerrainLayout).to.deep.equal(paired.recipe.initialTerrainLayout); expect(blend.recipe.initialReleaseGesture).to.deep.equal(paired.recipe.initialReleaseGesture); expect(blend.scene.patchRefs).to.deep.equal(paired.scene.patchRefs); expect(blend.scene.causalMappings).to.deep.equal(paired.scene.causalMappings); await verifySceneMorphMechanism(mechanism, blend.scene.causalMappings.instruments);
    expect(() => validateSceneMorphMechanism({ ...mechanism, schema: 'lemmings-scene-morph-route/v1' })).to.throw('explicit v2');
    const budget = createResourceBudget(), context = { state: 'running', sampleRate: 48000 }, bindings = []; let state = null, prepared;
    const owner = createSceneMorphMechanism({ mechanism, resourceBudget: budget, getContext: () => context, getOwnerState: () => state, travelEffects: { bind: value => bindings.push(value) }, prepareGraph: async graph => { prepared = graph; return state = { revision: 1, mode: 'active', activeGraph: { hash: h('c') } }; } });
    try { await owner.ensure(); expect(owner.state()).to.include({ bodyCount: 2, modeCount: 10, strategy: 'prepared-endpoint-audio-blend' }); expect(prepared.nodes.find(node => node.id === 'morph-body').kind).to.equal('resonator-blend-body'); const intent = { kind: 'begin', mappingId: mechanism.instrumentId, voiceId: 'same-actor', generation: 1, intentId: 'real-motion' }; owner.consume([intent], new Map([[intent.intentId, 'accepted']])); owner.consume([intent], new Map([[intent.intentId, 'accepted']])); expect(bindings).to.have.length(1); }
    finally { await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0); }
    const catalog = await createInstalledPerformanceSceneCatalog({ getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: h('b') }, descriptors: engines }) }), scene = catalog.registry.resolve(catalog.registry.page({ limit: 64 }).rows.find(row => row.id === 'metamorphic-bridge.blend')); expect((await checkPerformanceSceneRequirements(scene, { resolveDependency: catalog.resolveDependency })).status).to.equal('ready'); await verifyPerformanceSceneOrigin(await catalog.origin(scene), { sourceHash: h('b') });
  });
  it('binds only an admitted canonical begin and never retries or rewrites the source intent', async () => {
    const score = await item(), budget = createResourceBudget(), context = { sampleRate: 48000, state: 'suspended' }, bindings = []; let state = { revision: 0, mode: 'neutral', activeGraph: null }, prepares = 0;
    const owner = createSceneMorphMechanism({ mechanism: score.recipe.initialMorphMechanism, resourceBudget: budget, getContext: () => context, getOwnerState: () => state, travelEffects: { bind: value => bindings.push(value) }, prepareGraph: async () => { prepares++; return state = { revision: 1, mode: 'active', activeGraph: { hash: h('c') } }; } });
    expect((await refusal(() => owner.ensure())).message).to.include('enable browser audio'); expect(prepares).to.equal(0); context.state = 'running'; await Promise.all([owner.ensure(), owner.ensure()]); expect(prepares).to.equal(1); expect(owner.isPrepared()).to.equal(true);
    const intent = { kind: 'begin', mappingId: 'metamorphic-journey', voiceId: 'actual-actor', generation: 3, intentId: 'motion-note' }, original = JSON.stringify(intent); owner.consume([intent], new Map([[intent.intentId, 'rejected']])); expect(bindings).to.have.length(0); owner.consume([intent], new Map([[intent.intentId, 'accepted']])); owner.consume([{ ...intent, voiceId: 'late-other' }], new Map([[intent.intentId, 'accepted']])); expect(bindings).to.have.length(1); expect(bindings[0].control).to.include({ parameter: 'morph01', travelPixels: 512, curve: 'clamped-signed-distance' }); expect(JSON.stringify(intent)).to.equal(original); state = { revision: 2, mode: 'active', activeGraph: { hash: h('d') } }; expect(owner.state().active).to.equal(false); expect(owner.isPrepared()).to.equal(true); const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains pending profile storage through stopped preparation and publishes no late body', async () => {
    const score = await item(), budget = createResourceBudget(), context = { sampleRate: 48000, state: 'running' }; let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const owner = createSceneMorphMechanism({ mechanism: score.recipe.initialMorphMechanism, resourceBudget: budget, getContext: () => context, getOwnerState: () => null, travelEffects: { bind() { throw new Error('No source may bind.'); } }, prepareGraph: async (graph, options) => { entered(); await gate; options.signal.throwIfAborted(); return { revision: 1, activeGraph: { hash: h('c') } }; } });
    const pending = owner.ensure().catch(value => value); await started; owner.reset(); const receipt = owner.dispose(); expect(receipt.outcome).to.equal('pending'); expect(budget.diagnostics().residentBytes).to.be.greaterThan(2 * 1048576); release(); expect((await pending).code).to.equal('scene-morph-unavailable'); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(owner.isPrepared()).to.equal(false); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('authors a real finite route and collision reversal without an extra journey attack', async () => {
    const score = await item(), budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 1), score.recipe.initialTerrainLayout, { resourceBudget: budget, jobs });
    await terrain.prepare(); const world = new ProcgenLaneWorld({ masks: await loadProcgenMasks(), terrain, laneCount: 1, laneHeight: 96, seed: score.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: score.recipe.initialReleaseGesture, stallPolicy: { secondsWithoutProgress: 1000 } }), engine = createCausalMusicEngine({ getGraph: () => score.scene.causalMappings }), facts = [], intents = [];
    world.configurePhysicalAuthoring(score.scene.causalMappings, []); world.soundEvents.onBatch.on(batch => { facts.push(...batch.facts); intents.push(...engine.processBatch(batch)); });
    try { for (let tick = 0; tick < 1000; tick++) world.step(); expect(facts.filter(fact => fact.kind === 'ActorBorn')).to.have.length(1); expect(facts.some(fact => fact.kind === 'MotionCommitted' && fact.positionBefore.x > 700 && fact.positionAfter.x < fact.positionBefore.x)).to.equal(true); expect(intents.filter(intent => intent.kind === 'begin')).to.have.length(1); expect(intents.some(intent => intent.articulationState?.signedDistancePixels >= 512)).to.equal(true); }
    finally { world.dispose(); engine.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
});
