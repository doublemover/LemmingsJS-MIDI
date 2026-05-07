import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult,
  normalizeSolverOptions
} from './SolverTypes.js';
import { extractSolverState, isSolverState, stableHash } from './SolverState.js';

const actionName = lemming => String(lemming.action ?? lemming.state ?? '').toLowerCase();

const isDead = lemming => (
  lemming.dead === true ||
  lemming.removed === true ||
  ['dead', 'splatted', 'splatting', 'drowning', 'frying', 'out_of_level'].includes(actionName(lemming))
);

const isSaved = lemming => lemming.saved === true || actionName(lemming).includes('exit');

const isActive = lemming => !isDead(lemming) && !isSaved(lemming) && lemming.disabled !== true;

const roleRecord = (role, lemming, reason) => ({
  role,
  lemmingId: lemming?.id ?? null,
  x: lemming?.x ?? null,
  y: lemming?.y ?? null,
  reason
});

const uniqueRoles = roles => {
  const seen = new Set();
  const out = [];
  for (const role of roles) {
    const key = `${role.role}:${role.lemmingId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out;
};

const analyzeSolverCrowd = (input, options = {}) => {
  const snapshot = isSolverState(input) ? input : extractSolverState(input, options);
  const normalized = normalizeSolverOptions(options);
  const lemmings = snapshot.lemmings.map(lemming => ({
    ...lemming,
    saved: isSaved(lemming),
    dead: isDead(lemming),
    active: isActive(lemming),
    fallDistance: Number.isFinite(Number(lemming.fallDistance)) ? Math.max(0, Math.floor(lemming.fallDistance)) : 0
  }));
  const active = lemmings.filter(lemming => lemming.active)
    .sort((left, right) => left.x - right.x || left.y - right.y || Number(left.id) - Number(right.id));
  const savedCount = lemmings.filter(lemming => lemming.saved).length ||
    snapshot.victory.survivorsCount;
  const deadCount = lemmings.filter(lemming => lemming.dead).length;
  const leftCount = snapshot.victory.leftCount;
  const releaseCount = snapshot.victory.releaseCount || lemmings.length;
  const targetSaveCount = normalized.targetSaveCount || snapshot.victory.needCount || 1;
  const maximumReachableSaveCount = savedCount + active.length + leftCount;
  const frontier = [...active].sort((left, right) => (
    right.x - left.x ||
    left.y - right.y ||
    Number(left.id) - Number(right.id)
  ))[0] ?? null;
  const lead = active[0] ?? null;
  const rescue = active.find(lemming => lemming.fallDistance > 0) ?? null;
  const blockerAnchor = active.find(lemming => actionName(lemming).includes('block')) ?? lead;
  const builderCandidate = frontier ?? lead;
  const roles = uniqueRoles([
    roleRecord('lead', lead, 'earliest active lemming in deterministic order'),
    roleRecord('frontier', frontier, 'rightmost active lemming for forward route progress'),
    roleRecord('builder-candidate', builderCandidate, 'frontier lemming has first chance to bridge or climb route gaps'),
    roleRecord('blocker-anchor', blockerAnchor, 'candidate for simple crowd turnaround or hold'),
    roleRecord('crowd-representative', lead, 'stable representative for trailing crowd state'),
    roleRecord('rescue-candidate', rescue, rescue ? 'active lemming currently carrying fall risk' : 'no immediate rescue target')
  ]);
  const crowd = {
    kind: 'solver-crowd-analysis',
    stateHash: snapshot.snapshotHash,
    targetSaveCount,
    savedCount,
    deadCount,
    activeCount: active.length,
    leftCount,
    releaseCount,
    maximumReachableSaveCount,
    routeSuccessCanSatisfySaveCount: maximumReachableSaveCount >= targetSaveCount,
    roles,
    crowdRisk: {
      saveCountUnreachable: maximumReachableSaveCount < targetSaveCount,
      activeHazardCount: active.filter(lemming => lemming.fallDistance > 0).length,
      blockerNeeded: active.length > 1 && snapshot.skills.counts.blocker > 0
    }
  };
  crowd.crowdHash = stableHash(crowd);
  return crowd;
};

const validateSaveCountForResult = (result, crowd, options = {}) => {
  const targetSaveCount = Math.max(0, Math.floor(
    Number(options.targetSaveCount ?? crowd?.targetSaveCount ?? 1) || 0
  ));
  const savedCount = Math.max(0, Math.floor(Number(
    result?.replaySummary?.savedCount ?? crowd?.savedCount ?? 0
  ) || 0));
  if (result?.resultType !== SOLVER_RESULT_TYPES.SOLVED || savedCount >= targetSaveCount) {
    return result;
  }
  const next = createSolverResult({
    resultType: SOLVER_RESULT_TYPES.FAILED,
    summary: `Route replay saved ${savedCount} of ${targetSaveCount} required lemming(s)`,
    actions: result.actions,
    explanations: [{
      code: SOLVER_EXPLANATION_CODES.SAVE_COUNT_UNREACHABLE,
      detail: 'The action script reaches a route goal but fails the required save count.',
      data: { savedCount, targetSaveCount }
    }],
    budgetUsage: result.budgetUsage,
    replaySummary: result.replaySummary,
    captures: result.captures
  });
  next.crowd = crowd;
  return next;
};

export {
  analyzeSolverCrowd,
  validateSaveCountForResult
};
