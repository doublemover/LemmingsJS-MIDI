import { hashData, freezeData, canonicalDataText } from '../../../core/CanonicalData.js';
import { validateAcousticMap } from '../../../midi/content/AcousticMap.js';
import { validateSpatialState } from '../../../midi/content/SpatialState.js';
import { createAcousticMaterialSelection } from '../../../midi/content/AcousticMaterialSelection.js';
import { materialArticulationControls } from '../../../midi/content/MaterialPalette.js';
import { createWorldSpatialControl } from './WorldSpatialControl.js';
import { spatialSourcePoint } from './CausalSpatialPlayback.js';

export async function createSceneSpatialObservation({ scene, world, signal } = {}) {
  const map = validateAcousticMap(scene.causalMappings.acousticMap);
  if (map.listener.mode === 'camera-follow') throw new Error('Private acoustic rehearsal needs a fixed or selected-actor listener; it has no live display-camera owner.');
  const mapHash = await hashData(map, { maxBytes: 131072, maxNodes: 16384 }); signal?.throwIfAborted();
  const mapper = createWorldSpatialControl({ hasSolidAt: (x, y, identity) => identity.worldId === world.worldId && identity.generation === world.generation && identity.tick === world.tickIndex && identity.terrainRevision === world.terrainRevision ? world.peekGroundAt?.(x, y) ?? null : null }), mappings = new Map(scene.causalMappings.instruments.map(instrument => [instrument.id, instrument])), voices = new Map(), onsets = [], updates = [];
  mapper.configure(map); let retainedBytes = 0, staleObservations = 0;
  const retain = row => { retainedBytes += canonicalDataText(row, { maxBytes: 32768, maxNodes: 4096 }).bytes.length; if (retainedBytes > 4 * 1048576 || onsets.length + updates.length >= 8192) throw new Error('The complete private spatial stream exceeds its admitted observation bound.'); };
  return Object.freeze({
    observe(batch, intents) {
      signal?.throwIfAborted(); if (!mapper.observe(batch)) throw new Error('Private spatial rehearsal needs complete committed actor and terrain observations.');
      const facts = new Map(batch.facts.map(fact => [fact.eventId, fact]));
      for (const intent of intents) {
        const attachment = mappings.get(intent.mappingId)?.spatialAttachment; if (intent.kind !== 'begin' || !attachment) continue;
        if (voices.size >= Math.min(128, map.maximumVoices)) throw new Error('The private spatial prefix exceeds its complete retained-source bound.');
        const fact = intent.sourceEventIds.map(id => facts.get(id)).find(Boolean), result = mapper.state({ voiceId: intent.voiceId, actorId: intent.actorId, attachment, sourcePosition: spatialSourcePoint(fact) });
        if (result.status !== 'complete') throw new Error(result.reason);
        const state = validateSpatialState({ ...result.state, mapHash }), material = attachment.materialMode === 'zone-response' ? createAcousticMaterialSelection({ map, state, mapHash, intent, sourceEventId: fact?.eventId || intent.sourceEventIds[0], articulation: attachment.articulation || intent.materialState?.articulation || 'hard', site01: attachment.site01 ?? intent.materialState?.site01 ?? 0.5 }) : null,
          performanceControls = material ? { ...intent.performanceControls, macros: { ...materialArticulationControls(material), ...intent.performanceControls?.macros } } : intent.performanceControls,
          row = { intentId: intent.intentId, state, ...(material ? { acousticMaterialState: material, performanceControls } : {}) };
        retain(row); onsets.push(row); voices.set(intent.voiceId, { onsetId: intent.intentId, voiceId: intent.voiceId, actorId: intent.actorId, attachment, sourcePosition: state.sourceWorldPosition });
      }
      if (!mapper.due()) return;
      const newOnsets = new Set(intents.filter(intent => intent.kind === 'begin').map(intent => intent.intentId));
      for (const voice of voices.values()) { if (newOnsets.has(voice.onsetId)) continue;
        const result = mapper.state({ voiceId: voice.voiceId, actorId: voice.actorId, attachment: voice.attachment, sourcePosition: voice.sourcePosition });
        if (result.status !== 'complete') { staleObservations++; continue; }
        const row = { onsetId: voice.onsetId, sourceTimeMs: batch.sourceTimeMs, state: validateSpatialState({ ...result.state, mapHash }) }; retain(row); updates.push(row);
      }
    },
    snapshot: () => freezeData({ schema: 'lemmings-private-scene-spatial/v1', definition: map, mapHash, onsets, updates, staleObservations, evidence: 'actual-private-world-observations;not-live-renderer-admission', nativeMapPrepared: false })
  });
}
