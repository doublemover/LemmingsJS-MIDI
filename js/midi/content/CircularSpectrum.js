import { freezeData } from '../../core/CanonicalData.js';

export const CIRCULAR_SPECTRUM_REVISION = 'original-octave-circular-spectrum-v2-route';
export const CIRCULAR_PARTIAL_CAPACITY = 10;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const fail = message => { throw Object.assign(new Error(message), { name: 'CircularSpectrumError', code: 'circular-spectrum-unavailable' }); };
export function resolveCircularSpectrum(raw = {}, sampleRate, referenceRatio = 1) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['periodRatio', 'referenceFrequencyHz', 'frequencyCenterHz', 'spectralWidthOctaves', 'bandLowHz', 'bandHighHz', 'partialCountCap', 'weight01'].includes(key)) || ![44100, 48000, 96000].includes(sampleRate) || !finite(referenceRatio, 1 / 16, 16)) fail('Circular spectrum requires an explicit output rate and bounded reference transposition.');
  const p = { periodRatio: 2, referenceFrequencyHz: 55, frequencyCenterHz: 700, spectralWidthOctaves: 1.2, bandLowHz: 80, bandHighHz: 8000, partialCountCap: 10, weight01: 1, ...raw };
  if (p.periodRatio !== 2 || !finite(p.referenceFrequencyHz, 1, 20000) || !finite(p.frequencyCenterHz, 20, 20000) || !finite(p.spectralWidthOctaves, 0.25, 3) ||
      !finite(p.bandLowHz, 20, 10000) || !finite(p.bandHighHz, p.bandLowHz * 2, 20000) || !Number.isInteger(p.partialCountCap) || !finite(p.partialCountCap, 8, CIRCULAR_PARTIAL_CAPACITY) || !finite(p.weight01, 0, 1)) fail('The initial circular lattice supports only octave periods, positive resolved references and eight to ten bounded partial slots.');
  const referenceFrequencyHz = p.referenceFrequencyHz * referenceRatio, high = Math.min(p.bandHighHz, sampleRate * 0.4), low = p.bandLowHz;
  if (high < low * 2 || p.frequencyCenterHz <= low || p.frequencyCenterHz >= high) fail('The circular active band is unavailable at this output rate.');
  const minimumIndex = Math.floor(Math.log2(low / referenceFrequencyHz)) - 1, maximumIndex = minimumIndex + p.partialCountCap - 1;
  if (p.partialCountCap < Math.ceil(Math.log2(high / low)) + 3 || maximumIndex < Math.ceil(Math.log2(high / referenceFrequencyHz))) fail('The active circular band and its silent phase-recycling guards exceed the authored partial cap.');
  return freezeData({ revision: CIRCULAR_SPECTRUM_REVISION, ...p, sampleRate, authoredReferenceFrequencyHz: p.referenceFrequencyHz, referenceFrequencyHz,
    resolvedBandLowHz: low, resolvedBandHighHz: high, minimumIndex, maximumIndex,
    envelope: 'amplitude-Gaussian;log2-frequency-standard-deviation-in-octaves', normalization: 'convex-ramped-partial-amplitudes;sum-absolute-gains-at-most-0.8-times-weight',
    bandEdge: 'zero-outside-active-band;quarter-octave-cosine-tapers', phasePolicy: 'preserve-active-slot-phase;recycle-only-silent-outer-guards',
    quality: 'implementation-awaiting-frequency-wrap-spectral-cost-and-listening-qualification' });
}

export function validateCircularCoordinateControl(parameters) {
  const mode = parameters.circularControlMode ?? 0, scope = parameters.circularScope ?? 0, axis = parameters.circularAxis ?? 0, segments = parameters.circularRequireSegments ?? 0;
  if (![0, 1, 2].includes(mode) || ![0, 1, 2].includes(scope) || ![0, 1].includes(axis) || ![0, 1].includes(segments) || mode === 1 && (scope !== 0 || segments !== 0) || mode === 2 && (scope !== 0 || axis !== 0 || segments !== 0)) fail('Circular coordinate mode has unsupported scope, axis or precision controls. Directed routes require actorJourney and completed endpoints; contacts sample one onset coordinate.');
  return mode;
}

export function circularSpectrumParameters(parameters) {
  return { periodRatio: parameters.circularPeriodRatio, referenceFrequencyHz: parameters.circularReferenceHz, frequencyCenterHz: parameters.circularCenterHz,
    spectralWidthOctaves: parameters.circularWidthOctaves, bandLowHz: parameters.circularLowHz, bandHighHz: parameters.circularHighHz,
    partialCountCap: parameters.circularPartialCap, weight01: parameters.circularWeight01 };
}

