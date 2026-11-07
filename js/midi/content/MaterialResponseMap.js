import { canonicalDataText, cloneData, freezeData } from '../../core/CanonicalData.js';

const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value);
const natural = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => { throw new TypeError('Material response: ' + message); };
export const ORIGINAL_MATERIAL_PATCH_IDS = freezeData(['material.unclassified', 'material.timber', 'material.slate', 'material.glass', 'material.sheet-metal']);
export function validateMaterialResponseMap(raw) {
  const value = cloneData(raw, { maxBytes: 16384, maxNodes: 1024 });
  if (value?.schema !== 'lemmings-material-response-map/v1' || Object.keys(value).some(key => !['schema', 'id', 'revision', 'neutralPatchId', 'entries', 'articulation', 'site01'].includes(key)) || !id(value.id) || !natural(value.revision) || value.neutralPatchId !== 'material.unclassified' || !['hard', 'soft', 'muted'].includes(value.articulation) || !Number.isFinite(value.site01) || value.site01 < 0 || value.site01 > 1 || !Array.isArray(value.entries) || value.entries.length > 32) fail('Use an explicit bounded material-ID/tag map, unclassified fallback, authored articulation and normalized strike site.');
  const seen = new Set();
  for (const entry of value.entries) {
    if (!entry || Object.keys(entry).some(key => !['selector', 'value', 'patchId'].includes(key)) || !['materialId', 'tag'].includes(entry.selector) || !id(entry.value) || !ORIGINAL_MATERIAL_PATCH_IDS.includes(entry.patchId) || seen.has(entry.selector + ':' + entry.value)) fail('Material selectors must be exact, distinct and mapped to a prepared original body.');
    seen.add(entry.selector + ':' + entry.value);
  }
  value.entries.sort((a, b) => { const first = a.selector + ':' + a.value, second = b.selector + ':' + b.value; return first < second ? -1 : first > second ? 1 : 0; });
  return freezeData(value);
}
export function createOriginalMaterialResponseMap({ articulation = 'hard', site01 = 0.5 } = {}) {
  return validateMaterialResponseMap({ schema: 'lemmings-material-response-map/v1', id: 'original-contact-materials', revision: 1, neutralPatchId: 'material.unclassified', articulation, site01,
    entries: ['materialId', 'tag'].flatMap(selector => [['wood', 'material.timber'], ['stone', 'material.slate'], ['glass', 'material.glass'], ['metal', 'material.sheet-metal']].map(([value, patchId]) => ({ selector, value, patchId }))) });
}
export function resolveObservedMaterialResponse(map, batch, fact) {
  const provenance = fact?.physicalPayload?.terrainProvenance, support = fact?.kind === 'ContactSpanBegan' && fact.causeKind === 'support' && fact.physicalPayload?.evidence === 'completed-support-cell', obstacle = fact?.kind === 'ContactResolved' && fact.causeKind === 'wall' && fact.physicalPayload?.materialEvidence === 'resolved-obstacle-cell', cell = support ? fact.anchor : fact?.physicalPayload?.surfaceCell;
  const qualified = (support || obstacle) && fact.worldId === batch.worldId && fact.generation === batch.generation && batch.completeness?.status === 'complete' && fact.observedTick === batch.tick && natural(fact.surfaceRevision) && provenance?.status === 'complete' && (provenance.sourceRevision ?? provenance.revision) === fact.surfaceRevision &&
    cell && Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y) && (!support || !fact.physicalPayload.surfaceCell || fact.physicalPayload.surfaceCell.x === cell.x && fact.physicalPayload.surfaceCell.y === cell.y);
  const materialId = qualified && id(provenance.materialId) ? provenance.materialId : null, tag = qualified && id(provenance.tag) ? provenance.tag : null,
    entry = qualified ? map.entries.find(entry => entry.selector === 'materialId' && entry.value === materialId) || map.entries.find(entry => entry.selector === 'tag' && entry.value === tag) : null;
  return freezeData({ schema: 'lemmings-observed-material-response/v1', mapId: map.id, mapRevision: map.revision, patchId: entry?.patchId || map.neutralPatchId, classification: entry ? 'classified' : 'unclassified',
    reason: entry ? 'verified-contact-provenance' : qualified ? 'no-authored-material-selector' : 'material-evidence-unavailable', selector: entry?.selector || null, materialId, tag, articulation: map.articulation, site01: map.site01,
    sourceEventId: fact?.eventId || null, sourceSequence: fact?.causalSequence ?? null, observedTick: fact?.observedTick ?? null, sourceKind: fact?.kind || null, worldId: batch.worldId, generation: batch.generation, actorId: fact?.actorId ?? null,
    surfaceRevision: qualified ? fact.surfaceRevision : null, sourceEditId: qualified ? provenance.editId ?? null : null, sourceCell: qualified ? { x: cell.x, y: cell.y } : null, heldPolicy: 'retain-onset-body-and-articulation', units: 'authored-material-label-and-normalized-site;not-color-force-or-meters' });
}
export function validateObservedMaterialResponse(raw) {
  const value = cloneData(raw, { maxBytes: 8192, maxNodes: 256 });
  if (value?.schema !== 'lemmings-observed-material-response/v1' || Object.keys(value).some(key => !['schema', 'mapId', 'mapRevision', 'patchId', 'classification', 'reason', 'selector', 'materialId', 'tag', 'articulation', 'site01', 'sourceEventId', 'sourceSequence', 'observedTick', 'sourceKind', 'worldId', 'generation', 'actorId', 'surfaceRevision', 'sourceEditId', 'sourceCell', 'heldPolicy', 'units'].includes(key)) || !['verified-contact-provenance', 'no-authored-material-selector', 'material-evidence-unavailable'].includes(value.reason) || !['ContactSpanBegan', 'ContactResolved'].includes(value.sourceKind) || value.selector !== null && !['materialId', 'tag'].includes(value.selector) || [value.materialId, value.tag].some(label => label !== null && !id(label)) || value.surfaceRevision !== null && !natural(value.surfaceRevision) || value.classification === 'unclassified' && (value.patchId !== 'material.unclassified' || value.selector !== null) || value.units !== 'authored-material-label-and-normalized-site;not-color-force-or-meters' || !id(value.mapId) || !natural(value.mapRevision) || !ORIGINAL_MATERIAL_PATCH_IDS.includes(value.patchId) || !['classified', 'unclassified'].includes(value.classification) || !['hard', 'soft', 'muted'].includes(value.articulation) || !Number.isFinite(value.site01) || value.site01 < 0 || value.site01 > 1 || typeof value.worldId !== 'string' || !value.worldId || value.worldId.length > 512 || !natural(value.generation) || !natural(value.actorId) || typeof value.sourceEventId !== 'string' || !value.sourceEventId || value.sourceEventId.length > 512 || !Number.isSafeInteger(value.sourceSequence) || value.sourceSequence < 1 || !natural(value.observedTick) || value.heldPolicy !== 'retain-onset-body-and-articulation' || value.classification === 'classified' && (!natural(value.surfaceRevision) || !value.sourceCell || !Number.isSafeInteger(value.sourceCell.x) || !Number.isSafeInteger(value.sourceCell.y))) fail('Keep the exact observed material identity and onset policy.');
  canonicalDataText(value, { maxBytes: 8192, maxNodes: 256 }); return freezeData(value);
}
