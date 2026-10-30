const SCOPES = new Set(['actorJourney', 'actionInstance', 'contactSpan']);
const METRICS = new Set(['segment-path', 'endpoint-chord', 'axis-projection', 'qualified-route-arc-pixels']);
const ORIENTATIONS = new Set(['unsigned', 'signedX', 'signedY', 'directed-route']);
const PHASE_MODES = new Set(['cumulative', 'direction-reversing', 'contact-stroke']);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const modulo = (value, size) => ((value % size) + size) % size;

const validateArticulationField = value => {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.spacingPixels) || value.spacingPixels < 0.25 ||
      value.spacingPixels > 1000000 || !SCOPES.has(value.lifetimeScope ?? 'actorJourney') ||
      !METRICS.has(value.metric ?? 'endpoint-chord') || !ORIENTATIONS.has(value.orientation ?? 'unsigned') ||
      !PHASE_MODES.has(value.phaseMode ?? 'cumulative') ||
      (value.metric === 'axis-projection' && !['signedX', 'signedY'].includes(value.orientation)) ||
      (value.phaseMode === 'direction-reversing' && !['signedX', 'signedY', 'directed-route'].includes(value.orientation)) ||
      (value.phaseMode === 'contact-stroke' && value.lifetimeScope !== 'contactSpan') ||
      (value.metric === 'qualified-route-arc-pixels' ? value.orientation !== 'directed-route' || value.lifetimeScope !== 'actorJourney' || value.sustain !== true || value.phaseMode !== 'direction-reversing' || !id(value.routeId) || value.routeId.length > 128 : value.orientation === 'directed-route' || value.routeId != null)) throw new Error('Invalid travel articulation field.');
  return Object.freeze({ spacingPixels: value.spacingPixels, lifetimeScope: value.lifetimeScope ?? 'actorJourney',
    metric: value.metric ?? 'endpoint-chord', orientation: value.orientation ?? 'unsigned',
    phaseMode: value.phaseMode ?? 'cumulative', sustain: value.sustain === true, ...(value.metric === 'qualified-route-arc-pixels' ? { routeId: value.routeId, crossingPolicy: 'none;held-route-coordinate-only' } : {}) });
};

