// @ts-check
import {
  DELTA_FLAG_ENTRANCE,
  DELTA_FLAG_GROUND,
  DELTA_FLAG_LEMMING_ADDS,
  DELTA_FLAG_LEMMING_CHANGES,
  DELTA_FLAG_LEMMING_MANAGER,
  DELTA_FLAG_LEMMING_REMOVALS,
  DELTA_FLAG_MINIMAP_DEATHS,
  DELTA_FLAG_OBJECTS,
  DELTA_FLAG_SCALARS,
  DELTA_FLAG_SOUND_EVENTS,
  DELTA_FLAG_TRIGGERS,
  toBoolByte,
  toI32,
  toU8
} from './HistoryShared.js';


const computeDeltaFlags = (delta) => {
  if (!delta || typeof delta !== 'object') return 0;
  let flags = 0;
  if (delta.lemAdded?.length) flags |= DELTA_FLAG_LEMMING_ADDS;
  if (delta.lemChanges?.ids?.length) flags |= DELTA_FLAG_LEMMING_CHANGES;
  if (delta.lemRemoved?.length) flags |= DELTA_FLAG_LEMMING_REMOVALS;
  if (delta.lemmingManagerChanges) flags |= DELTA_FLAG_LEMMING_MANAGER;
  if (delta.groundChanges?.indices?.length || delta.groundChanges?.spans) flags |= DELTA_FLAG_GROUND;
  if (delta.entranceChanges?.indices?.length) flags |= DELTA_FLAG_ENTRANCE;
  if (
    delta.triggerCooldownChanges?.ids?.length ||
    delta.triggerAdd?.length ||
    delta.triggerRemove?.length
  ) {
    flags |= DELTA_FLAG_TRIGGERS;
  }
  if (delta.objectAnimChanges?.ids?.length) flags |= DELTA_FLAG_OBJECTS;
  if (delta.victoryChanges || delta.skillsChanges || delta.timerChanges || delta.gameChanges) {
    flags |= DELTA_FLAG_SCALARS;
  }
  if (delta.soundEvents?.length) flags |= DELTA_FLAG_SOUND_EVENTS;
  if (delta.minimapDeaths?.length) flags |= DELTA_FLAG_MINIMAP_DEATHS;
  return flags;
};

/**
 * Canonical delta-section bitmap normalizer.
 * Deltas are expected to carry `flags`; this fills it once for any ad-hoc test
 * or tooling input that omitted the bitmap.
 */
const ensureDeltaFlags = (delta) => {
  if (!delta || typeof delta !== 'object') return 0;
  if (Number.isFinite(delta.flags)) return delta.flags | 0;
  const flags = computeDeltaFlags(delta);
  delta.flags = flags;
  return flags;
};

const isNoOpDelta = (delta) => {
  return ensureDeltaFlags(delta) === 0;
};


const createDelta = (tick) => ({
  tick,
  flags: 0,
  lemChanges: { ids: [], fields: [], prev: [], next: [] },
  lemAdded: [],
  lemRemoved: [],
  lemmingManagerChanges: null,
  groundChanges: {
    indices: [],
    spans: null,
    prevMask: [],
    prevR: [],
    prevG: [],
    prevB: [],
    nextMask: [],
    nextR: [],
    nextG: [],
    nextB: []
  },
  entranceChanges: { indices: [], prev: [], next: [] },
  triggerCooldownChanges: { ids: [], prev: [], next: [] },
  triggerAdd: [],
  triggerRemove: [],
  objectAnimChanges: { ids: [], prevFirst: [], prevFinished: [], nextFirst: [], nextFinished: [] },
  victoryChanges: null,
  skillsChanges: null,
  timerChanges: null,
  gameChanges: null,
  soundEvents: [],
  minimapDeaths: []
});

const createPackedLemmingMutation = (count) => ({
  count,
  id: new Int32Array(count),
  x: new Int32Array(count),
  y: new Int32Array(count),
  lookRight: new Uint8Array(count),
  frameIndex: new Int32Array(count),
  state: new Int32Array(count),
  canClimb: new Uint8Array(count),
  hasParachute: new Uint8Array(count),
  removed: new Uint8Array(count),
  disabled: new Uint8Array(count),
  countdown: new Int32Array(count),
  hasExploded: new Uint8Array(count),
  lastTriggerType: new Int32Array(count),
  actionType: new Int32Array(count),
  countdownActive: new Uint8Array(count)
});

const packLemmingMutationList = (list) => {
  const count = Array.isArray(list) ? list.length : 0;
  const packed = createPackedLemmingMutation(count);
  for (let i = 0; i < count; i += 1) {
    const snap = list[i] || {};
    packed.id[i] = toI32(snap.id);
    packed.x[i] = toI32(snap.x);
    packed.y[i] = toI32(snap.y);
    packed.lookRight[i] = toBoolByte(snap.lookRight);
    packed.frameIndex[i] = toI32(snap.frameIndex);
    packed.state[i] = toI32(snap.state);
    packed.canClimb[i] = toBoolByte(snap.canClimb);
    packed.hasParachute[i] = toBoolByte(snap.hasParachute);
    packed.removed[i] = toBoolByte(snap.removed);
    packed.disabled[i] = toBoolByte(snap.disabled);
    packed.countdown[i] = toI32(snap.countdown);
    packed.hasExploded[i] = toBoolByte(snap.hasExploded);
    packed.lastTriggerType[i] = toI32(snap.lastTriggerType, -1);
    packed.actionType[i] = toI32(snap.actionType, -1);
    packed.countdownActive[i] = toBoolByte(snap.countdownActive);
  }
  return packed;
};

