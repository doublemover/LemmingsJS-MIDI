import { expect } from 'chai';
import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_MODES,
  SOLVER_RESULT_TYPES,
  createBudgetMeter,
  createSolverResult,
  normalizeActionScriptAction,
  normalizeSolverOptions
} from '../js/solver/SolverTypes.js';
import {
  createFlatWalkFixture,
  createSmallGapFixture,
  fillRect
} from '../js/solver/SolverFixtures.js';

describe('SolverTypes', function() {
  it('normalizes solver options with stable defaults and skill subsets', function() {
    const options = normalizeSolverOptions({
      seed: '12',
      mode: SOLVER_MODES.FULL,
      skills: ['builder', 'builder', ' digger '],
      targetSaveCount: 2,
      maxTicks: 0,
      maxNodes: 4,
      maxActions: 1,
      maxWallTimeMs: 3
    });
    expect(options).to.deep.equal({
      seed: 12,
      mode: SOLVER_MODES.FULL,
      skillSubset: ['builder', 'digger'],
      targetSaveCount: 2,
      maxTicks: 1,
      maxNodes: 4,
      maxActions: 1,
      maxWallTimeMs: 3
    });
  });

  it('normalizes action scripts and result payloads', function() {
    const action = normalizeActionScriptAction({
      skill: 'builder',
      targetSelector: { kind: 'frontier' },
      tick: 12.8,
      window: { start: 10, end: 20 },
      preconditions: ['walking'],
      expectedPostconditions: ['bridge-started'],
      rationale: 'bridge gap'
    });
    expect(action).to.deep.equal({
      skillType: 'builder',
      target: { kind: 'frontier' },
      tick: 12,
      window: { start: 10, end: 20 },
      preconditions: ['walking'],
      expectedPostconditions: ['bridge-started'],
      rationale: 'bridge gap'
    });

    const result = createSolverResult({
      resultType: SOLVER_RESULT_TYPES.SOLVED,
      actions: [action],
      explanations: [SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT],
      budgetUsage: { ticks: 5, nodes: 6, actions: 1, wallTimeMs: 2 }
    });
    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.actions).to.deep.equal([action]);
    expect(result.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT);
  });

  it('tracks budgets and produces timeout results', function() {
    let time = 100;
    const meter = createBudgetMeter({ maxNodes: 1, maxTicks: 2, maxActions: 1, maxWallTimeMs: 5 }, () => time);
    meter.recordNode();
    meter.recordTick(2);
    meter.recordAction();
    expect(meter.isExceeded()).to.equal(false);
    time = 106;
    expect(meter.isExceeded()).to.equal(true);
    const result = meter.timeoutResult();
    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.TIMEOUT);
    expect(result.explanations[0].code).to.equal(SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED);
  });
});

describe('SolverFixtures', function() {
  it('creates deterministic synthetic fixtures with mask helpers', function() {
    const flat = createFlatWalkFixture();
    const gap = createSmallGapFixture();
    expect(flat.groundMask[52 * flat.width]).to.equal(1);
    expect(gap.groundMask[58 * gap.width + 52]).to.equal(0);
    fillRect(gap.groundMask, gap.width, gap.height, { x: 50, y: 58, width: 4, height: 4 }, 1);
    expect(gap.groundMask[58 * gap.width + 52]).to.equal(1);
  });
});
