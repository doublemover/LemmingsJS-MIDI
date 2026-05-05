// @ts-check
import { SkillTypes } from '../SkillTypes.js';
import { Trigger } from '../../level/Trigger.js';
import {
  COLD_BLOCK_MAGIC,
  COLD_BLOCK_VERSION,
  COLD_DELTA_SENTINEL,
  DEFAULT_OPTIONS,
  DELTA_CODEC_VERSION,
  DELTA_FLAG_ENTRANCE,
  DELTA_FLAG_GROUND,
  DELTA_FLAG_LEMMING_ADDS,
  DELTA_FLAG_LEMMING_CHANGES,
  DELTA_FLAG_LEMMING_MANAGER,
  DELTA_FLAG_LEMMING_MUTATIONS,
  DELTA_FLAG_LEMMING_REMOVALS,
  DELTA_FLAG_MINIMAP_DEATHS,
  DELTA_FLAG_OBJECTS,
  DELTA_FLAG_SCALARS,
  DELTA_FLAG_SOUND_EVENTS,
  DELTA_FLAG_TRIGGERS,
  NULL_INT32,
  normalizeOptions,
  toI32
} from './HistoryShared.js';
import {
  BinaryReader,
  BinaryWriter,
  bytesEqual,
  fnv1aHashBytes,
  readTaggedValue,
  rleDecodeBytes,
  rleEncodeBytes,
  writeTaggedValue
} from './HistoryBinaryCodec.js';
import {
  applyLemmingSnapshot,
  cloneLemmingState,
  createLemmingState,
  ensureLemmingCapacity,
  snapshotLemming
} from './HistoryLemmingState.js';
import {
  computeDeltaFlags,
  createDelta,
  ensureDeltaFlags,
  isNoOpDelta,
  packLemmingChanges,
  packLemmingMutationList,
  packTimerStateForStorage,
  readPackedLemmingChanges,
  readPackedLemmingMutation,
  unpackLemmingChanges,
  unpackLemmingMutationList,
  unpackTimerStateFromStorage,
  writePackedLemmingChanges,
  writePackedLemmingMutation
} from './HistoryDeltaCodec.js';
import {
  MIDI_FLAG_OWNER_KIND,
  clonePlainObject,
  createMidiFlagTriggerOwner
} from './HistoryTriggerOwners.js';

