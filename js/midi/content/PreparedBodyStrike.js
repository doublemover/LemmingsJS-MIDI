import { cloneData, freezeData } from '../../core/CanonicalData.js';
import { projectPreparedSurfacePoint } from './PreparedSurface.js';

const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
export function validatePreparedBodyStrike(raw) {
  const p = cloneData(raw, { maxBytes: 2048, maxNodes: 32 });
  if (!p || Object.getPrototypeOf(p) !== Object.prototype || Object.keys(p).some(key => !['surfaceId', 'surfaceRevision', 'pulseMilliseconds', 'amplitudeScale01', 'pitchPolicy'].includes(key)) || !text(p.surfaceId) || !Number.isSafeInteger(p.surfaceRevision) || p.surfaceRevision < 0 || ![4, 8, 12].includes(p.pulseMilliseconds) || !Number.isFinite(p.amplitudeScale01) || p.amplitudeScale01 < 0 || p.amplitudeScale01 > 1 || p.pitchPolicy !== 'fixed-prepared-body') throw new TypeError('Invalid finite prepared-body strike mapping.');
  return freezeData(p);
}

export function planPreparedBodyStrike(intent, body, targetFrame, token) {
  const p = validatePreparedBodyStrike(intent?.preparedBodyStrike), o = intent?.articulationState?.contactCoordinate;
  if (intent.kind !== 'begin' || intent.route !== 'prepared-body' || !['ContactResolved', 'ContactSpanBegan'].includes(intent.physicalSourceKind) || !o || o.schema !== 'lemmings-canonical-contact-coordinate/v1' || o.worldId !== intent.worldId || o.generation !== intent.generation || o.actorId !== intent.actorId || o.mappingId !== intent.mappingId || o.graphRevision !== intent.graphRevision || !text(o.sourceEventId) || !intent.sourceEventIds?.includes(o.sourceEventId) || o.precision !== 'completed-contact-coordinate' || !text(o.contactInstanceId) || !Number.isSafeInteger(o.sourceSequence) || o.sourceSequence < 1 || !Number.isSafeInteger(o.observedTick) || o.observedTick < 0 ||
      o.coordinateMeaning !== (intent.physicalSourceKind === 'ContactSpanBegan' ? 'observed-completed-support-cell-anchor' : 'actor-position-at-resolved-contact') || !body || !Array.isArray(body.pulses) || body.surfaceId !== p.surfaceId || body.surfaceRevision !== p.surfaceRevision || body.worldId !== intent.worldId || body.generation !== intent.generation || body.surfaceMap.boundTopologyRevision !== o.surfaceRevision || !Number.isSafeInteger(targetFrame) || targetFrame < 0 || !Number.isSafeInteger(token) || token < 1 || !Number.isFinite(intent.velocity01) || intent.velocity01 < 0 || intent.velocity01 > 1) throw new TypeError('The finite source lacks its exact observed contact, saved map or current prepared body.');
  const pulseIndex = body.pulses.findIndex(pulse => pulse.milliseconds === p.pulseMilliseconds), pulse = body.pulses[pulseIndex];
  if (!pulse || !Number.isSafeInteger(targetFrame + pulse.frames)) throw new TypeError('The selected finite pulse is unavailable on this body.');
  const position = projectPreparedSurfacePoint(body.surfaceMap, o.coordinate);
  return freezeData({ command: { frame: targetFrame, token, x01: position.x01, y01: position.y01, amplitude01: intent.velocity01 * p.amplitudeScale01, pulseIndex }, endFrame: targetFrame + pulse.frames,
    source: { intentId: intent.intentId, voiceId: intent.voiceId, onsetId: intent.onsetId, generation: intent.generation, actorId: intent.actorId, worldId: intent.worldId, sourceEventIds: intent.sourceEventIds,
      contactInstanceId: o.contactInstanceId, surfaceId: p.surfaceId, surfaceRevision: p.surfaceRevision, mapId: body.surfaceMap.id, mapRevision: body.surfaceMap.revision, bodyInstanceId: body.bodyInstanceId, pitchPolicy: p.pitchPolicy } });
}

export function validateCapturedBodyStrike(raw) {
  const p = cloneData(raw, { maxBytes: 24576, maxNodes: 128 }), keys = ['intentId', 'voiceId', 'onsetId', 'generation', 'actorId', 'worldId', 'sourceEventIds', 'contactInstanceId', 'surfaceId', 'surfaceRevision', 'mapId', 'mapRevision', 'bodyInstanceId', 'pitchPolicy', 'x01', 'y01', 'amplitude01', 'pulseMilliseconds', 'applicationEvidence'];
  if (!p || Object.getPrototypeOf(p) !== Object.prototype || Object.keys(p).some(key => !keys.includes(key)) || ['intentId', 'voiceId', 'onsetId', 'worldId', 'contactInstanceId', 'surfaceId', 'mapId'].some(key => typeof p[key] !== 'string' || !p[key] || p[key].length > 1024) || ['generation', 'actorId', 'surfaceRevision', 'mapRevision'].some(key => !Number.isSafeInteger(p[key]) || p[key] < 0) || !/^[a-f0-9]{64}$/.test(p.bodyInstanceId) || p.pitchPolicy !== 'fixed-prepared-body' || p.applicationEvidence !== 'processor-frame-acknowledged' || ![4, 8, 12].includes(p.pulseMilliseconds) || ['x01', 'y01', 'amplitude01'].some(key => !Number.isFinite(p[key]) || p[key] < 0 || p[key] > 1) || !Array.isArray(p.sourceEventIds) || !p.sourceEventIds.length || p.sourceEventIds.length > 16 || p.sourceEventIds.some(id => !text(id)) || new Set(p.sourceEventIds).size !== p.sourceEventIds.length) throw new TypeError('Invalid captured finite body strike or application evidence.');
  return freezeData(p);
}
