// Only accepted coordinate writes belong here. A tentative walk into a wall
// that is immediately restored is a contact, not traversed distance.
const recordPhysicalMotion = (level, actor, beforeX, beforeY) => {
  const facts = actor.runtime?.physicalFacts;
  if (!facts?.enabled?.(actor) || beforeX === actor.x && beforeY === actor.y) return;
  facts.emit({ kind: 'MotionCommitted', actorId: actor.id, laneId: actor.laneIndex ?? null,
    action: actor.action?.actionName || null, actionInstanceId: actor._physicalActionInstanceId,
    parentCauseIds: actor._physicalInterventionId ? [actor._physicalInterventionId] : [],
    positionBefore: { x: beforeX, y: beforeY }, positionAfter: { x: actor.x, y: actor.y }, precision: 'tick',
    physicalPayload: { displacementPixels: Math.hypot(actor.x - beforeX, actor.y - beforeY),
      pathEvidence: 'committed-coordinate-write' } });
  actor._physicalMotionFactTick = level.tickIndex;
};

export { recordPhysicalMotion };
