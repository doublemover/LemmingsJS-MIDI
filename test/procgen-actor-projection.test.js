import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { expect } from 'chai';
import { Worker } from 'node:worker_threads';
import { ProcgenActorVisibility, registerProcgenActorVisibility } from '../js/app/procgen/ProcgenActorVisibility.js';
import { ProcgenActorProjection } from '../js/app/procgen/ProcgenActorProjection.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenPhysicsCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

const fixture = () => ({ laneCount: 2, laneHeight: 96, worldId: 'world:test', generation: 1, tickIndex: 1,
  soundEvents: { pendingBatchIdentity: () => 'world:test:1:1:0' }, actors: [{ id: 1, x: 20, y: 32, laneIndex: 1, action: {} }], actions: {} });
describe('leased completed actor projections', () => {
  it('pins immutable physical and semantic facts across subsequent simulation mutation', () => {
    const world = fixture(), index = new ProcgenActorVisibility(world); index.publish();
    const lease = index.acquireSnapshot({ batchId: 'world:test:1:1:0' }), first = lease.frame;
    world.actors[0].x = 90; world.actors[0].laneIndex = 0; world.tickIndex++; index.publish();
    expect(first.physicalRows[0][0].x).to.equal(20); expect(first.semanticLanes[1][0].laneIndex).to.equal(1);
    expect(Object.isFrozen(first.actors[0])).to.equal(true); expect(first.actors[0]).not.to.have.property('action');
    expect(index.projections.stats().versions).to.equal(2); lease.release();
    expect(index.projections.stats().versions).to.equal(1); expect(() => lease.frame).to.throw('released'); index.dispose();
  });
  it('keeps leased retirement bytes charged after owner disposal', () => {
    const entries = new Map(), projection = new ProcgenActorProjection({ budgetAdapter: { reserve: request => entries.set(request.token, request.bytes), release: ({ token }) => entries.delete(token) } });
    projection.publish(fixture()); const lease = projection.acquire(); projection.dispose();
    expect(entries.size).to.equal(1); expect(lease.frame.tick).to.equal(1);
    lease.release(); expect(entries.size).to.equal(0); expect(projection.stats().estimatedBytes).to.equal(0);
  });
  it('balances the real shared resource-budget adapter rather than an incompatible release stub', () => {
    const budget = createResourceBudget(), projection = new ProcgenActorProjection({ budgetAdapter: budget });
    projection.publish(fixture()); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    projection.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('bounds retained versions and refuses mismatched event-batch reads', () => {
    const world = fixture(), projection = new ProcgenActorProjection({ maxVersions: 2 });
    projection.publish(world); const first = projection.acquire(); world.tickIndex++; projection.publish(world);
    expect(projection.acquire({ batchId: 'wrong' })).to.equal(null);
    expect(projection.publish(world)).to.equal(null); expect(projection.stats().dropped).to.equal(1);
    first.release(); expect(projection.publish(world)).not.to.equal(null); projection.dispose();
  });
  it('does not publish partially stepped actors or expose live render methods', () => {
    const world = fixture(), index = new ProcgenActorVisibility(world); index.publish(); const lease = index.acquireSnapshot();
    world.tickIndex++; world._stepping = true; world.actors[0].x = 100;
    expect(index.publish()).to.equal(false); expect(lease.frame.actors[0].x).to.equal(20);
    expect(index.renderActor(1)).to.equal(null); lease.release(); index.dispose();
  });
  it('publishes bounded immutable draw buckets with reference cross-row and wide geometry', () => {
    const world = fixture(); world.laneCount = 16;
    world.actors = [
      { id: 1, x: 50, y: 96, laneIndex: 15 },
      { id: 2, x: 50, y: 200, laneIndex: 0, action: { spriteProvider: { getActorDrawBounds: () => ({ x: 30, y: 0, width: 80, height: 1200 }) } } },
      { id: 3, x: 90, y: 700, laneIndex: 2, removed: true },
      { id: 4, x: 90, y: 700, laneIndex: 2, failureReason: 'lost' },
      { id: 5, x: NaN, y: 1400, laneIndex: 2 }
    ];
    const index = new ProcgenActorVisibility(world); index.publish(); const lease = index.acquireSnapshot(), frame = lease.frame;
    expect(Object.isFrozen(frame.drawRows)).to.equal(true); expect(Object.isFrozen(frame.drawRows[0])).to.equal(true);
    expect(frame.wideDrawActors.map(actor => actor.id)).to.deep.equal([2]);
    for (let row = 0; row < world.laneCount; row++) {
      const expected = world.actors.filter(actor => {
        if (actor.removed || actor.failureReason) return false;
        const bounds = actor.action?.spriteProvider?.getActorDrawBounds(actor);
        const first = Math.max(0, Math.floor(Math.min(actor.y - 32, bounds?.y ?? Infinity) / 96));
        const last = Math.min(world.laneCount - 1, Math.floor(Math.max(actor.y + 32, bounds ? bounds.y + bounds.height : -Infinity) / 96));
        return last - first >= 8 || row >= first && row <= last;
      });
      expect(index.query(row * 96, 0).map(actor => actor.id)).to.have.members(expected.map(actor => actor.id));
      expect(index.candidates.length).to.equal(new Set(index.candidates).size);
    }
    expect(index.bounds.get(world.actors[1])).to.deep.equal({ x: 30, y: 0, width: 80, height: 1200 });
    expect(index.physicalLeader(0, 3).id).to.equal(1); expect(index.semanticLeader(0).id).to.equal(2);
    world.actors[0].y = 900; world.tickIndex++; index.publish();
    expect(frame.drawRows[0].map(actor => actor.id)).to.deep.equal([1]); expect(frame.drawRows[0][0].y).to.equal(96);
    lease.release(); index.dispose();
  });
  it('refuses stale consumers under leased-version pressure and resumes after release', () => {
    const world = fixture(); world.sprites = { activePreference: 'classic' };
    const index = new ProcgenActorVisibility(world, { maxVersions: 2 }); index.publish(); const first = index.acquireSnapshot();
    world.tickIndex++; index.publish(); const second = index.acquireSnapshot();
    world.sprites.activePreference = 'holiday';
    expect(index.acquireSnapshot()).to.equal(null); expect(index.isCurrent()).to.equal(false);
    expect(index.query(0, 200)).to.deep.equal([]); expect(index.renderActor(1)).to.equal(null); expect(index.physicalLeader(0, 2)).to.equal(null);
    expect(index.semanticActors(1)).to.deep.equal([]); expect(index.physicalActors(0)).to.deep.equal([]);
    expect(index.semanticLeader(1)).to.equal(null); expect(index.semanticObservationLeader(1)).to.equal(null);
    expect(index.semanticActionMask(1)).to.equal(0); expect(index.semanticActionOrder(1)).to.equal(0); expect(index.semanticActionCount(1, 'walk')).to.equal(0); expect(index.actorById(1)).to.equal(null);
    expect(first.frame.drawBoundsRevision).to.equal('classic'); expect(second.frame.drawBoundsRevision).to.equal('classic');
    first.release(); expect(index.publish()).to.equal(true); expect(index.isCurrent()).to.equal(true);
    expect(index.query(0, 200)).to.deep.equal(world.actors); expect(second.frame.drawBoundsRevision).to.equal('classic');
    second.release(); index.dispose();
  });
  for (const laneCount of [8, 128, 1024]) it(`queries ${laneCount} lanes without another live actor iteration or display scan`, () => {
    const world = fixture(); world.laneCount = laneCount;
    world.actors = Array.from({ length: laneCount * 4 }, (_, id) => ({ id, x: id % 17, y: Math.floor(id / 4) * 96 + 48, laneIndex: Math.floor(id / 4), action: {} }));
    const index = new ProcgenActorVisibility(world); index.publish(); const before = index.getStats();
    Object.defineProperty(world.actors, Symbol.iterator, { configurable: true, value() { throw new Error('Unexpected live actor scan'); } });
    try {
      expect(index.query(0, 8 * 96 - 1)).to.have.length(32); expect(index.physicalLeader(0, 8)).not.to.equal(null);
      expect(index.semanticActors(0)).to.have.length(4); expect(index.semanticLeader(0)).not.to.equal(null); index.semanticActionMask(0);
      const after = index.getStats(); expect(after.actorScans).to.equal(before.actorScans); expect(after.drawScans).to.equal(0);
      expect(after.queryVisits - before.queryVisits).to.equal(40); expect(after.projection.allocations).to.equal(before.projection.allocations);
      expect(after.retainedActors).to.equal(laneCount * 4);
    } finally { delete world.actors[Symbol.iterator]; index.dispose(); }
  });
  it('invalidates same-tick restore, lane geometry and sprite ownership before reuse', () => {
    const world = fixture(), index = new ProcgenActorVisibility(world); index.publish();
    for (const change of [() => { world.generation++; }, () => { world.actors = [{ ...world.actors[0], x: 80 }]; }, () => { world.laneHeight = 144; }, () => { world.laneCount = 4; }, () => { world.sprites = { activePreference: 'classic' }; }]) {
      const serial = index.getStats().publications; change(); expect(index.isCurrent()).to.equal(false); index.query(0, 300);
      expect(index.isCurrent()).to.equal(true); expect(index.getStats().publications).to.equal(serial + 1);
    }
    index.dispose();
  });
  it('preserves actual physical batches, musical intents and checkpoint identity regardless of consumer order', async () => {
    const masks = await loadProcgenMasks(), worlds = [0, 1].map(() => new ProcgenLaneWorld({ masks, seed: 42, laneCount: 8, assists: false }));
    const graph = { version: 1, revision: 1, instruments: [{ id: 'travel', sourceKind: 'MotionCommitted', gateX: 37, crossingDirection: 'positive', pitchCents: 6000, velocity01: 0.5, role: 'gate', route: 'local' }] };
    const engines = worlds.map(() => createCausalMusicEngine({ getGraph: () => graph })), batches = [[], []], intents = [[], []], identities = [];
    const index = new ProcgenActorVisibility(worlds[1]); registerProcgenActorVisibility(worlds[1], index);
    worlds.forEach((world, owner) => world.soundEvents.onBatch.on(batch => {
      batches[owner].push(batch); intents[owner].push(...engines[owner].processBatch(batch));
      if (owner) {
        const lease = index.acquireSnapshot({ batchId: batch.batchId });
        identities.push(!!lease && lease.frame.batchId === batch.batchId && lease.frame.physicalSnapshotRevision === batch.snapshot.revision);
        lease?.release(); index.query(0, 8 * 96); index.physicalLeader(0, 8); index.semanticActionMask(0);
      }
    }));
    try {
      for (let tick = 1; tick <= 128; tick++) { worlds[0].step(tick * 20); worlds[1].step(tick * 20); index.semanticLeader(0); index.query(96, 96); }
      expect(batches[1]).to.deep.equal(batches[0]); expect(intents[1]).to.deep.equal(intents[0]); expect(intents[0].some(value => value.kind === 'begin')).to.equal(true);
      expect(identities).to.have.length(128); expect(identities.every(Boolean)).to.equal(true);
      expect(worlds.map(world => world.soundEvents.deliveryErrors)).to.deep.equal([0, 0]);
      expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(worlds[1]))).to.equal(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(worlds[0])));
    } finally { index.dispose(); engines.forEach(engine => engine.dispose()); worlds.forEach(world => world.dispose()); }
  });
  it('keeps a leased source revision immutable during an actual worker round trip', async () => {
    const world = fixture(), index = new ProcgenActorVisibility(world); index.publish(); const lease = index.acquireSnapshot();
    const worker = new Worker('const {parentPort} = require(\'node:worker_threads\'); parentPort.on(\'message\', frame => { frame.actors[0].x = 999; frame.drawRows[0].push({id: 999}); parentPort.postMessage(frame); });', { eval: true });
    try {
      const reply = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      worker.postMessage(lease.frame); world.actors[0].x = 80; world.tickIndex++; index.publish();
      const result = await reply; expect(result.actors[0].x).to.equal(999); expect(result.batchId).to.equal(lease.frame.batchId);
      expect(lease.frame.actors[0].x).to.equal(20); expect(lease.frame.drawRows[0]).to.have.length(1); expect(index.actorById(1).x).to.equal(80);
    } finally { await worker.terminate(); lease.release(); index.dispose(); }
  });
  it('accounts failed bounds publication and failed retirement without releasing retained resources early', () => {
    const reservations = new Map(); let refuseRelease = false;
    const projection = new ProcgenActorProjection({ budgetAdapter: { reserve: ({ token, bytes }) => reservations.set(token, bytes), release: ({ token }) => { if (refuseRelease) return false; reservations.delete(token); } } });
    const world = fixture(); projection.publish(world); const current = projection.current.frame;
    world.actors[0].action = { spriteProvider: { getActorDrawBounds() { throw new Error('bounds unavailable'); } } };
    expect(projection.publish(world)).to.equal(null); expect(projection.current.frame).to.equal(current); expect(reservations.size).to.equal(1);
    expect(projection.lastError).to.equal('bounds unavailable'); refuseRelease = true; projection.dispose();
    expect(projection.stats().retirementFailures).to.equal(1); expect(reservations.size).to.equal(1); expect(projection.stats().estimatedBytes).to.be.greaterThan(0);
    refuseRelease = false; for (const entry of projection.versions) projection.retire(entry);
    expect(reservations.size).to.equal(0); expect(projection.stats().estimatedBytes).to.equal(0);
    const refused = new ProcgenActorProjection({ budgetAdapter: { reserve() { throw new Error('shared budget exhausted'); } } });
    expect(refused.publish(fixture())).to.equal(null); expect(refused.stats()).to.include({ dropped: 1, allocations: 0, estimatedBytes: 0 }); refused.dispose();
  });
});
