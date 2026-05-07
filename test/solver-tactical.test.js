import { expect } from 'chai';
import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES
} from '../js/solver/SolverTypes.js';
import {
  createBarrierFixture,
  createFlatWalkFixture,
  createSmallGapFixture,
  createSyntheticSolverFixture
} from '../js/solver/SolverFixtures.js';
import { solveTactical } from '../js/solver/TacticalSolver.js';

const explanationCodes = result => result.explanations.map(explanation => explanation.code);

const expectActionContract = action => {
  expect(action.skillType).to.be.a('string').and.not.equal('');
  expect(action.target).to.be.an('object');
  expect(action.tick).to.be.a('number');
  expect(action.window).to.include.keys(['start', 'end']);
  expect(action.preconditions).to.be.an('array').and.not.empty;
  expect(action.expectedPostconditions).to.be.an('array').and.not.empty;
  expect(action.rationale).to.be.a('string').and.not.equal('');
};

describe('TacticalSolver', function() {
  it('bridges a small local gap with a builder script', function() {
    const result = solveTactical(createSmallGapFixture());

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.actions).to.have.lengthOf(1);
    expect(result.actions[0].skillType).to.equal('builder');
    expectActionContract(result.actions[0]);
    expect(result.budgetUsage.actions).to.equal(1);
    expect(result.replaySummary).to.deep.equal({
      verifier: 'local-tactical-fixture',
      verified: true
    });
  });

  it('clears a simple barrier with a destructive skill script', function() {
    const result = solveTactical(createBarrierFixture({
      skills: { basher: 1 }
    }));

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.actions).to.have.lengthOf(1);
    expect(result.actions[0].skillType).to.equal('basher');
    expect(result.actions[0].expectedPostconditions[0]).to.include('clears simple barrier');
    expectActionContract(result.actions[0]);
  });

  it('assigns a floater before a lethal local fall', function() {
    const fixture = createSyntheticSolverFixture({
      id: 'floater-fall',
      width: 100,
      height: 140,
      ground: [
        { x: 0, y: 24, width: 32, height: 4 },
        { x: 48, y: 116, width: 52, height: 4 }
      ],
      entrances: [{ x: 10, y: 23 }],
      exits: [{ x: 84, y: 115 }],
      lemmings: [{ id: 7, x: 12, y: 23, lookRight: true, action: 'walking' }],
      skills: { floater: 1 }
    });
    fixture.fall = {
      x: 34,
      fromY: 23,
      toY: 115,
      safeFallDistance: 60,
      assignmentTick: 48
    };

    const result = solveTactical(fixture);

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.actions).to.have.lengthOf(1);
    expect(result.actions[0].skillType).to.equal('floater');
    expect(result.actions[0].tick).to.equal(48);
    expect(result.actions[0].target.id).to.equal(7);
    expectActionContract(result.actions[0]);
  });

  it('places a blocker for a supported local turnaround', function() {
    const fixture = createFlatWalkFixture({
      id: 'blocker-turnaround',
      skills: { blocker: 1 }
    });
    fixture.blockerTurnaround = {
      x: 28,
      y: 51,
      assignmentTick: 24
    };

    const result = solveTactical(fixture);

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(result.actions).to.have.lengthOf(1);
    expect(result.actions[0].skillType).to.equal('blocker');
    expect(result.actions[0].target.role).to.equal('turnaround-anchor');
    expect(result.actions[0].expectedPostconditions[0]).to.include('crowd turns');
    expectActionContract(result.actions[0]);
  });

  it('fails with a no-route explanation when a gap has no builder support', function() {
    const result = solveTactical(createSmallGapFixture({
      skills: {}
    }));

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.FAILED);
    expect(explanationCodes(result)).to.include(SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT);
    expect(result.summary).to.include('No route');
  });

  it('fails when a gap exceeds the available builder budget', function() {
    const result = solveTactical(createSyntheticSolverFixture({
      id: 'large-gap',
      width: 160,
      height: 80,
      ground: [
        { x: 0, y: 62, width: 32, height: 4 },
        { x: 98, y: 62, width: 62, height: 4 }
      ],
      entrances: [{ x: 8, y: 61 }],
      exits: [{ x: 140, y: 61 }],
      lemmings: [{ id: 0, x: 18, y: 61, lookRight: true, action: 'walking' }],
      skills: { builder: 2 }
    }));

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.FAILED);
    expect(explanationCodes(result)).to.include(SOLVER_EXPLANATION_CODES.GAP_EXCEEDS_BUILDER_BUDGET);
    expect(result.explanations[0].data.neededBuilders).to.be.greaterThan(2);
  });

  it('fails when a destructive barrier path intersects steel', function() {
    const result = solveTactical(createBarrierFixture({
      steel: [{ x: 62, y: 48, width: 8, height: 10 }],
      skills: { basher: 1 }
    }));

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.FAILED);
    expect(explanationCodes(result)).to.include(SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL);
    expect(result.summary).to.include('steel');
  });

  it('returns unsupported for mechanics outside tactical scope', function() {
    const fixture = createFlatWalkFixture();
    fixture.requiredMechanic = 'climber-route';

    const result = solveTactical(fixture);

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.UNSUPPORTED);
    expect(explanationCodes(result)).to.include(SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC);
    expect(result.explanations[0].detail).to.include('climber-route');
  });

  it('returns unknown when a barrier exceeds the bounded local solver', function() {
    const result = solveTactical(createSyntheticSolverFixture({
      id: 'tall-barrier',
      width: 140,
      height: 90,
      ground: [
        { x: 0, y: 72, width: 140, height: 4 },
        { x: 62, y: 40, width: 8, height: 32 }
      ],
      entrances: [{ x: 12, y: 71 }],
      exits: [{ x: 120, y: 71 }],
      lemmings: [{ id: 0, x: 20, y: 71, lookRight: true, action: 'walking' }],
      skills: { basher: 1 }
    }));

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.UNKNOWN);
    expect(explanationCodes(result)).to.include(SOLVER_EXPLANATION_CODES.STATE_EXPLOSION);
    expect(result.summary).to.include('bounds');
  });

  it('returns timeout when node budget is exhausted', function() {
    const result = solveTactical(createSmallGapFixture(), {
      maxNodes: 1
    });

    expect(result.resultType).to.equal(SOLVER_RESULT_TYPES.TIMEOUT);
    expect(explanationCodes(result)).to.include(SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED);
    expect(result.budgetUsage.nodes).to.be.greaterThan(1);
  });
});