// This is the single physical travel clock. It consumes committed coordinates,
// never viewport positions, elapsed host time, or an actor's look direction.
const createTravelAccumulator = ({ maxEntries = 16384, maxCrossingsPerFact = 128 } = {}) => {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxCrossingsPerFact) ||
      maxCrossingsPerFact < 1 || maxCrossingsPerFact > 4096) throw new Error('Invalid travel budgets.');
  let entries = new Map();
  const identity = (batch, fact, instrumentId, field) => {
    const scopeInstanceId = field.lifetimeScope === 'actorJourney' ? String(fact.actorId) :
      field.lifetimeScope === 'actionInstance' ? fact.actionInstanceId : fact.contactSpanId;
    if (!id(batch.worldId) || !Number.isSafeInteger(batch.generation) || !Number.isSafeInteger(fact.actorId) ||
        !id(instrumentId) || !id(scopeInstanceId)) throw new Error('Missing travel scope identity.');
    return { key: JSON.stringify([batch.worldId, batch.generation, fact.actorId, instrumentId, field.lifetimeScope, scopeInstanceId]), scopeInstanceId };
  };
  const consumeRoute = (batch, fact, instrumentId, field, graphRevision, route) => {
    const { key, scopeInstanceId } = identity(batch, fact, instrumentId, field), prior = entries.get(key), empty = Object.freeze([]);
    const unavailable = reason => { entries.delete(key); return Object.freeze({ status: 'unsupported', reason, crossings: empty }); };
    if (!route || route.status !== 'qualified' || route.worldId !== batch.worldId || route.generation !== batch.generation || route.actorId !== fact.actorId || route.routeId !== field.routeId ||
        !Number.isSafeInteger(route.routeRevision) || route.routeRevision < 0 || !id(route.branchId) || !id(route.entryObservationId) || route.coordinatePrecision !== 'completed-route-endpoint-projection' ||
        !['authored', 'measured-trace'].includes(route.geometrySource) || route.observationTick !== batch.tick || route.motionSourceEventId !== fact.eventId || route.motionSourceSequence !== fact.causalSequence || route.motionSourceTick !== batch.tick ||
        !Number.isFinite(route.sPixels) || Math.abs(route.sPixels) > 1e12 || !Number.isFinite(route.previousSPixels) || Math.abs(route.previousSPixels) > 1e12 ||
        !Number.isSafeInteger(route.previousObservationTick) || route.previousObservationTick < -1 || !point(fact.positionAfter) || route.lastPosition?.x !== fact.positionAfter.x || route.lastPosition?.y !== fact.positionAfter.y || batch.completeness?.status !== 'complete') return unavailable('qualified-directed-route-endpoint-unavailable');
    const routeIdentity = JSON.stringify([route.routeId, route.routeRevision, route.branchId, route.entryObservationId]);
    if (prior && (JSON.stringify(prior.field) !== JSON.stringify(field) || prior.routeIdentity !== routeIdentity || prior.previousRouteCoordinate !== route.previousSPixels || route.previousObservationTick !== batch.tick - 1)) {
      entries.delete(key); return Object.freeze({ status: 'discontinuity', reason: 'route-reentry-revision-or-unobserved-coordinate', crossings: empty });
    }
    if (!prior && entries.size >= maxEntries) return Object.freeze({ status: 'rejected', reason: 'travel-capacity', crossings: empty });
    const state = prior ? { ...prior } : { worldId: batch.worldId, generation: batch.generation, actorId: fact.actorId, instrumentId, graphRevision,
      lifetimeScope: field.lifetimeScope, scopeInstanceId, field, origin: { ...fact.positionAfter }, pathDistancePixels: 0, signedDistancePixels: 0, contactPathDistancePixels: 0,
      directionEpoch: 0, directionSign: 0, discontinuityEpoch: 0, actionInstanceId: fact.actionInstanceId ?? null, ordinal: 0, routeIdentity, originRouteCoordinate: route.sPixels };
    const delta = prior ? route.sPixels - prior.previousRouteCoordinate : 0, distance = Math.abs(delta), from = Object.freeze({ pathDistancePixels: state.pathDistancePixels, signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: 0 });
    if (!Number.isFinite(state.pathDistancePixels + distance) || Math.abs(state.signedDistancePixels + delta) > 1e12) return unavailable('route-distance-overflow');
    const sign = Math.sign(delta); if (sign && state.directionSign && sign !== state.directionSign) state.directionEpoch++; if (sign) state.directionSign = sign;
    state.pathDistancePixels += distance; state.signedDistancePixels = route.sPixels - state.originRouteCoordinate; state.previousRouteCoordinate = route.sPixels; state.previousPosition = { ...fact.positionAfter }; state.observedTick = batch.tick; state.actionInstanceId = fact.actionInstanceId ?? null;
    entries.set(key, state);
    return Object.freeze({ status: 'accepted', state: freezeState(state), phase01: modulo(state.signedDistancePixels, field.spacingPixels) / field.spacingPixels, distancePixels: distance, crossings: empty,
      observation: Object.freeze({ schema: 'lemmings-canonical-travel-observation/v1', worldId: batch.worldId, generation: batch.generation, actorId: fact.actorId, instrumentId,
        lifetimeScope: field.lifetimeScope, scopeInstanceId, metric: field.metric, orientation: field.orientation, precision: 'completed-route-endpoint-projection',
        routeId: route.routeId, routeRevision: route.routeRevision, branchId: route.branchId, entryObservationId: route.entryObservationId, routeIdentity, geometrySource: route.geometrySource,
        originRouteCoordinate: state.originRouteCoordinate, fromRouteCoordinate: prior ? prior.previousRouteCoordinate : route.sPixels, toRouteCoordinate: route.sPixels,
        originWorldCoordinate: Object.freeze({ ...state.origin }), discontinuityEpoch: state.discontinuityEpoch, directionEpoch: state.directionEpoch,
        sourceEventId: fact.eventId, from, to: Object.freeze({ pathDistancePixels: state.pathDistancePixels, signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: 0 }) }) });
  };
  const consume = (batch, fact, instrumentId, input, graphRevision = 0, routeCoordinate = null) => {
    const field = validateArticulationField(input);
    if (field.metric === 'qualified-route-arc-pixels') return consumeRoute(batch, fact, instrumentId, field, graphRevision, routeCoordinate);
    const { key, scopeInstanceId } = identity(batch, fact, instrumentId, field);
    if (!point(fact.positionBefore) || !point(fact.positionAfter) || !id(fact.eventId)) throw new Error('Invalid committed motion.');
    const prior = entries.get(key);
    if (prior && JSON.stringify(prior.field) !== JSON.stringify(field)) throw new Error('Travel mapping changed without resetting its scope.');
    const supported = field.metric !== 'segment-path' || fact.physicalPayload?.pathEvidence === 'committed-coordinate-write';
    if (!supported) return Object.freeze({ status: 'unsupported', reason: 'required-segment-path-evidence', crossings: Object.freeze([]) });
    if (field.lifetimeScope === 'contactSpan' && fact.physicalPayload?.contactObserved !== true) {
      entries.delete(key);
      return Object.freeze({ status: 'unsupported', reason: 'unknown-contact-coverage', crossings: Object.freeze([]) });
    }
    if (!prior && entries.size >= maxEntries) return Object.freeze({ status: 'rejected', reason: 'travel-capacity', crossings: Object.freeze([]) });
    const before = fact.positionBefore, after = fact.positionAfter;
    const discontinuity = fact.discontinuity === true || fact.physicalPayload?.discontinuity === true ||
      prior && (prior.previousPosition.x !== before.x || prior.previousPosition.y !== before.y);
    const state = prior ? { ...prior } : { worldId: batch.worldId, generation: batch.generation, actorId: fact.actorId,
      instrumentId, graphRevision, lifetimeScope: field.lifetimeScope, scopeInstanceId, field, origin: { ...before },
      pathDistancePixels: 0, signedDistancePixels: field.orientation === 'unsigned' ? null : 0,
      contactPathDistancePixels: 0, directionEpoch: 0, directionSign: 0, discontinuityEpoch: 0,
      actionInstanceId: fact.actionInstanceId ?? null, ordinal: 0 };
    state.actionInstanceId = fact.actionInstanceId ?? null;
    state.previousPosition = { ...after };
    if (discontinuity) {
      state.discontinuityEpoch++; state.origin = { ...after };
      entries.set(key, state);
      return Object.freeze({ status: 'discontinuity', reason: 'unobserved-travel', state: freezeState(state), crossings: Object.freeze([]) });
    }
    const dx = after.x - before.x, dy = after.y - before.y;
    const projection = field.orientation === 'signedX' ? dx : field.orientation === 'signedY' ? dy : null;
    const distance = field.metric === 'axis-projection' ? Math.abs(projection) : Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || !Number.isFinite(state.pathDistancePixels + distance)) throw new Error('Travel distance overflow.');
    const sign = projection == null ? 0 : Math.sign(projection);
    if (sign && state.directionSign && state.directionSign !== sign) state.directionEpoch++;
    if (sign) state.directionSign = sign;
    const fromCoordinates = Object.freeze({ pathDistancePixels: state.pathDistancePixels, signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: state.contactPathDistancePixels });
    const from = field.phaseMode === 'direction-reversing' ? state.signedDistancePixels : state.pathDistancePixels;
    const delta = field.phaseMode === 'direction-reversing' ? projection : distance;
    const to = from + delta, spacing = field.spacingPixels;
    const count = delta > 0 ? Math.floor(to / spacing + 1e-10) - Math.floor(from / spacing + 1e-10) :
      delta < 0 ? Math.ceil(from / spacing - 1e-10) - Math.ceil(to / spacing - 1e-10) : 0;
    // Refuse a segment before changing accumulated state; no silent thinning of
    // a promised faithful distance articulation.
    if (count > maxCrossingsPerFact) return Object.freeze({ status: 'rejected', reason: 'travel-crossing-budget', crossings: Object.freeze([]) });
    const crossings = [];
    for (let index = 0; index < count; index++) {
      const threshold = delta > 0 ? (Math.floor(from / spacing + 1e-10) + index + 1) * spacing :
        (Math.ceil(from / spacing - 1e-10) - index - 1) * spacing;
      const fraction = (threshold - from) / delta;
      crossings.push(Object.freeze({ ordinal: ++state.ordinal, sourceEventId: fact.eventId, fraction,
        position: Object.freeze({ x: before.x + dx * fraction, y: before.y + dy * fraction }),
        pathDistancePixels: state.pathDistancePixels + distance * fraction, precision: 'linear-segment-interpolation' }));
    }
    state.pathDistancePixels += distance;
    if (projection != null) state.signedDistancePixels += projection;
    if (field.lifetimeScope === 'contactSpan') state.contactPathDistancePixels += distance;
    entries.set(key, state);
    const phaseDistance = field.phaseMode === 'direction-reversing' ? state.signedDistancePixels : state.pathDistancePixels;
    return Object.freeze({ status: 'accepted', state: freezeState(state), phase01: modulo(phaseDistance, spacing) / spacing,
      observation: Object.freeze({ schema: 'lemmings-canonical-travel-observation/v1', worldId: batch.worldId, generation: batch.generation, actorId: fact.actorId, instrumentId,
        lifetimeScope: state.lifetimeScope, scopeInstanceId: state.scopeInstanceId, metric: field.metric, orientation: field.orientation,
        precision: fact.physicalPayload?.pathEvidence === 'committed-coordinate-write' ? 'committed-coordinate-write' : 'endpoint-chord',
        originWorldCoordinate: Object.freeze({ ...state.origin }), discontinuityEpoch: state.discontinuityEpoch, directionEpoch: state.directionEpoch,
        sourceEventId: fact.eventId, from: fromCoordinates, to: Object.freeze({ pathDistancePixels: state.pathDistancePixels, signedDistancePixels: state.signedDistancePixels, contactPathDistancePixels: state.contactPathDistancePixels }) }),
      distancePixels: distance, crossings: Object.freeze(crossings) });
  };
  const release = predicate => { for (const [key, state] of entries) if (predicate(state)) entries.delete(key); };
  const observeLifecycle = (batch, fact) => {
    if (fact.kind === 'ActorTerminated') release(state => state.worldId === batch.worldId && state.generation === batch.generation && state.actorId === fact.actorId);
    if (fact.kind === 'ActionExited') release(state => state.lifetimeScope === 'actionInstance' && state.actionInstanceId === fact.actionInstanceId && state.actorId === fact.actorId);
    if (fact.kind === 'ContactSpanEnded') release(state => state.lifetimeScope === 'contactSpan' && state.scopeInstanceId === fact.spanId);
    if (fact.kind === 'DirectionChanged') for (const state of entries.values()) {
      if (state.worldId === batch.worldId && state.generation === batch.generation && state.actorId === fact.actorId) {
        state.directionEpoch++; state.directionSign = 0;
      }
    }
  };
  const snapshot = () => Object.freeze({ version: 1, entries: Object.freeze([...entries.values()].map(freezeState)) });
  const restore = value => {
    if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > maxEntries) throw new Error('Invalid travel checkpoint.');
    const next = new Map();
    for (const input of value.entries) {
      const field = validateArticulationField(input.field);
      const { key, scopeInstanceId } = identity(input, { actorId: input.actorId, actionInstanceId: input.lifetimeScope === 'actionInstance' ? input.scopeInstanceId : input.actionInstanceId,
        contactSpanId: input.scopeInstanceId }, input.instrumentId, field);
      if (next.has(key) || input.scopeInstanceId !== scopeInstanceId || input.lifetimeScope !== field.lifetimeScope || !point(input.origin) || !point(input.previousPosition) ||
          !Number.isFinite(input.pathDistancePixels) || input.pathDistancePixels < 0 ||
          !(input.signedDistancePixels === null && field.orientation === 'unsigned' || Number.isFinite(input.signedDistancePixels)) ||
          !Number.isFinite(input.contactPathDistancePixels) || input.contactPathDistancePixels < 0 ||
          ![input.directionEpoch, input.discontinuityEpoch, input.ordinal].every(number => Number.isSafeInteger(number) && number >= 0) ||
          !Number.isSafeInteger(input.graphRevision) || input.graphRevision < 0 ||
          ![-1, 0, 1].includes(input.directionSign) || field.metric === 'qualified-route-arc-pixels' && (typeof input.routeIdentity !== 'string' || !input.routeIdentity || input.routeIdentity.length > 2048 || !Number.isFinite(input.originRouteCoordinate) || !Number.isFinite(input.previousRouteCoordinate) || Math.abs(input.previousRouteCoordinate) > 1e12 || Math.abs(input.originRouteCoordinate) > 1e12 || !Number.isSafeInteger(input.observedTick) || input.observedTick < 0)) throw new Error('Invalid travel checkpoint entry.');
      next.set(key, { ...input, field, origin: { ...input.origin }, previousPosition: { ...input.previousPosition } });
    }
    entries = next;
  };
  return { consume, observeLifecycle, snapshot, restore, release, rebaseGraph(revision, predicate) { for (const state of entries.values()) if (predicate(state)) state.graphRevision = revision; }, reset: () => entries.clear() };
};
const freezeState = state => Object.freeze({ ...state, origin: Object.freeze({ ...state.origin }), previousPosition: Object.freeze({ ...state.previousPosition }) });

export { createTravelAccumulator, validateArticulationField };
