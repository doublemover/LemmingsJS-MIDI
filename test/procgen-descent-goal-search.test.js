import { expect } from 'chai';
import { searchProcgenGoal } from '../js/solver/ProcgenGoalSearch.js';
import { replayProcgenGoal } from '../js/solver/ProcgenSolverAdapter.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { descentFactoryFor } from './support/procgen-descent-scene.js';

describe('independent whole-crew two-stripe descent goals', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const skill of ['digger', 'miner']) for (const crewCount of [8, 16]) it(`searches and freshly replays one ${skill} for all ${crewCount} ordinary actors down 32px`, () => {
    const result = searchProcgenGoal(descentFactoryFor(masks, { skill, crewCount }), { maxNodes: 8, maxTicks: 1200, maxActions: 1, maxWallTimeMs: 3000 });
    expect(result.resultType).to.equal('solved'); expect(result.search.intendedRouteHint).to.equal(false);
    expect(result.actions).to.have.length(1); expect(result.actions[0].skillType).to.equal(skill);
    expect(result.replaySummary).to.include({ verified: true, goalKind: 'physical-region', exitRescues: false, releaseCount: crewCount,
      goalReachedCount: crewCount, deadCount: 0, routeBoundsExceeded: false, protectedTerrainUnchanged: true, hazardContacts: 0 });
    expect(result.replaySummary.skills[skill]).to.equal(0);
    expect(result.replaySummary.lemmings.every(actor => !actor.dead && actor.y === 104)).to.equal(true);
    expect(result.replaySummary.laneTransfers).to.equal(crewCount);
  });
  for (const skill of ['digger', 'miner']) for (const crewCount of [8, 16]) it(`independently discovers early ${skill} admission for the local contained ${crewCount}-actor scene`, () => {
    const result = searchProcgenGoal(descentFactoryFor(masks, { skill, crewCount, minX: 24, maxX: 105,
      rearWallX: 24, forwardWallX: 104, wallTop: 44, forwardWallTop: 90, leadX: 64, followerStartX: 62, spacing: 2, goalX: 90 }),
    { maxNodes: 8, maxTicks: 1200, maxActions: 1, maxWallTimeMs: 3000 });
    expect(result.resultType).to.equal('solved'); expect(result.search.intendedRouteHint).to.equal(false);
    expect(result.actions).to.have.length(1); expect(result.actions[0]).to.include({ skillType: skill, target: 0, tick: 0 });
    expect(result.replaySummary).to.include({ verified: true, goalReachedCount: crewCount, deadCount: 0,
      routeBoundsExceeded: false, protectedTerrainUnchanged: true, hazardContacts: 0, laneTransfers: crewCount });
    expect(result.replaySummary.lemmings.every(actor => !actor.dead && actor.y === 104 && actor.x >= 25 && actor.x <= 103)).to.equal(true);
    expect(Object.values(result.replaySummary.skills).every(count => count === 0)).to.equal(true);
  });
  for (const skill of ['digger', 'miner']) it(`rejects ${skill} geometry that the moving leader leaves before all followers arrive`, () => {
    const found = searchProcgenGoal(descentFactoryFor(masks, { skill, crewCount: 16, forwardWall: false }), { maxNodes: 8, maxTicks: 1200, maxActions: 1, maxWallTimeMs: 3000 });
    expect(found.resultType).to.equal('solved');
    const result = replayProcgenGoal(descentFactoryFor(masks, { skill, crewCount: 16, forwardWall: false, maxX: 124 }), found.actions, { maxTicks: 1200 });
    expect(result.resultType).not.to.equal('solved');
    expect(result.replaySummary).to.include({ verified: false, routeBoundsExceeded: true, deadCount: 0, protectedTerrainUnchanged: true });
    expect(result.replaySummary.goalReachedCount).to.be.lessThan(16);
  });
  it('keeps a wholly protected descent unqualified instead of accepting a rejected action or deaths', () => {
    const result = searchProcgenGoal(descentFactoryFor(masks, { steelRoof: true }), { maxNodes: 8, maxTicks: 600, maxActions: 1, maxWallTimeMs: 3000 });
    expect(result.resultType).not.to.equal('solved'); expect(result.replaySummary.verified).to.equal(false);
    expect(result.replaySummary).to.include({ deadCount: 0, protectedTerrainUnchanged: true });
  });
});
