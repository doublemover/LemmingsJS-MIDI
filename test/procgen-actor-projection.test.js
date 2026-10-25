import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { expect } from 'chai';
import { ProcgenActorVisibility } from '../js/app/procgen/ProcgenActorVisibility.js';
import { ProcgenActorProjection } from '../js/app/procgen/ProcgenActorProjection.js';

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
});
