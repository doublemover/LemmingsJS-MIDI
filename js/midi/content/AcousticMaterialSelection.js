import { validateAcousticMap } from './AcousticMap.js';
import { validateSpatialState } from './SpatialState.js';
import { ORIGINAL_MATERIAL_PATCH_IDS } from './MaterialResponseMap.js';
import { cloneData, freezeData } from '../../core/CanonicalData.js';

export function createAcousticMaterialSelection({ map: raw, state: rawState, mapHash, intent, sourceEventId, articulation = 'hard', site01 = 0.5 }) {
  const map = validateAcousticMap(raw), state = validateSpatialState(rawState), response = map.materialResponses.find(response => response.id === state.materialResponseId);
  if (!response) return null;
  if (response.exciterPatch !== response.resonatorPatch) throw new Error('This acoustic response requires a separately qualified exciter/body graft; the modal palette cannot substitute it.');
  return validateAcousticMaterialSelection({ schema: 'lemmings-acoustic-material-selection/v1', classification: 'authored-world-region-response', mapId: map.id, mapRevision: map.revision, mapHash,
    responseId: response.id, patchId: response.resonatorPatch, articulation: response.contactVariants[articulation], site01, worldId: state.worldId, generation: state.generation,
    actorId: intent.actorId, voiceId: intent.voiceId, sourceEventId, sourceTick: state.sourceTick, heldPolicy: 'retain-onset-body;world-spatial-controls-may-change' }, { intent: { ...intent, spatialState: state }, map });
}
export function validateAcousticMaterialSelection(raw, { intent = null, map: rawMap = null } = {}) {
  const value = cloneData(raw, { maxBytes: 8192, maxNodes: 128 }), id = value => typeof value === 'string' && value.length > 0 && value.length <= 512, natural = value => Number.isSafeInteger(value) && value >= 0;
  if (value?.schema !== 'lemmings-acoustic-material-selection/v1' || Object.keys(value).some(key => !['schema', 'classification', 'mapId', 'mapRevision', 'mapHash', 'responseId', 'patchId', 'articulation', 'site01', 'worldId', 'generation', 'actorId', 'voiceId', 'sourceEventId', 'sourceTick', 'heldPolicy'].includes(key)) || value.classification !== 'authored-world-region-response' || ![value.mapId, value.responseId, value.worldId, value.voiceId, value.sourceEventId].every(id) || ![value.mapRevision, value.generation, value.sourceTick].every(natural) || value.actorId !== null && !natural(value.actorId) || !/^[a-f0-9]{64}$/.test(value.mapHash) || !ORIGINAL_MATERIAL_PATCH_IDS.includes(value.patchId) || !['hard', 'soft', 'muted'].includes(value.articulation) || !Number.isFinite(value.site01) || value.site01 < 0 || value.site01 > 1 || value.heldPolicy !== 'retain-onset-body;world-spatial-controls-may-change') throw new TypeError('Acoustic material selection needs its exact authored region, source cause and prepared body identity.');
  if (intent) {
    const state = validateSpatialState(intent.spatialState);
    if (state.sourceAttachment.materialMode !== 'zone-response' || value.mapId !== state.mapId || value.mapRevision !== state.mapRevision || value.responseId !== state.materialResponseId || value.worldId !== intent.worldId || value.generation !== intent.generation || value.actorId !== intent.actorId || value.voiceId !== intent.voiceId || value.sourceTick !== state.sourceTick || !intent.sourceEventIds?.includes(value.sourceEventId)) throw new TypeError('The acoustic response changed its original spatial onset or physical cause.');
  }
  if (rawMap) { const map = validateAcousticMap(rawMap), response = map.materialResponses.find(response => response.id === value.responseId); if (map.id !== value.mapId || map.revision !== value.mapRevision || !response || response.resonatorPatch !== value.patchId || response.exciterPatch !== value.patchId || response.contactVariants[value.articulation] !== value.articulation) throw new TypeError('The acoustic material source is not declared by this exact map revision.'); }
  return freezeData(value);
}
