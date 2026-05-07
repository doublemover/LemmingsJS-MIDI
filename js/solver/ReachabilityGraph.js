import { analyzeSolverAffordances } from './SolverAnalysis.js';
import { analyzeSolverGeometry } from './SolverGeometry.js';
import { extractSolverState, isSolverState, stableHash } from './SolverState.js';

const edgeDistance = (from, to) => {
  const ax = from?.x ?? 0;
  const ay = from?.y ?? 0;
  const bx = to?.x ?? ax;
  const by = to?.y ?? ay;
  return Math.abs(ax - bx) + Math.abs(ay - by);
};

const sortById = (left, right) => String(left.id).localeCompare(String(right.id));

const addNode = (nodes, node) => {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
};

const addEdge = (edges, edge) => {
  if (!edge.from || !edge.to || edge.from === edge.to) return;
  const id = edge.id ?? `${edge.from}->${edge.to}:${edge.type}`;
  if (edges.has(id)) return;
  edges.set(id, {
    ...edge,
    id
  });
};

const findSurfaceNode = surfaceId => `surface:${surfaceId}`;

const surfaceCenter = surface => ({
  x: Math.floor(surface.x + surface.width / 2),
  y: surface.y
});

const rectCenter = rect => ({
  x: Math.floor(rect.x + Math.max(0, rect.width - 1) / 2),
  y: Math.floor(rect.y + Math.max(0, rect.height - 1) / 2)
});

const rectRight = rect => rect.x + rect.width - 1;
const rectBottom = rect => rect.y + rect.height - 1;

const rectsOverlap = (left, right) => (
  left.x <= rectRight(right) &&
  rectRight(left) >= right.x &&
  left.y <= rectBottom(right) &&
  rectBottom(left) >= right.y
);

const edgeFromAffordance = affordance => {
  const requiredSkills = affordance.skillType ? [affordance.skillType] : [];
  const hazardExposure = affordance.blocked
    ? affordance.blockers.map(blocker => blocker.type).sort()
    : [];
  const mutation = affordance.skillType && affordance.skillType !== 'floater' && affordance.skillType !== 'blocker'
    ? {
      kind: affordance.type,
      skillType: affordance.skillType,
      affectedBounds: { ...affordance.rect },
      blockers: affordance.blockers
    }
    : null;
  return {
    type: affordance.skillType === 'builder'
      ? 'build'
      : affordance.skillType === 'floater'
        ? 'fall'
        : affordance.skillType === 'blocker'
          ? 'blocker-turn'
          : affordance.skillType,
    requiredSkills,
    requiredSkillCount: affordance.requiredSkillCount,
    availableSkillCount: affordance.availableSkillCount,
    roughTimingWindow: affordance.roughTimingWindow,
    hazardExposure,
    blocked: affordance.blocked,
    blockers: affordance.blockers,
    uncertainty: affordance.blocked ? 1 : 0,
    mutation
  };
};

const buildEndpointNodes = (nodes, edges, snapshot, geometry, kind, rects, surfaceKey) => {
  for (const item of rects) {
    const nodeId = `${kind}:${item.index}`;
    addNode(nodes, {
      id: nodeId,
      type: kind,
      rect: {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height
      },
      point: rectCenter(item)
    });
  }
  const surfaceIds = geometry.routeContinuity?.[surfaceKey] ?? [];
  for (const item of rects) {
    for (const surfaceId of surfaceIds) {
      const surfaceNode = findSurfaceNode(surfaceId);
      if (kind === 'entrance') {
        addEdge(edges, {
          from: `${kind}:${item.index}`,
          to: surfaceNode,
          type: 'spawn',
          requiredSkills: [],
          requiredSkillCount: 0,
          hazardExposure: [],
          blocked: false,
          uncertainty: 0,
          distance: 0
        });
      } else {
        addEdge(edges, {
          from: surfaceNode,
          to: `${kind}:${item.index}`,
          type: 'exit',
          requiredSkills: [],
          requiredSkillCount: 0,
          hazardExposure: [],
          blocked: false,
          uncertainty: 0,
          distance: 0
        });
      }
    }
  }
};

const addStepEdges = (edges, surfaces, maxStepHeight) => {
  for (const left of surfaces) {
    for (const right of surfaces) {
      if (left.id === right.id) continue;
      const touching = right.left <= left.right + 1 && right.right >= left.left - 1;
      if (!touching) continue;
      const step = Math.abs(left.y - right.y);
      if (step > maxStepHeight) continue;
      addEdge(edges, {
        from: findSurfaceNode(left.id),
        to: findSurfaceNode(right.id),
        type: step === 0 ? 'walk' : 'step',
        requiredSkills: [],
        requiredSkillCount: 0,
        hazardExposure: right.hasHazard ? right.hazardKinds : [],
        blocked: right.hasHazard,
        uncertainty: 0,
        distance: edgeDistance(surfaceCenter(left), surfaceCenter(right))
      });
    }
  }
};

