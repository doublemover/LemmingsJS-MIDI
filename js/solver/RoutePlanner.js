import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult,
  normalizeSolverOptions,
  createBudgetMeter
} from './SolverTypes.js';
import { buildReachabilityGraph } from './ReachabilityGraph.js';
import { analyzeSolverCrowd } from './SolverCrowd.js';
import { extractSolverState, isSolverState, stableHash } from './SolverState.js';
import { compareSolverKeys, createSolverSearchFrontier } from './SolverSearchFrontier.js';

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
const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const requiredSkills = edge => {
  if (edge.requiredSkillCounts) return { ...edge.requiredSkillCounts };
  const families = [...new Set(edge.requiredSkills || [])], count = edge.requiredSkillCount ?? families.length;
  if (!families.length) return count ? null : {};
  if (families.length > 1 && count !== families.length) return null;
  return Object.fromEntries(families.map(skill => [skill, families.length === 1 ? count : 1]));
};
const skillTotal = edge => Object.values(requiredSkills(edge) || {}).reduce((sum, count) => sum + count, 0);
const mutationCost = edge => nonnegative(edge.terrainMutationCost ?? (edge.mutation?.affectedBounds
  ? edge.mutation.affectedBounds.width * edge.mutation.affectedBounds.height : 0));
const fallRisk = edge => nonnegative(edge.fallRisk ?? (edge.type === 'fall' ? edge.fallDistance ?? edge.distance : 0));

const edgeCost = edge => {
  const skillCost = skillTotal(edge) * 100;
  const destructiveCost = DESTRUCTIVE_TYPES.has(edge.type) ? 25 : 0;
  const hazardCost = (edge.hazardExposure?.length ?? 0) * 1000;
  const blockedCost = edge.blocked ? 10000 : 0;
  const uncertaintyCost = (edge.uncertainty ?? 0) * 20;
  const distanceCost = Math.max(0, Math.floor(edge.distance ?? 0));
  const timingCost = edge.roughTimingWindow
    ? Math.max(0, Math.floor(edge.roughTimingWindow.end - edge.roughTimingWindow.start))
    : 0;
  return skillCost + destructiveCost + hazardCost + blockedCost + uncertaintyCost + distanceCost + timingCost + fallRisk(edge) * 100 + mutationCost(edge) / 16;
};

const routeScoreBreakdown = edges => ({
  skillCount: edges.reduce((sum, edge) => sum + skillTotal(edge), 0),
  destructiveActions: edges.filter(edge => DESTRUCTIVE_TYPES.has(edge.type)).length,
  hazardExposure: edges.reduce((sum, edge) => sum + (edge.hazardExposure?.length ?? 0), 0),
  uncertainty: edges.reduce((sum, edge) => sum + (edge.uncertainty ?? 0), 0),
  timingDifficulty: edges.reduce((sum, edge) => {
    if (!edge.roughTimingWindow) return sum;
    return sum + Math.max(0, edge.roughTimingWindow.end - edge.roughTimingWindow.start);
  }, 0),
  distance: edges.reduce((sum, edge) => sum + Math.max(0, edge.distance ?? 0), 0),
  fallRisk: edges.reduce((sum, edge) => sum + fallRisk(edge), 0),
  terrainMutationCost: edges.reduce((sum, edge) => sum + mutationCost(edge), 0),
  total: edges.reduce((sum, edge) => sum + edgeCost(edge), 0)
});

const sortEdges = edges => [...edges].sort((left, right) => (
  edgeCost(left) - edgeCost(right) ||
  (EDGE_TYPE_ORDER[left.type] ?? 99) - (EDGE_TYPE_ORDER[right.type] ?? 99) ||
  compareSolverKeys(String(left.id), String(right.id))
));

const buildAdjacency = graph => {
  const adjacency = new Map();
  for (const edge of sortEdges(graph.edges)) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  return adjacency;
};

const isDestructiveAllowed = (edge, options) => {
  if (!DESTRUCTIVE_TYPES.has(edge.type)) return true;
  if (options.allowDestructiveSkills === false) return false;
  return true;
};

