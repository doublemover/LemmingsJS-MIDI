import { planSolverRoute } from '../js/solver/RoutePlanner.js';
import { extractSolverState } from '../js/solver/SolverState.js';
import { verifyActionReplay } from '../js/solver/SolverRunner.js';

const compactRect = rect => ({
  index: rect.index,
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
  ...(rect.type ? { type: rect.type } : {}),
  ...(rect.kind ? { kind: rect.kind } : {})
});

const compactSnapshot = snapshot => ({
  kind: snapshot.kind,
  sourceKind: snapshot.sourceKind,
  id: snapshot.id,
  width: snapshot.width,
  height: snapshot.height,
  terrainHash: snapshot.terrainHash,
  terrainMutationHash: snapshot.terrainMutationHash,
  snapshotHash: snapshot.snapshotHash,
  hashes: snapshot.hashes,
  counts: {
    terrainSolid: snapshot.terrain.solidCount,
    steelSolid: snapshot.steel.solidCount,
    entrances: snapshot.entrances.length,
    exits: snapshot.exits.length,
    hazards: snapshot.hazards.length,
    lemmings: snapshot.lemmings.length,
    terrainMutations: snapshot.terrainMutations.length
  },
  entrances: snapshot.entrances.map(compactRect),
  exits: snapshot.exits.map(compactRect),
  hazards: snapshot.hazards.map(compactRect),
  lemmings: snapshot.lemmings.map(lemming => ({
    id: lemming.id,
    x: lemming.x,
    y: lemming.y,
    action: lemming.action,
    state: lemming.state,
    removed: lemming.removed,
    disabled: lemming.disabled
  })),
  skills: snapshot.skills,
  timer: snapshot.timer,
  victory: snapshot.victory
});

const compactRoute = result => ({
  ok: true,
  resultType: result.resultType,
  summary: result.summary,
  explanations: result.explanations,
  budgetUsage: result.budgetUsage,
  graphHash: result.graphHash ?? null,
  routeSearchStats: result.routeSearchStats ?? null,
  crowd: result.crowd ?? null,
  routeSkeleton: result.routeSkeleton
    ? {
      kind: result.routeSkeleton.kind,
      graphHash: result.routeSkeleton.graphHash,
      routeHash: result.routeSkeleton.routeHash,
      nodeIds: result.routeSkeleton.nodeIds,
      edgeIds: result.routeSkeleton.edgeIds,
      segments: result.routeSkeleton.segments,
      scoreBreakdown: result.routeSkeleton.scoreBreakdown
    }
    : null
});

const createSolverToolHandlers = ({ schemas }) => {
  const solverSnapshotTool = async (args) => {
    const parsed = schemas.SolverSnapshotSchema.parse(args || {});
    const snapshot = extractSolverState(parsed.source, parsed.options || {});
    return {
      ok: true,
      snapshot: compactSnapshot(snapshot)
    };
  };

  const solverRouteTool = async (args) => {
    const parsed = schemas.SolverRouteSchema.parse(args || {});
    const result = planSolverRoute(parsed.source, parsed.options || {});
    return compactRoute(result);
  };

  const solverReplayTool = async (args) => {
    const parsed = schemas.SolverReplaySchema.parse(args || {});
    const result = verifyActionReplay(parsed.source, parsed.actions || [], parsed.options || {});
    return {
      ok: true,
      result
    };
  };

  return {
    solverSnapshotTool,
    solverRouteTool,
    solverReplayTool
  };
};

export { createSolverToolHandlers };
