import { cloneData, freezeData } from '../../core/CanonicalData.js';
import { resolveObservedMaterialResponse } from './MaterialResponseMap.js';

const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value);
const proofMap = freezeData({ id: 'sample-gesture-work-proof', revision: 1, neutralPatchId: 'material.unclassified', entries: [], articulation: 'hard', site01: 0.5 });
export function validateObservedSampleGesture(raw) {
  const value = cloneData(raw, { maxBytes: 8192, maxNodes: 512 });
  if (value?.schema !== 'lemmings-observed-sample-gesture/v1' || Object.keys(value).some(key => !['schema', 'id', 'revision', 'source', 'unknownPolicy', 'regions'].includes(key)) || !id(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.source !== 'verified-work-material-cell' || value.unknownPolicy !== 'omit-source' || !Array.isArray(value.regions) || !value.regions.length || value.regions.length > 8) throw new Error('Use one bounded explicit sample-gesture map on verified work cells.');
  for (const [index, row] of value.regions.entries()) {
    const b = row?.bounds;
    if (!row || Object.keys(row).some(key => !['gesture', 'bounds'].includes(key)) || !id(row.gesture) || !b || Object.keys(b).some(key => !['x1', 'x2', 'y1', 'y2'].includes(key)) || ![b.x1, b.x2, b.y1, b.y2].every(number => Number.isFinite(number) && Math.abs(number) <= 1e9) || b.x2 <= b.x1 || b.y2 <= b.y1 || value.regions.slice(0, index).some(other => b.x1 < other.bounds.x2 && b.x2 > other.bounds.x1 && b.y1 < other.bounds.y2 && b.y2 > other.bounds.y1)) throw new Error('Sample-gesture regions must be finite disjoint world rectangles.');
  }
  return freezeData(value);
}
export function resolveObservedSampleGesture(map, batch, fact) {
  const observed = resolveObservedMaterialResponse(proofMap, batch, fact), point = observed.sourceCell;
  if (!observed.workMaterial || !point) return null;
  const selected = map.regions.find(({ bounds: b }) => point.x >= b.x1 && point.x < b.x2 && point.y >= b.y1 && point.y < b.y2); if (!selected) return null;
  return freezeData({ schema: 'lemmings-observed-sample-gesture-receipt/v1', mapId: map.id, mapRevision: map.revision, gesture: selected.gesture,
    sourceEventId: observed.sourceEventId, sourceSequence: observed.sourceSequence, sourceCell: point, surfaceRevision: observed.surfaceRevision, sourceEditId: observed.sourceEditId,
    workOperationId: observed.workMaterial.operationId, worldId: observed.worldId, generation: observed.generation, actorId: observed.actorId, observedTick: observed.observedTick,
    selection: 'authored-gesture-at-verified-successful-work-cell;not-an-inferred-physical-timbre', acousticReceipt: false });
}
