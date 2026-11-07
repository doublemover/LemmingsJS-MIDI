import { canonicalDataText } from '../../../core/CanonicalData.js';

const stamp = value => canonicalDataText(value, { maxBytes: 262144, maxNodes: 16384 }).text;
export function createBodyTailLessonObservation({ definition, graph, releaseGesture, soundIdentity, assists }) {
  if (definition.success.kind !== 'body-outlives-actor' || assists !== false) throw new Error('The shared-body lesson requires the manual prepared-surface scene.');
  const policy = stamp({ graph, releaseGesture }), baseline = [], changed = [];
  let phase = 'observe-baseline', reason = null, body = null;
  const result = () => ({ phase, reason, baseline: [...baseline], changed: [...changed], journey: {
    kind: 'body-outlives-actor', bodyInstanceId: body?.bodyInstanceId ?? null, sourceActorId: baseline[0]?.actorId ?? null,
    retainedAfterActor: changed.length === 1, addedSemanticOnsets: 0, tailPcm: 'unmeasured;residency-is-not-ringing-energy',
    summary: 'Original shared-body strike: ' + (baseline.length ? 'observed' : 'pending') + '; striker termination and same body retained: ' +
      (changed.length ? 'observed' : 'pending') + '. Body residency does not prove audible ringing or external output.'
  } });
  return Object.freeze({ state: result, observe({ batch, intents, context }) {
    if (phase === 'physical-evidence-observed') return result();
    if (context.assists !== false || context.soundIdentity !== soundIdentity || stamp({ graph: context.graph, releaseGesture: context.releaseGesture }) !== policy)
      throw new Error('Keep the same prepared body, physical surface and entry policy throughout this comparison.');
    const bodies = context.preparedBodyResidency || [], facts = new Map(batch.facts.map(fact => [fact.eventId, fact]));
    if (!baseline.length) {
      for (const intent of intents) {
        if (intent.kind !== 'begin' || !definition.success.mappingIds.includes(intent.mappingId) || intent.worldId !== batch.worldId ||
            intent.generation !== batch.generation || intent.batchId !== batch.batchId || intent.physicalSourceKind !== 'ContactSpanBegan' ||
            !Array.isArray(intent.sourceEventIds) || !intent.sourceEventIds.length || intent.sourceEventIds.length > 8 ||
            !intent.sourceEventIds.every(id => { const fact = facts.get(id); return fact?.kind === 'ContactSpanBegan' && fact.actorId === intent.actorId &&
              fact.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId; })) continue;
        const resident = bodies.find(value => value.surfaceId === definition.success.surfaceId && value.active === true && value.quarantined !== true &&
          typeof value.bodyInstanceId === 'string' && value.bodyInstanceId);
        if (!resident) { reason = 'The physical contact is visible, but its shared body has no prepared residency observation. Explicitly enable a supported local output, then perform another real strike; no unheard tail was inferred.'; continue; }
        body = { ...resident }; baseline.push({ intentId: intent.intentId, batchId: batch.batchId, actorId: intent.actorId,
          sourceEventIds: [...intent.sourceEventIds], bodyInstanceId: body.bodyInstanceId, strikeTick: batch.tick });
        phase = 'remove-striker'; reason = 'Remove the top-lane striker through the ordinary physical controls, or observe its actual departure. Leave the shared body and other actors alone.'; break;
      }
      return result();
    }
    if (intents.some(intent => intent.kind === 'begin' && intent.actorId === baseline[0].actorId && definition.success.mappingIds.includes(intent.mappingId)))
      throw new Error('A new striker onset entered this comparison. Reset and compare one original strike with its retained body.');
    const terminated = batch.facts.find(fact => fact.kind === 'ActorTerminated' && fact.actorId === baseline[0].actorId &&
      fact.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId && typeof fact.eventId === 'string');
    if (!terminated) return result();
    if (!Array.isArray(batch.snapshot?.actors) || batch.snapshot.actors.some(actor => actor.actorId === baseline[0].actorId)) throw new Error('The striker’s terminal fact and current physical snapshot disagree.');
    const retained = bodies.find(value => value.bodyInstanceId === body.bodyInstanceId && value.surfaceId === body.surfaceId &&
      value.active === true && value.quarantined !== true && value.graphDefinitionHash === body.graphDefinitionHash);
    if (!retained) { reason = 'The striker ended, but the original body residency is unavailable or was replaced. No retained-tail evidence was inferred.'; return result(); }
    changed.push({ ...baseline[0], actorTerminationEventId: terminated.eventId, actorTerminationBatchId: batch.batchId,
      actorTerminationTick: batch.tick, evidenceRole: 'original-strike-with-retained-body;not-a-new-onset' });
    phase = 'physical-evidence-observed'; reason = null; return result();
  } });
}
