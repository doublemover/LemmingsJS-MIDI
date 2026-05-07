import { expect } from 'chai';
import {
  createBarrierFixture,
  createSmallGapFixture
} from '../js/solver/SolverFixtures.js';
import { analyzeSolverAffordances } from '../js/solver/SolverAnalysis.js';
import {
  buildReachabilityGraph,
  invalidateReachabilityGraph
} from '../js/solver/ReachabilityGraph.js';
import { SOLVER_EXPLANATION_CODES } from '../js/solver/SolverTypes.js';

describe('solver analysis and reachability graph', function () {
  it('reports hazards and steel-blocked destructive affordances deterministically', function () {
    const fixture = createBarrierFixture({
      hazards: [{ x: 90, y: 55, width: 5, height: 3, kind: 'water' }],
      steel: [{ x: 62, y: 48, width: 8, height: 10 }]
    });

    const first = analyzeSolverAffordances(fixture);
    const second = analyzeSolverAffordances(fixture);
    const basher = first.skillAffordances.find(entry => entry.skillType === 'basher');

    expect(first.analysisHash).to.equal(second.analysisHash);
    expect(first.hazards[0]).to.include({ kind: 'water', supported: true });
    expect(basher.blocked).to.equal(true);
    expect(basher.blockers.map(blocker => blocker.type)).to.include('steel');
    expect(basher.explanation.code).to.equal(
      SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL
    );
  });

  it('builds deterministic graph edges and invalidates mutation-overlapping data', function () {
    const graph = buildReachabilityGraph(createSmallGapFixture());
    const repeat = buildReachabilityGraph(createSmallGapFixture());
    const buildEdge = graph.edges.find(edge => edge.type === 'build');

    expect(graph.graphHash).to.equal(repeat.graphHash);
    expect(graph.nodes.some(node => node.type === 'entrance')).to.equal(true);
    expect(graph.nodes.some(node => node.type === 'exit')).to.equal(true);
    expect(buildEdge.requiredSkills).to.deep.equal(['builder']);
    expect(buildEdge.mutation).to.include({ kind: 'builder-bridge', skillType: 'builder' });

    const invalidation = invalidateReachabilityGraph(graph, buildEdge.mutation);
    expect(invalidation.requiresRebuild).to.equal(true);
    expect(invalidation.invalidatedEdgeIds).to.include(buildEdge.id);
  });
});
