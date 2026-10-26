import { canonicalDataText } from '../../../core/CanonicalData.js';

export const ADVANCED_PHYSICAL_LESSONS = Object.freeze(['productive-work', 'route-delay-change', 'formation-and-timbre']);
const stamp = value => canonicalDataText(value, { maxBytes: 262144, maxNodes: 16384 }).text;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => Number.isFinite(value) && Math.abs(value) <= 1e9;
const spacing = value => stamp({ nominalGapTicks: value?.nominalGapTicks ?? null, spreadTicks: value?.spreadTicks ?? null, lanePhase: value?.lanePhase ?? null, phaseStepTicks: value?.phaseStepTicks ?? null, grouping: value?.grouping ?? null, clockMode: value?.clockMode ?? null });
const span = records => Math.max(...records.map(record => record.birthTick)) - Math.min(...records.map(record => record.birthTick));
const pitches = records => records.map(record => record.pitchCents).sort((a, b) => a - b).join('|');

// One bounded observer over authoritative batches; it sends no world or sound commands.
export function createAdvancedPhysicalLessonObservation({ definition, graph, releaseGesture, soundIdentity, assists, junctionDefinitions = [] }) {
  if (!ADVANCED_PHYSICAL_LESSONS.includes(definition.success.kind) || assists !== false) throw new Error('This lesson needs its manual-only initial physical world.');
  const cache = new WeakMap(), stableStamp = value => { if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return stamp(value); if (!cache.has(value)) cache.set(value, stamp(value)); return cache.get(value); };
  const success = definition.success, originalGraph = stableStamp(graph), originalSpacing = spacing(releaseGesture), originalJunctions = stableStamp(junctionDefinitions);
  const tracks = new Map(), commands = new Map(), baseline = [], changed = [], operationIds = new Set(); let phase = 'observe-baseline', reason = null, switched = null, changedSpacing = null;
  const result = () => ({ phase, reason, baseline: [...baseline], changed: [...changed] });
  const member = (fact, batch) => fact?.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId && typeof fact.eventId === 'string' && fact.eventId.length > 0;
  const onset = (intent, batch, facts, rawKind) => intent.kind === 'begin' && intent.worldId === batch.worldId && intent.generation === batch.generation && intent.batchId === batch.batchId && definition.success.mappingIds.includes(intent.mappingId) && typeof intent.intentId === 'string' && intent.intentId && Array.isArray(intent.sourceEventIds) && intent.sourceEventIds.length > 0 && intent.sourceEventIds.length <= 8 && intent.sourceEventIds.every(id => { const fact = facts.get(id); return member(fact, batch) && fact.actorId === intent.actorId && fact.kind === rawKind; });
  const record = (intent, batch, actor) => ({ intentId: intent.intentId, batchId: batch.batchId, actorId: intent.actorId, sourceEventIds: [...intent.sourceEventIds], birthTick: actor.spawnTick, arrivalTick: batch.tick, precision: 'actual-completed-physical-batch' });
  const pickupRecord = (intent, batch, facts, actors) => {
    if (!onset(intent, batch, facts, 'MotionCommitted') || intent.physicalSourceKind !== 'PickupCrossing' || intent.observation?.gateId !== success.pickupId) return null;
    const actor = actors.get(intent.actorId), track = tracks.get(intent.actorId);
    if (!actor || !integer(actor.spawnTick) || !track || track.birthTick !== actor.spawnTick || !track.operations || [...baseline, ...changed].some(value => value.intentId === intent.intentId)) return null;
    return { ...record(intent, batch, actor), pathPixels: track.pathPixels, motionOperations: track.operations, firstMotionEventId: track.firstMotionEventId, lastMotionEventId: track.lastMotionEventId, travelTicks: batch.tick - actor.spawnTick };
  };
  return Object.freeze({ observe({ batch, intents, context }) {
    if (phase === 'physical-evidence-observed') return result();
    if (context.assists !== false || context.soundIdentity !== soundIdentity || stableStamp(context.graph) !== originalGraph || stableStamp(context.junctionDefinitions || []) !== originalJunctions) throw new Error('The manual policy, sound, mapping or route definition changed. Reset and change only the declared cause.');
    const currentSpacing = spacing(context.releaseGesture);
    if (phase === 'observe-baseline' && currentSpacing !== originalSpacing || success.kind !== 'formation-and-timbre' && currentSpacing !== originalSpacing || phase === 'perform-timbre' && currentSpacing !== changedSpacing) throw new Error('Keep the lesson release policy unchanged at this observation boundary.');
    const facts = new Map(batch.facts.filter(fact => member(fact, batch)).map(fact => [fact.eventId, fact])), actors = new Map((batch.snapshot?.actors || []).map(actor => [actor.actorId, actor]));
    for (const fact of facts.values()) {
      if (fact.kind === 'ActorBorn' && integer(fact.actorId) && integer(fact.spawnTick)) {
        if (tracks.size >= 16 && !tracks.has(fact.actorId)) throw new Error('This practice attempt exceeded its bounded entrant history. Reset to a fresh setup.');
        if (tracks.has(fact.actorId)) throw new Error('The observed entrant birth identity was reused.');
        tracks.set(fact.actorId, { birthTick: fact.spawnTick, pathPixels: 0, operations: 0, firstMotionEventId: null, lastMotionEventId: null });
      }
      if (fact.kind === 'MotionCommitted' && tracks.has(fact.actorId)) {
        const before = fact.positionBefore, after = fact.positionAfter, track = tracks.get(fact.actorId);
        if (![before?.x, before?.y, after?.x, after?.y].every(finite)) throw new Error('Physical travel evidence is incomplete.');
        track.pathPixels += Math.hypot(after.x - before.x, after.y - before.y); track.operations++;
        if (track.pathPixels > 1000000 || track.operations > 1000000) throw new Error('This practice attempt exceeded its physical observation bounds.');
        track.firstMotionEventId ??= fact.eventId; track.lastMotionEventId = fact.eventId;
      }
      if (fact.kind === 'CommandApplied' && fact.status === 'accepted' && ['manual', 'live-controller'].includes(fact.origin) && fact.requestedCommand?.id === fact.commandId) {
        const command = fact.requestedCommand;
        if (command.kind === 'assign-worker' && ['builders', 'miners'].includes(command.parameters?.workerKind) && command.target?.actorId === fact.actorId) {
          if (commands.size >= 64) throw new Error('The practice attempt exceeded its manual operation history.');
          commands.set(command.id, { actorId: fact.actorId, operationKind: command.parameters.workerKind === 'builders' ? 'build' : 'mine', tick: batch.tick });
        }
        if (success.kind === 'route-delay-change' && phase === 'perform-intervention' && command.kind === 'junction-request' && command.parameters?.request?.junctionId === success.junctionId && command.parameters.request.configurationId === success.configurationId && fact.terrain?.junction?.junctionId === success.junctionId && fact.terrain.junction.configurationId === success.configurationId && fact.terrain.junction.commandId === command.id) switched = { commandId: command.id, appliedTick: batch.tick, configurationId: success.configurationId };
      }
    }
    if (success.kind === 'productive-work') {
      if (phase === 'observe-baseline') {
        if (intents.some(intent => intent.kind === 'begin')) throw new Error('Observe the unchanged quiet walking baseline before assigning a skill.');
        const actor = [...actors.values()].find(value => ['walk', 'walking'].includes(value.action) && tracks.has(value.actorId));
        const source = [...facts.values()].find(fact => fact.kind === 'MotionCommitted' && fact.actorId === actor?.actorId);
        if (actor && source) { baseline.push({ actorId: actor.actorId, birthTick: actor.spawnTick, batchId: batch.batchId, sourceEventIds: [source.eventId], intentId: null, quietWalking: true }); phase = 'perform-intervention'; reason = 'Assign a builder or miner explicitly; two successful solid-material contacts are required.'; }
        return result();
      }
      for (const intent of intents) {
        if (!onset(intent, batch, facts, 'TerrainWorkCommitted') || intent.physicalSourceKind !== 'TerrainWorkCommitted') continue;
        const fact = facts.get(intent.sourceEventIds[0]), actor = actors.get(intent.actorId), commandId = fact.parentCauseIds?.find(id => commands.has(id)), command = commands.get(commandId);
        const validPhase = fact.operationKind === 'build' ? fact.phase === 9 && fact.operationPhase === 'brick' : fact.operationKind === 'mine' && [1, 2].includes(fact.phase) && fact.operationPhase === 'mask';
        if (!actor || !command || command.actorId !== intent.actorId || command.operationKind !== fact.operationKind || batch.tick < command.tick || fact.workVersion !== 2 || !validPhase || fact.outcome !== 'changed' || !(fact.physicalPayload?.changedSolidCells > 0) || !integer(fact.operationOrdinal) || typeof fact.actionInstanceId !== 'string' || typeof fact.workOperationId !== 'string' || operationIds.has(fact.workOperationId)) continue;
        operationIds.add(fact.workOperationId); changed.push({ ...record(intent, batch, actor), commandId, operationKind: fact.operationKind, operationOrdinal: fact.operationOrdinal, workOperationId: fact.workOperationId, actionInstanceId: fact.actionInstanceId, phase: fact.phase, changedSolidCells: fact.physicalPayload.changedSolidCells });
        if (changed.length === success.minimumContacts) { phase = 'physical-evidence-observed'; reason = null; break; }
      }
      return result();
    }
    for (const intent of intents) {
      const value = pickupRecord(intent, batch, facts, actors); if (!value) continue;
      if (success.kind === 'route-delay-change') {
        if (phase === 'observe-baseline') { baseline.push(value); phase = 'perform-intervention'; reason = 'Request the stepped route, observe its application, then explicitly release a new entrant with the same spacing.'; continue; }
        const actual = context.junctionStates?.find(item => item.junctionId === success.junctionId);
        if (!switched || actual?.status !== 'observed-at-application' || actual.generation !== batch.generation || actual.commandId !== switched.commandId || actual.configurationId !== switched.configurationId || value.birthTick < switched.appliedTick || baseline.some(item => item.actorId === value.actorId)) continue;
        if (!(value.pathPixels > baseline[0].pathPixels + 0.5) || value.travelTicks === baseline[0].travelTicks) { reason = 'A switch request alone is insufficient. A new entrant must actually travel farther and arrive after a different observed duration.'; continue; }
        changed.push({ ...value, routeCommandId: switched.commandId, configurationId: switched.configurationId, appliedTick: switched.appliedTick }); phase = 'physical-evidence-observed'; reason = null; break;
      }
      if (intent.tonalState?.formationId !== success.formationId || intent.tonalState?.fieldId !== success.fieldId || !Number.isFinite(intent.pitch?.cents) || !Number.isFinite(intent.pitch?.referenceHz) || intent.pitch.referenceHz <= 0) continue;
      const macroValue = intent.performanceControls?.macros?.[success.macroId] ?? success.macroDefault01;
      if (!Number.isFinite(macroValue) || macroValue < 0 || macroValue > 1) continue;
      const field = context.graph.harmonicFields.find(field => field.id === success.fieldId), bounds = field.geometry.bounds, inField = [...actors.values()].filter(actor => actor.x >= bounds.x1 && actor.x < bounds.x2 && actor.y >= bounds.y1 && actor.y < bounds.y2);
      const entry = { ...value, pitchCents: intent.pitch.cents, referenceHz: intent.pitch.referenceHz, macroValue, fieldMemberCount: inField.length, formationSpreadPixels: inField.length ? Math.max(...inField.map(actor => actor.x)) - Math.min(...inField.map(actor => actor.x)) : 0 };
      if (phase === 'perform-timbre') {
        if (macroValue === changed[0].macroValue) continue;
        changed.push({ ...entry, timbreIntervention: true, macroId: success.macroId }); phase = 'physical-evidence-observed'; reason = null; break;
      }
      const target = phase === 'observe-baseline' ? baseline : changed;
      if (target.some(item => item.actorId === value.actorId) || target === changed && baseline.some(item => item.actorId === value.actorId) || target.length >= success.minimumActors) continue;
      if (target === changed && currentSpacing === originalSpacing) { reason = 'Change actual finite entry spacing before observing a fresh formation.'; continue; }
      if (target === changed && changedSpacing && currentSpacing !== changedSpacing) throw new Error('Keep one release policy throughout the changed formation trial.');
      if (target === changed) changedSpacing = currentSpacing;
      target.push(entry);
      if (target.length === success.minimumActors) {
        if (!target.some(item => item.fieldMemberCount >= success.minimumActors)) throw new Error('This trial never observed the required actors together in the field. Try a fresh finite formation.');
        if (target === baseline) { phase = 'perform-intervention'; reason = 'Change finite entry spacing, then release fresh actors into the same tuned field.'; }
        else if (span(baseline) === span(changed) || pitches(baseline) === pitches(changed) || Math.max(...baseline.map(item => item.formationSpreadPixels)) === Math.max(...changed.map(item => item.formationSpreadPixels))) throw new Error('Requested spacing has not produced a different actual formation and voicing. Reset or explore another finite phrase.');
        else { phase = 'perform-timbre'; reason = 'The changed formation and voicing are observed. Keep that physical policy; change BRIGHTNESS and explicitly release a later attack.'; }
      }
    }
    return result();
  } });
}