const unpackLemmingMutationList = (packed) => {
  const count = packed?.count || 0;
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = {
      id: packed.id[i],
      x: packed.x[i],
      y: packed.y[i],
      lookRight: packed.lookRight[i],
      frameIndex: packed.frameIndex[i],
      state: packed.state[i],
      canClimb: packed.canClimb[i],
      hasParachute: packed.hasParachute[i],
      removed: packed.removed[i],
      disabled: packed.disabled[i],
      countdown: packed.countdown[i],
      hasExploded: packed.hasExploded[i],
      lastTriggerType: packed.lastTriggerType[i],
      actionType: packed.actionType[i],
      countdownActive: packed.countdownActive[i]
    };
  }
  return out;
};

const writePackedLemmingMutation = (writer, packed) => {
  const count = packed?.count || 0;
  writer.writeVarUint(count);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.id[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.x[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.y[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.lookRight[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.frameIndex[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.state[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.canClimb[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.hasParachute[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.removed[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.disabled[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.countdown[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.hasExploded[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.lastTriggerType[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.actionType[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.countdownActive[i]);
};

const readPackedLemmingMutation = (reader) => {
  const count = reader.readVarUint();
  const packed = createPackedLemmingMutation(count);
  for (let i = 0; i < count; i += 1) packed.id[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.x[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.y[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.lookRight[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.frameIndex[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.state[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.canClimb[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.hasParachute[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.removed[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.disabled[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.countdown[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.hasExploded[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.lastTriggerType[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.actionType[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.countdownActive[i] = reader.readU8();
  return packed;
};

const createPackedLemmingChanges = (count) => ({
  count,
  ids: new Int32Array(count),
  fields: new Uint8Array(count),
  prev: new Int32Array(count),
  next: new Int32Array(count)
});

const packLemmingChanges = (changes) => {
  const count = Array.isArray(changes?.ids) ? changes.ids.length : 0;
  const packed = createPackedLemmingChanges(count);
  for (let i = 0; i < count; i += 1) {
    packed.ids[i] = toI32(changes.ids[i]);
    packed.fields[i] = toU8(changes.fields?.[i]);
    packed.prev[i] = toI32(changes.prev?.[i]);
    packed.next[i] = toI32(changes.next?.[i]);
  }
  return packed;
};

const unpackLemmingChanges = (packed) => {
  const count = packed?.count || 0;
  const changes = {
    ids: new Array(count),
    fields: new Array(count),
    prev: new Array(count),
    next: new Array(count)
  };
  for (let i = 0; i < count; i += 1) {
    changes.ids[i] = packed.ids[i];
    changes.fields[i] = packed.fields[i];
    changes.prev[i] = packed.prev[i];
    changes.next[i] = packed.next[i];
  }
  return changes;
};

const writePackedLemmingChanges = (writer, packed) => {
  const count = packed?.count || 0;
  writer.writeVarUint(count);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.ids[i]);
  for (let i = 0; i < count; i += 1) writer.writeU8(packed.fields[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.prev[i]);
  for (let i = 0; i < count; i += 1) writer.writeI32(packed.next[i]);
};

const readPackedLemmingChanges = (reader) => {
  const count = reader.readVarUint();
  const packed = createPackedLemmingChanges(count);
  for (let i = 0; i < count; i += 1) packed.ids[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.fields[i] = reader.readU8();
  for (let i = 0; i < count; i += 1) packed.prev[i] = reader.readI32();
  for (let i = 0; i < count; i += 1) packed.next[i] = reader.readI32();
  return packed;
};

const packTimerStateForStorage = (state, tick) => {
  if (!state) return null;
  const out = { ...state };
  if (Number.isFinite(out.tickIndex) && Number.isFinite(tick)) {
    out.tickIndex = Math.trunc(out.tickIndex) - Math.trunc(tick);
  }
  return out;
};

const unpackTimerStateFromStorage = (state, tick) => {
  if (!state) return null;
  const out = { ...state };
  if (Number.isFinite(out.tickIndex) && Number.isFinite(tick)) {
    out.tickIndex = Math.trunc(out.tickIndex) + Math.trunc(tick);
  }
  return out;
};

export {
  computeDeltaFlags,
  ensureDeltaFlags,
  isNoOpDelta,
  createDelta,
  packLemmingMutationList,
  unpackLemmingMutationList,
  writePackedLemmingMutation,
  readPackedLemmingMutation,
  packLemmingChanges,
  unpackLemmingChanges,
  writePackedLemmingChanges,
  readPackedLemmingChanges,
  packTimerStateForStorage,
  unpackTimerStateFromStorage
};
