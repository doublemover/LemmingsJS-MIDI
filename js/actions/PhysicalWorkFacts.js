// These are annotations on the authoritative action pass. They never schedule
// sound or infer force/energy from pixel edits.
const recordPhysicalWork = (level, actor, { operationKind, phase, cycleOrdinal, attemptedCells,
  changedSolidCells = 0, changedAppearanceCells = 0, outcome = null, revisionBefore = null,
  targetX = actor.x, targetY = actor.y, warning = null } = {}) => {
  actor._physicalWorkSerial = (actor._physicalWorkSerial || 0) + 1;
  const terrainEdit = level.commitTerrainWork?.({ actorId: actor.id, actionInstanceId: actor._physicalActionInstanceId,
    operation: operationKind, workOperationId: `${actor.id}:work:${actor._physicalWorkSerial}`, transactionId: actor._physicalInterventionId ?? null });
  const facts = actor.runtime?.physicalFacts;
  if (!facts?.enabled?.(actor)) return;
  const cycleLength = operationKind === 'mine' ? 24 : 16, framePhase = actor.frameIndex % cycleLength;
  const cycle = (actor._physicalActionCycle || 0) + (actor._physicalProcessingFrame != null && framePhase < actor._physicalProcessingFrame % cycleLength ? 1 : 0);
  const bounds = level._physicalWorkBounds ? { ...level._physicalWorkBounds } : null; level._physicalWorkBounds = null;
  facts.emit({ kind: 'TerrainWorkCommitted', actorId: actor.id, laneId: actor.laneIndex ?? null,
    parentCauseIds: actor._physicalInterventionId ? [actor._physicalInterventionId] : [],
    actionInstanceId: actor._physicalActionInstanceId, workOperationId: `${actor.id}:work:${actor._physicalWorkSerial}`,
    workVersion: 2, operationOrdinal: actor._physicalWorkSerial, operationKind, phase: framePhase, operationPhase: phase, cycleOrdinal: cycle, actionState: cycleOrdinal, warning,
    outcome: outcome || (changedSolidCells || changedAppearanceCells ? 'changed' : 'no-change'),
    positionBefore: { x: actor.x, y: actor.y },
    physicalPayload: { bounds, terrainEdit: terrainEdit ?? null, attemptedCells, changedSolidCells, changedAppearanceCells, targetX, targetY,
      sourceEditRevisionBefore: revisionBefore, sourceEditRevisionAfter: Number.isFinite(level.terrainRevision) ? level.terrainRevision : null } });
};

export { recordPhysicalWork };
