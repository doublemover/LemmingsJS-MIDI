import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { nearestTuningPitch } from './physical/Tuning.js';

const keyFor = value => JSON.stringify([value.generation, value.voiceId]);
const causes = values => Object.freeze((values || []).slice(0, 8));
export function createHarmonySnapshotOwner({ resourceBudget = null, getGraph, resolveLane, inspectRenderVoices = () => [] } = {}) {
  if ([getGraph, resolveLane, inspectRenderVoices].some(value => typeof value !== 'function')) throw new TypeError('Harmony inspection needs physical graph and source owners.');
  let laneId = null, storage = null, disposed = false, omitted = 0, revision = 0;
  const voices = new Map();
  const selectLane = (id, seeds = []) => {
    if (disposed) return;
    if (id === laneId) return;
    if (id !== null) storage ||= createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-harmony-view', kind: 'bounded-voice-cause-inspection', category: 'graphics', bytes: 4 * 1048576 });
    voices.clear(); laneId = id; omitted = 0; revision++;
    if (id === null) { storage?.release(); storage = null; return; }
    for (const seed of seeds.slice(0, 512)) if (resolveLane(seed.laneId) === id) voices.set(keyFor(seed), { ...seed, state: 'held', expression: { pitchOffsetCents: seed.pitchOffsetCents || 0 },
      causeIds: causes(seed.sourceEventIds), causeCoverage: seed.causeCoverage || (seed.sourceEventIds ? seed.sourceEventIds.length <= 8 ? 'complete' : 'capped' : 'unavailable'), missingReads: 0 });
  };
  const observe = (intents, receipts = []) => {
    if (disposed || laneId === null) return;
    const outcomes = new Map(receipts.filter(row => row.sinkId === 'physical-browser-audio').map(row => [row.intentId, row.status]));
    for (const intent of intents) {
      if (resolveLane(intent.laneId) !== laneId) continue;
      const key = keyFor(intent), previous = voices.get(key);
      if (intent.kind === 'begin') {
        if (!previous && voices.size >= 512) { omitted++; continue; }
        voices.set(key, { worldId: intent.worldId, generation: intent.generation, voiceId: intent.voiceId, actorId: intent.actorId, laneId: intent.laneId,
          instrumentId: intent.mappingId, role: intent.role, pitch: intent.pitch, tonalState: intent.tonalState || null, expression: intent.expression,
          causeIds: causes(intent.sourceEventIds), causeCoverage: intent.sourceEventIds.length <= 8 ? 'complete' : 'capped', state: 'held',
          admission: outcomes.get(intent.intentId) || 'unobserved', missingReads: 0 });
      } else if (previous) {
        if (intent.kind === 'end') previous.state = 'semantic-end';
        else {
          previous.expression = { ...previous.expression, ...intent.expression };
          if (intent.articulationState?.tonal) previous.tonalState = intent.articulationState.tonal;
        }
      }
      revision++;
    }
  };
  const snapshot = () => {
    if (disposed || laneId === null) return null;
    const graph = getGraph(), rendered = inspectRenderVoices(), renderIndex = new Map(),
      fields = new Map((graph.harmonicFields || []).map(field => [field.id, field])), formations = new Map((graph.formations || []).map(formation => [formation.id, formation]));
    for (const voice of rendered) { const key = keyFor(voice); if (!renderIndex.has(key)) renderIndex.set(key, []); renderIndex.get(key).push(voice); }
    const activeVoices = [], tuningIds = new Set(), actorBindings = [], causeIds = new Set();
    for (const [key, voice] of voices) {
      const sources = renderIndex.get(key) || [], ended = voice.state === 'semantic-end';
      if (ended && !sources.length && ++voice.missingReads > 2) { voices.delete(key); continue; }
      const pitch = voice.pitch, knownPitch = Number.isFinite(pitch?.cents) && Number.isFinite(pitch?.referenceHz) && pitch.referenceHz > 0;
      const cents = knownPitch ? pitch.cents + (voice.expression?.pitchOffsetCents || 0) : null;
      const hz = knownPitch ? pitch.referenceHz * 2 ** ((cents - 6900) / 1200) : null;
      const axisPitchCents = knownPitch ? cents + 1200 * Math.log2(pitch.referenceHz / 440) : null;
      const tuningId = voice.tonalState?.quantizedPitch?.tuningId || pitch?.tuningId || null;
      const source = voice.tonalState?.fieldId ? fields.get(voice.tonalState.fieldId) : voice.tonalState?.formationId ? formations.get(voice.tonalState.formationId) : null;
      const revisionMatches = source && source.revision === (voice.tonalState?.fieldId ? voice.tonalState.fieldRevision : voice.tonalState.formationRevision);
      const definition = revisionMatches && source.tuning?.id === tuningId ? source.tuning : null;
      let membership = 'unknown', nearest = null;
      if (definition && knownPitch && definition.referenceHz === pitch.referenceHz) {
        try { nearest = nearestTuningPitch(definition, cents); membership = Math.abs(nearest.cents - cents) <= 0.05 ? 'in-tuning' : 'between-tuning-degrees'; } catch {}
      }
      if (tuningId) tuningIds.add(tuningId);
      const sourceStates = Object.freeze(sources.map(source => Object.freeze({ state: source.state, evidence: source.evidence, patchId: source.patchId, patchRevision: source.patchRevision })));
      const state = sources.some(source => source.state === 'release') ? 'released-tail' : sources.some(source => source.state === 'scheduled') ? 'scheduled' :
        sources.length ? ended ? 'semantic-ended;source-completion-pending' : 'source-owned' : ended ? 'ended' : voice.admission === 'rejected' ? 'rejected' : 'semantic-held;local-source-unobserved';
      for (const id of voice.causeIds) causeIds.add(id);
      actorBindings.push(Object.freeze({ actorId: voice.actorId, voiceId: voice.voiceId, generation: voice.generation }));
      activeVoices.push(Object.freeze({ voiceId: voice.voiceId, generation: voice.generation, actorId: voice.actorId, instrumentId: voice.instrumentId, role: voice.role || null,
        pitchCents: cents, axisPitchCents, pitchHz: hz, referenceHz: knownPitch ? pitch.referenceHz : null, tuningId, tuningStatus: definition ? 'current-definition-available' : tuningId ? 'historical-definition-unavailable' : 'unknown',
        membership, nearestTuningCents: nearest?.cents ?? null, quantizedTargetCents: tuningId ? voice.tonalState?.quantizedPitch?.cents ?? pitch.cents : null,
        originalContinuousPitchCents: voice.tonalState?.originalContinuousPitch?.cents ?? null, originalContinuousReferenceHz: voice.tonalState?.originalContinuousPitch?.referenceHz ?? null,
        quantizedTargetReferenceHz: tuningId ? voice.tonalState?.quantizedPitch?.referenceHz ?? pitch.referenceHz : null,
        state, sources: sourceStates, realizationCount: sources.length, causeIds: voice.causeIds, causeCoverage: voice.causeCoverage,
        fieldId: voice.tonalState?.fieldId || null, formationId: voice.tonalState?.formationId || null }));
    }
    activeVoices.sort((a, b) => (a.axisPitchCents ?? Infinity) - (b.axisPitchCents ?? Infinity) || (a.voiceId < b.voiceId ? -1 : a.voiceId > b.voiceId ? 1 : 0));
    return Object.freeze({ schema: 'lemmings-physical-harmony-snapshot/v1', laneId, revision, scaleId: null, tuningId: tuningIds.size === 1 ? [...tuningIds][0] : null,
      tuningIds: Object.freeze([...tuningIds]), candidates: Object.freeze([]), candidateStatus: 'no-engine-provided-future-candidate',
      activeVoices: Object.freeze(activeVoices), actorBindings: Object.freeze(actorBindings), causeIds: Object.freeze([...causeIds]),
      transformation: 'observed-semantic-pitch-plus-current-expression;no-preview-or-quantization', omitted, acousticReceipt: false });
  };
  return Object.freeze({ selectLane, observe, snapshot, selectedLane: () => laneId, enabled: () => laneId !== null && !disposed,
    dispose() { if (disposed) return true; selectLane(null); disposed = true; return true; } });
}
