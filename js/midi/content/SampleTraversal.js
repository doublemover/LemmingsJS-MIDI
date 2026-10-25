import { freezeData } from '../../core/CanonicalData.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => { throw Object.assign(new Error(message), { name: 'SampleTraversalError', code: 'sample-travel-unavailable' }); };
export function validateSampleTraversalBinding(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['schema', 'revision', 'mappingId', 'lifetimeScope', 'metric', 'orientation', 'mode', 'originPixels', 'framesPerWorldPixel', 'requiredPrecision', 'discontinuityPolicy', 'timing'].includes(key)) ||
      raw.schema !== 'lemmings-sample-traversal/v1' || !integer(raw.revision, 1, 2147483647) || typeof raw.mappingId !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(raw.mappingId) ||
      !['actorJourney', 'contactSpan', 'actionInstance'].includes(raw.lifetimeScope) || !['segment-path', 'endpoint-chord', 'axis-projection'].includes(raw.metric) || !['unsigned', 'signedX', 'signedY'].includes(raw.orientation) ||
      !['tape-footpath', 'one-way-rubbing'].includes(raw.mode) || !finite(raw.originPixels, -1000000000, 1000000000) || !finite(raw.framesPerWorldPixel, 0.000001, 1000000) ||
      !['committed-coordinate-write', 'endpoint-chord'].includes(raw.requiredPrecision) || raw.discontinuityPolicy !== 'end-voice' || raw.timing !== 'completed-tick-equal-segments-v1' ||
      raw.mode === 'tape-footpath' && (raw.metric !== 'axis-projection' || !['signedX', 'signedY'].includes(raw.orientation)) ||
      raw.mode === 'one-way-rubbing' && (raw.lifetimeScope !== 'contactSpan' || raw.orientation !== 'unsigned' || raw.metric === 'axis-projection')) fail('Traversal requires an explicit canonical scope, metric, varispeed direction, precision and completed-tick timing policy.');
  return freezeData({ ...raw });
}

// Replay only the completed observation, starting at its committed audio target.
// Equal subspans represent ordered writes, not measured intra-tick timestamps.
export function planSampleTraversal(entry, intent, targetFrame, sampleRate) {
  const binding = entry.traversal, observed = intent?.articulationState?.travel, profile = entry.cursorProfile;
  if (!binding || !profile || !observed || observed.schema !== 'lemmings-canonical-travel-observation/v1' ||
      observed.instrumentId !== binding.mappingId || intent.mappingId !== binding.mappingId || observed.worldId !== intent.worldId || observed.generation !== intent.generation || observed.actorId !== intent.actorId ||
      observed.lifetimeScope !== binding.lifetimeScope || observed.metric !== binding.metric || observed.orientation !== binding.orientation ||
      typeof observed.scopeInstanceId !== 'string' || !observed.scopeInstanceId || observed.scopeInstanceId.length > 512 || !integer(observed.discontinuityEpoch, 0) ||
      !['committed-coordinate-write', 'endpoint-chord'].includes(observed.precision) || binding.requiredPrecision === 'committed-coordinate-write' && observed.precision !== binding.requiredPrecision ||
      !observed.originWorldCoordinate || !finite(observed.originWorldCoordinate.x, -1000000000, 1000000000) || !finite(observed.originWorldCoordinate.y, -1000000000, 1000000000) ||
      observed.timing !== binding.timing || !finite(observed.completedTickDurationMs, 0.001, 2000) || !integer(observed.segmentCount, 1, 128) || !integer(observed.segmentOrdinal, 0, observed.segmentCount - 1) ||
      !integer(observed.sourceSequence, 1) || typeof observed.sourceEventId !== 'string' || !observed.sourceEventId || observed.sourceEventId.length > 512 || !intent.sourceEventIds?.includes(observed.sourceEventId) || !integer(targetFrame, 0) || sampleRate !== profile.sampleRate) fail('Canonical travel evidence does not cover this authored traversal binding.');
  const coordinate = binding.mode === 'tape-footpath' ? 'signedDistancePixels' : 'contactPathDistancePixels', from = observed.from?.[coordinate], to = observed.to?.[coordinate];
  if (!Number.isFinite(from) || !Number.isFinite(to) || binding.mode === 'one-way-rubbing' && (from < 0 || to < from)) fail('Canonical travel coordinates are unavailable or reverse a forward-only contact path.');
  const firstSourceFrame = entry.sourceFirst + (from - binding.originPixels) * binding.framesPerWorldPixel, endSourceFrame = entry.sourceFirst + (to - binding.originPixels) * binding.framesPerWorldPixel;
  const span = observed.completedTickDurationMs * sampleRate / 1000, firstOutputFrame = targetFrame + Math.round(span * observed.segmentOrdinal / observed.segmentCount), endOutputFrame = targetFrame + Math.round(span * (observed.segmentOrdinal + 1) / observed.segmentCount);
  const derivative = (endSourceFrame - firstSourceFrame) * profile.sourceToDecoded / (endOutputFrame - firstOutputFrame) * (profile.interpolation === 'smoothstep' ? 1.5 : 1);
  if (!integer(endOutputFrame, firstOutputFrame + 1) || !finite(firstSourceFrame, -profile.maximumCoordinateSourceFrames, profile.maximumCoordinateSourceFrames) || !finite(endSourceFrame, -profile.maximumCoordinateSourceFrames, profile.maximumCoordinateSourceFrames) || !finite(derivative, -profile.maximumReadDerivative, profile.maximumReadDerivative)) fail('Observed traversal exceeds the prepared source-coordinate, timing or filtered read-rate bound.');
  const ownerIdentity = JSON.stringify([observed.worldId, observed.generation, observed.actorId, observed.scopeInstanceId, observed.discontinuityEpoch]);
  return freezeData({ initialSourceFrame: firstSourceFrame, ownerIdentity,
    segment: { firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, sequence: observed.sourceSequence, discontinuity: 'continuous' },
    receipt: { schema: 'lemmings-sample-traversal-receipt/v1', mappingId: binding.mappingId, mappingRevision: binding.revision, sourceAssetHash: entry.assetHash,
      sourceSampleRate: entry.sourceSampleRate, sourceRegionFrames: [entry.sourceFirst, entry.sourceEnd], originWorldCoordinate: observed.originWorldCoordinate, originPixels: binding.originPixels,
      framesPerWorldPixel: binding.framesPerWorldPixel, mode: binding.mode, lifetimeScope: observed.lifetimeScope, scopeInstanceId: observed.scopeInstanceId, metric: observed.metric, orientation: observed.orientation,
      precision: observed.precision, discontinuityEpoch: observed.discontinuityEpoch, sourceEventId: observed.sourceEventId, sourceCoordinateDomain: 'original-source-frames',
      timing: binding.timing, observedSpanMs: observed.completedTickDurationMs, interpolation: 'authored-ordered-equal-subspans;no-measured-intra-tick-time;no-extrapolation',
      firstOutputFrame, endOutputFrame, firstSourceFrame, endSourceFrame, maximumDecodedReadDerivative: Math.abs(derivative), evidenceClass: 'canonical-travel-source-control-admission', acousticReceipt: false } });
}

export function sampleTraversalBeginFields(plan) {
  if (!plan) return {};
  const s = plan.segment;
  return { 20: plan.initialSourceFrame, 21: 1, 24: s.firstOutputFrame, 25: s.endOutputFrame, 26: s.firstSourceFrame, 27: s.endSourceFrame, 28: s.sequence, 29: 0, 30: 1 };
}
