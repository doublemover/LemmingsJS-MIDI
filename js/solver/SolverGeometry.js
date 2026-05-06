import { extractSolverState, isSolverState, stableHash } from './SolverState.js';

const DEFAULT_GEOMETRY_OPTIONS = Object.freeze({
  maxSmallGap: 12,
  maxStepHeight: 4,
  maxSafeFall: 60,
  landingSearchDepth: 96,
  entranceSnapRadius: 24,
  exitSnapRadius: 24,
  minSurfaceWidth: 1
});

const toOptions = options => ({
  ...DEFAULT_GEOMETRY_OPTIONS,
  ...options
});

const maskAt = (mask, width, height, x, y) => {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  return mask[y * width + x] !== 0;
};

const isGroundAt = (snapshot, x, y) => (
  maskAt(snapshot.terrain.mask, snapshot.width, snapshot.height, x, y)
);

const isSteelAt = (snapshot, x, y) => (
  maskAt(snapshot.steel.mask, snapshot.width, snapshot.height, x, y)
);

const rectRight = rect => rect.x + rect.width - 1;

const rectBottom = rect => rect.y + rect.height - 1;

const rectsOverlap = (a, b) => (
  a.x <= rectRight(b) &&
  rectRight(a) >= b.x &&
  a.y <= rectBottom(b) &&
  rectBottom(a) >= b.y
);

const surfaceOverlapRect = surface => ({
  x: surface.x,
  y: surface.y - 2,
  width: surface.width,
  height: 5
});

const countSteelInRect = (snapshot, rect) => {
  let count = 0;
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(snapshot.width - 1, rectRight(rect));
  const y2 = Math.min(snapshot.height - 1, rectBottom(rect));
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      if (isSteelAt(snapshot, x, y)) count += 1;
    }
  }
  return count;
};

const buildWalkableSurfaces = snapshot => {
  const surfaces = [];
  for (let y = 0; y < snapshot.height - 1; y += 1) {
    let startX = -1;
    for (let x = 0; x < snapshot.width; x += 1) {
      const walkable = !isGroundAt(snapshot, x, y) && isGroundAt(snapshot, x, y + 1);
      if (walkable && startX < 0) {
        startX = x;
      } else if (!walkable && startX >= 0) {
        surfaces.push({
          x: startX,
          y,
          width: x - startX
        });
        startX = -1;
      }
    }
    if (startX >= 0) {
      surfaces.push({
        x: startX,
        y,
        width: snapshot.width - startX
      });
    }
  }
  return surfaces
    .filter(surface => surface.width > 0)
    .sort((a, b) => a.x - b.x || a.y - b.y || b.width - a.width)
    .map((surface, id) => {
      const rect = {
        x: surface.x,
        y: surface.y + 1,
        width: surface.width,
        height: 1
      };
      const hazardKinds = snapshot.hazards
        .filter(hazard => rectsOverlap(surfaceOverlapRect(surface), hazard))
        .map(hazard => hazard.kind)
        .sort();
      const entrances = snapshot.entrances
        .filter(entrance => rectsOverlap(surfaceOverlapRect(surface), entrance))
        .map(entrance => entrance.index);
      const exits = snapshot.exits
        .filter(exit => rectsOverlap(surfaceOverlapRect(surface), exit))
        .map(exit => exit.index);
      const steelCount = countSteelInRect(snapshot, rect);
      return {
        id,
        x: surface.x,
        y: surface.y,
        width: surface.width,
        left: surface.x,
        right: surface.x + surface.width - 1,
        steelCount,
        hasSteel: steelCount > 0,
        hazardKinds,
        hasHazard: hazardKinds.length > 0,
        entrances,
        exits
      };
    });
};

