const physicalContactForMotion = (level, actor, beforeX, beforeY) => {
  const span = actor._physicalContactSpan;
  if (!span || span.lastObservedTick !== level.tickIndex - 1 || span.actionInstanceId !== actor._physicalActionInstanceId ||
      !level.hasGroundAt(beforeX, beforeY + 1) || !level.hasGroundAt(actor.x, actor.y + 1) || !level.hasGroundAt(span.anchor.x, span.anchor.y)) return null;
  return span.spanId;
};

// Only accepted coordinate writes belong here. A tentative walk into a wall
// that is immediately restored is a contact, not traversed distance.
const recordPhysicalMotion = (level, actor, beforeX, beforeY) => {
  const facts = actor.runtime?.physicalFacts;
  if (!facts?.enabled?.(actor) || beforeX === actor.x && beforeY === actor.y) return;
  const contactSpanId = physicalContactForMotion(level, actor, beforeX, beforeY);
  facts.emit({ kind: 'MotionCommitted', contactSpanId, actorId: actor.id, laneId: actor.laneIndex ?? null,
    actionPhase: actor.frameIndex, action: actor.action?.actionName || null, actionInstanceId: actor._physicalActionInstanceId,
    parentCauseIds: actor._physicalInterventionId ? [actor._physicalInterventionId] : [],
    positionBefore: { x: beforeX, y: beforeY }, positionAfter: { x: actor.x, y: actor.y }, precision: 'tick',
    physicalPayload: { displacementPixels: Math.hypot(actor.x - beforeX, actor.y - beforeY),
      pathEvidence: 'committed-coordinate-write', contactObserved: contactSpanId !== null, contactEvidence: contactSpanId ? 'consecutive-support-endpoints' : 'unknown' } });
  actor._physicalMotionFactTick = level.tickIndex;
};

export { recordPhysicalMotion, physicalContactForMotion };
