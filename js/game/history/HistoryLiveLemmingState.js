// @ts-check
import { createLemmingState, ensureLemmingCapacity } from './HistoryLemmingState.js';

const LIVE_LAYOUT = 'live-id-slots';
const fields = ['x', 'y', 'lookRight', 'frameIndex', 'state', 'canClimb', 'hasParachute', 'removed',
  'disabled', 'countdown', 'hasExploded', 'lastTriggerType', 'actionType', 'countdownActive'];
const hasLiveLookup = manager => manager?._lemmingById instanceof Map && typeof manager._registerLemming === 'function';
const stateSnapshot = (state, slot, id) => {
  const snapshot = { id };
  for (const field of fields) snapshot[field] = state[field][slot];
  return snapshot;
};
const resetLiveLemmingState = (history, manager) => {
  const size = manager.lemmings.length;
  const previous = history._lemmingState;
  const state = previous.layout === LIVE_LAYOUT ? ensureLemmingCapacity(previous, size) : createLemmingState(size);
  state.present.fill(0); state.layout = LIVE_LAYOUT; history._lemmingState = state;
  history._liveLemmingSlots.clear(); history._liveLemmingFree.length = 0; history._liveLemmingSlotCount = 0;
  for (const actor of manager.lemmings) if (actor) {
    const slot = history._liveLemmingSlotCount++;
    history._liveLemmingSlots.set(actor.id, slot); history._lemmingState.actorIds[slot] = actor.id;
    history._writeLemmingState(history._lemmingState, slot, actor, history._getActionType(manager, actor.action), !!actor.countdownAction);
  }
};
const cloneLiveLemmingState = state => {
  let size = 0; for (const present of state.present) if (present) size++;
  const copy = createLemmingState(size); copy.layout = LIVE_LAYOUT;
  let at = 0;
  for (let slot = 0; slot < state.capacity; slot++) if (state.present[slot]) {
    copy.present[at] = 1; copy.actorIds[at] = state.actorIds[slot];
    for (const field of fields) copy[field][at] = state[field][slot];
    at++;
  }
  return copy;
};
const diffLiveLemmings = (history, manager, delta) => {
  if (history._lemmingState.layout !== LIVE_LAYOUT) resetLiveLemmingState(history, { lemmings: [] });
  const slots = history._liveLemmingSlots;
  for (const [id, slot] of slots) if (!manager.getLemming(id)) {
    delta.lemRemoved.push(stateSnapshot(history._lemmingState, slot, id));
    history._lemmingState.present[slot] = 0; slots.delete(id); history._liveLemmingFree.push(slot);
  }
  const scratch = history._liveLemmingValues;
  for (const actor of manager.lemmings) if (actor) {
    let slot = slots.get(actor.id), state = history._lemmingState;
    const type = history._getActionType(manager, actor.action);
    if (slot == null) {
      slot = history._liveLemmingFree.length ? history._liveLemmingFree.pop() : history._liveLemmingSlotCount++;
      state = history._lemmingState = ensureLemmingCapacity(state, slot + 1); state.layout = LIVE_LAYOUT;
      slots.set(actor.id, slot); state.actorIds[slot] = actor.id;
      history._writeLemmingState(state, slot, actor, type, !!actor.countdownAction);
      delta.lemAdded.push(stateSnapshot(state, slot, actor.id)); continue;
    }
    scratch[0] = actor.x; scratch[1] = actor.y; scratch[2] = actor.lookRight ? 1 : 0; scratch[3] = actor.frameIndex;
    scratch[4] = actor.state ?? 0; scratch[5] = actor.canClimb ? 1 : 0; scratch[6] = actor.hasParachute ? 1 : 0;
    scratch[7] = actor.removed ? 1 : 0; scratch[8] = actor.disabled ? 1 : 0; scratch[9] = actor.countdown ?? 0;
    scratch[10] = actor.hasExploded ? 1 : 0; scratch[11] = Number.isFinite(actor.lastTriggerType) ? actor.lastTriggerType : -1;
    scratch[12] = type; scratch[13] = actor.countdownAction ? 1 : 0;
    for (let field = 0; field < fields.length; field++) {
      const values = state[fields[field]];
      history._diffLemmingField(delta, actor.id, field, values[slot], scratch[field], values, slot);
    }
  }
};
export { LIVE_LAYOUT, hasLiveLookup, resetLiveLemmingState, cloneLiveLemmingState, diffLiveLemmings };
