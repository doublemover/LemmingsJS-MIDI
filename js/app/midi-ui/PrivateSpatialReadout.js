import { hashData, freezeData, canonicalDataText } from '../../core/CanonicalData.js';
import { validateAcousticMap } from '../../midi/content/AcousticMap.js';
import { validateSpatialState } from '../../midi/content/SpatialState.js';
import { validateAcousticMaterialSelection } from '../../midi/content/AcousticMaterialSelection.js';
import { spatialReadoutGraphCost } from './SpatialReadoutPlan.js';

const plans = new WeakSet(), fail = message => { throw new Error('Private spatial readout: ' + message); };
export const isPrivateSpatialReadout = plan => plans.has(plan);
export async function preparePrivateSpatialReadout({ revoice, spatial, scene, sampleRate, signal } = {}) {
  const inventory = canonicalDataText(spatial, { maxBytes: 4 * 1048576, maxNodes: 524288 }), map = validateAcousticMap(spatial?.definition);
  if (spatial.schema !== 'lemmings-private-scene-spatial/v1' || spatial.evidence !== 'actual-private-world-observations;not-live-renderer-admission' || spatial.nativeMapPrepared !== false || !Array.isArray(spatial.onsets) || !spatial.onsets.length || spatial.onsets.length > 128 || !Array.isArray(spatial.updates) || spatial.updates.length + spatial.onsets.length > 8192 || await hashData(map, { maxBytes: 131072, maxNodes: 16384 }) !== spatial.mapHash || canonicalDataText(map).text !== canonicalDataText(scene.causalMappings.acousticMap).text) fail('Keep the exact authored map and bounded observed private source; native preparation has not happened yet.');
  const originals = new Map(revoice.intents.filter(intent => intent.kind === 'begin').map(intent => [intent.intentId, intent])), onsets = new Map(), mixes = new Map(scene.mix.map(row => [row.laneId, row])), anySolo = scene.mix.some(row => row.solo), mappings = new Map(scene.causalMappings.instruments.map(mapping => [mapping.id, mapping]));
  const checkState = (raw, original) => { const state = validateSpatialState(raw); if (state.mapHash !== spatial.mapHash || state.mapId !== map.id || state.mapRevision !== map.revision || state.voiceId !== original.voiceId || state.worldId !== original.worldId || state.generation !== original.generation || canonicalDataText(state.sourceAttachment).text !== canonicalDataText(mappings.get(original.mappingId)?.spatialAttachment).text) fail('A spatial source changed its physical identity, attachment or map.'); return state; };
  for (const row of spatial.onsets) {
    signal?.throwIfAborted(); const original = originals.get(row.intentId); if (!original || onsets.has(row.intentId)) fail('Keep one observed spatial onset for each original semantic source.');
    const state = checkState(row.state, original); if (state.sourceTick !== original.scoreTime.simTick) fail('The spatial onset differs from its committed source tick.');
    if (row.acousticMaterialState) validateAcousticMaterialSelection(row.acousticMaterialState, { intent: { ...original, spatialState: state }, map });
    onsets.set(row.intentId, row);
  }
  for (const intent of originals.values()) if (mappings.get(intent.mappingId)?.spatialAttachment && !onsets.has(intent.intentId)) fail('The private source omitted a mapped spatial onset.');
  let lastTime = revoice.boundary.state.sourceTimeMs; const updates = [];
  for (const row of spatial.updates) { signal?.throwIfAborted(); const onset = onsets.get(row.onsetId), original = originals.get(row.onsetId); if (!onset || !Number.isFinite(row.sourceTimeMs) || row.sourceTimeMs < lastTime || row.sourceTimeMs < original.scoreTime.sourceTimeMs || row.sourceTimeMs > revoice.finalBoundaryState.sourceTimeMs) fail('Spatial updates must follow their actual source onset and private clock.'); lastTime = row.sourceTimeMs;
    updates.push({ onsetId: row.onsetId, event: { sourceTimeMs: row.sourceTimeMs, sourceOwnerDelayFrames: 0, sampleRate, state: checkState(row.state, original) } });
  }
  const intents = revoice.intents.map(intent => {
      const row = onsets.get(intent.intentId); if (!row) return intent;
      const lane = scene.patchRefs[intent.laneId], mix = mixes.get(lane?.laneId); if (!mix) fail('The private source lane has no exact authored mix.');
      return { ...intent, laneMix: { gain: mix.mute || anySolo && !mix.solo ? 0 : mix.gain, pan: mix.pan / 127 }, spatialState: row.state, ...(row.acousticMaterialState ? { acousticMaterialState: row.acousticMaterialState, performanceControls: row.performanceControls } : {}) };
    }), palettes = new Map(), bindings = [], voiceLanes = new Map();
  for (const intent of intents) {
    const voice = JSON.stringify([intent.worldId, intent.generation, intent.voiceId]);
    if (intent.kind !== 'begin') { if (voiceLanes.has(voice) && intent.laneId != null && intent.laneId !== voiceLanes.get(voice)) fail('This private spatial profile keeps its authored lane mix; lane-transfer rehearsals need a separately owned mix schedule.'); continue; }
    voiceLanes.set(voice, intent.laneId); const palette = scene.patchRefs[intent.laneId]?.materialPalette;
    if (intent.acousticMaterialState || intent.materialState) { if (!palette) fail('A material onset omitted its complete source palette.'); palettes.set(palette.identityHash, palette); bindings.push({ intentId: intent.intentId, paletteHash: palette.identityHash }); }
  }
  const { graphBytes, maximumTailFrames } = spatialReadoutGraphCost([map], sampleRate), source = { ...revoice, intents, ...(palettes.size ? { materialSources: { schema: 'lemmings-captured-material-sources/v1', covered: true, palettes: [...palettes.values()], onsets: bindings } } : {}) },
    plan = Object.freeze({ source, maps: [map], updates, maximumTailFrames, planningBytes: inventory.bytes.length * 3 + inventory.nodes * 64 + graphBytes + 8 * 1048576, receipt: freezeData({ schema: 'lemmings-private-spatial-readout/v1', semanticIntentHash: await hashData(revoice.intents, { maxBytes: 8 * 1048576, maxNodes: 1000000 }), sourceHash: await hashData(spatial, { maxBytes: 4 * 1048576, maxNodes: 524288 }), maps: [{ hash: spatial.mapHash, mapId: map.id, revision: map.revision }], spatialOnsets: onsets.size, controlUpdates: updates.length, staleObservations: spatial.staleObservations, controls: 'actual-private-world-observations;static-authored-map;no-live-camera', historicalPerformanceEvidence: false, nativeAdmissionHistoryRecreated: false, semanticOnsetsAdded: 0 }) });
  signal?.throwIfAborted(); plans.add(plan); return plan;
}