const findSurfaceAt = (surfaces, x, y, radius) => {
  let best = null;
  let bestScore = Infinity;
  for (const surface of surfaces) {
    const dx = x < surface.left ? surface.left - x : Math.max(0, x - surface.right);
    const dy = Math.abs(surface.y - y);
    if (dx > radius || dy > radius) continue;
    const score = dx * 4 + dy;
    if (score < bestScore) {
      best = surface;
      bestScore = score;
    }
  }
  return best;
};

const rectAnchor = rect => ({
  x: Math.trunc(rect.x + Math.max(0, rect.width - 1) / 2),
  y: Math.trunc(rect.y + Math.max(0, rect.height - 1))
});

const findLandingBelow = (snapshot, surfaces, x, startY, options) => {
  if (x < 0 || x >= snapshot.width) return null;
  const limit = Math.min(snapshot.height - 2, startY + options.landingSearchDepth);
  for (let y = Math.max(0, startY); y <= limit; y += 1) {
    if (!isGroundAt(snapshot, x, y) && isGroundAt(snapshot, x, y + 1)) {
      const surface = findSurfaceAt(surfaces, x, y, 1);
      return {
        x,
        y,
        surfaceId: surface?.id ?? null
      };
    }
  }
  return null;
};

const buildCliffs = (snapshot, surfaces, options) => {
  const cliffs = [];
  for (const surface of surfaces) {
    const edges = [
      { side: 'left', x: surface.left - 1 },
      { side: 'right', x: surface.right + 1 }
    ];
    for (const edge of edges) {
      const outOfLevel = edge.x < 0 || edge.x >= snapshot.width;
      const landing = outOfLevel
        ? null
        : findLandingBelow(snapshot, surfaces, edge.x, surface.y + 1, options);
      const fallDistance = landing ? landing.y - surface.y : null;
      cliffs.push({
        surfaceId: surface.id,
        side: edge.side,
        x: edge.x,
        y: surface.y,
        outOfLevel,
        fallDistance,
        landing,
        safe: Number.isFinite(fallDistance) && fallDistance <= options.maxSafeFall
      });
    }
  }
  return cliffs;
};

const isGapEmpty = (snapshot, leftSurface, rightSurface) => {
  const startX = leftSurface.right + 1;
  const endX = rightSurface.left - 1;
  if (startX > endX) return false;
  const y = Math.max(leftSurface.y, rightSurface.y);
  for (let x = startX; x <= endX; x += 1) {
    if (isGroundAt(snapshot, x, y) || isGroundAt(snapshot, x, y + 1)) return false;
  }
  return true;
};

const buildGaps = (snapshot, surfaces, options) => {
  const gaps = [];
  for (let i = 0; i < surfaces.length; i += 1) {
    for (let j = 0; j < surfaces.length; j += 1) {
      if (i === j) continue;
      const left = surfaces[i];
      const right = surfaces[j];
      if (right.left <= left.right + 1) continue;
      const verticalDelta = Math.abs(right.y - left.y);
      if (verticalDelta > options.maxStepHeight) continue;
      if (!isGapEmpty(snapshot, left, right)) continue;
      const width = right.left - left.right - 1;
      gaps.push({
        fromSurfaceId: left.id,
        toSurfaceId: right.id,
        x: left.right + 1,
        y: Math.max(left.y, right.y),
        width,
        verticalDelta,
        isSmall: width <= options.maxSmallGap,
        bridgeable: width <= options.maxSmallGap
      });
    }
  }
  return gaps.sort((a, b) => a.x - b.x || a.y - b.y || a.width - b.width);
};

const measureWallHeight = (snapshot, x, y) => {
  let height = 0;
  for (let yy = y; yy >= 0; yy -= 1) {
    if (!isGroundAt(snapshot, x, yy)) break;
    height += 1;
  }
  return height;
};

