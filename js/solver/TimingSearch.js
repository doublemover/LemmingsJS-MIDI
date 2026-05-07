import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult,
  normalizeSolverOptions
} from './SolverTypes.js';
import { planSolverRoute } from './RoutePlanner.js';
import { validateSaveCountForResult } from './SolverCrowd.js';
import { stableHash } from './SolverState.js';
import { verifyActionReplay } from './SolverRunner.js';

const DEFAULT_SKILL_FOR_EDGE = Object.freeze({
  build: 'builder',
  basher: 'basher',
  digger: 'digger',
  miner: 'miner',
  fall: 'floater',
  'blocker-turn': 'blocker'
});

const windowForSegment = (segment, fallbackTick) => {
  const raw = segment.roughActionWindow;
  if (raw) {
    return {
      start: Math.max(0, Math.floor(Number(raw.start) || 0)),
      end: Math.max(0, Math.floor(Number(raw.end) || 0))
    };
  }
  return {
    start: Math.max(0, fallbackTick - 6),
    end: fallbackTick + 6
  };
};

const actionForSegment = (segment, tickCursor) => {
  const skillType = segment.requiredSkillFamilies?.[0] ?? DEFAULT_SKILL_FOR_EDGE[segment.type] ?? null;
  if (!skillType) return null;
  const window = windowForSegment(segment, tickCursor);
  return {
    skillType,
    target: {
      kind: 'lemming',
      role: skillType === 'blocker' ? 'blocker-anchor' : 'frontier'
    },
    tick: null,
    window,
    preconditions: [
      { type: 'skillAvailable', skillType, count: 1 },
      'target-active'
    ],
    expectedPostconditions: [
      { type: 'activeCountAtLeast', count: 1 }
    ],
    rationale: `Apply ${skillType} for ${segment.type} segment ${segment.index}.`
  };
};

const compactStats = stats => ({
  nodes: stats.nodes,
  ticksConsidered: stats.ticksConsidered,
  actionsConsidered: stats.actionsConsidered,
  prunedEquivalentStates: stats.prunedEquivalentStates,
  prunedImpossiblePreconditions: stats.prunedImpossiblePreconditions,
  prunedDominatedScripts: stats.prunedDominatedScripts,
  bestFailureReason: stats.bestFailureReason
});

const buildCandidateScript = routeSkeleton => {
  const actions = [];
  let tickCursor = 0;
  for (const segment of routeSkeleton.segments ?? []) {
    tickCursor += 12;
    const action = actionForSegment(segment, tickCursor);
    if (!action) continue;
    actions.push(action);
    tickCursor = Math.max(tickCursor, action.window.end);
  }
  return actions;
};

const searchActionTiming = (runnerOrSource, routeOrInput = null, options = {}) => {
  const normalized = normalizeSolverOptions(options);
  const stats = {
    nodes: 0,
    ticksConsidered: 0,
    actionsConsidered: 0,
    prunedEquivalentStates: 0,
    prunedImpossiblePreconditions: 0,
    prunedDominatedScripts: 0,
    bestFailureReason: null
  };
  const routeSkeleton = routeOrInput?.kind === 'solver-route-skeleton'
    ? routeOrInput
    : routeOrInput?.routeSkeleton ??
      planSolverRoute(routeOrInput ?? runnerOrSource, options).routeSkeleton;
  if (!routeSkeleton) {
    const result = createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      summary: 'Timing search has no route skeleton to schedule',
      explanations: [SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT],
      budgetUsage: { nodes: 1 }
    });
    result.timingSearchStats = compactStats({ ...stats, nodes: 1 });
    return result;
  }

  const seenStateKeys = new Set();
  const actions = buildCandidateScript(routeSkeleton);
  stats.actionsConsidered = actions.length;
  stats.ticksConsidered = actions.reduce((sum, action) => {
    return sum + Math.max(1, action.window.end - action.window.start + 1);
  }, 0);
  stats.nodes = Math.max(1, actions.length + 1);
  if (stats.nodes > normalized.maxNodes || actions.length > normalized.maxActions) {
    const result = createSolverResult({
      resultType: SOLVER_RESULT_TYPES.TIMEOUT,
      summary: 'Timing search exhausted deterministic budget',
      explanations: [SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED],
      budgetUsage: {
        nodes: stats.nodes,
        actions: actions.length,
        ticks: stats.ticksConsidered
      }
    });
    result.timingSearchStats = compactStats(stats);
    result.routeSkeleton = routeSkeleton;
    return result;
  }

  const canonicalKey = stableHash(actions.map(action => ({
    skillType: action.skillType,
    target: action.target,
    window: action.window
  })));
  if (seenStateKeys.has(canonicalKey)) {
    stats.prunedEquivalentStates += 1;
  }
  seenStateKeys.add(canonicalKey);

  const narrow = actions.find(action => action.window.end < action.window.start);
  if (narrow) {
    stats.prunedImpossiblePreconditions += 1;
    stats.bestFailureReason = SOLVER_EXPLANATION_CODES.TIMING_WINDOW_TOO_NARROW;
    const result = createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      summary: 'Timing search found an impossible action window',
      actions,
      explanations: [SOLVER_EXPLANATION_CODES.TIMING_WINDOW_TOO_NARROW],
      budgetUsage: {
        nodes: stats.nodes,
        actions: actions.length,
        ticks: stats.ticksConsidered
      }
    });
    result.timingSearchStats = compactStats(stats);
    result.routeSkeleton = routeSkeleton;
    return result;
  }

  const replay = options.verify === false
    ? createSolverResult({
      resultType: SOLVER_RESULT_TYPES.UNKNOWN,
      summary: 'Timing candidate generated; runtime replay was skipped by option',
      actions,
      budgetUsage: {
        nodes: stats.nodes,
        actions: actions.length,
        ticks: stats.ticksConsidered
      }
    })
    : verifyActionReplay(runnerOrSource, actions, normalized);
  const result = options.crowd
    ? validateSaveCountForResult(replay, options.crowd, normalized)
    : replay;
  result.timingSearchStats = compactStats(stats);
  result.routeSkeleton = routeSkeleton;
  result.candidateScriptHash = stableHash(actions);
  return result;
};

export {
  searchActionTiming
};
