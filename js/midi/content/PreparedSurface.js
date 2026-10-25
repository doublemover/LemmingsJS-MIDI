import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

const text = (value, maximum = 512) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key));
export function validatePreparedSurfaceMap(raw) {
  const p = cloneData(raw, { maxBytes: 8192, maxNodes: 128 }), b = p?.bounds;
  if (!record(p, ['id', 'revision', 'regionInstanceId', 'sourceEditRevision', 'boundTopologyRevision', 'bounds']) || !text(p.id, 128) || !text(p.regionInstanceId, 256) ||
      !integer(p.revision) || !integer(p.sourceEditRevision) || !integer(p.boundTopologyRevision) || !record(b, ['x1', 'x2', 'y1', 'y2']) ||
      ![b.x1, b.x2, b.y1, b.y2].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9) || b.x2 <= b.x1 || b.y2 <= b.y1) throw new TypeError('Invalid named world-to-normalized surface map.');
  return freezeData(p);
}
export function projectPreparedSurfacePoint(map, point) {
  const b = map.bounds;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < b.x1 || point.x > b.x2 || point.y < b.y1 || point.y > b.y2) throw new RangeError('The observed point is outside the prepared surface map.');
  return Object.freeze({ x01: (point.x - b.x1) / (b.x2 - b.x1), y01: (point.y - b.y1) / (b.y2 - b.y1), units: 'normalized-interior-grid', mapId: map.id, mapRevision: map.revision });
}
export async function preparedBodyIdentity(raw) {
  const p = cloneData(raw, { maxBytes: 16384, maxNodes: 256 });
  if (!record(p, ['documentEpoch', 'executionEpoch', 'worldId', 'generation', 'surfaceId', 'surfaceRevision', 'surfaceMap', 'owner', 'ownerGeneration', 'ownerRouteRevision', 'graphDefinitionHash', 'nodeId', 'processorRevision']) ||
      !text(p.documentEpoch) || !text(p.executionEpoch) || !text(p.worldId) || !integer(p.generation) || !text(p.surfaceId, 128) || !integer(p.surfaceRevision) || !text(p.owner) || !integer(p.ownerGeneration) ||
      !integer(p.ownerRouteRevision) || p.ownerRouteRevision < 1 || !/^[a-f0-9]{64}$/.test(p.graphDefinitionHash) || !text(p.nodeId, 128) || !text(p.processorRevision)) throw new TypeError('Prepared body identity is missing an exact execution or graph revision.');
  validatePreparedSurfaceMap(p.surfaceMap);
  return freezeData({ ...p, bodyInstanceId: await hashData(p), heldContactPolicy: 'keep-old-tail', stateTransferPolicy: 'exact-same-body-cut-or-canonical-preroll;no-topology-array-copy' });
}
export function validateMappedBodyPreparation(raw) {
  const p = cloneData(raw, { maxBytes: 32768, maxNodes: 1024 });
  if (!record(p, ['schema', 'commandId', 'batchId', 'stage', 'operation', 'kind', 'surfaceId', 'mapId', 'mapRevision', 'mappingId', 'mappingRevision', 'preparationSlot', 'beginPolicy', 'contactSpanId', 'actorId', 'worldId', 'generation',
    'sourceTick', 'sourceSequence', 'sourceEventIds', 'sourceKind', 'sourceEditRevision', 'boundTopologyRevision', 'position', 'radius01', 'amount01', 'scoreTime', 'reason', 'lossMaskId']) ||
      p.schema !== 'lemmings-mapped-body-preparation/v1' || p.stage !== 'physical-mapping-output-not-audio-admission' || !text(p.commandId, 1024) || !text(p.batchId) || !['begin', 'update', 'end'].includes(p.operation) || !['touch', 'pickup-left', 'pickup-right', 'mode-loss'].includes(p.kind) ||
      !text(p.surfaceId, 128) || !text(p.mapId, 128) || !integer(p.mapRevision) || !text(p.mappingId, 128) || !integer(p.mappingRevision) || !text(p.preparationSlot, 128) || !['observed-span-begin', 'current-observed-contact'].includes(p.beginPolicy) || !text(p.contactSpanId) ||
      !integer(p.actorId) || !text(p.worldId) || !integer(p.generation) || !integer(p.sourceTick) || !integer(p.sourceSequence) || !integer(p.sourceEditRevision) || !integer(p.boundTopologyRevision) ||
      !Array.isArray(p.sourceEventIds) || !p.sourceEventIds.length || p.sourceEventIds.length > 128 || p.sourceEventIds.some(value => !text(value)) ||
      !['ContactSpanBegan', 'ContactSpanUpdated', 'ContactSpanEnded', 'ActorTerminated', 'coverage-ended', 'mapping-changed'].includes(p.sourceKind) ||
      !p.scoreTime || Object.getPrototypeOf(p.scoreTime) !== Object.prototype || p.reason != null && !text(p.reason) || (p.kind === 'mode-loss' ? !text(p.lossMaskId, 96) : p.lossMaskId != null)) throw new TypeError('Invalid mapped prepared-body command or fact ancestry.');
  if (p.operation !== 'end' && (!record(p.position, ['x', 'y']) || ![p.position.x, p.position.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9) ||
      !['ContactSpanBegan', 'ContactSpanUpdated'].includes(p.sourceKind) || p.kind === 'touch' && (!Number.isFinite(p.radius01) || p.radius01 < 0.08 || p.radius01 > 0.18 || !Number.isFinite(p.amount01) || p.amount01 < 0 || p.amount01 > 1) || p.kind === 'mode-loss' && (p.radius01 != null || !Number.isFinite(p.amount01) || p.amount01 < 0 || p.amount01 > 1) || ['pickup-left', 'pickup-right'].includes(p.kind) && (p.radius01 != null || p.amount01 != null))) throw new TypeError('A held preparation needs an observed coordinate and an admitted loss domain.');
  if (p.operation === 'end' && (p.position !== null || p.radius01 != null || p.amount01 != null)) throw new TypeError('Preparation end cannot contain another strike or held position.');
  return freezeData(p);
}
