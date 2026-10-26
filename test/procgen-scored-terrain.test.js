import { baseScoredTerrainFixture as baseSource } from './helpers/scored-terrain.js';
import { expect } from 'chai';
import { ProcgenScoredTerrain } from '../js/app/procgen/ProcgenScoredTerrain.js';
import { afterProcgenRetirement, createProcgenRetirementScope, retireProcgenWorldResources } from '../js/app/procgen/ProcgenRetirement.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';

const layout = () => ({ schema: 'lemmings-scene-terrain/v1', id: 'score.owned-source', revision: 1, width: 256, laneHeight: 96, lanes: [{ laneId: 0, regions: [{ kind: 'solid', x1: 0, x2: 256, y1: 88, y2: 96, color: 0xff526f74 }, { kind: 'air', x1: 96, x2: 112, y1: 80, y2: 96, color: 0 }] }] });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const make = async ({ raw = layout(), bound = true, events = [], wrappedJobs = null } = {}) => {
  const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), jobs = createTestBackgroundJobs(bound ? { identity: () => ({ activeExecution: 'bound', buildId: 'explicit-test-build' }) } : {}), base = baseSource(events);
  const owned = new ProcgenScoredTerrain(base, raw, { resourceBudget: budget, jobs: wrappedJobs ? wrappedJobs(jobs) : jobs });
  return { owned, budget, jobs, base, async close() { const receipt = owned.dispose(); await receipt.completion; jobs.dispose(); return receipt; } };
};

