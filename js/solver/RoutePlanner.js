import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult,
  normalizeSolverOptions
} from './SolverTypes.js';
import { buildReachabilityGraph } from './ReachabilityGraph.js';
import { analyzeSolverCrowd } from './SolverCrowd.js';
import { stableHash } from './SolverState.js';

const EDGE_TYPE_ORDER = Object.freeze({
  spawn: 0,
  walk: 1,
  step: 2,
  fall: 3,
  build: 4,
  blocker: 5,
  'blocker-turn': 5,
  basher: 6,
  digger: 7,
  miner: 8,
  exit: 9
});

const DESTRUCTIVE_TYPES = new Set(['basher', 'digger', 'miner']);

const edgeCost = edge => {
  const skillCost = (edge.requiredSkillCount ?? edge.requiredSkills?.length ?? 0) * 100;
  const destructiveCost = DESTRUCTIVE_TYPES.has(edge.type) ? 25 : 0;
  const hazardCost = (edge.hazardExposure?.length ?? 0) * 1000;
  const blockedCost = edge.blocked ? 10000 : 0;
  const uncertaintyCost = (edge.uncertainty ?? 0) * 20;
  const distanceCost = Math.max(0, Math.floor(edge.distance ?? 0));
  const timingCost = edge.roughTimingWindow
    ? Math.max(0, Math.floor(edge.roughTimingWindow.end - edge.roughTimingWindow.start))
    : 0;
  return skillCost + destructiveCost + hazardCost + blockedCost + uncertaintyCost + distanceCost + timingCost;
};

const routeScoreBreakdown = edges => ({
  skillCount: edges.reduce((sum, edge) => sum + (edge.requiredSkillCount ?? edge.requiredSkills?.length ?? 0), 0),
  destructiveActions: edges.filter(edge => DESTRUCTIVE_TYPES.has(edge.type)).length,
  hazardExposure: edges.reduce((sum, edge) => sum + (edge.hazardExposure?.length ?? 0), 0),
  uncertainty: edges.reduce((sum, edge) => sum + (edge.uncertainty ?? 0), 0),
  timingDifficulty: edges.reduce((sum, edge) => {
    if (!edge.roughTimingWindow) return sum;
    return sum + Math.max(0, edge.roughTimingWindow.end - edge.roughTimingWindow.start);
  }, 0),
  distance: edges.reduce((sum, edge) => sum + Math.max(0, edge.distance ?? 0), 0),
  total: edges.reduce((sum, edge) => sum + edgeCost(edge), 0)
});

const sortEdges = edges => [...edges].sort((left, right) => (
  edgeCost(left) - edgeCost(right) ||
  (EDGE_TYPE_ORDER[left.type] ?? 99) - (EDGE_TYPE_ORDER[right.type] ?? 99) ||
  String(left.id).localeCompare(String(right.id))
));

const buildAdjacency = graph => {
  const adjacency = new Map();
  for (const edge of sortEdges(graph.edges)) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  return adjacency;
};

const hasUsableSkills = (edge, options) => {
  if (!edge.requiredSkills?.length) return true;
  const subset = new Set(options.skillSubset);
  if (subset.size && edge.requiredSkills.some(skill => !subset.has(skill))) return false;
  if (edge.availableSkillCount != null && edge.requiredSkillCount != null) {
    return edge.availableSkillCount >= edge.requiredSkillCount;
  }
  return true;
};

const isDestructiveAllowed = (edge, options) => {
  if (!DESTRUCTIVE_TYPES.has(edge.type)) return true;
  if (options.allowDestructiveSkills === false) return false;
  return true;
};

const createRouteSkeleton = (graph, edges) => {
  const scoreBreakdown = routeScoreBreakdown(edges);
  const skeleton = {
    kind: 'solver-route-skeleton',
    graphHash: graph.graphHash,
    nodeIds: edges.length
      ? [edges[0].from, ...edges.map(edge => edge.to)]
      : [],
    edgeIds: edges.map(edge => edge.id),
    segments: edges.map((edge, index) => ({
      index,
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      requiredSkillFamilies: edge.requiredSkills ?? [],
      requiredSkillCount: edge.requiredSkillCount ?? edge.requiredSkills?.length ?? 0,
      roughActionWindow: edge.roughTimingWindow ?? null,
      mutation: edge.mutation ?? null,
      hazardExposure: edge.hazardExposure ?? [],
      explanation: edge.blocked ? 'blocked edge retained for failure reporting' : null
    })),
    scoreBreakdown
  };
  skeleton.routeHash = stableHash(skeleton);
  return skeleton;
};

