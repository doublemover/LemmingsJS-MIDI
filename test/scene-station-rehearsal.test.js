import { expect } from 'chai';
import { createSceneStationRehearsal } from '../js/app/procgen/workstation/SceneStationRehearsal.js';
import { inspectSceneStationRehearsal, sceneStationRehearsalReceipt } from '../js/app/procgen/workstation/SceneStationPolicy.js';
import { createBuilderMinerScores } from '../js/app/procgen/workstation/BuilderMinerScore.js';
import { createPerformanceSceneLoader } from '../js/app/procgen/workstation/PerformanceSceneLoader.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { baseScoredTerrainFixture } from './helpers/scored-terrain.js';

const h = value => value.repeat(64), refuse = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); };
describe('explicit private work-station rehearsals (physical fixtures authored, qualification deferred)', function() {
  this.timeout(120000); let item, masks;
  before(async () => { const [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'native-fm', engineVersion: 1, artifactHash: h('a') }]); [item] = await createBuilderMinerScores({ sourceHash: h('b'), descriptor }); masks = await loadProcgenMasks(); });
  const fixture = async () => {
    const budget = createResourceBudget({ limitBytes: 128 * 1048576 }), jobs = createTestBackgroundJobs({ identity: () => ({ activeExecution: 'bound', buildId: 'private-station-fixture' }) }), terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], 2), item.recipe.initialTerrainLayout, { resourceBudget: budget, jobs }); await terrain.prepare();
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 2, laneHeight: 128, seed: item.scene.seed, maxActors: 8, cohorts: true, workstation: true, assists: false, hazardSpacing: 1024, initialReleaseGesture: item.recipe.initialReleaseGesture, stallPolicy: { secondsWithoutProgress: 1000 } }); world.configurePhysicalAuthoring(item.scene.causalMappings, []);
    return { world, budget, async close() { world.dispose(); await terrain.dispose().completion; jobs.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); } };
  };
  it('admits only finite one-shot actor-bound skill stations and rejects an already advanced world', async () => {
    expect(inspectSceneStationRehearsal(item.scene)).to.include({ available: true, maximumRequests: 2 });
    for (const changed of [null, {}, { causalMappings: { feedback: { conductors: 'invalid' } } }, { ...item.scene, causalMappings: { ...item.scene.causalMappings, feedback: { ...item.scene.causalMappings.feedback, conductors: item.scene.causalMappings.feedback.conductors.map(rule => ({ ...rule, fuel: 2 })) } } }]) expect(inspectSceneStationRehearsal(changed).available).to.equal(false);
    const f = await fixture(); try { f.world.step(); expect(await refuse(createSceneStationRehearsal({ scene: item.scene, sceneHash: await performanceSceneHash(item.scene), world: f.world, resourceBudget: f.budget }))).to.be.instanceOf(Error); } finally { await f.close(); }
  });
  it('retains requested versus actually applied private commands and creates attacks only from successful work', async () => {
    const f = await fixture(), station = await createSceneStationRehearsal({ scene: item.scene, sceneHash: await performanceSceneHash(item.scene), world: f.world, resourceBudget: f.budget }), engine = createCausalMusicEngine({ world: f.world, resourceBudget: f.budget, getGraph: () => item.scene.causalMappings, maxVoices: 16, traceLimit: 0 }), facts = [], begins = [];
    const listener = batch => { facts.push(...batch.facts); begins.push(...engine.processBatch(batch).filter(intent => intent.kind === 'begin')); station.observe(batch, engine.physicalAnalysis()); }; f.world.soundEvents.onBatch.on(listener);
    try {
      for (let tick = 0; tick < 120; tick++) f.world.step(); const ledger = station.metadata(), receipt = sceneStationRehearsalReceipt(ledger), applied = facts.filter(fact => fact.kind === 'CommandApplied' && ledger.requests.some(row => row.command.id === fact.commandId));
      expect(ledger.requests).to.have.length(2); expect(applied).to.have.length(2); expect(ledger.outcomes.filter(row => row.kind === 'CommandApplied').map(row => row.commandId)).to.deep.equal(applied.map(row => row.commandId)); expect(receipt).to.include({ requested: 2, applied: 2, rejected: 0, pendingAtPrefixEnd: 0, liveWorldArmedByRehearsal: false, liveFeedbackChanged: false });
      expect(begins.length).to.be.greaterThan(0); expect(begins.every(intent => intent.physicalSourceKind === 'TerrainWorkCommitted' && intent.sourceEventIds.some(id => facts.some(fact => fact.eventId === id && fact.physicalPayload?.changedSolidCells > 0)))).to.equal(true); expect(ledger.historicalPerformanceEvidence).to.equal(false);
      const saved = JSON.stringify(ledger); f.world.soundEvents.onBatch.off(listener); await station.retire().completion; expect(JSON.stringify(ledger)).to.equal(saved); expect(() => station.metadata()).to.throw('retired');
    } finally { f.world.soundEvents.onBatch.off(listener); await station.retire().completion; engine.dispose(); await f.close(); }
  });
  it('cancels an unapplied private skill request at the prefix boundary without advancing or repairing the world', async () => {
    const f = await fixture(), station = await createSceneStationRehearsal({ scene: item.scene, sceneHash: await performanceSceneHash(item.scene), world: f.world, resourceBudget: f.budget }), engine = createCausalMusicEngine({ getGraph: () => item.scene.causalMappings }), listener = batch => { engine.processBatch(batch); station.observe(batch, engine.physicalAnalysis()); }; f.world.soundEvents.onBatch.on(listener);
    try {
      for (let tick = 0; tick < 120 && !station.metadata().requests.length; tick++) f.world.step(); const ledger = station.metadata(), before = f.world.tickIndex; expect(ledger.pendingAtPrefixEnd.length).to.be.greaterThan(0); f.world.soundEvents.onBatch.off(listener); await station.retire().completion; expect(f.world.tickIndex).to.equal(before); expect(f.world.interventionState.pending).to.have.length(0); for (let tick = 0; tick < 24; tick++) f.world.step(); expect(f.world.stats.builds + f.world.stats.mines).to.equal(0);
    } finally { f.world.soundEvents.onBatch.off(listener); await station.retire().completion; engine.dispose(); await f.close(); }
  });
  it('forwards an explicit rehearsal policy through the loader without applying the staged scene', async () => {
    const policies = []; let commits = 0;
    const loader = createPerformanceSceneLoader({ getBaseIdentity: () => 'private-station-doc', resolveDependency: async dependency => ({ ...dependency, status: 'available', storage: 'installed-runtime' }), prepareCandidate: async ({ preflight, baseIdentity }) => ({ sceneHash: preflight.sceneHash, variants: [], baseIdentity, admission: { status: 'admitted', world: true, sound: true, mapping: true }, commit() { commits++; throw new Error('No load requested.'); }, retire: () => ({ outcome: 'complete' }) }), preparePreview: async ({ authoredStations }) => { policies.push(authoredStations); return { routing: 'isolated-local', externalOutput: false, retire: () => ({ outcome: 'complete' }) }; } });
    try { loader.select(item.scene); await loader.prepare(); await loader.rehearse({ authoredStations: true }); expect(loader.state().preview.authoredStations).to.equal(true); await loader.stopPreview(); await loader.rehearse(); expect(policies).to.deep.equal([true, false]); expect(commits).to.equal(0); expect(await refuse(loader.rehearse({ authoredStations: 'true' }))).to.be.instanceOf(Error); }
    finally { await loader.dispose(); }
  });
});
