import { validateSpatialPerformance } from '../../midi/content/SpatialPerformance.js';
import { validateAcousticMaterialSelection } from '../../midi/content/AcousticMaterialSelection.js';
import { spatialReadoutGraphCost } from './SpatialReadoutPlan.js';
import { canonicalDataText, hashData, freezeData } from '../../core/CanonicalData.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'captured-spatial-readout' }); };
export async function prepareCapturedSpatialReadout(revoice, sampleRate, { signal } = {}) {
  if (!Number.isFinite(revoice.boundary?.state?.sourceTimeMs) || !Number.isFinite(revoice.finalBoundaryState?.sourceTimeMs)) fail('Spatial readout needs the captured source-clock boundary.');
  if (revoice.spatialCoverage?.captured !== true || revoice.spatialCoverage.status !== 'known-covered' || !Array.isArray(revoice.spatialEvents) || !revoice.spatialEvents.length || revoice.spatialEvents.length > 16384) fail('This readout requires complete captured world spatial controls and map definitions.');
  const inventory = canonicalDataText(revoice.spatialEvents, { maxBytes: 8 * 1048576, maxNodes: 1048576 }), maps = new Map(), onsets = new Map(), updates = [], originals = new Map(revoice.intents.filter(intent => intent.kind === 'begin').map(intent => [intent.intentId, intent])), voices = new Map();
  let lastSourceTime = -Infinity, rejectedNativeRequests = 0;
  for (const raw of revoice.spatialEvents) {
    signal?.throwIfAborted(); const event = validateSpatialPerformance(raw);
    if (event.sourceTimeMs < lastSourceTime || event.sourceTimeMs < revoice.boundary.state.sourceTimeMs || event.sourceTimeMs > revoice.finalBoundaryState.sourceTimeMs) fail('Spatial control history is outside its ordered captured source clock.'); lastSourceTime = event.sourceTimeMs;
    if (event.kind === 'map') {
      if (await hashData(event.definition, { maxBytes: 131072, maxNodes: 16384 }) !== event.mapHash) fail('A captured acoustic map changed its definition.');
      if (!maps.has(event.mapHash)) {
        if (maps.size >= 3) fail('This native readout profile admits at most three exact map revisions in one captured history.');
        maps.set(event.mapHash, event.definition);
      }
      continue;
    }
    if (!event.state) { if (event.status === 'rejected') fail('A spatial source observation is missing; this history cannot invent its controls.'); continue; }
    const map = maps.get(event.mapHash); if (!map || event.state.mapId !== map.id || event.state.mapRevision !== map.revision) fail('A spatial control precedes or differs from its exact prepared map definition.');
    if (event.kind === 'onset') {
      const intent = originals.get(event.intentId); if (!intent || onsets.has(event.intentId) || intent.voiceId !== event.voiceId || intent.worldId !== event.worldId || intent.generation !== event.generation || intent.scoreTime.sourceTimeMs !== event.sourceTimeMs) fail('Spatial onset ancestry does not match the captured semantic source.');
      if (event.acousticMaterialState) validateAcousticMaterialSelection(event.acousticMaterialState, { intent: { ...intent, spatialState: event.state }, map });
      onsets.set(event.intentId, event); voices.set(JSON.stringify([event.worldId, event.generation, event.voiceId]), intent.intentId);
    } else if (event.kind === 'update') {
      const onsetId = voices.get(JSON.stringify([event.worldId, event.generation, event.voiceId])); if (!onsetId) fail('A spatial update lacks its captured original source onset.');
      if (event.status === 'rejected') rejectedNativeRequests++;
      updates.push({ onsetId, event });
    }
  }
  if (!maps.size || !onsets.size) fail('This take contains no complete spatial source onset.');
  const intents = revoice.intents.map(intent => { const event = onsets.get(intent.intentId); return event ? { ...intent, spatialState: event.state, ...(event.acousticMaterialState ? { acousticMaterialState: event.acousticMaterialState, performanceControls: event.performanceControls } : {}) } : intent; });
  signal?.throwIfAborted();
  const { graphBytes, maximumTailFrames } = spatialReadoutGraphCost([...maps.values()], sampleRate);
  return Object.freeze({ maximumTailFrames, source: { ...revoice, intents }, maps: [...maps.values()], updates, planningBytes: inventory.bytes.length * 3 + inventory.nodes * 64 + graphBytes + 8 * 1048576,
    receipt: freezeData({ schema: 'lemmings-captured-spatial-readout/v1', semanticIntentHash: await hashData(revoice.intents, { maxBytes: 8 * 1048576, maxNodes: 1000000 }), sourceHash: await hashData(revoice.spatialEvents, { maxBytes: 8 * 1048576, maxNodes: 1048576 }), maps: [...maps].map(([hash, definition]) => ({ hash, mapId: definition.id, revision: definition.revision })), spatialOnsets: onsets.size, controlUpdates: updates.length, rejectedNativeRequests,
      controls: 'complete-recorded-world-requests;no-camera-or-terrain-resampling', nativeAdmissionHistoryRecreated: false, hiddenNativeStateRecreated: false, otherSourcePolicy: 'explicit-neutral-modal-revoice;captured-material-bodies-preserved' }) });
}
