// These are annotations on the authoritative action pass. They never schedule
// sound or infer force/energy from pixel edits.
const recordPhysicalWork = (level, actor, { operationKind, phase, cycleOrdinal, attemptedCells,
  changedSolidCells = 0, changedAppearanceCells = 0, outcome = null, revisionBefore = null,
  targetX = actor.x, targetY = actor.y } = {}) => {
  actor._physicalWorkSerial = (actor._physicalWorkSerial || 0) + 1;
  const facts = actor.runtime?.physicalFacts;
  if (!facts?.enabled?.()) return;
  facts.emit({ kind: 'TerrainWorkCommitted', actorId: actor.id, laneId: actor.laneIndex ?? null,
    actionInstanceId: actor._physicalActionInstanceId, workOperationId: `${actor.id}:work:${actor._physicalWorkSerial}`,
    operationOrdinal: actor._physicalWorkSerial, operationKind, phase, cycleOrdinal,
    outcome: outcome || (changedSolidCells || changedAppearanceCells ? 'changed' : 'no-change'),
    positionBefore: { x: actor.x, y: actor.y },
    physicalPayload: { attemptedCells, changedSolidCells, changedAppearanceCells, targetX, targetY,
      sourceEditRevisionBefore: revisionBefore, sourceEditRevisionAfter: Number.isFinite(level.terrainRevision) ? level.terrainRevision : null } });
};

export { recordPhysicalWork };
