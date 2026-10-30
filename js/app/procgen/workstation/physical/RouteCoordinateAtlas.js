import { plain, identity, integer, finite, point, bounds, boundedList, freeze, copy } from './PhysicalSchema.js';
import { describeRoutePeriods } from './RoutePeriodEvidence.js';

export function validateRouteDefinition(input, pickups = []) {
  if (!plain(input) || !identity(input.id) || !identity(input.branchId) || !integer(input.revision) || !['authored', 'measured-trace'].includes(input.geometrySource ?? 'authored')) throw new Error('Invalid route identity or geometry provenance.');
  const gates = new Set(pickups.map(gate => gate.id));
  const markers = boundedList(input.markers, 65, marker => { if (!plain(marker) || !gates.has(marker.gateId) || !['positive', 'negative', 'either'].includes(marker.direction ?? 'either')) throw new Error('Route markers must reference an existing directional pickup.'); return { gateId: marker.gateId, direction: marker.direction ?? 'either' }; }, 'route markers');
  const segments = boundedList(input.segments, 64, (segment, index) => {
    if (!plain(segment) || !identity(segment.id)) throw new Error('Invalid route segment identity.');
    const path = boundedList(segment.path, 256, point, 'route trace');
    if (path.length < 2 || path.some((p, i) => i && p.x === path[i - 1].x && p.y === path[i - 1].y)) throw new Error('Route segments require nondegenerate ordered paths.');
    const lengthPixels = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
    if (!finite(lengthPixels, 65536) || lengthPixels <= 0) throw new Error('Route segment length exceeds its finite authoring region.');
    const dependencies = boundedList(segment.dependencies ?? [], 64, dependency => { if (!plain(dependency) || !integer(dependency.terrainRevision)) throw new Error('Invalid route terrain dependency.'); return { bounds: bounds(dependency.bounds), terrainRevision: dependency.terrainRevision }; }, 'route terrain dependencies');
    return { id: segment.id, index, path, lengthPixels, dependencies };
  }, 'route segments');
  if (!segments.length || markers.length !== segments.length + 1 || new Set(segments.map(segment => segment.id)).size !== segments.length || input.loop === true && markers[0].gateId !== markers.at(-1).gateId) throw new Error('Route markers must delimit every segment, including an explicit loop seam.');
  if (input.entryAction != null && (typeof input.entryAction !== 'string' || input.entryAction.length > 64)) throw new Error('Invalid route action qualifier.');
  if (input.requestedPeriodTicks != null && (!Number.isFinite(input.requestedPeriodTicks) || input.requestedPeriodTicks <= 0 || input.requestedPeriodTicks > 2147483647)) throw new Error('Invalid requested route period.');
  let offset = 0; const segmentOffsets = segments.map(segment => { const start = offset; offset += segment.lengthPixels; return start; });
  return freeze({ segmentOffsets, id: input.id, revision: input.revision, branchId: input.branchId, geometrySource: input.geometrySource ?? 'authored',
    metric: 'qualified-route-arc-pixels', loop: input.loop === true, markers, segments, entryAction: input.entryAction ?? null,
    tolerancePixels: Number.isFinite(input.tolerancePixels) && input.tolerancePixels >= 0 && input.tolerancePixels <= 16 ? input.tolerancePixels : 2,
    lengthPixels: segments.reduce((sum, segment) => sum + segment.lengthPixels, 0), requestedPeriodTicks: input.requestedPeriodTicks ?? null });
}
const intersects = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const routeStatuses = new Set(['qualified', 'ambiguous', 'off-route', 'terrain-invalidated', 'discontinuous', 'marker-order-mismatch', 'completed']);
const observationId = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const boundedTime = (value, end) => Number.isFinite(value) && value >= 0 && value <= end;
const newRouteTracker = (route, crossing, batch, ambiguous) => ({ worldId: batch.worldId, generation: batch.generation, previousSPixels: 0, previousObservationTick: -1, entryObservationId: crossing.observationId,
  routeId: route.id, routeRevision: route.revision, branchId: route.branchId, actorId: crossing.actorId, segmentIndex: 0, segmentId: route.segments[0].id,
  lapId: 0, sPixels: 0, segmentS: 0, direction: 1, observationTick: batch.tick, status: ambiguous ? 'ambiguous' : 'qualified',
  entryTick: batch.tick - 1 + (crossing.fraction ?? 1), lastReturnTick: null, periodTicks: null, lastLapObservationId: null, lastLapSourceEventIds: [], markerHistory: [crossing.observationId], sourceEventIds: crossing.sourceEventIds });