const findBarrierFromEdge = (snapshot, surface, side, options) => {
  const direction = side === 'right' ? 1 : -1;
  const edgeX = side === 'right' ? surface.right + 1 : surface.left - 1;
  if (edgeX < 0 || edgeX >= snapshot.width) return null;
  const height = measureWallHeight(snapshot, edgeX, surface.y);
  if (height <= options.maxStepHeight) return null;
  let width = 0;
  let cursor = edgeX;
  while (cursor >= 0 && cursor < snapshot.width) {
    const nextHeight = measureWallHeight(snapshot, cursor, surface.y);
    if (nextHeight <= options.maxStepHeight) break;
    width += 1;
    cursor += direction;
  }
  const x = direction > 0 ? edgeX : edgeX - width + 1;
  const rect = {
    x,
    y: surface.y - height + 1,
    width,
    height
  };
  const steelCount = countSteelInRect(snapshot, rect);
  return {
    surfaceId: surface.id,
    side,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    bottomY: surface.y,
    steelCount,
    hasSteel: steelCount > 0
  };
};

const buildBarriers = (snapshot, surfaces, options) => {
  const seen = new Set();
  const barriers = [];
  for (const surface of surfaces) {
    for (const side of ['left', 'right']) {
      const barrier = findBarrierFromEdge(snapshot, surface, side, options);
      if (!barrier) continue;
      const key = `${barrier.x}:${barrier.y}:${barrier.width}:${barrier.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      barriers.push({ ...barrier, id: barriers.length });
    }
  }
  return barriers.sort((a, b) => a.x - b.x || a.y - b.y || b.height - a.height)
    .map((barrier, id) => ({ ...barrier, id }));
};

const buildLandingZones = (surfaces, cliffs) => {
  const landingsBySurface = new Map();
  for (const cliff of cliffs) {
    if (cliff.landing?.surfaceId == null) continue;
    if (!landingsBySurface.has(cliff.landing.surfaceId)) {
      landingsBySurface.set(cliff.landing.surfaceId, []);
    }
    landingsBySurface.get(cliff.landing.surfaceId).push({
      fromSurfaceId: cliff.surfaceId,
      fallDistance: cliff.fallDistance,
      side: cliff.side
    });
  }
  return surfaces.map(surface => ({
    surfaceId: surface.id,
    x: surface.x,
    y: surface.y,
    width: surface.width,
    safe: !surface.hasHazard,
    incomingFalls: landingsBySurface.get(surface.id) ?? []
  }));
};

const addEdge = (edges, from, to, type, data = {}) => {
  if (from == null || to == null || from === to) return;
  if (!edges.has(from)) edges.set(from, []);
  const bucket = edges.get(from);
  if (bucket.some(edge => edge.to === to && edge.type === type)) return;
  bucket.push({ from, to, type, ...data });
};

const buildRouteEdges = (surfaces, gaps, cliffs, options) => {
  const edges = new Map();
  for (const gap of gaps) {
    if (!gap.bridgeable) continue;
    addEdge(edges, gap.fromSurfaceId, gap.toSurfaceId, 'small-gap', {
      width: gap.width
    });
    addEdge(edges, gap.toSurfaceId, gap.fromSurfaceId, 'small-gap', {
      width: gap.width
    });
  }
  for (const cliff of cliffs) {
    if (!cliff.safe || cliff.landing?.surfaceId == null) continue;
    addEdge(edges, cliff.surfaceId, cliff.landing.surfaceId, 'fall', {
      fallDistance: cliff.fallDistance
    });
  }
  for (const left of surfaces) {
    for (const right of surfaces) {
      if (left.id === right.id) continue;
      const touching = right.left <= left.right + 1 && right.right >= left.left - 1;
      if (!touching) continue;
      const step = Math.abs(right.y - left.y);
      if (step > options.maxStepHeight) continue;
      addEdge(edges, left.id, right.id, 'step', { step });
    }
  }
  return edges;
};

const resolveEndpointSurfaceIds = (rects, surfaces, radius) => rects
  .map(rect => {
    const anchor = rectAnchor(rect);
    return findSurfaceAt(surfaces, anchor.x, anchor.y, radius)?.id ?? null;
  })
  .filter(id => id != null);

const traverseRoute = (surfaceIds, exitIds, surfaces, edges) => {
  const exitSet = new Set(exitIds);
  const blockedHazards = [];
  const queue = [];
  const visited = new Set();
  for (const id of surfaceIds) {
    const surface = surfaces[id];
    if (!surface || surface.hasHazard) {
      if (surface?.hasHazard) blockedHazards.push(id);
      continue;
    }
    queue.push(id);
    visited.add(id);
  }
  while (queue.length) {
    const current = queue.shift();
    if (exitSet.has(current)) {
      return {
        continuous: true,
        reachableSurfaceIds: Array.from(visited).sort((a, b) => a - b),
        blockedHazardSurfaceIds: blockedHazards
      };
    }
    for (const edge of edges.get(current) ?? []) {
      const surface = surfaces[edge.to];
      if (!surface || visited.has(edge.to)) continue;
      if (surface.hasHazard) {
        blockedHazards.push(edge.to);
        continue;
      }
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }
  return {
    continuous: false,
    reachableSurfaceIds: Array.from(visited).sort((a, b) => a - b),
    blockedHazardSurfaceIds: blockedHazards.sort((a, b) => a - b)
  };
};

const buildRouteContinuity = (snapshot, surfaces, gaps, cliffs, options) => {
  const entranceSurfaceIds = resolveEndpointSurfaceIds(
    snapshot.entrances,
    surfaces,
    options.entranceSnapRadius
  );
  const exitSurfaceIds = resolveEndpointSurfaceIds(
    snapshot.exits,
    surfaces,
    options.exitSnapRadius
  );
  const edges = buildRouteEdges(surfaces, gaps, cliffs, options);
  const route = traverseRoute(entranceSurfaceIds, exitSurfaceIds, surfaces, edges);
  return {
    continuous: route.continuous,
    entranceSurfaceIds,
    exitSurfaceIds,
    reachableSurfaceIds: route.reachableSurfaceIds,
    blockedHazardSurfaceIds: route.blockedHazardSurfaceIds,
    edgeCount: Array.from(edges.values()).reduce((sum, bucket) => sum + bucket.length, 0),
    blocked: !route.continuous,
    missingEntrance: entranceSurfaceIds.length === 0,
    missingExit: exitSurfaceIds.length === 0
  };
};

const analyzeSolverGeometry = (input, options = {}) => {
  const normalizedOptions = toOptions(options);
  const snapshot = isSolverState(input) ? input : extractSolverState(input);
  const surfaces = buildWalkableSurfaces(snapshot)
    .filter(surface => surface.width >= normalizedOptions.minSurfaceWidth);
  const cliffs = buildCliffs(snapshot, surfaces, normalizedOptions);
  const gaps = buildGaps(snapshot, surfaces, normalizedOptions);
  const barriers = buildBarriers(snapshot, surfaces, normalizedOptions);
  const landingZones = buildLandingZones(surfaces, cliffs);
  const routeContinuity = buildRouteContinuity(
    snapshot,
    surfaces,
    gaps,
    cliffs,
    normalizedOptions
  );
  const geometry = {
    kind: 'solver-geometry',
    stateHash: snapshot.snapshotHash,
    terrainHash: snapshot.terrainHash,
    terrainMutationHash: snapshot.terrainMutationHash,
    width: snapshot.width,
    height: snapshot.height,
    surfaces,
    cliffs,
    gaps,
    barriers,
    landingZones,
    routeContinuity
  };
  geometry.geometryHash = stableHash({
    stateHash: geometry.stateHash,
    surfaces,
    cliffs,
    gaps,
    barriers,
    landingZones,
    routeContinuity
  });
  return geometry;
};

export {
  DEFAULT_GEOMETRY_OPTIONS,
  analyzeSolverGeometry
};
