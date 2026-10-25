const SUPPORTED_ACTIONS = new Set(['walk', 'blocking', 'building', 'bashing', 'digging', 'mining', 'shrug']);

// A qualified contact observation is a discrete support-cell query against the
// completed terrain. It asserts neither pressure nor continuous sub-tick touch.
const observePhysicalSupport = (level, actor) => {
  if (!actor.runtime?.physicalFacts?.enabled?.(actor)) return;
  const existing = actor._physicalContactSpan;
  const covered = SUPPORTED_ACTIONS.has(actor.action?.actionName) && !actor.removed && !actor.failureReason && !actor.terminalReason;
  const anchor = { x: actor.x, y: actor.y + 1 };
  const supported = covered && level.hasGroundAt(anchor.x, anchor.y);
  if (existing && existing.lastObservedTick !== level.tickIndex - 1) actor.endPhysicalContactSpan('unknown-coverage');
  else if (existing && existing.surfaceRevision !== level.terrainRevision && !level.hasGroundAt(existing.anchor.x, existing.anchor.y)) {
    actor.endPhysicalContactSpan('support-topology-invalidated');
  } else if (existing && !supported) actor.endPhysicalContactSpan(covered ? 'support-lost' : 'unsupported-action');
  if (!supported) return;
  const prior = actor._physicalContactSpan;
  const spanId = prior?.spanId ?? `${level.worldId}:${level.generation}:${actor.id}:support:${actor._physicalContactSerial = (actor._physicalContactSerial || 0) + 1}`;
  const span = { spanId, anchor, lastObservedTick: level.tickIndex, surfaceRevision: level.terrainRevision,
    actionInstanceId: actor._physicalActionInstanceId };
  actor._physicalContactSpan = span;
  actor.runtime.physicalFacts.emit({ kind: prior ? 'ContactSpanUpdated' : 'ContactSpanBegan', spanId,
    actorId: actor.id, laneId: actor.laneIndex ?? null, action: actor.action?.actionName || null,
    actionInstanceId: actor._physicalActionInstanceId, causeKind: 'support', contactRole: 'supported-body',
    positionAfter: { x: actor.x, y: actor.y }, anchor, surfaceRevision: level.terrainRevision,
    observedTick: level.tickIndex, precision: 'tick', physicalPayload: { evidence: 'completed-support-cell',
      contactContinuity: 'consecutive-discrete-observations', terrainProvenance: level.terrainContactProvenance?.(anchor.x, anchor.y) ?? { status: 'unknown' }, terrainFeatureId: null, pressure: null, normal: null } });
};

export { observePhysicalSupport };
