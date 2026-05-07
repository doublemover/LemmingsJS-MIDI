import { analyzeSolverAffordances } from './SolverAnalysis.js';
import { buildReachabilityGraph, invalidateReachabilityGraph } from './ReachabilityGraph.js';
import { extractSolverState, hashMask, isSolverState, stableHash } from './SolverState.js';

const MUTATION_SKILLS = new Set(['builder', 'digger', 'basher', 'miner']);

const cloneMask = mask => {
  if (mask instanceof Uint8Array) return new Uint8Array(mask);
  if (ArrayBuffer.isView(mask)) return new Uint8Array(mask.buffer.slice(mask.byteOffset, mask.byteOffset + mask.byteLength));
  if (Array.isArray(mask)) return Uint8Array.from(mask);
  return new Uint8Array(0);
};

const clampRect = (snapshot, rect) => {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(snapshot.width, Math.ceil(rect.x + rect.width));
  const y2 = Math.min(snapshot.height, Math.ceil(rect.y + rect.height));
  return {
    x,
    y,
    width: Math.max(0, x2 - x),
    height: Math.max(0, y2 - y)
  };
};

const forEachRectPixel = (snapshot, rect, fn) => {
  const clipped = clampRect(snapshot, rect);
  for (let y = clipped.y; y < clipped.y + clipped.height; y += 1) {
    const row = y * snapshot.width;
    for (let x = clipped.x; x < clipped.x + clipped.width; x += 1) {
      fn(x, y, row + x);
    }
  }
};

const candidateFromAffordance = (snapshot, graph, affordance) => {
  if (!MUTATION_SKILLS.has(affordance.skillType)) return null;
  const affectedBounds = { ...affordance.rect };
  const candidate = {
    id: `mutation:${affordance.id}`,
    kind: affordance.type,
    skillType: affordance.skillType,
    fromSurfaceId: affordance.fromSurfaceId,
    toSurfaceId: affordance.toSurfaceId,
    affectedBounds,
    requiredSkillCount: affordance.requiredSkillCount,
    availableSkillCount: affordance.availableSkillCount,
    roughTimingWindow: affordance.roughTimingWindow,
    steelBlockers: affordance.blockers.filter(blocker => blocker.type === 'steel'),
    oneWayBlockers: affordance.blockers.filter(blocker => blocker.type === 'one-way'),
    expectedGraphInvalidation: invalidateReachabilityGraph(graph, { affectedBounds }),
    expectedNewSurfaces: affordance.toSurfaceId == null
      ? [{ generatedBy: affordance.id, bounds: affectedBounds }]
      : [],
    acceptedOnlyAfterReplay: snapshot.sourceKind !== 'synthetic'
  };
  candidate.blocked = candidate.steelBlockers.length > 0 || candidate.oneWayBlockers.length > 0;
  candidate.mutationHash = stableHash(candidate);
  return candidate;
};

const planTerrainMutations = (input, options = {}) => {
  const snapshot = isSolverState(input) ? input : extractSolverState(input, options);
  const graph = options.graph ?? buildReachabilityGraph(snapshot, options);
  const analysis = options.analysis ?? analyzeSolverAffordances(snapshot, options);
  const candidates = analysis.skillAffordances
    .map(affordance => candidateFromAffordance(snapshot, graph, affordance))
    .filter(Boolean)
    .sort((left, right) => (
      Number(left.blocked) - Number(right.blocked) ||
      left.affectedBounds.y - right.affectedBounds.y ||
      left.affectedBounds.x - right.affectedBounds.x ||
      left.skillType.localeCompare(right.skillType) ||
      left.id.localeCompare(right.id)
    ));
  const plan = {
    kind: 'solver-terrain-mutation-plan',
    stateHash: snapshot.snapshotHash,
    terrainMutationHash: snapshot.terrainMutationHash,
    graphHash: graph.graphHash,
    candidates
  };
  plan.planHash = stableHash(plan);
  return plan;
};

const simulateTerrainMutation = (snapshotInput, candidate) => {
  const snapshot = isSolverState(snapshotInput) ? snapshotInput : extractSolverState(snapshotInput);
  const groundMask = cloneMask(snapshot.terrain.mask);
  const baseGroundMask = cloneMask(snapshot.terrain.mask);
  const steelMask = cloneMask(snapshot.steel.mask);
  if (!candidate || candidate.blocked) {
    return {
      snapshot,
      applied: false,
      reason: candidate?.blocked ? 'blocked' : 'missing-candidate'
    };
  }
  if (candidate.skillType === 'builder') {
    forEachRectPixel(snapshot, candidate.affectedBounds, (_x, _y, index) => {
      groundMask[index] = 1;
    });
  } else {
    forEachRectPixel(snapshot, candidate.affectedBounds, (_x, _y, index) => {
      if (steelMask[index]) return;
      groundMask[index] = 0;
    });
  }
  const nextSource = {
    kind: snapshot.sourceKind,
    id: snapshot.id,
    width: snapshot.width,
    height: snapshot.height,
    baseGroundMask,
    groundMask,
    steelMask,
    steel: snapshot.steel.constraints,
    oneWay: snapshot.oneWay,
    entrances: snapshot.entrances,
    exits: snapshot.exits,
    hazards: snapshot.hazards,
    lemmings: snapshot.lemmings,
    skills: snapshot.skills.counts,
    timer: snapshot.timer,
    needCount: snapshot.victory.needCount,
    releaseCount: snapshot.victory.releaseCount,
    terrainMutations: [
      ...snapshot.terrainMutations,
      {
        kind: candidate.kind,
        skillType: candidate.skillType,
        ...candidate.affectedBounds
      }
    ]
  };
  const nextSnapshot = extractSolverState(nextSource, {
    sourceKind: snapshot.sourceKind,
    id: `${snapshot.id}:mutation`
  });
  return {
    snapshot: nextSnapshot,
    applied: true,
    previousTerrainMutationHash: snapshot.terrainMutationHash,
    terrainMutationHash: hashMask(groundMask, snapshot.width, snapshot.height, 'terrain-mutation'),
    snapshotHash: nextSnapshot.snapshotHash
  };
};

export {
  planTerrainMutations,
  simulateTerrainMutation
};
