import { validateSpatialState } from '../../../midi/content/SpatialState.js';
import { validateSpatialPerformance } from '../../../midi/content/SpatialPerformance.js';
import { createAcousticMaterialSelection } from '../../../midi/content/AcousticMaterialSelection.js';
import { materialArticulationControls } from '../../../midi/content/MaterialPalette.js';
import { createWorldSpatialControl } from './WorldSpatialControl.js';
import { canonicalDataText } from '../../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const pointFor = fact => fact?.anchor || fact?.physicalPayload?.surfaceCell || fact?.physicalPayload?.terrainEdit?.materialObservation?.sourceCell || fact?.positionAfter || null;
export function createCausalSpatialPlayback({ getGraph, world, session, getSources, updateSources, toFrame, getExecutionEpoch, getContext, getCameraPosition, isCaptureEnabled = () => false, resourceBudget, onReceipt = () => {} } = {}) {
  const mapper = createWorldSpatialControl({ getCameraPosition, hasSolidAt: (x, y, identity) => world?.worldId === identity.worldId && world.generation === identity.generation && world.terrainRevision === identity.terrainRevision && world.tickIndex === identity.tick && typeof world.peekGroundAt === 'function' ? world.peekGroundAt(x, y) : null }),
    storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'world-spatial-controls', kind: 'bounded-spatial-observations-and-occlusion-cache', category: 'candidate', bytes: 4096 }), scope = createProcgenRetirementScope();
  let rawMap = null, signature = null, activeMap = null, mapHash = null, capturing = false, disposed = false, batch = null;
  const report = value => { try { onReceipt(validateSpatialPerformance(value)); } catch { try { onReceipt({ status: 'rejected', stage: 'world-spatial-observation', reason: 'spatial-performance-capture-rejected', batchId: batch?.batchId, acousticReceipt: false }); } catch {} } };
  const envelope = value => ({ schema: 'lemmings-spatial-performance/v1', worldId: batch.worldId, generation: batch.generation, sourceTick: batch.tick, sourceTimeMs: batch.sourceTimeMs, sourceTickDurationMs: batch.tickDurationMs, executionEpoch: getExecutionEpoch(), sampleRate: getContext()?.sampleRate || null, acousticReceipt: false, ...value });
  return Object.freeze({
    before(intents, source) {
      if (disposed) return intents; batch = source; const map = getGraph()?.acousticMap || null, capture = isCaptureEnabled(); if (capture && !capturing) mapHash = null; capturing = capture;
      const ready = !!map && session?.acousticMapMatches?.(map) === true;
      if (!map) { if (activeMap) { activeMap = rawMap = signature = null; mapper.configure(null); storage.resize(4096); } return intents; }
      if (ready && map !== rawMap) { const next = canonicalDataText(map, { maxBytes: 131072, maxNodes: 16384 }).text; rawMap = map; if (signature !== next) { storage.resize(8 * 1048576); signature = next; activeMap = map; mapper.configure(map); mapHash = null; } }
      mapper.observe(source); const owner = ready ? session.acousticMapState() : null;
      if (owner?.mapHash && mapHash !== owner.mapHash) { mapHash = owner.mapHash; report(envelope({ kind: 'map', status: 'prepared', mapHash, definition: activeMap })); }
      const facts = new Map(source.facts.map(fact => [fact.eventId, fact])), instruments = new Map(getGraph().instruments.map(instrument => [instrument.id, instrument])); const capacity = Math.max(0, mapper.maximumVoices() - getSources().length); let onsets = 0;
      return intents.map(intent => {
        const attachment = instruments.get(intent.mappingId)?.spatialAttachment; if (intent.kind !== 'begin' || !attachment) return intent;
        if (!ready || onsets++ >= capacity) { report(envelope({ kind: 'onset', status: 'rejected', intentId: intent.intentId, voiceId: intent.voiceId, reason: !ready ? 'acoustic-map-not-prepared' : 'spatial-onset-capacity' })); return { ...intent, spatialUnavailable: !ready ? 'acoustic-map-not-prepared' : 'spatial-onset-capacity' }; }
        const fact = intent.sourceEventIds.map(id => facts.get(id)).find(Boolean), observation = mapper.state({ voiceId: intent.voiceId, actorId: intent.actorId, attachment, sourcePosition: pointFor(fact) });
        if (observation.status !== 'complete') { report(envelope({ kind: 'onset', status: 'rejected', intentId: intent.intentId, voiceId: intent.voiceId, reason: observation.reason })); return { ...intent, spatialUnavailable: observation.reason }; }
        observation.state = validateSpatialState({ ...observation.state, mapHash });
        let acousticMaterialState = null;
        if (attachment.materialMode === 'zone-response') try { acousticMaterialState = createAcousticMaterialSelection({ map: activeMap, state: observation.state, mapHash, intent, sourceEventId: fact?.eventId || intent.sourceEventIds[0], articulation: attachment.articulation || intent.materialState?.articulation || 'hard', site01: attachment.site01 ?? intent.materialState?.site01 ?? 0.5 }); } catch (error) { report(envelope({ kind: 'onset', status: 'rejected', intentId: intent.intentId, voiceId: intent.voiceId, reason: error.message })); return { ...intent, spatialUnavailable: 'acoustic-material-response-unavailable' }; }
        const performanceControls = acousticMaterialState ? { ...intent.performanceControls, macros: { ...materialArticulationControls(acousticMaterialState), ...intent.performanceControls?.macros } } : intent.performanceControls;
        report(envelope({ kind: 'onset', status: 'requested', intentId: intent.intentId, voiceId: intent.voiceId, mapHash, state: observation.state, ...(acousticMaterialState ? { acousticMaterialState, performanceControls } : {}) }));
        return { ...intent, performanceControls, spatialState: observation.state, spatialSourceFrame: toFrame(intent.scoreTime), ...(acousticMaterialState ? { acousticMaterialState } : {}) };
      });
    },
    after() {
      if (disposed || !activeMap || !mapper.due() || !session?.acousticMapMatches?.(activeMap)) return;
      const frame = toFrame({ simTick: batch.tick }), now = getContext()?.currentTime, rate = getContext()?.sampleRate;
      if (!Number.isSafeInteger(frame) || !Number.isFinite(rate) || frame <= Math.ceil(now * rate)) return;
      const sources = getSources(); if (sources.length > mapper.maximumVoices()) { report(envelope({ kind: 'updates', status: 'rejected', reason: 'spatial-active-source-capacity' })); return; }
      const states = [];
      for (const source of sources) {
        if (source.worldId !== batch.worldId || source.generation !== batch.generation) continue;
        const observation = mapper.state({ voiceId: source.voiceId, actorId: source.actorId, attachment: source.spatialState.sourceAttachment, sourcePosition: source.spatialState.sourceWorldPosition });
        if (observation.status === 'complete') states.push(validateSpatialState({ ...observation.state, mapHash }));
        else report(envelope({ kind: 'update', status: 'rejected', voiceId: source.voiceId, reason: observation.reason }));
      }
      for (const receipt of updateSources(states, frame)) { const { executionEpoch: rendererExecutionEpoch, ...controls } = receipt; report(envelope({ kind: 'update', ...controls, ...(rendererExecutionEpoch ? { rendererExecutionEpoch } : {}), mapHash })); }
      session.collectAcousticTails?.();
    },
    diagnostics: () => mapper.diagnostics(), reset() { mapper.reset(); rawMap = activeMap = signature = mapHash = null; capturing = false; },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; mapper.reset(); return scope.retire([{ name: 'spatial-control-storage', run: () => storage.release() }]); }
  });
}