describe('owned initial scene terrain provider (runtime/renderer qualification deferred)', function() {
  this.timeout(30000);
  it('requires a bound worker, retains one result and gives collision/render/source queries the same initial cells', async () => {
    const f = await make();
    try {
      await f.owned.prepare(); f.owned.configure(1, 8, { laneHeight: 96, workstation: true, hazardSpacing: 1024 }); f.owned.registerLanes(new Uint32Array([123]), 1, 1);
      expect(f.owned.collisionAt(123, 80, 88)).to.equal(true); expect(f.owned.collisionAt(123, 100, 90)).to.equal(false); expect(f.owned.surface(123, 100)).to.equal(-1); expect(f.owned.surface(123, 140)).to.equal(88);
      expect(f.owned.getChunk(123, 0).pixels[88 * 128 + 80]).to.equal(f.owned.rasterSample(123, 0, 80, 88)); expect(f.owned.objectsAt(123, 0)).to.have.length(0); expect(f.owned.sourceReceipt()).to.include({ status: 'prepared', method: 'dedicated-worker', activeExecution: 'bound', fineGrowth: false }); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
      expect(() => f.owned.getChunk(999, 0)).to.throw('registered physical lane'); expect(() => f.owned.configure(2, 8, { laneHeight: 96 })).to.throw('exact physical dimensions');
      const saved = f.owned.exportAssignments(); f.owned.reset(); expect(() => f.owned.getChunk(123, 0)).to.throw('registered'); f.owned.restoreAssignments(saved); expect(f.owned.collisionAt(123, 80, 88)).to.equal(true);
    } finally { const receipt = await f.close(); expect(receipt.outcome).to.equal('complete'); }
    expect(f.budget.diagnostics().accountedBytes).to.equal(0); expect(() => f.owned.getChunk(123, 0)).to.throw('unavailable');
  });
  it('rejects an unbound producer or an already canceled source before publication and retires its base/result', async () => {
    const f = await make({ bound: false }); let failure;
    try { await f.owned.prepare(); } catch (error) { failure = error; } expect(failure?.message).to.include('bound application worker'); expect(f.owned.sourceReceipt().status).to.equal('unavailable'); expect((await f.close()).outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    const g = await make(), controller = new AbortController(); controller.abort(new Error('canceled-source')); let canceled;
    try { await g.owned.prepare({ signal: controller.signal }); } catch (error) { canceled = error; } expect(canceled?.message).to.equal('canceled-source'); expect((await g.close()).outcome).to.equal('complete'); expect(g.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('waits for world and renderer readers before returning result, assets or provider ownership', async () => {
    const events = [], gate = deferred(), reader = createProcgenRetirementScope().retire([{ name: 'pending-read', run: () => gate.promise.then(() => events.push('renderer-quiescent')) }]), f = await make({ events, wrappedJobs: jobs => ({ ...jobs, async compute(request) { const original = await jobs.compute(request); return { ...original, release() { events.push('geometry-result'); return original.release(); } }; } }) });
    await f.owned.prepare();
    const retired = retireProcgenWorldResources({ world: { dispose() { events.push('world-quiescent'); } }, renderer: { dispose: () => reader }, terrain: f.owned, assets: { dispose() { events.push('display-assets'); } }, resourceLease: { release() { events.push('provider'); } } });
    expect(events).to.deep.equal(['world-quiescent']); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); gate.resolve(); await retired.completion;
    expect(retired.outcome).to.equal('complete'); expect(events.indexOf('geometry-result')).to.be.greaterThan(events.indexOf('renderer-quiescent')); expect(events.indexOf('base-assets')).to.be.greaterThan(events.indexOf('renderer-quiescent')); expect(events.at(-1)).to.equal('provider'); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.jobs.dispose();
  });
  it('keeps the outer world allocation charged until its owned asynchronous sources confirm retirement', async () => {
    const events = [], gate = deferred(), f = await make(); await f.owned.prepare();
    const token = {}; f.budget.reserve({ token, owner: 'active-world', generation: 1, kind: 'candidate', bytes: 4096, pinned: true, reloadable: false });
    const readers = createProcgenRetirementScope().retire([{ name: 'world', run: () => gate.promise }]);
    const source = createProcgenRetirementScope().retire([{ name: 'source', run: () => afterProcgenRetirement([readers], () => f.owned.dispose()) }]);
    const runtime = createProcgenRetirementScope().retire([{ name: 'readers', run: () => readers }, { name: 'sources', run: () => source }, { name: 'world-budget', run: () => afterProcgenRetirement([readers, source], () => { events.push('world-budget'); return f.budget.release({ token, owner: 'active-world' }); }) }]);
    expect(runtime.outcome).to.equal('pending'); expect(events).to.have.length(0); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(4096);
    gate.resolve(); await runtime.completion; expect(runtime.outcome).to.equal('complete'); expect(events).to.deep.equal(['world-budget']); expect(f.budget.diagnostics().accountedBytes).to.equal(0); f.jobs.dispose();
  });
  it('retains every dependent source/provider when a prerequisite reader retirement fails', async () => {
    const events = [], f = await make({ events }); await f.owned.prepare(); const receipt = retireProcgenWorldResources({ world: { dispose() { throw new Error('reader-unknown'); } }, renderer: { dispose() {} }, terrain: f.owned, assets: { dispose() { events.push('display-assets'); } }, resourceLease: { release() { events.push('provider'); } } });
    await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(events).to.have.length(0); expect(f.owned.sourceReceipt().status).to.equal('prepared'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    await f.close(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('does not release base assets after a false result-release acknowledgement', async () => {
    const events = []; let original;
    const f = await make({ events, wrappedJobs: jobs => ({ ...jobs, async compute(request) { original = await jobs.compute({ ...request, signal: undefined }); return { ...original, release: () => false }; } }) });
    await f.owned.prepare(); const receipt = f.owned.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(events).to.have.length(0); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    original.release(); f.base.dispose(); f.jobs.dispose(); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('installs geometry before any physics, restores its exact source profile and continues real world state', async () => {
    const masks = await loadProcgenMasks(), a = await make(), b = await make(); let original, restored;
    const summary = world => ({ tick: world.tickIndex, actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.action.actionName, actor.failureReason]), nextActorId: world.nextActorId });
    try {
      await a.owned.prepare(); await b.owned.prepare(); original = new ProcgenLaneWorld({ masks, terrain: a.owned, laneCount: 1, laneHeight: 96, maxActors: 8, seed: 42, cohorts: true, workstation: true, hazardSpacing: 1024 }); restored = new ProcgenLaneWorld({ masks, terrain: b.owned, laneCount: 1, laneHeight: 96, maxActors: 8, seed: 42, cohorts: true, workstation: true, hazardSpacing: 1024 });
      expect(original.generatedThrough[0]).to.equal(256); expect(original.getGroundAt(80, 88)).to.equal(1); expect(original.getGroundAt(100, 90)).to.equal(0); const sourceFacts = []; original.soundEvents.onBatch.on(batch => sourceFacts.push(...batch.facts));
      for (let tick = 0; tick < 30; tick++) original.step(); expect(sourceFacts.some(fact => fact.kind === 'CommandApplied')).to.equal(false);
      const saved = JSON.parse(JSON.stringify(captureProcgenCheckpoint(original))); expect(saved.componentCodecs.terrainAssignments).to.equal(2); expect(saved.terrainAssignments.sceneTerrain.layoutHash).to.equal(a.owned.sceneTerrainLayoutHash); restoreProcgenCheckpoint(restored, saved); expect(summary(restored)).to.deep.equal(summary(original));
      for (let tick = 0; tick < 12; tick++) { original.step(); restored.step(); } expect(summary(restored)).to.deep.equal(summary(original));
      const before = summary(restored), forged = structuredClone(saved); forged.terrainSettings[0].laneHeight = 128; expect(() => restoreProcgenCheckpoint(restored, forged)).to.throw('source settings'); expect(summary(restored)).to.deep.equal(before);
      const wrongSeed = structuredClone(saved); wrongSeed.terrainAssignments.sceneTerrain.seedLanes[0][0] ^= 1; expect(() => restoreProcgenCheckpoint(restored, wrongSeed)).to.throw('lane seeds'); expect(summary(restored)).to.deep.equal(before);
      const future = structuredClone(saved); future.componentCodecs.terrainAssignments = 3; expect(() => restoreProcgenCheckpoint(restored, future)).to.throw('codec'); expect(summary(restored)).to.deep.equal(before);
      const plain = new ProcgenLaneWorld({ masks, terrain: baseSource(), laneCount: 1, laneHeight: 96, maxActors: 8, seed: 42, cohorts: true }); expect(() => restoreProcgenCheckpoint(plain, saved)).to.throw('source profile'); plain.dispose();
    } finally { original?.dispose(); restored?.dispose(); await a.close(); await b.close(); }
  });
});
