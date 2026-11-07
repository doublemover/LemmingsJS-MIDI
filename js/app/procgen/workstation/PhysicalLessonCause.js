export function readLessonPickupCrossing(definition, batch, intent, facts) {
  if (intent.kind !== 'begin' || intent.worldId !== batch.worldId || intent.generation !== batch.generation || intent.batchId !== batch.batchId ||
      !definition.success.mappingIds.includes(intent.mappingId) || intent.physicalSourceKind !== 'PickupCrossing' ||
      intent.observation?.gateId !== definition.success.pickupId || typeof intent.intentId !== 'string' || !intent.intentId ||
      !Array.isArray(intent.sourceEventIds) || !intent.sourceEventIds.length || intent.sourceEventIds.length > 8 ||
      !intent.sourceEventIds.every(id => { const fact = facts.get(id); return fact?.kind === 'MotionCommitted' && fact.actorId === intent.actorId &&
        fact.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId; })) return null;
  const actor = batch.snapshot?.actors?.find(value => value.actorId === intent.actorId);
  if (!actor || !Number.isSafeInteger(actor.spawnTick) || actor.spawnTick < 0) return null;
  return { intentId: intent.intentId, batchId: batch.batchId, worldId: batch.worldId, generation: batch.generation,
    actorId: intent.actorId, sourceEventIds: [...intent.sourceEventIds], arrivalTick: batch.tick, birthTick: actor.spawnTick };
}