const addFallEdges = (edges, cliffs) => {
  for (const cliff of cliffs) {
    if (!cliff.safe || cliff.landing?.surfaceId == null) continue;
    addEdge(edges, {
      from: findSurfaceNode(cliff.surfaceId),
      to: findSurfaceNode(cliff.landing.surfaceId),
      type: 'fall',
      requiredSkills: [],
      requiredSkillCount: 0,
      hazardExposure: [],
      blocked: false,
      uncertainty: 0,
      fallDistance: cliff.fallDistance,
      roughTimingWindow: {
        start: Math.max(0, cliff.x - 4),
        end: cliff.x + 4
      },
      distance: Math.max(0, cliff.fallDistance ?? 0)
    });
  }
};

const addAffordanceEdges = (edges, nodes, affordances) => {
  for (const affordance of affordances) {
    const from = findSurfaceNode(affordance.fromSurfaceId);
    let to = affordance.toSurfaceId == null ? null : findSurfaceNode(affordance.toSurfaceId);
    if (!to && affordance.skillType !== 'blocker') {
      to = `mutation:${affordance.id}`;
      addNode(nodes, {
        id: to,
        type: 'mutation-segment',
        rect: { ...affordance.rect },
        point: rectCenter(affordance.rect),
        generatedBy: affordance.id
      });
    }
    if (!to) to = from;
    addEdge(edges, {
      from,
      to,
      id: `affordance:${affordance.id}`,
      affordanceId: affordance.id,
      ...edgeFromAffordance(affordance),
      distance: Math.max(1, affordance.rect.width + affordance.rect.height)
    });
  }
};

const buildReachabilityGraph = (input, options = {}) => {
  const snapshot = isSolverState(input) ? input : extractSolverState(input, options);
  const geometry = options.geometry ?? analyzeSolverGeometry(snapshot, options.geometryOptions ?? options);
  const analysis = options.analysis ?? analyzeSolverAffordances(snapshot, {
    ...options,
    geometry
  });
  const nodes = new Map();
  const edges = new Map();

  for (const surface of geometry.surfaces) {
    addNode(nodes, {
      id: findSurfaceNode(surface.id),
      type: 'surface',
      surfaceId: surface.id,
      rect: {
        x: surface.x,
        y: surface.y,
        width: surface.width,
        height: 1
      },
      point: surfaceCenter(surface),
      hazardKinds: surface.hazardKinds,
      blocked: surface.hasHazard
    });
  }

  buildEndpointNodes(nodes, edges, snapshot, geometry, 'entrance', snapshot.entrances, 'entranceSurfaceIds');
  buildEndpointNodes(nodes, edges, snapshot, geometry, 'exit', snapshot.exits, 'exitSurfaceIds');
  addStepEdges(edges, geometry.surfaces, options.maxStepHeight ?? 4);
  addFallEdges(edges, geometry.cliffs);
  addAffordanceEdges(edges, nodes, analysis.skillAffordances);

  const graph = {
    kind: 'solver-reachability-graph',
    stateHash: snapshot.snapshotHash,
    terrainHash: snapshot.terrainHash,
    terrainMutationHash: snapshot.terrainMutationHash,
    geometryHash: geometry.geometryHash,
    analysisHash: analysis.analysisHash,
    nodes: Array.from(nodes.values()).sort(sortById),
    edges: Array.from(edges.values()).sort(sortById),
    entranceNodeIds: snapshot.entrances.map(entrance => `entrance:${entrance.index}`),
    exitNodeIds: snapshot.exits.map(exit => `exit:${exit.index}`)
  };
  graph.graphHash = stableHash({
    stateHash: graph.stateHash,
    terrainMutationHash: graph.terrainMutationHash,
    nodes: graph.nodes,
    edges: graph.edges
  });
  return graph;
};

const invalidateReachabilityGraph = (graph, mutation = {}) => {
  const bounds = mutation.affectedBounds ?? mutation.rect ?? mutation;
  const overlaps = rect => rect && bounds?.width != null && rectsOverlap(rect, bounds);
  const invalidatedNodeIds = graph.nodes
    .filter(node => overlaps(node.rect))
    .map(node => node.id)
    .sort();
  const invalidatedEdgeIds = graph.edges
    .filter(edge => invalidatedNodeIds.includes(edge.from) ||
      invalidatedNodeIds.includes(edge.to) ||
      overlaps(edge.mutation?.affectedBounds))
    .map(edge => edge.id)
    .sort();
  return {
    graphHash: graph.graphHash,
    mutationHash: stableHash(mutation),
    invalidatedNodeIds,
    invalidatedEdgeIds,
    requiresRebuild: invalidatedNodeIds.length > 0 || invalidatedEdgeIds.length > 0
  };
};

export {
  buildReachabilityGraph,
  invalidateReachabilityGraph
};