export function circularSpectrumWeight(recipe, frequency) {
  if (!Number.isFinite(frequency) || frequency <= recipe.resolvedBandLowHz || frequency >= recipe.resolvedBandHighHz) return 0;
  const z = Math.log2(frequency / recipe.frequencyCenterHz) / recipe.spectralWidthOctaves;
  const edge = Math.min(1, Math.log2(frequency / recipe.resolvedBandLowHz) * 4, Math.log2(recipe.resolvedBandHighHz / frequency) * 4);
  return Math.exp(-0.5 * z * z) * (0.5 - 0.5 * Math.cos(Math.PI * edge));
}

export function captureCircularContactCoordinate(batch, fact, mappingId, graphRevision) {
  const support = fact?.kind === 'ContactSpanBegan', resolved = fact?.kind === 'ContactResolved', point = support ? fact.anchor : fact?.positionAfter;
  if ((!support && !resolved) || typeof batch?.worldId !== 'string' || !batch.worldId || batch.worldId.length > 512 || !Number.isSafeInteger(batch.generation) || batch.generation < 0 || !Number.isSafeInteger(batch.tick) || batch.tick < 0 || typeof mappingId !== 'string' || !mappingId || mappingId.length > 128 || !Number.isSafeInteger(graphRevision) || graphRevision < 0 || batch?.completeness?.status !== 'complete' || !point || !finite(point.x, -1000000000, 1000000000) || !finite(point.y, -1000000000, 1000000000) ||
      !Number.isSafeInteger(fact.actorId) || fact.actorId < 0 || !Number.isSafeInteger(fact.causalSequence) || fact.causalSequence < 1 || typeof fact.eventId !== 'string' || !fact.eventId || fact.eventId.length > 512 ||
      fact.observedTick != null && fact.observedTick !== batch.tick || fact.physicalCauseFact && fact.physicalCauseFact.actorId !== fact.actorId) return null;
  const contactInstanceId = support ? fact.spanId : fact.contactId;
  if (typeof contactInstanceId !== 'string' || !contactInstanceId || contactInstanceId.length > 512) return null;
  return freezeData({ schema: 'lemmings-canonical-contact-coordinate/v1', worldId: batch.worldId, generation: batch.generation, actorId: fact.actorId, mappingId, graphRevision,
    contactInstanceId, sourceEventId: fact.eventId, sourceSequence: fact.causalSequence, observedTick: batch.tick, coordinate: { x: point.x, y: point.y },
    coordinateMeaning: support ? 'observed-completed-support-cell-anchor' : 'actor-position-at-resolved-contact', precision: 'completed-contact-coordinate',
    surfaceRevision: Number.isSafeInteger(fact.surfaceRevision) && fact.surfaceRevision >= 0 ? fact.surfaceRevision : resolved && Number.isSafeInteger(batch.terrainRevisionBefore) && batch.terrainRevisionBefore >= 0 && batch.terrainRevisionBefore === batch.terrainRevisionAfter ? batch.terrainRevisionBefore : null });
}

