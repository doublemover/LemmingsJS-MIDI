import { createWorldSpatialControl } from './WorldSpatialControl.js';
import { canonicalDataText } from '../../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const pointFor = fact => fact?.anchor || fact?.physicalPayload?.surfaceCell || fact?.physicalPayload?.terrainEdit?.materialObservation?.sourceCell || fact?.positionAfter || null;
export function createCausalSpatialPlayback({ getGraph, world, session, getSources, updateSources, toFrame, getExecutionEpoch, getContext, getCameraPosition, isCaptureEnabled = () => false, resourceBudget, onReceipt = () => {} } = {}) {
  const mapper = createWorldSpatialControl({ getCameraPosition, hasSolidAt: (x, y, identity) => world?.worldId === identity.worldId && world.generation === identity.generation && world.terrainRevision === identity.terrainRevision && world.tickIndex === identity.tick && typeof world.hasGroundAt === 'function' ? !!world.hasGroundAt(x, y) : null }),
    storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'world-spatial-controls', kind: 'bounded-spatial-observations-and-occlusion-cache', category: 'candidate', bytes: 4096 }), scope = createProcgenRetirementScope();
  let rawMap = null, signature = null, activeMap = null, mapHash = null, capturing = false, disposed = false, batch = null;
  const report = value => { try { onReceipt(Object.freeze(value)); } catch {} };
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
        report(envelope({ kind: 'onset', status: 'requested', intentId: intent.intentId, voiceId: intent.voiceId, mapHash, state: observation.state }));
        return { ...intent, spatialState: observation.state, spatialSourceFrame: toFrame(intent.scoreTime) };
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
        if (observation.status === 'complete') states.push(observation.state);
        else report(envelope({ kind: 'update', status: 'rejected', voiceId: source.voiceId, reason: observation.reason }));
      }
      for (const receipt of updateSources(states, frame)) report(envelope({ kind: 'update', ...receipt, mapHash }));
      session.collectAcousticTails?.();
    },
    diagnostics: () => mapper.diagnostics(), reset() { mapper.reset(); rawMap = activeMap = signature = mapHash = null; capturing = false; },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; mapper.reset(); return scope.retire([{ name: 'spatial-control-storage', run: () => storage.release() }]); }
  });
}
