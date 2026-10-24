import { expect } from 'chai';
import { createSyntheticSolverFixture } from '../js/solver/SolverFixtures.js';
import { analyzeSolverGeometry } from '../js/solver/SolverGeometry.js';
import { buildReachabilityGraph } from '../js/solver/ReachabilityGraph.js';
import { planSolverRoute } from '../js/solver/RoutePlanner.js';

const islands = (entrances, exits) => createSyntheticSolverFixture({ width: 240, height: 80,
  ground: [{ x: 0, y: 50, width: 40, height: 4 }, { x: 180, y: 50, width: 40, height: 4 }],
  entrances, exits, skills: {}, needCount: 0, lemmings: [] });
const at = x => ({ x, y: 49 });
describe('identity-preserving solver endpoint bindings', () => {
  const route = fixture => {
    const graph = buildReachabilityGraph(fixture), result = planSolverRoute(fixture, { graph,
      crowd: { targetSaveCount: 0, maximumReachableSaveCount: 0 } });
    expect(result.resultType).to.equal('unknown'); return { graph, result };
  };
  it('starts a right-island skeleton at the actual right entrance', () => {
    const { graph, result } = route(islands([at(10), at(190)], [at(200)]));
    expect(graph.edges.filter(edge => edge.type === 'spawn').map(edge => [edge.from, edge.to])).to.deep.equal([
      ['entrance:0', 'surface:0'], ['entrance:1', 'surface:1']]);
    expect(result.routeSkeleton.nodeIds).to.deep.equal(['entrance:1', 'surface:1', 'exit:0']);
  });
  it('terminates at the actual right exit with a right-only entrance', () => {
    const { graph, result } = route(islands([at(190)], [at(20), at(200)]));
    expect(graph.edges.filter(edge => edge.type === 'exit').map(edge => [edge.from, edge.to])).to.deep.equal([
      ['surface:0', 'exit:0'], ['surface:1', 'exit:1']]);
    expect(result.routeSkeleton.nodeIds).to.deep.equal(['entrance:0', 'surface:1', 'exit:1']);
  });
  it('retains an unresolved first endpoint without shifting the next binding', () => {
    const fixture = islands([at(100), at(190)], [at(100), at(200)]), geometry = analyzeSolverGeometry(fixture);
    expect(geometry.routeContinuity.entranceBindings.map(binding => [binding.endpointIndex, binding.surfaceId])).to.deep.equal([[0, null], [1, 1]]);
    expect(geometry.routeContinuity.exitBindings.map(binding => [binding.endpointIndex, binding.surfaceId])).to.deep.equal([[0, null], [1, 1]]);
    const { result, graph } = route(fixture);
    expect(graph.nodes.find(node => node.id === 'entrance:0').bindingStatus).to.equal('unresolved');
    expect(result.routeSkeleton.nodeIds).to.deep.equal(['entrance:1', 'surface:1', 'exit:1']);
  });
  it('allows shared local surfaces and recomputes bindings after endpoint and terrain changes', () => {
    for (const entries of [[at(10), at(190)], [at(190), at(10)]]) {
      const fixture = islands(entries, [at(200)]), graph = buildReachabilityGraph(fixture);
      for (const edge of graph.edges.filter(edge => edge.type === 'spawn')) {
        const index = Number(edge.from.split(':')[1]); expect(edge.to).to.equal(entries[index].x < 100 ? 'surface:0' : 'surface:1');
      }
    }
    const fixture = islands([at(185), at(190)], [at(200), at(205)]);
    const before = buildReachabilityGraph(fixture); expect(before.edges.filter(edge => edge.type === 'spawn').every(edge => edge.to === 'surface:1')).to.equal(true);
    fixture.entrances[0].x = 10; fixture.groundMask.fill(0, 50 * 240 + 180, 50 * 240 + 220);
    const after = buildReachabilityGraph(fixture); expect(after.graphHash).not.to.equal(before.graphHash);
    expect(after.nodes.find(node => node.id === 'entrance:0').surfaceId).to.equal(0);
    expect(after.nodes.find(node => node.id === 'entrance:1').surfaceId).not.to.equal(0);
  });
});
