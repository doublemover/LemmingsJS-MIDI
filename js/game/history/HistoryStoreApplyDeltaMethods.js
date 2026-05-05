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

const historyStoreApplyDeltaMethods = {
  applyDeltaForward(game, delta) {
    this._applyDelta(game, delta, true);
  },

  applyDeltaBackward(game, delta) {
    this._applyDelta(game, delta, false);
  },

  _applyDelta(game, delta, useNext) {
    if (!game || !delta) return;
    const flags = this._getDeltaFlags(delta);
    const manager = game.getLemmingManager?.();
    if (manager) {
      if (useNext) {
        if (flags & DELTA_FLAG_LEMMING_ADDS) {
          this._applyLemmingAdds(manager, delta.lemAdded);
        }
      } else {
        if (flags & DELTA_FLAG_LEMMING_REMOVALS) {
          this._applyLemmingAdds(manager, delta.lemRemoved);
        }
      }
      if (flags & DELTA_FLAG_LEMMING_CHANGES) {
        this._applyLemmingChanges(manager, delta.lemChanges, useNext);
      }
      if (useNext) {
        if (flags & DELTA_FLAG_LEMMING_REMOVALS) {
          this._applyLemmingRemovals(manager, delta.lemRemoved);
        }
      } else {
        if (flags & DELTA_FLAG_LEMMING_ADDS) {
          this._applyLemmingRemovals(manager, delta.lemAdded);
        }
      }
      if (flags & DELTA_FLAG_LEMMING_MANAGER) {
        this._applyLemmingManagerState(manager, delta.lemmingManagerChanges, useNext);
      }
      if (flags & DELTA_FLAG_LEMMING_MUTATIONS) {
        this._rebuildActiveLemmings(manager);
      }
      if (flags & DELTA_FLAG_MINIMAP_DEATHS) {
        this._applyMinimapDeaths(manager, delta.minimapDeaths, useNext);
      }
    }
  
    if (flags & DELTA_FLAG_ENTRANCE) {
      this._applyEntranceChanges(game.level, delta.entranceChanges, useNext);
    }
    if (flags & DELTA_FLAG_GROUND) {
      this._applyGroundChanges(game.level, delta.groundChanges, useNext);
    }
    if (flags & DELTA_FLAG_TRIGGERS) {
      this._applyTriggerChanges(game, delta, useNext);
    }
    if (flags & DELTA_FLAG_OBJECTS) {
      this._applyObjectChanges(game.level, delta.objectAnimChanges, useNext);
    }
    if (flags & DELTA_FLAG_SCALARS) {
      this._applyScalarChanges(game, delta, useNext);
    } else {
      this._applyDerivedTimerTick(game, delta, useNext);
    }
  },

  _applyDerivedTimerTick(game, delta, useNext) {
    if (!Number.isFinite(delta?.tick)) return;
    const timer = game?.getGameTimer?.();
    if (!timer) return;
    timer.tickIndex = Math.max(0, Math.trunc(delta.tick) + (useNext ? 1 : 0));
  },

  _getDeltaFlags(delta) {
    return ensureDeltaFlags(delta);
  },

  _createReplayLemming(manager, x, y, id) {
    if (!manager) return null;
    if (typeof manager._acquireLemming === 'function') {
      const lem = manager._acquireLemming(x, y, id);
      if (lem && typeof lem === 'object') return lem;
    } else if (typeof manager._lemmingCtor === 'function') {
      return new manager._lemmingCtor(x, y, id);
    }
    throw new Error('HistoryStore replay apply requires manager._acquireLemming() or manager._lemmingCtor.');
  },

  _applyLemmingAdds(manager, list) {
    if (!manager || !Array.isArray(list) || !list.length) return;
    const countdownAction = manager.skillActions?.[SkillTypes.BOMBER] ?? null;
    if (!Array.isArray(manager.lemmings)) manager.lemmings = [];
    for (const snap of list) {
      if (snap == null || !Number.isFinite(snap.id)) continue;
      let lem = manager.lemmings[snap.id];
      if (!lem) {
        lem = this._createReplayLemming(manager, snap.x, snap.y, snap.id);
        manager.lemmings[snap.id] = lem;
      }
      const action = snap.actionType >= 0 ? manager.actions?.[snap.actionType] : null;
      applyLemmingSnapshot(lem, snap, action, countdownAction);
    }
  },

  _applyLemmingRemovals(manager, list) {
    if (!manager || !Array.isArray(list) || !list.length) return;
    for (const snap of list) {
      if (snap == null || !Number.isFinite(snap.id)) continue;
      manager.lemmings[snap.id] = null;
    }
  },

  _applyLemmingChanges(manager, changes, useNext) {
    if (!manager || !changes?.ids?.length) return;
    const countdownAction = manager.skillActions?.[SkillTypes.BOMBER] ?? null;
    for (let i = 0; i < changes.ids.length; i++) {
      const id = changes.ids[i];
      const field = changes.fields[i];
      const value = useNext ? changes.next[i] : changes.prev[i];
      const lem = manager.lemmings?.[id];
      if (!lem) continue;
      switch (field) {
      case 0: lem.x = value; break;
      case 1: lem.y = value; break;
      case 2: lem.lookRight = !!value; break;
      case 3: lem.frameIndex = value; break;
      case 4: lem.state = value; break;
      case 5: lem.canClimb = !!value; break;
      case 6: lem.hasParachute = !!value; break;
      case 7: lem.removed = !!value; break;
      case 8: lem.disabled = !!value; break;
      case 9: lem.countdown = value; break;
      case 10: lem.hasExploded = !!value; break;
      case 11: lem.lastTriggerType = value >= 0 ? value : null; break;
      case 12: lem.action = value >= 0 ? manager.actions?.[value] : null; break;
      case 13: lem.countdownAction = value ? countdownAction : null; break;
      default: break;
      }
    }
  },

  _applyLemmingManagerState(manager, changes, useNext) {
    if (!manager || !changes) return;
    const state = useNext ? changes.next : changes.prev;
    if (!state) return;
    manager.selectedIndex = state.selectedIndex ?? -1;
    manager.spawnTotal = state.spawnTotal ?? 0;
    manager.releaseTickIndex = state.releaseTickIndex ?? 0;
    manager.mmTickCounter = state.mmTickCounter ?? 0;
    manager.nextNukingLemmingsIndex = state.nextNukingLemmingsIndex ?? -1;
    manager._nukeTargets = this._resolveNukeTargets(manager, state.nukeTargets);
  },

  _resolveNukeTargets(manager, ids) {
    if (!manager || !Array.isArray(ids)) return null;
    const lems = manager.lemmings || [];
    const resolved = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (!Number.isFinite(id)) continue;
      const lem = lems[id];
      if (lem) resolved.push(lem);
    }
    return resolved;
  },

  _rebuildActiveLemmings(manager) {
    if (!manager) return;
    const lems = manager.lemmings || [];
    const active = Array.isArray(manager.activeLemmings) ? manager.activeLemmings : [];
    active.length = 0;
    for (let i = 0; i < lems.length; i += 1) {
      const lem = lems[i];
      if (!lem || lem.removed) continue;
      lem._activeIndex = active.length;
      active.push(lem);
    }
    manager.activeLemmings = active;
    manager._activeDirty = false;
  },

  _applyEntranceChanges(level, changes, useNext) {
    if (!level || !changes?.indices?.length) return;
    for (let i = 0; i < changes.indices.length; i++) {
      const idx = changes.indices[i];
      const val = useNext ? changes.next[i] : changes.prev[i];
      if (level.entrances?.[idx]) {
        level.entrances[idx]._opened = !!val;
      }
    }
  },

  _applyGroundChanges(level, changes, useNext) {
    if (!level || !changes) return;
    const mask = level.groundMask?.mask;
    const img = level.groundImage;
    if (!mask || !img) return;
    const maskValues = useNext ? changes.nextMask : changes.prevMask;
    const redValues = useNext ? changes.nextR : changes.prevR;
    const greenValues = useNext ? changes.nextG : changes.prevG;
    const blueValues = useNext ? changes.nextB : changes.prevB;
    if (!maskValues || !redValues || !greenValues || !blueValues) return;
    const spans = changes.spans;
    if (spans?.starts?.length) {
      const starts = spans.starts;
      const lengths = spans.lengths;
      let valueIndex = 0;
      for (let i = 0; i < starts.length; i += 1) {
        let index = starts[i];
        let imgIndex = index << 2;
        const valueEnd = valueIndex + lengths[i];
        for (; valueIndex < valueEnd; valueIndex += 1, index += 1, imgIndex += 4) {
          mask[index] = maskValues[valueIndex];
          img[imgIndex] = redValues[valueIndex];
          img[imgIndex + 1] = greenValues[valueIndex];
          img[imgIndex + 2] = blueValues[valueIndex];
        }
      }
      return;
    }
    const indices = changes.indices;
    if (!indices?.length) return;
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      const imgIndex = index << 2;
      mask[index] = maskValues[i];
      img[imgIndex] = redValues[i];
      img[imgIndex + 1] = greenValues[i];
      img[imgIndex + 2] = blueValues[i];
    }
  },

  _applyTriggerChanges(game, delta, useNext) {
    const triggerManager = game?.triggerManager;
    if (!triggerManager || !delta) return;
    const adds = useNext ? delta.triggerAdd : delta.triggerRemove;
    const removes = useNext ? delta.triggerRemove : delta.triggerAdd;
    for (let i = 0; i < (removes?.length || 0); i += 1) {
      const snap = removes[i];
      const trig = this._findTriggerById(triggerManager, snap.id);
      if (this._isReplayManagedDynamicTrigger(trig)) {
        this._removeTriggerInstance(triggerManager, trig);
      }
    }
    for (let i = 0; i < (adds?.length || 0); i += 1) {
      const snap = adds[i];
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
      trig.disabledUntilTick = snap.disabledUntilTick ?? 0;
      trig.__historyId = snap.id;
      if (snap.observer === true && typeof triggerManager.addObserver === 'function') {
        triggerManager.addObserver(trig);
      } else {
        triggerManager.add(trig);
      }
      this._triggerById.set(snap.id, trig);
    }
    if (delta.triggerCooldownChanges?.ids?.length) {
      for (let i = 0; i < delta.triggerCooldownChanges.ids.length; i++) {
        const id = delta.triggerCooldownChanges.ids[i];
        const trig = this._findTriggerById(triggerManager, id);
        if (!trig) continue;
        const value = useNext
          ? delta.triggerCooldownChanges.next[i]
          : delta.triggerCooldownChanges.prev[i];
        trig.disabledUntilTick = value;
      }
    }
  },

  _findTriggerById(triggerManager, id) {
    if (!triggerManager || !id) return null;
    if (this._triggerById.has(id)) return this._triggerById.get(id);
    let found = null;
    const triggerSets = [triggerManager._triggers, triggerManager._observerTriggers];
    for (const triggerSet of triggerSets) {
      for (const trig of triggerSet || []) {
        const trigId = trig?.__historyId;
        if (!trigId) continue;
        this._triggerById.set(trigId, trig);
        if (trigId === id) {
          found = trig;
        }
      }
    }
    return found;
  },

  _applyObjectChanges(level, changes, useNext) {
    if (!level || !changes?.ids?.length) return;
    for (let i = 0; i < changes.ids.length; i++) {
      const id = changes.ids[i];
      let obj = this._objectById.get(id);
      if (!obj) {
        const objects = level.objects || [];
        for (const entry of objects) {
          if (!entry?.animation) continue;
          const entryId = this._ensureObjectId(entry);
          if (entryId === id) {
            obj = entry;
            break;
          }
        }
      }
      if (!obj?.animation) continue;
      const first = useNext ? changes.nextFirst[i] : changes.prevFirst[i];
      const finished = useNext ? changes.nextFinished[i] : changes.prevFinished[i];
      obj.animation.firstFrameIndex = first;
      obj.animation.isFinished = !!finished;
    }
  },

  _applyScalarChanges(game, delta, useNext) {
    const derivedTick = Number.isFinite(delta?.tick)
      ? Math.max(0, Math.trunc(delta.tick) + (useNext ? 1 : 0))
      : null;
    if (delta.victoryChanges) {
      const victory = game.getVictoryCondition?.();
      const state = useNext ? delta.victoryChanges.next : delta.victoryChanges.prev;
      if (victory && state) {
        victory.releaseRate = state.releaseRate;
        victory.minReleaseRate = state.minReleaseRate;
        victory.leftCount = state.leftCount;
        victory.outCount = state.outCount;
        victory.survivorCount = state.survivorCount;
        victory.isFinalize = !!state.isFinalize;
      }
    }
    if (delta.skillsChanges) {
      const skills = game.getGameSkills?.();
      const state = useNext ? delta.skillsChanges.next : delta.skillsChanges.prev;
      if (skills && state) {
        skills.selectedSkill = state.selectedSkill;
        skills.cheatMode = !!state.cheatMode;
        skills.skills = state.skills.slice();
      }
    }
    if (delta.timerChanges) {
      const timer = game.getGameTimer?.();
      const state = useNext ? delta.timerChanges.next : delta.timerChanges.prev;
      if (timer && state) {
        const ignoreSpeed = !useNext && !!game?.timeTravel?.ignoreSpeedOnReverse;
        if (!ignoreSpeed) {
          timer.speedFactor = state.speedFactor;
        }
        timer.frameTime = state.frameTime;
        timer.tickIndex = Number.isFinite(state.tickIndex) ? state.tickIndex : derivedTick;
      }
    } else if (derivedTick != null) {
      const timer = game.getGameTimer?.();
      if (timer) timer.tickIndex = derivedTick;
    }
    if (delta.gameChanges) {
      const state = useNext ? delta.gameChanges.next : delta.gameChanges.prev;
      if (state) game.finalGameState = state.finalGameState;
    }
  },

  _applyMinimapDeaths(manager, entries, useNext) {
    const miniMap = manager?.miniMap;
    if (!miniMap || !entries?.length) return;
    if (useNext) {
      for (const entry of entries) {
        const idx = entry.prevCount ?? miniMap.deadCount ?? 0;
        const neededDots = (idx + 1) * 2;
        if (miniMap.deadDots.length < neededDots) {
          const next = Math.max(4, miniMap.deadDots.length * 2, neededDots);
          const coords = new Uint8Array(next);
          coords.set(miniMap.deadDots);
          miniMap.deadDots = coords;
        }
        if (miniMap.deadTTLs.length < idx + 1) {
          const next = Math.max(4, miniMap.deadTTLs.length * 2, idx + 1);
          const ttls = new Uint8Array(next);
          ttls.set(miniMap.deadTTLs);
          miniMap.deadTTLs = ttls;
        }
        miniMap.deadDots[idx * 2] = entry.x ?? 0;
        miniMap.deadDots[idx * 2 + 1] = entry.y ?? 0;
        miniMap.deadTTLs[idx] = entry.ttl ?? 0;
        miniMap.deadCount = Math.max(miniMap.deadCount ?? 0, idx + 1);
      }
      return;
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const prevCount = entry.prevCount ?? 0;
      miniMap.deadCount = prevCount;
    }
  },
};

export { historyStoreApplyDeltaMethods };
