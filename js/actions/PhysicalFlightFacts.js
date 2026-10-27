const airborne = name => name === 'falling' || name === 'floating';
const emit = (actor, kind, state, extra = {}) => actor._queuePhysicalTransition({ kind, actorId: actor.id, laneId: actor.laneIndex ?? null,
  actionInstanceId: actor._physicalActionInstanceId, arcId: state.arcId, startTick: state.startTick, startPosition: state.startPosition,
  peakY: state.peakY, travelPixels: state.travelPixels, verticalDisplacementPixels: actor.y - state.startPosition.y,
  source: state.source, fallState: actor.action?.actionName || null, parachutePhase: actor.action?.actionName === 'floating' ? actor.frameIndex : null,
  positionAfter: { x: actor.x, y: actor.y }, ...extra });
export function transitionPhysicalFlight(actor, previousAction, nextAction) {
  const previous = previousAction?.actionName, next = nextAction?.actionName;
  if (airborne(next) && !airborne(previous)) {
    actor._physicalFlightSerial = (actor._physicalFlightSerial || 0) + 1;
    const state = { arcId: `${actor.id}:flight:${actor._physicalFlightSerial}`, startTick: actor.runtime?.physicalFacts?.tick?.() ?? null,
      startPosition: { x: actor.x, y: actor.y }, peakY: actor.y, travelPixels: 0, source: previous ? 'action-transition' : 'spawn-fall' };
    actor._physicalFlightState = state; emit(actor, 'FlightArcStarted', state);
  } else if (airborne(previous) && !airborne(next) && actor._physicalFlightState) {
    endPhysicalFlight(actor, ['walk', 'walking'].includes(next) ? 'safe-landing' : 'action-interrupted');
  }
}
export function observePhysicalFlightStep(actor, beforeX, beforeY) {
  const state = actor._physicalFlightState;
  if (!state || !airborne(actor.action?.actionName)) return;
  state.travelPixels += Math.hypot(actor.x - beforeX, actor.y - beforeY); state.peakY = Math.min(state.peakY, actor.y);
  emit(actor, 'FlightArcUpdated', state, { positionBefore: { x: beforeX, y: beforeY }, phase: actor.frameIndex, gameFallDistancePixels: actor.state });
}
export function endPhysicalFlight(actor, reason) {
  const state = actor._physicalFlightState; if (!state) return;
  emit(actor, 'FlightArcEnded', state, { terminationReason: reason, contactAtEnd: reason === 'safe-landing' || reason === 'unsafe-fall' ? 'terrain-landing' : null });
  actor._physicalFlightState = null;
}

export function publishObservedFlightBoundary(actor) {
  const state = actor._physicalFlightState; if (state) emit(actor, 'FlightArcStarted', state, { observation: 'existing-flight-boundary', historyComplete: state.travelPixels === 0 });
}
