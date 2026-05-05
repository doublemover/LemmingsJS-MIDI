// @ts-check
const createLemmingState = (size) => ({
  capacity: size,
  present: new Uint8Array(size),
  x: new Int32Array(size),
  y: new Int32Array(size),
  lookRight: new Uint8Array(size),
  frameIndex: new Int32Array(size),
  state: new Int32Array(size),
  canClimb: new Uint8Array(size),
  hasParachute: new Uint8Array(size),
  removed: new Uint8Array(size),
  disabled: new Uint8Array(size),
  countdown: new Int32Array(size),
  hasExploded: new Uint8Array(size),
  lastTriggerType: new Int32Array(size),
  actionType: new Int32Array(size),
  countdownActive: new Uint8Array(size)
});

const cloneLemmingState = (state, length) => {
  const size = length ?? state.capacity;
  const copy = createLemmingState(size);
  copy.present.set(state.present.subarray(0, size));
  copy.x.set(state.x.subarray(0, size));
  copy.y.set(state.y.subarray(0, size));
  copy.lookRight.set(state.lookRight.subarray(0, size));
  copy.frameIndex.set(state.frameIndex.subarray(0, size));
  copy.state.set(state.state.subarray(0, size));
  copy.canClimb.set(state.canClimb.subarray(0, size));
  copy.hasParachute.set(state.hasParachute.subarray(0, size));
  copy.removed.set(state.removed.subarray(0, size));
  copy.disabled.set(state.disabled.subarray(0, size));
  copy.countdown.set(state.countdown.subarray(0, size));
  copy.hasExploded.set(state.hasExploded.subarray(0, size));
  copy.lastTriggerType.set(state.lastTriggerType.subarray(0, size));
  copy.actionType.set(state.actionType.subarray(0, size));
  copy.countdownActive.set(state.countdownActive.subarray(0, size));
  return copy;
};

const ensureLemmingCapacity = (state, size) => {
  if (state.capacity >= size) return state;
  const next = Math.max(size, state.capacity * 2, 1);
  const grown = createLemmingState(next);
  grown.present.set(state.present);
  grown.x.set(state.x);
  grown.y.set(state.y);
  grown.lookRight.set(state.lookRight);
  grown.frameIndex.set(state.frameIndex);
  grown.state.set(state.state);
  grown.canClimb.set(state.canClimb);
  grown.hasParachute.set(state.hasParachute);
  grown.removed.set(state.removed);
  grown.disabled.set(state.disabled);
  grown.countdown.set(state.countdown);
  grown.hasExploded.set(state.hasExploded);
  grown.lastTriggerType.set(state.lastTriggerType);
  grown.actionType.set(state.actionType);
  grown.countdownActive.set(state.countdownActive);
  return grown;
};

const snapshotLemming = (lem, actionType, countdownActive) => ({
  id: lem.id,
  x: lem.x,
  y: lem.y,
  lookRight: lem.lookRight ? 1 : 0,
  frameIndex: lem.frameIndex,
  state: lem.state ?? 0,
  canClimb: lem.canClimb ? 1 : 0,
  hasParachute: lem.hasParachute ? 1 : 0,
  removed: lem.removed ? 1 : 0,
  disabled: lem.disabled ? 1 : 0,
  countdown: lem.countdown ?? 0,
  hasExploded: lem.hasExploded ? 1 : 0,
  lastTriggerType: Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1,
  actionType: Number.isFinite(actionType) ? actionType : -1,
  countdownActive: countdownActive ? 1 : 0
});

const applyLemmingSnapshot = (lem, snapshot, action, countdownAction) => {
  lem.id = snapshot.id;
  lem.x = snapshot.x;
  lem.y = snapshot.y;
  lem.lookRight = !!snapshot.lookRight;
  lem.frameIndex = snapshot.frameIndex;
  lem.state = snapshot.state;
  lem.canClimb = !!snapshot.canClimb;
  lem.hasParachute = !!snapshot.hasParachute;
  lem.removed = !!snapshot.removed;
  lem.disabled = !!snapshot.disabled;
  lem.countdown = snapshot.countdown;
  lem.hasExploded = !!snapshot.hasExploded;
  lem.lastTriggerType = snapshot.lastTriggerType >= 0 ? snapshot.lastTriggerType : null;
  lem.action = action || null;
  lem.countdownAction = snapshot.countdownActive ? countdownAction : null;
};

export {
  createLemmingState,
  cloneLemmingState,
  ensureLemmingCapacity,
  snapshotLemming,
  applyLemmingSnapshot
};