const createRouteSkeleton = (graph, edges, resources = {}) => {
  const scoreBreakdown = routeScoreBreakdown(edges);
  const skeleton = {
    kind: 'solver-route-skeleton',
    graphHash: graph.graphHash,
    ...resources,
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
      requiredSkillCount: skillTotal(edge),
      requiredSkillCounts: requiredSkills(edge),
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
  const meter = createBudgetMeter(normalized, options.now), subset = new Set(normalized.skillSubset);
  const snapshot = options.graph != null && options.crowd != null
    ? input
    : (isSolverState(input) ? input : extractSolverState(input, options));
  const graph = options.graph ?? buildReachabilityGraph(snapshot, options);
  const crowd = options.crowd ?? analyzeSolverCrowd(snapshot, options);
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
  const skillNames = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];
  const counts = options.skillCounts ?? snapshot?.skills?.counts ?? snapshot?.skills ?? graph.skillCounts;
  const inventory = Object.fromEntries(skillNames.map(skill => [skill, counts ? nonnegative(counts[skill]) : null]));
  if (!counts) for (const edge of graph.edges) for (const skill of edge.requiredSkills || []) {
    if (Object.hasOwn(inventory, skill) && Number.isSafeInteger(edge.availableSkillCount) && edge.availableSkillCount >= 0)
      inventory[skill] = inventory[skill] == null ? edge.availableSkillCount : Math.min(inventory[skill], edge.availableSkillCount);
  }
  let serial = 0, admitted = 0;
  const queue = createSolverSearchFrontier((a, b) => a.score - b.score || compareSolverKeys(String(a.nodeId), String(b.nodeId)) || a.serial - b.serial, normalized.maxNodes);
  const labels = new Map();
  const dominates = (a, b) => a.score <= b.score && a.actions <= b.actions && a.ticks <= b.ticks && skillNames.every(skill => (a.used[skill] || 0) <= (b.used[skill] || 0));
  const stats = {
    nodes: 0,
    edgesConsidered: 0,
    pruned: 0,
    prunedResources: 0,
    prunedDominated: 0,
    prunedBudgets: 0,
    admitted: 0,
    bestFailureReason: null,
    estimates: 'actions are required skill assignments; ticks are cumulative edge estimates, not runtime replay'
  };
  const finish = (resultType, summary, explanations, current = null) => {
    const result = createSolverResult({ resultType, summary, explanations,
      budgetUsage: { ...meter.usage(), actions: current?.actions || 0, ticks: current?.ticks || 0 } });
    result.routeSearchStats = { ...stats, admitted }; result.graphHash = graph.graphHash; result.crowd = crowd; return result;
  };
  const timeout = detail => finish(SOLVER_RESULT_TYPES.TIMEOUT, 'Route planner exhausted a declared search budget', [{ code: SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED, detail }]);
  const admit = label => {
    const previous = labels.get(label.nodeId) || [];
    if (previous.some(other => other.active && dominates(other, label))) { stats.pruned++; stats.prunedDominated++; return true; }
    if (admitted >= normalized.maxNodes) return false;
    for (const other of previous) if (other.active && dominates(label, other)) { other.active = false; stats.prunedDominated++; }
    label.serial = serial++; label.active = true; admitted++;
    labels.set(label.nodeId, [...previous.filter(other => other.active), label]); return queue.push(label);
  };
  for (const nodeId of [...graph.entranceNodeIds].sort(compareSolverKeys)) {
    if (!admit({ nodeId, parent: null, edge: null, score: 0, actions: 0, ticks: 0, used: {} })) return timeout('bounded route frontier capacity');
  }
  while (queue.size) {
    if (meter.usage().wallTimeMs > normalized.maxWallTimeMs) return timeout('elapsed wall time');
    const current = queue.pop(); if (!current.active) continue;
    meter.recordNode(); stats.nodes++;
    if (exitSet.has(current.nodeId)) {
      const edges = []; for (let label = current; label.edge; label = label.parent) edges.push(label.edge); edges.reverse();
      const result = finish(SOLVER_RESULT_TYPES.UNKNOWN, 'Route skeleton selected; exact timing and runtime replay still required', [], current);
      result.routeSkeleton = createRouteSkeleton(graph, edges, { estimatedTicks: current.ticks, requiredSkillCounts: { ...current.used } });
      return result;
    }

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      stats.edgesConsidered += 1;
      if (meter.usage().wallTimeMs > normalized.maxWallTimeMs) return timeout('elapsed wall time during edge expansion');
      if (edge.blocked) {
        stats.pruned += 1;
        stats.bestFailureReason = edge.blockers?.[0]?.type === 'steel'
          ? SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL
          : SOLVER_EXPLANATION_CODES.HAZARD_UNAVOIDABLE;
        continue;
      }
      const required = requiredSkills(edge);
      if (!required || Object.entries(required).some(([skill, count]) => !skillNames.includes(skill) || !Number.isSafeInteger(count) || count < 0)) {
        stats.pruned++; stats.bestFailureReason = SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC; continue;
      }
      if (subset.size && Object.keys(required).some(skill => !subset.has(skill)) || !isDestructiveAllowed(edge, normalized)) {
        stats.pruned += 1;
        stats.bestFailureReason = SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT;
        continue;
      }
      const used = { ...current.used }; let unavailable = null;
      for (const [skill, count] of Object.entries(required)) {
        used[skill] = (used[skill] || 0) + count;
        if (inventory[skill] == null || used[skill] > inventory[skill]) unavailable = skill;
      }
      if (unavailable) { stats.pruned++; stats.prunedResources++; stats.bestFailureReason = unavailable === 'builder' ? SOLVER_EXPLANATION_CODES.GAP_EXCEEDS_BUILDER_BUDGET : SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT; continue; }
      const actions = current.actions + Object.values(required).reduce((sum, count) => sum + count, 0);
      const estimate = edge.estimatedTicks ?? Math.max(nonnegative(edge.distance), edge.roughTimingWindow ? nonnegative(edge.roughTimingWindow.end - edge.roughTimingWindow.start) : 0);
      if (!Number.isFinite(estimate) || estimate < 0) { stats.pruned++; stats.bestFailureReason = SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC; continue; }
      const ticks = current.ticks + Math.ceil(estimate);
      if (actions > normalized.maxActions || ticks > normalized.maxTicks) { stats.pruned++; stats.prunedBudgets++; continue; }
      const score = current.score + edgeCost(edge);
      if (!Number.isFinite(score) || score < current.score) { stats.pruned++; stats.bestFailureReason = SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC; continue; }
      if (!admit({ nodeId: edge.to, parent: current, edge, score, used, actions, ticks })) return timeout('bounded route frontier capacity');
    }
  }

  const explanationCode = stats.bestFailureReason ?? SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT;
  if (stats.prunedBudgets) return timeout('all remaining route candidates exceed action or estimated tick budgets');
  const result = finish(
    explanationCode === SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC ? SOLVER_RESULT_TYPES.UNSUPPORTED : SOLVER_RESULT_TYPES.FAILED,
    'No route skeleton reaches the exit within supported graph edges', [{
      code: explanationCode,
      detail: 'Reachability graph search exhausted all deterministic candidates.'
    }]);
  return result;
};

export {
  planSolverRoute
};