const historyStoreRecordingMethods = {
  _bindTimer() {
    if (!this.timer) return;
    this._beforeTick = (tick) => this.beginTick(tick);
    this._afterTick = () => this.endTick();
    this.timer.onBeforeGameTick?.on(this._beforeTick);
    this.timer.onGameTick?.on(this._afterTick);
  },

  beginTick(tick) {
    if (!this._recording) return;
    this._currentTick = tick;
    this._currentDelta = this._allocDelta(tick);
  },

  endTick() {
    if (!this._recording || !this.game || !this._currentDelta) return;
    const tick = this._currentTick;
    const tickIndex = this.timer?.tickIndex ?? (tick + 1);
    this._diffState(this.game, this._currentDelta);
    this._compressGroundChanges(this._currentDelta.groundChanges);
    this._currentDelta.flags = computeDeltaFlags(this._currentDelta);
    this._setDelta(tick, this._currentDelta);
    if ((tickIndex % this.options.keyframeInterval) === 0) {
      this._setKeyframe(tickIndex, this._captureKeyframe(this.game, tickIndex));
    }
    this._maybeWarnHistory();
    this._enforceHistoryCap();
    this._maybeCompactDeltaBlocks();
    this._currentDelta = null;
  },

  captureBaseline(game) {
    if (!game) return;
    this._captureScalarState(game);
    const manager = game.getLemmingManager?.();
    this._captureLemmingState(manager);
    this._lemmingManagerState = this._readLemmingManager(manager);
    this._captureEntrances(game.level);
  },

  recordSoundEvent(event) {
    if (!this._currentDelta) return;
    this._currentDelta.soundEvents.push(event);
  },

  recordGroundChange(index, prevMask, prevR, prevG, prevB, nextMask, nextR, nextG, nextB) {
    if (!this._currentDelta) return;
    this._groundDirty = true;
    const changes = this._currentDelta.groundChanges;
    changes.indices.push(index);
    changes.prevMask.push(prevMask);
    changes.prevR.push(prevR);
    changes.prevG.push(prevG);
    changes.prevB.push(prevB);
    changes.nextMask.push(nextMask);
    changes.nextR.push(nextR);
    changes.nextG.push(nextG);
    changes.nextB.push(nextB);
  },

  recordEntranceChange(index, prev, next) {
    if (!this._currentDelta) return;
    const changes = this._currentDelta.entranceChanges;
    changes.indices.push(index);
    changes.prev.push(prev ? 1 : 0);
    changes.next.push(next ? 1 : 0);
  },

  recordTriggerCooldown(trigger, prev, next) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    const changes = this._currentDelta.triggerCooldownChanges;
    changes.ids.push(id);
    changes.prev.push(prev);
    changes.next.push(next);
  },

  recordTriggerAdd(trigger, snapshot) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    this._currentDelta.triggerAdd.push({
      id,
      ...snapshot,
      ...this._readTriggerOwnerSnapshot(trigger)
    });
  },

  recordTriggerRemove(trigger, snapshot) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    this._currentDelta.triggerRemove.push({
      id,
      ...snapshot,
      ...this._readTriggerOwnerSnapshot(trigger)
    });
  },

  _readTriggerOwnerSnapshot(trigger) {
    const owner = trigger?.owner ?? null;
    if (!owner) {
      return { ownerKind: null, ownerId: null, ownerRef: null, ownerData: null };
    }
    if (Number.isFinite(owner.id)) {
      return {
        ownerKind: 'lemming',
        ownerId: owner.id,
        ownerRef: { id: owner.id },
        ownerData: null
      };
    }
    const ownerKind = owner.__historyKind || owner.historyKind || null;
    if (ownerKind) {
      const ownerData = typeof owner.getHistoryData === 'function'
        ? owner.getHistoryData(trigger)
        : (clonePlainObject(owner.__historyData) || clonePlainObject(owner.historyData));
      return {
        ownerKind,
        ownerId: owner.id ?? null,
        ownerRef: owner.id != null ? { id: owner.id } : null,
        ownerData
      };
    }
    return { ownerKind: null, ownerId: owner.id ?? null, ownerRef: null, ownerData: null };
  },

  _resolveTriggerOwner(game, snap) {
    const ownerKind = snap?.ownerKind || (Number.isFinite(snap?.ownerId) ? 'lemming' : null);
    if (ownerKind === 'lemming') {
      const id = Number.isFinite(snap?.ownerRef?.id) ? snap.ownerRef.id : snap?.ownerId;
      return Number.isFinite(id)
        ? game.getLemmingManager?.()?.getLemming?.(id) ?? null
        : null;
    }
    if (ownerKind === MIDI_FLAG_OWNER_KIND) {
      return createMidiFlagTriggerOwner(game, snap);
    }
    if (ownerKind) {
      return { id: snap?.ownerId ?? snap?.ownerRef?.id ?? null };
    }
    return null;
  },

  _isReplayManagedDynamicTrigger(trigger) {
    if (!trigger) return false;
    const ownerSnapshot = this._readTriggerOwnerSnapshot(trigger);
    return ownerSnapshot.ownerKind != null;
  },

  _removeTriggerInstance(triggerManager, trigger) {
    if (!triggerManager || !trigger) return;
    if (typeof triggerManager.remove === 'function') {
      triggerManager.remove(trigger);
      return;
    }
    if (trigger.owner && typeof triggerManager.removeByOwner === 'function') {
      triggerManager.removeByOwner(trigger.owner);
      return;
    }
    triggerManager._triggers?.delete?.(trigger);
  },

  recordObjectAnimation(obj, prev, next) {
    if (!this._currentDelta) return;
    const id = this._ensureObjectId(obj);
    const changes = this._currentDelta.objectAnimChanges;
    changes.ids.push(id);
    changes.prevFirst.push(prev.firstFrameIndex);
    changes.prevFinished.push(prev.isFinished ? 1 : 0);
    changes.nextFirst.push(next.firstFrameIndex);
    changes.nextFinished.push(next.isFinished ? 1 : 0);
  },

  recordMinimapDeath(entry) {
    if (!this._currentDelta) return;
    this._currentDelta.minimapDeaths.push(entry);
  },

  _ensureTriggerId(trigger) {
    if (!trigger) return 0;
    if (trigger.__historyId) return trigger.__historyId;
    const id = this._nextTriggerId++;
    trigger.__historyId = id;
    this._triggerIds.set(trigger, id);
    this._triggerById.set(id, trigger);
    return id;
  },

  _ensureObjectId(obj) {
    if (!obj) return 0;
    if (obj.__historyId) return obj.__historyId;
    const id = this._nextObjectId++;
    obj.__historyId = id;
    this._objectIds.set(obj, id);
    this._objectById.set(id, obj);
    return id;
  },
};

export { historyStoreRecordingMethods };