const planSolverRoute = (input, options = {}) => {
  const normalized = {
    ...normalizeSolverOptions(options),
    allowDestructiveSkills: options.allowDestructiveSkills !== false
  };
  const graph = options.graph ?? buildReachabilityGraph(input, options);
  const crowd = options.crowd ?? analyzeSolverCrowd(input, options);
  if (crowd.targetSaveCount > 0 && crowd.maximumReachableSaveCount < crowd.targetSaveCount) {
    const result = createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      summary: `Save target ${crowd.targetSaveCount} exceeds reachable crowd count ${crowd.maximumReachableSaveCount}`,
      explanations: [{
        code: SOLVER_EXPLANATION_CODES.SAVE_COUNT_UNREACHABLE,
        detail: 'Route planning stopped before timing search because the crowd cannot satisfy the save target.',
        data: {
          targetSaveCount: crowd.targetSaveCount,
          maximumReachableSaveCount: crowd.maximumReachableSaveCount
        }
      }],
      budgetUsage: { nodes: 1 }
    });
    result.crowd = crowd;
    result.graphHash = graph.graphHash;
    return result;
  }

  const adjacency = buildAdjacency(graph);
  const exitSet = new Set(graph.exitNodeIds);
  const queue = graph.entranceNodeIds.map(nodeId => ({
    nodeId,
    edges: [],
    score: 0
  }));
  const bestScoreByNode = new Map(queue.map(item => [item.nodeId, 0]));
  const stats = {
    nodes: 0,
    edgesConsidered: 0,
    pruned: 0,
    bestFailureReason: null
  };

  while (queue.length) {
    queue.sort((left, right) => left.score - right.score || left.nodeId.localeCompare(right.nodeId));
    const current = queue.shift();
    stats.nodes += 1;
    if (stats.nodes > normalized.maxNodes) {
      const result = createSolverResult({
        resultType: SOLVER_RESULT_TYPES.TIMEOUT,
        summary: 'Route planner exhausted node budget',
        explanations: [SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED],
        budgetUsage: { nodes: stats.nodes }
      });
      result.routeSearchStats = stats;
      result.graphHash = graph.graphHash;
      return result;
    }
    if (exitSet.has(current.nodeId)) {
      const routeSkeleton = createRouteSkeleton(graph, current.edges);
      const result = createSolverResult({
        resultType: SOLVER_RESULT_TYPES.UNKNOWN,
        summary: 'Route skeleton selected; exact timing and runtime replay still required',
        explanations: [],
        budgetUsage: { nodes: stats.nodes, actions: routeSkeleton.segments.length }
      });
      result.routeSkeleton = routeSkeleton;
      result.routeSearchStats = stats;
      result.graphHash = graph.graphHash;
      result.crowd = crowd;
      return result;
    }

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      stats.edgesConsidered += 1;
      if (edge.blocked) {
        stats.pruned += 1;
        stats.bestFailureReason = edge.blockers?.[0]?.type === 'steel'
          ? SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL
          : SOLVER_EXPLANATION_CODES.HAZARD_UNAVOIDABLE;
        continue;
      }
      if (!hasUsableSkills(edge, normalized) || !isDestructiveAllowed(edge, normalized)) {
        stats.pruned += 1;
        stats.bestFailureReason = SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT;
        continue;
      }
      const score = current.score + edgeCost(edge);
      const previous = bestScoreByNode.get(edge.to);
      if (previous != null && previous <= score) {
        stats.pruned += 1;
        continue;
      }
      bestScoreByNode.set(edge.to, score);
      queue.push({
        nodeId: edge.to,
        edges: [...current.edges, edge],
        score
      });
    }
  }

  const explanationCode = stats.bestFailureReason ?? SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT;
  const result = createSolverResult({
    resultType: SOLVER_RESULT_TYPES.FAILED,
    summary: 'No route skeleton reaches the exit within supported graph edges',
    explanations: [{
      code: explanationCode,
      detail: 'Reachability graph search exhausted all deterministic candidates.'
    }],
    budgetUsage: { nodes: stats.nodes }
  });
  result.routeSearchStats = stats;
  result.graphHash = graph.graphHash;
  result.crowd = crowd;
  return result;
};

export {
  planSolverRoute
};
