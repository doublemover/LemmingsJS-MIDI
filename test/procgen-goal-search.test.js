import { expect } from 'chai';
import { searchProcgenGoal } from '../js/solver/ProcgenGoalSearch.js';
import { factoryFor } from './support/procgen-route-fixtures.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('independent real procgen action search', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('finds and independently replays a long wall route without an intended action hint', () => {
    const result = searchProcgenGoal(factoryFor(masks, { wall: true, crewCount: 16 }), { maxNodes: 8, maxActions: 1 });
    expect(result.resultType).to.equal('solved'); expect(result.replaySummary.verified).to.equal(true);
    expect(result.replaySummary).to.include({ goalReachedCount: 16, deadCount: 0, goalKind: 'physical-region', exitRescues: false });
    expect(result.actions).to.have.length(1); expect(result.actions[0]).to.include({ skillType: 'basher', target: 0, tick: 0 });
    expect(result.search.intendedRouteHint).to.equal(false); expect(result.budgetUsage.nodes).to.be.at.most(8);
  });
  it('accepts actual walking without manufacturing assignments and never claims a finite negative is unsolvable', () => {
    const walking = searchProcgenGoal(factoryFor(masks, { skills: {} }));
    expect(walking.resultType).to.equal('solved'); expect(walking.actions).to.have.length(0);
    const blocked = searchProcgenGoal(factoryFor(masks, { wall: true, steelWall: true }), { maxNodes: 3, maxTicks: 240 });
    expect(blocked.resultType).not.to.equal('solved'); expect(blocked.replaySummary.verified).to.equal(false);
    expect(blocked.explanations[0].detail).to.include('does not prove unsolvability');
  });
  it('enforces finite node/tick allocations and catches a changing factory rather than certifying mismatched replays', () => {
    const bounded = searchProcgenGoal(factoryFor(masks, { wall: true }), { maxNodes: 1, maxSimulatedTicks: 10 });
    expect(bounded.resultType).to.equal('timeout'); expect(bounded.budgetUsage.nodes).to.equal(1); expect(bounded.budgetUsage.ticks).to.equal(10);
    let call = 0;
    expect(() => searchProcgenGoal(() => factoryFor(masks, { wall: ++call === 1 })(), { maxNodes: 2 })).to.throw('changed its initial state');
  });
});