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
  SyntheticSolverRunner,
  RuntimeGameSolverRunner,
  DelegatingRuntimeSolverRunner,
  createEditorLevelRunner,
  createProcgenChunkRunner,
  createRunnerFromSource,
  verifyActionReplay
} from '../js/solver/SolverRunner.js';

import { Game } from '../js/game/Game.js';
import { CommandManager } from '../js/commands/CommandManager.js';
import { GameTimer } from '../js/game/GameTimer.js';
import { GameVictoryCondition } from '../js/game/GameVictoryCondition.js';
import { LemmingManager } from '../js/lemmings/LemmingManager.js';
import { Level } from '../js/level/Level.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerManager } from '../js/level/TriggerManager.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { MAX_SOLVER_SNAPSHOT_PIXELS } from '../js/solver/SolverState.js';

const makeReportedReplay = (marker) => {
  let tick = 0;
  const runner = {
    kind: 'editor',
    get tick() { return tick; },
    step(count = 1) { tick += count; },
    applyAction: () => ({ ok: true, lemmingId: 0 }),
    getSavedCount: () => tick >= 1 ? 1 : 0,
    isTerminal: () => tick >= 1,
    getFinalStateSummary: () => ({ tick, savedCount: tick >= 1 ? 1 : 0, needCount: 1,
      activeCount: tick >= 1 ? 0 : 1, leftCount: 0, lemmings: [], authority: 'real-runtime', verified: true })
  };
  if (marker !== undefined) runner.isRuntimeAuthoritative = marker;
  return runner;
};