function planCircularContact(parameters, intent, targetFrame, sampleRate) {
  const o = intent?.articulationState?.contactCoordinate;
  if (intent?.kind !== 'begin' || !o || o.schema !== 'lemmings-canonical-contact-coordinate/v1' || o.worldId !== intent.worldId || o.generation !== intent.generation || o.actorId !== intent.actorId || o.mappingId !== intent.mappingId ||
      !['ContactSpanBegan', 'ContactResolved'].includes(intent.physicalSourceKind) || typeof o.worldId !== 'string' || !o.worldId || o.worldId.length > 512 || !Number.isSafeInteger(o.generation) || o.generation < 0 || !Number.isSafeInteger(o.actorId) || o.actorId < 0 ||
      !Number.isSafeInteger(o.graphRevision) || o.graphRevision < 0 || typeof o.mappingId !== 'string' || !o.mappingId || o.mappingId.length > 128 ||
      typeof o.contactInstanceId !== 'string' || !o.contactInstanceId || o.contactInstanceId.length > 512 || typeof o.sourceEventId !== 'string' || !o.sourceEventId || o.sourceEventId.length > 512 || !intent.sourceEventIds?.includes(o.sourceEventId) ||
      !Number.isSafeInteger(o.sourceSequence) || o.sourceSequence < 1 || !Number.isSafeInteger(o.observedTick) || o.observedTick < 0 || o.precision !== 'completed-contact-coordinate' || !['observed-completed-support-cell-anchor', 'actor-position-at-resolved-contact'].includes(o.coordinateMeaning) || o.surfaceRevision !== null && (!Number.isSafeInteger(o.surfaceRevision) || o.surfaceRevision < 0) || parameters.circularRequireSegments === 1 ||
      ![0, 1].includes(parameters.circularAxis) || !Number.isSafeInteger(targetFrame) || targetFrame < 0 || !Number.isSafeInteger(targetFrame + 1) || ![44100, 48000, 96000].includes(sampleRate) || !finite(parameters.circularPixelsPerCycle, 1, 1000000)) fail('This circular onset requires its matching completed contact coordinate.');
  const coordinate = o.coordinate?.[parameters.circularAxis === 0 ? 'x' : 'y'];
  if (!finite(coordinate, -1000000000, 1000000000)) fail('The observed contact has no bounded coordinate on this declared axis.');
  const phase = parameters.circularPhaseOrigin + (coordinate - parameters.circularOriginPixels) / parameters.circularPixelsPerCycle;
  if (!finite(phase, -1000000, 1000000)) fail('The contact coordinate exceeds the declared circular origin/phase domain.');
  return freezeData({ from: phase, to: phase, firstFrame: targetFrame, endFrame: targetFrame + 1, sequence: o.sourceSequence,
    ownerIdentity: JSON.stringify([o.worldId, o.generation, o.actorId, o.mappingId, o.graphRevision, o.contactInstanceId, o.sourceEventId]),
    receipt: { schema: 'lemmings-circular-contact-receipt/v1', rendererRevision: CIRCULAR_SPECTRUM_REVISION, mappingId: o.mappingId, graphRevision: o.graphRevision, contactInstanceId: o.contactInstanceId,
      sourceEventId: o.sourceEventId, observedTick: o.observedTick, surfaceRevision: o.surfaceRevision, coordinate, coordinateMeaning: o.coordinateMeaning, precision: o.precision,
      orientation: parameters.circularAxis === 0 ? 'world-x' : 'world-y', phaseCycles: phase, originPixels: parameters.circularOriginPixels, pixelsPerCycle: parameters.circularPixelsPerCycle,
      timing: 'onset-samples-one-observed-coordinate;no-distance-interpolation-or-time-driven-ascent', firstFrame: targetFrame, endFrame: targetFrame + 1, acousticReceipt: false } });
}

function circularRouteCoordinatesMatch(o) {
  if (!o || ![o.originRouteCoordinate, o.fromRouteCoordinate, o.toRouteCoordinate].every(value => finite(value, -1e12, 1e12))) return false;
  const first = o.fromRouteCoordinate - o.originRouteCoordinate, last = o.toRouteCoordinate - o.originRouteCoordinate, tolerance = Math.max(1e-7, Math.abs(first) * Number.EPSILON * 16, Math.abs(last) * Number.EPSILON * 16);
  return Math.abs(first - o.from?.signedDistancePixels) <= tolerance && Math.abs(last - o.to?.signedDistancePixels) <= tolerance;
}

