import { expect } from 'chai';
import {
  createFlatWalkFixture,
  createSmallGapFixture
} from '../js/solver/SolverFixtures.js';
import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES
} from '../js/solver/SolverTypes.js';
import {
  createBuiltInLevelRunner,
  createEditorLevelRunner,
  createProcgenChunkRunner,
  createRunnerFromSource,
  verifyActionReplay
} from '../js/solver/SolverRunner.js';

describe('SolverRunner', function () {
  it('creates a deterministic runner from synthetic fixture descriptors', function () {
    const created = createRunnerFromSource({
      kind: 'synthetic',
      fixture: createFlatWalkFixture()
    });

    expect(created.result).to.equal(null);
    expect(created.sourceKind).to.equal('synthetic');
    expect(created.runner.getFinalStateSummary()).to.include({
      id: 'flat-walk',
      tick: 0,
      savedCount: 0
    });
  });

  it('replays positive synthetic action scripts successfully', function () {
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
          { type: 'savedCountAtLeast', count: 1 },
          { type: 'skillRemainingAtLeast', skillType: 'builder', count: 1 }
        ],
        rationale: 'bridge the small synthetic gap'
      }
    ], {
      maxTicks: 180,
      maxActions: 2,
      targetSaveCount: 1
    });

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.replayVerified).to.equal(true);
    expect(result.replayAuthority).to.equal('synthetic-runtime');
    expect(result.actions).to.have.length(1);
    expect(result.budgetUsage.actions).to.equal(1);
    expect(result.replaySummary).to.deep.include({
      verifier: 'runtime-replay',
      verified: true,
      authority: 'synthetic-runtime'
    });
    expect(result.replaySummary.savedCount).to.equal(1);
    expect(result.replaySummary.appliedActions).to.eql([
      {
        index: 0,
        tick: 25,
        skillType: 'builder',
        target: { id: 0 },
        lemmingId: 0
      }
    ]);
  });

  it('reports replay divergence when expected postconditions are not met', function () {
    const result = verifyActionReplay(createFlatWalkFixture(), [
      {
        tick: 0,
        skill: 'wait',
        target: { id: 0 },
        expectedPostconditions: [
          { type: 'savedCountAtLeast', count: 2 }
        ],
        rationale: 'intentionally impossible postcondition'
      }
    ], {
      maxTicks: 160,
      maxActions: 1,
      targetSaveCount: 1
    });

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.FAILED);
    expect(result.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.REPLAY_DIVERGED);
    expect(result.replaySummary.savedCount).to.equal(1);
    expect(result.replaySummary.appliedActions).to.have.length(1);
  });

  it('terminates cleanly when replay tick budgets are exhausted', function () {
    const result = verifyActionReplay(createFlatWalkFixture(), [], {
      maxTicks: 10,
      maxNodes: 50,
      targetSaveCount: 1
    });

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.TIMEOUT);
    expect(result.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED);
    expect(result.budgetUsage.ticks).to.equal(10);
    expect(result.replaySummary.tick).to.equal(10);
    expect(result.replaySummary.savedCount).to.equal(0);
  });

  it('returns stable unsupported results for non-synthetic source entrypoints', function () {
    const unsupported = [
      createEditorLevelRunner({ kind: 'editor' }),
      createProcgenChunkRunner({ kind: 'procgen' }),
      createBuiltInLevelRunner({ kind: 'builtin' })
    ];

    for (const created of unsupported) {
      expect(created.runner).to.equal(null);
      expect(created.result.resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
      expect(created.result.replaySummary).to.equal(null);
      expect(created.result.explanations[0].code).to.equal(
        SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC
      );
    }
  });

  it('creates runtime-authoritative adapters for non-synthetic source entrypoints', function () {
    const makeAdapter = (id) => {
      let tick = 0;
      let savedCount = 0;
      return {
        id,
        isRuntimeAuthoritative: true,
        step(count = 1) {
          tick += count;
          if (tick >= 3) savedCount = 1;
        },
        applyAction(action) {
          return {
            ok: true,
            lemmingId: 7,
            skillType: action.skillType
          };
        },
        getFinalStateSummary() {
          return {
            id,
            tick,
            savedCount,
            deadCount: 0,
            activeCount: savedCount ? 0 : 1,
            needCount: 1,
            releaseCount: 1,
            leftCount: 0,
            lemmings: savedCount ? [] : [{ id: 7, x: tick, y: 0, action: 'walking' }]
          };
        }
      };
    };

    for (const kind of ['editor', 'procgen', 'builtin']) {
      const created = createRunnerFromSource({
        kind,
        runner: makeAdapter(`${kind}-adapter`)
      });

      expect(created.result).to.equal(null);
      expect(created.sourceKind).to.equal(kind);
      expect(created.runner.getFinalStateSummary()).to.include({
        sourceKind: kind,
        id: `${kind}-adapter`
      });
    }
  });

  it('requires authoritative runtime replay before non-synthetic solved results', function () {
    let tick = 0;
    const result = verifyActionReplay({
      kind: 'editor',
      runner: {
        id: 'advisory-adapter',
        isRuntimeAuthoritative: false,
        step(count = 1) {
          tick += count;
        },
        applyAction(action) {
          return { ok: true, lemmingId: 0, skillType: action.skillType };
        },
        getFinalStateSummary() {
          return {
            id: 'advisory-adapter',
            tick,
            savedCount: tick >= 1 ? 1 : 0,
            deadCount: 0,
            activeCount: tick >= 1 ? 0 : 1,
            needCount: 1,
            releaseCount: 1,
            leftCount: 0,
            lemmings: tick >= 1 ? [] : [{ id: 0, x: 0, y: 0 }]
          };
        }
      }
    }, [], {
      maxTicks: 4,
      targetSaveCount: 1
    });

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.UNKNOWN);
    expect(result.replayVerified).to.equal(false);
    expect(result.replayAuthority).to.equal('non-authoritative-adapter');
    expect(result.explanations[0].code).to.equal(
      SOLVER_EXPLANATION_CODES.MISSING_RUNTIME_ADAPTER
    );
  });
});