const validateObservedRouteState = (state, route, boundary, currentTick) => {
  if (!plain(state) || !route || state.routeRevision !== route.revision || state.branchId !== route.branchId || !integer(state.actorId) || !integer(state.segmentIndex, route.segments.length - 1) || state.segmentId !== route.segments[state.segmentIndex].id || !integer(state.lapId) || !route.loop && state.lapId > 1 || !routeStatuses.has(state.status) || ![1, -1].includes(state.direction) ||
      typeof state.worldId !== 'string' || !state.worldId || !integer(state.generation) || `${state.worldId}:${state.generation}` !== boundary || !integer(state.observationTick, currentTick) || !boundedTime(state.entryTick, state.observationTick) || state.lastReturnTick != null && (!boundedTime(state.lastReturnTick, state.observationTick) || state.lastReturnTick < state.entryTick) || state.periodTicks != null && !boundedTime(state.periodTicks, state.observationTick) ||
      !finite(state.sPixels, Number.MAX_SAFE_INTEGER) || state.sPixels < 0 || !finite(state.segmentS, route.segments[state.segmentIndex].lengthPixels) || state.segmentS < 0 || !observationId(state.entryObservationId) || !Array.isArray(state.markerHistory) || !state.markerHistory.length || state.markerHistory.length > 65 || state.markerHistory.some(id => !observationId(id)) || !Array.isArray(state.sourceEventIds) || !state.sourceEventIds.length || state.sourceEventIds.length > 32 || state.sourceEventIds.some(id => !observationId(id))) throw new Error('Invalid observed route identity or history.');
  if (state.periodTicks != null && (!observationId(state.lastLapObservationId) || !Array.isArray(state.lastLapSourceEventIds) || !state.lastLapSourceEventIds.length || state.lastLapSourceEventIds.length > 32 || state.lastLapSourceEventIds.some(id => !observationId(id)))) throw new Error('Invalid completed route lap provenance.');
  if (state.coordinatePrecision != null || state.status === 'qualified') {
    const expectedS = route.segmentOffsets[state.segmentIndex] + state.segmentS + state.lapId * route.lengthPixels;
    if (state.coordinatePrecision !== 'completed-route-endpoint-projection' || state.geometrySource !== route.geometrySource || !plain(state.lastPosition) || !finite(state.lastPosition.x) || !finite(state.lastPosition.y) || !finite(state.previousSPixels, Number.MAX_SAFE_INTEGER) || state.previousSPixels < 0 || !Number.isSafeInteger(state.previousObservationTick) || state.previousObservationTick < -1 || state.previousObservationTick > state.observationTick ||
        state.motionSourceEventId !== null && (!observationId(state.motionSourceEventId) || !integer(state.motionSourceSequence) || !integer(state.motionSourceTick, state.observationTick) || state.status === 'qualified' && state.motionSourceTick !== state.observationTick) || state.status === 'qualified' && (!Number.isSafeInteger(Math.trunc(expectedS)) || Math.abs(state.sPixels - expectedS) > 1e-6)) throw new Error('Invalid completed route endpoint evidence.');
  }
};
const project = (segment, p, tolerance, previousS = null) => {
  const candidates = []; let offset = 0;
  for (let i = 1; i < segment.path.length; i++) {
    const a = segment.path[i - 1], b = segment.path[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
    if (t >= -1e-9 && t <= 1 + 1e-9) {
      const fraction = Math.max(0, Math.min(1, t));
      // Avoid subtracting a rounded projection on an exact, zero-tolerance path.
      const distance = t >= 0 && t <= 1 ? Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length : Math.hypot(p.x - a.x - fraction * dx, p.y - a.y - fraction * dy);
      const roundoff = Number.EPSILON * Math.max(1, length, Math.abs(p.x - a.x), Math.abs(p.y - a.y)) * 8;
      if (distance <= tolerance + roundoff) candidates.push(offset + fraction * length);
    }
    offset += length;
  }
  const unique = candidates.filter((value, index) => !candidates.slice(0, index).some(other => Math.abs(value - other) < 1e-6));
  if (unique.length === 1) return { status: 'qualified', s: unique[0] };
  if (unique.length > 1 && previousS != null) { const nearby = unique.filter(value => Math.abs(value - previousS) <= tolerance + 8); if (nearby.length === 1) return { status: 'qualified', s: nearby[0] }; }
  return { status: unique.length ? 'ambiguous' : 'off-route' };
};
export function createRouteCoordinateAtlas({ maxTrackers = 16384, maxRoutes = 128 } = {}) {
  let definitions = [], byId = new Map(), signatures = new Map(), boundary = null, index = new Map(), lastObservations = [], currentTick = -1;
  const trackers = new Map(), invalid = new Map();
  const key = (id, actorId) => `${id}/${actorId}`;
  const configure = routes => {
    if (!Array.isArray(routes) || routes.length > maxRoutes || new Set(routes.map(route => route.id)).size !== routes.length) throw new Error('Route atlas capacity or duplicate identity.');
    const next = new Map(routes.map(route => [route.id, JSON.stringify({ ...route, requestedPeriodTicks: undefined })]));
    for (const [id, state] of trackers) if (signatures.get(state.routeId) !== next.get(state.routeId)) trackers.delete(id);
    for (const id of invalid.keys()) if (signatures.get(id) !== next.get(id)) invalid.delete(id);
    definitions = routes; byId = new Map(routes.map(route => [route.id, route])); signatures = next;
    index = new Map(); for (const route of definitions) for (let markerIndex = 0; markerIndex < route.markers.length; markerIndex++) { const marker = route.markers[markerIndex]; if (!index.has(marker.gateId)) index.set(marker.gateId, []); index.get(marker.gateId).push({ route, markerIndex, marker }); }
  };
  const observe = (batch, crossings) => {
    if (boundary !== `${batch.worldId}:${batch.generation}`) { trackers.clear(); invalid.clear(); boundary = `${batch.worldId}:${batch.generation}`; }
    currentTick = batch.tick; const actors = new Map((batch.snapshot?.actors || []).map(actor => [actor.actorId, actor])), observations = [], motionDistances = new Map(), motionSources = new Map(), motionDiscontinuities = new Set();
    for (const state of trackers.values()) { state.previousSPixels = state.sPixels; state.previousObservationTick = state.observationTick; state.worldId = batch.worldId; state.generation = batch.generation; }
    for (const fact of batch.facts) if (fact.kind === 'MotionCommitted') {
      motionDistances.set(fact.actorId, (motionDistances.get(fact.actorId) || 0) + Math.hypot(fact.positionAfter.x - fact.positionBefore.x, fact.positionAfter.y - fact.positionBefore.y)); motionSources.set(fact.actorId, fact);
      if (fact.discontinuity === true || fact.physicalPayload?.discontinuity === true) motionDiscontinuities.add(fact.actorId);
    }
    for (const [id, state] of trackers) if (batch.snapshot && !actors.has(state.actorId)) trackers.delete(id);
    for (const fact of batch.facts) if (fact.kind === 'TerrainWorkCommitted' && fact.physicalPayload?.changedSolidCells > 0 || fact.kind === 'CommandApplied' && (fact.terrain?.counts?.solidAdded > 0 || fact.terrain?.counts?.solidRemoved > 0)) {
      const spans = fact.terrain?.edit?.spans || fact.physicalPayload?.terrainEdit?.spans || fact.physicalPayload?.spans;
      const region = fact.bounds || fact.physicalPayload?.bounds || (Array.isArray(spans) && spans.length ? { x1: Math.min(...spans.map(span => span.x1)), x2: Math.max(...spans.map(span => span.x2)), y1: Math.min(...spans.map(span => span.y)), y2: Math.max(...spans.map(span => span.y)) + 1 } : null);
      for (const route of definitions) for (const segment of route.segments) if (segment.dependencies.some(dependency => !region || intersects(dependency.bounds, region))) { let ids = invalid.get(route.id); if (!ids) { ids = new Set(); invalid.set(route.id, ids); } ids.add(segment.id); }
    }
    for (const crossing of crossings) {
      const crossingTime = batch.tick - 1 + (crossing.fraction ?? 1);
      const candidates = (index.get(crossing.gateId) || []).filter(entry => entry.marker.direction === 'either' || entry.marker.direction === crossing.direction);
      const entries = candidates.filter(entry => entry.markerIndex === 0 && (!entry.route.entryAction || actors.get(crossing.actorId)?.action === entry.route.entryAction));
      const ambiguous = entries.length > 1;
      const selected = new Map();
      for (const candidate of candidates) { const state = trackers.get(key(candidate.route.id, crossing.actorId)), current = selected.get(candidate.route.id);
        if (!current || candidate.markerIndex === (state ? state.segmentIndex + 1 : 0)) selected.set(candidate.route.id, candidate); }
      for (const { route, markerIndex } of selected.values()) {
        const id = key(route.id, crossing.actorId); let state = trackers.get(id);
        if (invalid.get(route.id)?.has(route.segments[state?.segmentIndex ?? 0].id)) { if (state) { state.status = 'terrain-invalidated'; state.observationTick = batch.tick; } continue; }
        if (!state) {
          if (markerIndex !== 0 || trackers.size >= maxTrackers || route.entryAction && actors.get(crossing.actorId)?.action !== route.entryAction) continue;
          state = newRouteTracker(route, crossing, batch, ambiguous);
          trackers.set(id, state); continue;
        }
        if (state.status !== 'qualified') { if (markerIndex === 0 && !ambiguous) trackers.set(id, newRouteTracker(route, crossing, batch, false)); continue; }
        if (markerIndex === state.segmentIndex + 1) {
          state.markerHistory.push(crossing.observationId); if (state.markerHistory.length > 65) state.markerHistory.shift();
          if (markerIndex === route.markers.length - 1) {
            const returned = crossingTime, previous = state.lastReturnTick ?? state.entryTick;
            state.periodTicks = returned - previous; state.lastReturnTick = returned; state.lastLapObservationId = crossing.observationId; state.lastLapSourceEventIds = crossing.sourceEventIds; state.lapId++; state.segmentIndex = route.loop ? 0 : route.segments.length - 1;
            state.status = route.loop ? 'qualified' : 'completed';
            observations.push({ ...crossing, observationId: crossing.observationId + ':route:' + route.id, routeId: route.id, routeRevision: route.revision,
              branchId: route.branchId, lapId: state.lapId, periodTicks: state.periodTicks, requestedPeriodTicks: route.requestedPeriodTicks, periodErrorTicks: route.requestedPeriodTicks == null ? null : state.periodTicks - route.requestedPeriodTicks, elapsedUnit: 'simulation-ticks', metric: route.metric, routeLengthPixels: route.lengthPixels, transition: 'lap' });
          } else state.segmentIndex = markerIndex;
          state.segmentS = 0; state.segmentId = route.segments[state.segmentIndex].id;
        } else if (markerIndex === state.segmentIndex && state.direction < 0 && markerIndex > 0) { state.segmentIndex--; state.segmentId = route.segments[state.segmentIndex].id; state.segmentS = route.segments[state.segmentIndex].lengthPixels; }
        else if (!(route.loop && markerIndex === 0 && state.segmentIndex === route.segments.length - 1)) { state.status = 'marker-order-mismatch'; }
        state.observationTick = batch.tick; state.sourceEventIds = crossing.sourceEventIds;
      }
    }
    for (const state of trackers.values()) {
      const route = byId.get(state.routeId), actor = actors.get(state.actorId);
      if (!actor || state.status !== 'qualified') continue;
      if (motionDiscontinuities.has(state.actorId)) { state.status = 'discontinuous'; continue; }
      if (invalid.get(route.id)?.has(state.segmentId)) { state.status = 'terrain-invalidated'; continue; }
      const distance = motionDistances.get(state.actorId) || 0;
      if (state.lastPosition && (batch.tick > state.observationTick + 1 || Math.hypot(actor.x - state.lastPosition.x, actor.y - state.lastPosition.y) > distance + 1e-6)) { state.status = 'discontinuous'; continue; }
      const coordinate = project(route.segments[state.segmentIndex], actor, route.tolerancePixels, state.segmentS);
      if (coordinate.status !== 'qualified') { state.status = coordinate.status; continue; }
      const s = route.segmentOffsets[state.segmentIndex] + coordinate.s + state.lapId * route.lengthPixels;
      if (state.previousObservationTick >= 0 && Math.abs(s - state.previousSPixels) > distance + route.tolerancePixels * 2 + 1e-6) { state.status = 'discontinuous'; continue; }
      if (s !== state.sPixels) state.direction = Math.sign(s - state.sPixels);
      const motion = motionSources.get(state.actorId); state.motionSourceEventId = motion?.eventId ?? null; state.motionSourceSequence = motion?.causalSequence ?? null; state.motionSourceTick = motion ? batch.tick : null;
      state.coordinatePrecision = typeof state.entryObservationId === 'string' && state.entryObservationId ? 'completed-route-endpoint-projection' : null; state.geometrySource = route.geometrySource;
      state.lastPosition = { x: actor.x, y: actor.y }; state.segmentS = coordinate.s; state.sPixels = s; state.observationTick = batch.tick;
    }
    lastObservations = observations.map(freeze); return Object.freeze(lastObservations);
  };
  const coordinate = (actorId, routeId) => { const state = trackers.get(key(routeId, actorId)); return state ? freeze({ ...copy(state), status: state.status !== 'qualified' || state.observationTick === currentTick ? state.status : 'stale', metric: 'qualified-route-arc-pixels' }) : null; };
  const neighbors = routeId => {
    const groups = new Map(); for (const state of trackers.values()) if (state.routeId === routeId && state.status === 'qualified' && state.observationTick === currentTick) {
      const id = `${state.branchId}:${state.direction}`; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(state); }
    return Object.freeze([...groups].map(([group, members]) => { members.sort((a, b) => a.sPixels - b.sPixels || a.actorId - b.actorId); return freeze({ group, members: members.map((member, i) => ({ actorId: member.actorId, sPixels: member.sPixels,
      previousActorId: members[i - 1]?.actorId ?? null, gapPixels: i ? member.sPixels - members[i - 1].sPixels : null, metric: 'qualified-route-arc-pixels' })) }); }));
  };
  const periods = () => describeRoutePeriods([...trackers.values()].filter(state => state.periodTicks > 0).map(state => ({ routeId: state.routeId, routeRevision: state.routeRevision, branchId: state.branchId, actorId: state.actorId,
    coordinateStatus: state.status, periodTicks: state.periodTicks, requestedPeriodTicks: byId.get(state.routeId).requestedPeriodTicks, lastCompletedLapTick: state.lastReturnTick, sourceObservationId: state.lastLapObservationId, sourceEventIds: [...state.lastLapSourceEventIds] })));
  return { configure, observe, coordinate, neighbors, periods, reset() { trackers.clear(); invalid.clear(); boundary = null; },
    snapshot: () => freeze({ version: 1, boundary, currentTick, signatures: [...signatures], trackers: [...trackers.values()].map(copy), invalid: [...invalid].map(([id, segments]) => [id, [...segments]]) }),
    restore(value) { if (value?.version !== 1 || value.boundary != null && typeof value.boundary !== 'string' || !Number.isSafeInteger(value.currentTick) || value.currentTick < -1 || JSON.stringify(value.signatures) !== JSON.stringify([...signatures]) || !Array.isArray(value.trackers) || value.trackers.length > maxTrackers || !Array.isArray(value.invalid) || value.invalid.length > maxRoutes) throw new Error('Invalid route checkpoint.');
      const next = new Map();
      for (const state of value.trackers) {
        validateObservedRouteState(state, byId.get(state?.routeId), value.boundary, value.currentTick);
        const id = key(state.routeId, state.actorId); if (next.has(id)) throw new Error('Duplicate observed route identity.'); next.set(id, copy(state));
      }
      const invalidNext = new Map();
      for (const [id, segments] of value.invalid) {
        const route = byId.get(id); if (!route || invalidNext.has(id) || !Array.isArray(segments) || new Set(segments).size !== segments.length || segments.some(segment => !route.segments.some(entry => entry.id === segment))) throw new Error('Invalid route dependency state.');
        invalidNext.set(id, new Set(segments));
      }
      for (const state of next.values()) if (state.status === 'qualified' && invalidNext.get(state.routeId)?.has(state.segmentId)) throw new Error('Qualified route segment has invalidated terrain.');
      trackers.clear(); for (const [id, state] of next) trackers.set(id, state); invalid.clear(); for (const [id, segments] of invalidNext) invalid.set(id, segments); boundary = value.boundary; currentTick = value.currentTick; },
    diagnostics: () => freeze({ routes: definitions.length, trackers: trackers.size, invalidated: [...invalid].map(([id, segments]) => ({ id, segments: [...segments] })), laps: lastObservations }) };
}