export function planCircularTravel(parameters, intent, targetFrame, sampleRate) {
  if (parameters.sourceMode !== 2) return null;
  validateCircularCoordinateControl(parameters);
  if (intent?.controlFixture === true && !intent?.articulationState?.travel && !intent?.articulationState?.contactCoordinate) return null;
  if (parameters.circularControlMode === 1) return planCircularContact(parameters, intent, targetFrame, sampleRate);
  const routed = parameters.circularControlMode === 2, o = intent?.articulationState?.travel, scope = ['actorJourney', 'contactSpan', 'actionInstance'][parameters.circularScope], orientation = routed ? 'directed-route' : parameters.circularAxis === 0 ? 'signedX' : 'signedY';

  if (routed && (parameters.circularScope !== 0 || parameters.circularAxis !== 0 || parameters.circularRequireSegments !== 0 ||
      typeof o?.routeId !== 'string' || !o.routeId || o.routeId.length > 128 || !Number.isSafeInteger(o.routeRevision) || o.routeRevision < 0 || typeof o.branchId !== 'string' || !o.branchId || o.branchId.length > 256 ||
      typeof o.entryObservationId !== 'string' || !o.entryObservationId || o.entryObservationId.length > 512 || o.routeIdentity !== JSON.stringify([o.routeId, o.routeRevision, o.branchId, o.entryObservationId]) ||
      !['authored', 'measured-trace'].includes(o.geometrySource) || o.segmentCount !== 1 || o.segmentOrdinal !== 0 || !circularRouteCoordinatesMatch(o))) fail('Directed circular travel requires its exact qualified route entry and completed endpoint coordinate; segment precision is unavailable.');
  if (!scope || ![0, 1].includes(parameters.circularAxis) || ![0, 1].includes(parameters.circularRequireSegments) || typeof intent?.mappingId !== 'string' || !intent.mappingId || intent.mappingId.length > 128 || !o || typeof o.worldId !== 'string' || !o.worldId || o.worldId.length > 512 || !Number.isSafeInteger(o.actorId) || o.actorId < 0 || !Number.isSafeInteger(o.generation) || o.generation < 0 || o.schema !== 'lemmings-canonical-travel-observation/v1' || o.worldId !== intent.worldId || o.generation !== intent.generation || o.actorId !== intent.actorId || o.instrumentId !== intent.mappingId ||
      o.lifetimeScope !== scope || o.orientation !== orientation || o.metric !== (routed ? 'qualified-route-arc-pixels' : 'axis-projection') || typeof o.scopeInstanceId !== 'string' || !o.scopeInstanceId || o.scopeInstanceId.length > 512 ||
      !Number.isSafeInteger(o.discontinuityEpoch) || o.discontinuityEpoch < 0 || !(routed ? o.precision === 'completed-route-endpoint-projection' : ['endpoint-chord', 'committed-coordinate-write'].includes(o.precision)) || parameters.circularRequireSegments === 1 && o.precision !== 'committed-coordinate-write' ||
      !Number.isFinite(o.from?.signedDistancePixels) || !Number.isFinite(o.to?.signedDistancePixels) || o.timing !== 'completed-tick-equal-segments-v1' || !finite(o.completedTickDurationMs, 0.001, 2000) ||
      !Number.isInteger(o.segmentCount) || !finite(o.segmentCount, 1, 128) || !Number.isInteger(o.segmentOrdinal) || !finite(o.segmentOrdinal, 0, o.segmentCount - 1) || !Number.isSafeInteger(o.sourceSequence) || o.sourceSequence < 1 ||
      typeof o.sourceEventId !== 'string' || !o.sourceEventId || o.sourceEventId.length > 512 || !intent.sourceEventIds?.includes(o.sourceEventId) || !Number.isSafeInteger(targetFrame) || targetFrame < 0 || ![44100, 48000, 96000].includes(sampleRate) || !finite(parameters.circularPixelsPerCycle, 1, 1000000)) fail('Canonical travel does not cover this declared circular metric, scope, precision or timing policy.');
  const from = parameters.circularPhaseOrigin + (o.from.signedDistancePixels - parameters.circularOriginPixels) / parameters.circularPixelsPerCycle,
    to = parameters.circularPhaseOrigin + (o.to.signedDistancePixels - parameters.circularOriginPixels) / parameters.circularPixelsPerCycle;
  const span = o.completedTickDurationMs * sampleRate / 1000, firstFrame = targetFrame + Math.round(span * o.segmentOrdinal / o.segmentCount), endFrame = targetFrame + Math.round(span * (o.segmentOrdinal + 1) / o.segmentCount);
  if (!finite(from, -1000000, 1000000) || !finite(to, -1000000, 1000000) || !Number.isSafeInteger(endFrame) || endFrame <= firstFrame || Math.abs(to - from) / (endFrame - firstFrame) * sampleRate > 4) fail('Circular travel exceeds the bounded phase or four-cycle/second interpolation domain.');
  return freezeData({ from, to, firstFrame, endFrame, sequence: o.sourceSequence, ownerIdentity: JSON.stringify([o.worldId, o.generation, o.actorId, o.instrumentId, o.scopeInstanceId, o.discontinuityEpoch, ...(routed ? [o.routeIdentity] : [])]),
    receipt: { schema: 'lemmings-circular-travel-receipt/v1', rendererRevision: CIRCULAR_SPECTRUM_REVISION, mappingId: o.instrumentId, lifetimeScope: scope, scopeInstanceId: o.scopeInstanceId,
      metric: o.metric, orientation, precision: o.precision, ...(routed ? { routeId: o.routeId, routeRevision: o.routeRevision, branchId: o.branchId, entryObservationId: o.entryObservationId, geometrySource: o.geometrySource, originRouteCoordinate: o.originRouteCoordinate, fromRouteCoordinate: o.fromRouteCoordinate, toRouteCoordinate: o.toRouteCoordinate } : {}), discontinuityEpoch: o.discontinuityEpoch, sourceEventId: o.sourceEventId, pixelsPerCycle: parameters.circularPixelsPerCycle,
      originPixels: parameters.circularOriginPixels, phaseOrigin: parameters.circularPhaseOrigin, firstFrame, endFrame, firstPhaseCycles: from, endPhaseCycles: to,
      timing: o.timing, phasePolicy: 'unwrapped-canonical-distance;negative-phase-uses-floor;carrier-phase-remains-owned', acousticReceipt: false } });
}