describe('SolverRunner', function () {
  it('omits discarded built-in step summaries but preserves the public step return', function () {
    const runner = new SyntheticSolverRunner(createFlatWalkFixture());
    const original = runner.getFinalStateSummary;
    let summaries = 0;
    runner.getFinalStateSummary = function () { summaries += 1; return original.call(this); };
    const result = verifyActionReplay(runner, [], { maxTicks: 4, targetSaveCount: 1 });
    expect(result.budgetUsage.ticks).to.equal(4);
    expect(summaries).to.equal(1);
    expect(runner.step(2).tick).to.equal(6);
    expect(summaries).to.equal(2);
  });

  it('advances runtime and nested built-in runners without constructing summaries', function () {
    let tick = 0;
    let summaries = 0;
    const runtime = {
      getGameTimer: () => ({ tick: count => { tick += count; } }),
      getSolverSummary: () => { summaries += 1; return { tick }; }
    };
    const runner = new RuntimeGameSolverRunner('builtin', { runtime });
    const nested = new DelegatingRuntimeSolverRunner('builtin', runner);
    nested._advanceWithoutSummary(3);
    expect(tick).to.equal(3);
    expect(summaries).to.equal(0);
    expect(nested.step(2).tick).to.equal(5);
    expect(summaries).to.equal(1);
    runtime.step = count => { tick += count; return 'custom-return'; };
    expect(runner.step(2)).to.equal('custom-return');
    runner._advanceWithoutSummary(2);
    expect(tick).to.equal(9);
  });

  it('retains overridden adapter step semantics through direct and delegated replay', function () {
    class CustomRunner extends SyntheticSolverRunner {
      step(count = 1) { this.stepCalls = (this.stepCalls || 0) + 1; return super.step(count); }
    }
    for (const delegated of [false, true]) {
      const custom = new CustomRunner(createFlatWalkFixture());
      const runner = delegated ? new DelegatingRuntimeSolverRunner('builtin', custom) : custom;
      verifyActionReplay(runner, [], { maxTicks: 4, targetSaveCount: 1 });
      expect(custom.stepCalls).to.equal(4);
    }
  });

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

  it('keeps unmarked and truthy-only facades non-authoritative through source, direct and nested entrypoints', function () {
    const sources = ['editor', 'procgen', 'builtin'].map(kind => {
      const facade = makeReportedReplay();
      return { kind, runner: { step: facade.step, applyAction: facade.applyAction, getFinalStateSummary: facade.getFinalStateSummary } };
    });
    const direct = makeReportedReplay(), claimedSynthetic = makeReportedReplay(); claimedSynthetic.kind = 'synthetic';
    sources.push(direct, claimedSynthetic, { sourceKind: 'editor', runner: makeReportedReplay() },
      new DelegatingRuntimeSolverRunner('editor', new DelegatingRuntimeSolverRunner('editor', makeReportedReplay())),
      { kind: 'editor', authoritative: 'true', runner: makeReportedReplay('true') });
    for (const source of sources) {
      const result = verifyActionReplay(source, [], { maxTicks: 4, targetSaveCount: 1 });
      expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.UNKNOWN);
      expect(result.replayVerified).to.equal(false); expect(result.replayAuthority).to.equal('non-authoritative-adapter');
      expect(result.replaySummary).to.include({ verified: false, authority: 'non-authoritative-adapter', savedCount: 1 });
      expect(result.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.MISSING_RUNTIME_ADAPTER);
    }
    const model = new SyntheticSolverRunner(createFlatWalkFixture());
    expect(new DelegatingRuntimeSolverRunner('builtin', model, { authoritative: true }).isRuntimeAuthoritative).to.equal(false);
    const facade = { getGameTimer: () => ({}), getLemmingManager: () => ({}) };
    expect(new RuntimeGameSolverRunner('builtin', { runtime: facade }).isRuntimeAuthoritative).to.equal(false);
  });

  it('honors explicit boolean adapter authority assertions while any explicit opt-out vetoes them', function () {
    const cases = [
      { source: { kind: 'editor', runner: makeReportedReplay(true) }, expected: SOLVER_RESULT_TYPES.SOLVED },
      { source: { kind: 'editor', authoritative: true, runner: makeReportedReplay() }, expected: SOLVER_RESULT_TYPES.SOLVED },
      { source: { kind: 'editor', authoritative: false, runner: makeReportedReplay(true) }, expected: SOLVER_RESULT_TYPES.UNKNOWN },
      { source: { kind: 'editor', authoritative: true, runner: makeReportedReplay(false) }, expected: SOLVER_RESULT_TYPES.UNKNOWN }
    ];
    for (const { source, expected } of cases) {
      const result = verifyActionReplay(source, [], { maxTicks: 4, targetSaveCount: 1 });
      expect(result.resultType).to.equal(expected); expect(result.replayVerified).to.equal(expected === SOLVER_RESULT_TYPES.SOLVED);
      expect(result.replayAuthority).to.equal(expected === SOLVER_RESULT_TYPES.SOLVED ? 'real-runtime' : 'non-authoritative-adapter');
    }
  });

  it('rejects oversized synthetic replay sources before reading masks and bounds typed-mask copies to validated dimensions', function () {
    let maskReads = 0;
    const oversized = { kind: 'synthetic', width: MAX_SOLVER_SNAPSHOT_PIXELS + 1, height: 1,
      get groundMask() { maskReads++; return null; }, get steelMask() { maskReads++; return null; } };
    expect(() => new SyntheticSolverRunner(oversized)).to.throw(RangeError, 'pixel budget');
    const rejected = verifyActionReplay(oversized, [], { maxSnapshotPixels: MAX_SOLVER_SNAPSHOT_PIXELS * 2 });
    expect(rejected.resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
    expect(rejected.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED);
    expect(rejected.replayVerified).to.equal(false); expect(rejected.replaySummary).to.equal(null); expect(maskReads).to.equal(0);
    const groundMask = new Uint8Array(100).fill(1), steelMask = new Uint8Array(100).fill(2);
    const source = { kind: 'synthetic', width: 5, height: 4, groundMask, steelMask };
    expect(() => new SyntheticSolverRunner(source, { maxSnapshotPixels: 19 })).to.throw(RangeError, '19-pixel budget');
    expect(verifyActionReplay(source, [], { maxSnapshotPixels: 19 }).resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
    const runner = new SyntheticSolverRunner(source, { maxSnapshotPixels: 20 });
    expect(runner.groundMask).to.have.length(20); expect(runner.steelMask).to.have.length(20);
    runner.groundMask[0] = 0; expect(groundMask[0]).to.equal(1); expect(steelMask).to.have.length(100);
    expect(verifyActionReplay(runner, [], { maxSnapshotPixels: 19 }).resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
  });

  it('preserves unrelated adapter exceptions instead of turning them into snapshot budget results', function () {
    const facade = makeReportedReplay(); facade.step = () => { throw new RangeError('adapter failure'); };
    expect(() => verifyActionReplay(facade, [], { maxTicks: 4 })).to.throw(RangeError, 'adapter failure');
  });

  it('recognizes an initialized Game and replays its actual timer, walking, exit action and victory count', async function () {
    const game = new Game({}), level = new Level(96, 64);
    expect(createBuiltInLevelRunner({ game }).runner.isRuntimeAuthoritative).to.equal(false);
    Object.assign(level, { needCount: 1, releaseCount: 1, releaseRate: 50, timeLimit: 1 });
    level.groundMask.mask.fill(1, 48 * level.width);
    game.level = level; game.gameTimer = new GameTimer(level, { window: {}, document: {} });
    game.gameVictoryCondition = new GameVictoryCondition(level);
    game.commandManager = new CommandManager(game, game.gameTimer);
    game.triggerManager = new TriggerManager(game.gameTimer, level.width, level.height);
    game.triggerManager.add(new Trigger(TriggerTypes.EXIT_LEVEL, 20, 36, 24, 52));
    game.lemmingManager = new LemmingManager(level, null, game.triggerManager, game.gameVictoryCondition, await loadProcgenMasks(), null);
    game.gameVictoryCondition.releaseOne(); game.lemmingManager.addLemming(12, 48);
    game.gameTimer.onGameTick.on(game._boundTick);
    try {
      const created = createBuiltInLevelRunner({ game });
      expect(created.runner.isRuntimeAuthoritative).to.equal(true);
      const smallBudget = { maxSnapshotPixels: level.width * level.height - 1 };
      expect(() => createBuiltInLevelRunner({ game }, smallBudget)).to.throw(RangeError, 'pixel budget');
      for (const source of [{ kind: 'builtin', game }, created.runner]) {
        const rejected = verifyActionReplay(source, [], smallBudget);
        expect(rejected.resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
        expect(rejected.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED);
        expect(game.gameTimer.getGameTicks()).to.equal(0); expect(game.gameVictoryCondition.getSurvivorsCount()).to.equal(0);
      }
      const result = verifyActionReplay(created, [], { maxTicks: 40, targetSaveCount: 1 });
      expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED); expect(result.replayVerified).to.equal(true);
      expect(result.replayAuthority).to.equal('real-runtime'); expect(result.replaySummary.savedCount).to.equal(1);
      expect(result.budgetUsage.ticks).to.be.greaterThan(8); expect(result.budgetUsage.ticks).to.be.at.most(40);
      expect(game.gameVictoryCondition.getSurvivorsCount()).to.equal(1);
      expect(createBuiltInLevelRunner({ game, authoritative: false }).runner.isRuntimeAuthoritative).to.equal(false);
    } finally { game.stop(); }
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
