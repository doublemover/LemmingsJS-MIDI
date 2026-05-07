import { expect } from 'chai';
import {
  SOLVER_RESULT_TYPES,
  createSmallGapFixture,
  verifyActionReplay
} from '../js/solver/index.js';

describe('solver public API integration', function() {
  it('replays a curated synthetic mini-level through the public solver surface', function() {
    const result = verifyActionReplay(createSmallGapFixture(), [
      {
        tick: 25,
        skill: 'builder',
        target: { id: 0 },
        preconditions: [
          { type: 'skillAvailable', skillType: 'builder', count: 1 },
          'target-active'
        ],
        expectedPostconditions: [
          { type: 'lemmingSaved', id: 0 },
          { type: 'savedCountAtLeast', count: 1 }
        ],
        rationale: 'bridge the curated checkpoint mini-level gap'
      }
    ], {
      maxTicks: 180,
      maxActions: 2,
      targetSaveCount: 1
    });

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.replaySummary.savedCount).to.equal(1);
    expect(result.replaySummary.appliedActions[0]).to.include({
      tick: 25,
      skillType: 'builder',
      lemmingId: 0
    });
  });
});
