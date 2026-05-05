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

const historyStoreApplyStateMethods = {
  applyKeyframe(game, keyframe) {
    if (!game || !keyframe) return;
    const manager = game.getLemmingManager?.();
    if (manager && keyframe.lemmingState) {
      const state = keyframe.lemmingState;
      const lems = manager.lemmings || [];
      if (lems.length !== state.present.length) {
        manager.lemmings = new Array(state.present.length);
      }
      const countdownAction = manager.skillActions?.[SkillTypes.BOMBER] ?? null;
      for (let i = 0; i < state.present.length; i++) {
        if (!state.present[i]) {
          manager.lemmings[i] = null;
          continue;
        }
        let lem = manager.lemmings[i];
        if (!lem) {
          lem = this._createReplayLemming(manager, state.x[i], state.y[i], i);
          manager.lemmings[i] = lem;
        }
        const action = state.actionType[i] >= 0 ? manager.actions?.[state.actionType[i]] : null;
        const snap = {
          id: i,
          x: state.x[i],
          y: state.y[i],
          lookRight: state.lookRight[i],
          frameIndex: state.frameIndex[i],
          state: state.state[i],
          canClimb: state.canClimb[i],
          hasParachute: state.hasParachute[i],
          removed: state.removed[i],
          disabled: state.disabled[i],
          countdown: state.countdown[i],
          hasExploded: state.hasExploded[i],
          lastTriggerType: state.lastTriggerType[i],
          actionType: state.actionType[i],
          countdownActive: state.countdownActive[i]
        };
        applyLemmingSnapshot(lem, snap, action, countdownAction);
      }
      this._rebuildActiveLemmings(manager);
    }
  
    if (manager && keyframe.lemmingManagerState) {
      const state = keyframe.lemmingManagerState;
      manager.selectedIndex = state.selectedIndex ?? -1;
      manager.spawnTotal = state.spawnTotal ?? 0;
      manager.releaseTickIndex = state.releaseTickIndex ?? 0;
      manager.mmTickCounter = state.mmTickCounter ?? 0;
      manager.nextNukingLemmingsIndex = state.nextNukingLemmingsIndex ?? -1;
      manager._nukeTargets = this._resolveNukeTargets(manager, state.nukeTargets);
    }
  
    if (game.level && keyframe.entranceOpened) {
      const entrances = game.level.entrances || [];
      for (let i = 0; i < entrances.length; i++) {
        entrances[i]._opened = !!keyframe.entranceOpened[i];
      }
    }
  
    if (game.triggerManager && keyframe.triggerState) {
      this._applyTriggerState(game, keyframe.triggerState);
    }
  
    if (game.level && keyframe.objectState) {
      this._applyObjectState(game.level, keyframe.objectState);
    }
  
    if (manager?.miniMap && keyframe.minimapState) {
      const miniMap = manager.miniMap;
      miniMap.deadDots = new Uint8Array(keyframe.minimapState.deadDots || []);
      miniMap.deadTTLs = new Uint8Array(keyframe.minimapState.deadTTLs || []);
      miniMap.deadCount = keyframe.minimapState.deadCount ?? 0;
    }
  
    if (game.level?.groundMask && keyframe.groundMask) {
      game.level.groundMask.mask = new Uint8Array(keyframe.groundMask);
    }
    if (game.level && keyframe.groundImage) {
      game.level.groundImage = new Uint8ClampedArray(keyframe.groundImage);
    }
  
    if (keyframe.victory) {
      const victory = game.getVictoryCondition?.();
      if (victory) {
        victory.releaseRate = keyframe.victory.releaseRate;
        victory.minReleaseRate = keyframe.victory.minReleaseRate;
        victory.leftCount = keyframe.victory.leftCount;
        victory.outCount = keyframe.victory.outCount;
        victory.survivorCount = keyframe.victory.survivorCount;
        victory.isFinalize = !!keyframe.victory.isFinalize;
      }
    }
  
    if (keyframe.skills) {
      const skills = game.getGameSkills?.();
      if (skills) {
        skills.selectedSkill = keyframe.skills.selectedSkill;
        skills.cheatMode = !!keyframe.skills.cheatMode;
        skills.skills = keyframe.skills.skills.slice();
      }
    }
  
    if (keyframe.timer) {
      const timer = game.getGameTimer?.();
      if (timer) {
        const ignoreSpeed = !!game?.timeTravel?.isReversing &&
            !!game?.timeTravel?.ignoreSpeedOnReverse;
        if (!ignoreSpeed) {
          timer.speedFactor = keyframe.timer.speedFactor;
        }
        timer.tickIndex = keyframe.timer.tickIndex;
      }
    }
  
    if (keyframe.gameState) {
      game.finalGameState = keyframe.gameState.finalGameState;
    }
  
    this.captureBaseline(game);
  },

  _readTriggerState(game) {
    const triggerManager = game?.triggerManager;
    const level = game?.level;
    if (!triggerManager || !level) return null;
    const staticTriggers = [];
    const dynamicTriggers = [];
    const levelTriggers = level.triggers || [];
    const staticSet = this._scratchStaticTriggers;
    staticSet.clear();
    for (let i = 0; i < levelTriggers.length; i += 1) {
      staticSet.add(levelTriggers[i]);
    }
    for (let i = 0; i < levelTriggers.length; i++) {
      const trig = levelTriggers[i];
      if (!trig) continue;
      const id = this._ensureTriggerId(trig);
      staticTriggers.push({ id, disabledUntilTick: trig.disabledUntilTick });
    }
    const readDynamicTrigger = (trig, observer = false) => {
      if (!trig || staticSet.has(trig)) return;
      const ownerSnapshot = this._readTriggerOwnerSnapshot(trig);
      if (ownerSnapshot.ownerKind == null) return;
      const id = this._ensureTriggerId(trig);
      dynamicTriggers.push({
        id,
        ...ownerSnapshot,
        type: trig.type,
        x1: trig.x1,
        y1: trig.y1,
        x2: trig.x2,
        y2: trig.y2,
        disableTicksCount: trig.disableTicksCount,
        soundIndex: trig.soundIndex,
        disabledUntilTick: trig.disabledUntilTick,
        observer
      });
    };
    for (const trig of triggerManager._triggers || []) {
      readDynamicTrigger(trig, false);
    }
    for (const trig of triggerManager._observerTriggers || []) {
      readDynamicTrigger(trig, true);
    }
    staticSet.clear();
    return { staticTriggers, dynamicTriggers };
  },

  _applyTriggerState(game, state) {
    const triggerManager = game.triggerManager;
    const level = game.level;
    if (!triggerManager || !level || !state) return;
    const levelTriggers = level.triggers || [];
    for (let i = 0; i < levelTriggers.length; i++) {
      const trig = levelTriggers[i];
      const entry = state.staticTriggers?.[i] || null;
      if (!trig || !entry) continue;
      trig.disabledUntilTick = entry.disabledUntilTick;
      this._ensureTriggerId(trig);
    }
  
    const dynamic = state.dynamicTriggers || [];
    const staticSet = this._scratchStaticTriggers;
    staticSet.clear();
    for (let i = 0; i < levelTriggers.length; i += 1) {
      if (levelTriggers[i]) staticSet.add(levelTriggers[i]);
    }
    const removeList = [];
    for (const triggerSet of [triggerManager._triggers, triggerManager._observerTriggers]) {
      for (const trig of triggerSet || []) {
        if (!trig || staticSet.has(trig)) continue;
        if (this._isReplayManagedDynamicTrigger(trig)) removeList.push(trig);
      }
    }
    staticSet.clear();
    for (const trig of removeList) {
      this._removeTriggerInstance(triggerManager, trig);
    }
    for (const snap of dynamic) {
      const owner = this._resolveTriggerOwner(game, snap);
      const trig = new Trigger(
        snap.type,
        snap.x1,
        snap.y1,
        snap.x2,
        snap.y2,
        snap.disableTicksCount,
        snap.soundIndex,
        owner
      );
      trig.disabledUntilTick = snap.disabledUntilTick;
      trig.__historyId = snap.id;
      if (snap.observer === true && typeof triggerManager.addObserver === 'function') {
        triggerManager.addObserver(trig);
      } else {
        triggerManager.add(trig);
      }
      this._triggerById.set(snap.id, trig);
    }
  },

  _readObjectState(level) {
    const objects = level?.objects || [];
    const out = [];
    for (const obj of objects) {
      if (!obj?.animation) continue;
      const id = this._ensureObjectId(obj);
      out.push({
        id,
        firstFrameIndex: obj.animation.firstFrameIndex,
        isFinished: obj.animation.isFinished
      });
    }
    return out;
  },

  _applyObjectState(level, state) {
    for (const entry of state || []) {
      let obj = this._objectById.get(entry.id);
      if (!obj) {
        const objects = level?.objects || [];
        for (const candidate of objects) {
          if (!candidate?.animation) continue;
          const candidateId = this._ensureObjectId(candidate);
          if (candidateId === entry.id) {
            obj = candidate;
            break;
          }
        }
      }
      if (!obj?.animation) continue;
      obj.animation.firstFrameIndex = entry.firstFrameIndex;
      obj.animation.isFinished = !!entry.isFinished;
    }
  },

  _readMinimapState(miniMap) {
    if (!miniMap) return null;
    return {
      deadDots: new Uint8Array(miniMap.deadDots || []),
      deadTTLs: new Uint8Array(miniMap.deadTTLs || []),
      deadCount: miniMap.deadCount ?? 0
    };
  },
};

export { historyStoreApplyStateMethods };
