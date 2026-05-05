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

const historyStoreDiffMethods = {
  _captureKeyframe(game, tickIndex) {
    const lemmingManager = game.getLemmingManager?.();
    const lemmings = lemmingManager?.lemmings || [];
    const lemmingState = cloneLemmingState(this._lemmingState, lemmings.length || 0);
    const lemmingManagerState = this._readLemmingManager(lemmingManager);
    const entrances = game.level?.entrances || [];
    const entranceOpened = new Uint8Array(entrances.length);
    for (let i = 0; i < entrances.length; i++) {
      entranceOpened[i] = entrances[i]?._opened ? 1 : 0;
    }
    const triggerState = this._readTriggerState(game);
    const objectState = this._readObjectState(game.level);
    const minimapState = this._readMinimapState(lemmingManager?.miniMap);
    const victory = this._readVictory(game.getVictoryCondition?.());
    const skills = this._readSkills(game.getGameSkills?.());
    const timer = this._readTimer(game.getGameTimer?.(), { includeTickIndex: true });
    const gameState = this._readGameState(game);
    const level = game.level || null;
    let groundMask = null;
    let groundImage = null;
    if (level?.groundMask?.mask && level?.groundImage) {
      if (!this._groundDirty &&
            this._lastKeyframe?.groundMask &&
            this._lastKeyframe?.groundImage) {
        groundMask = this._lastKeyframe.groundMask;
        groundImage = this._lastKeyframe.groundImage;
      } else {
        groundMask = new Uint8Array(level.groundMask.mask);
        groundImage = new Uint8ClampedArray(level.groundImage);
      }
    }
    this._groundDirty = false;
    return {
      tickIndex,
      lemmingState,
      lemmingManagerState,
      entranceOpened,
      triggerState,
      objectState,
      minimapState,
      victory,
      skills,
      timer,
      gameState,
      groundMask,
      groundImage
    };
  },

  _diffState(game, delta) {
    const manager = game.getLemmingManager?.();
    this._diffLemmings(manager, delta);
    this._diffLemmingManager(manager, delta);
    this._diffEntrances(game.level, delta);
    this._diffScalarState(game, delta);
  },

  _captureLemmingState(manager) {
    if (!manager) return;
    const lems = manager.lemmings || [];
    this._lemmingState = ensureLemmingCapacity(this._lemmingState, lems.length);
    for (let i = 0; i < lems.length; i++) {
      const lem = lems[i];
      if (!lem) {
        this._lemmingState.present[i] = 0;
        continue;
      }
      const actionType = this._getActionType(manager, lem.action);
      const countdownActive = !!lem.countdownAction;
      this._writeLemmingState(this._lemmingState, i, lem, actionType, countdownActive);
    }
  },

  _diffLemmings(manager, delta) {
    if (!manager) return;
    const lems = manager.lemmings || [];
    this._lemmingState = ensureLemmingCapacity(this._lemmingState, lems.length);
    const prev = this._lemmingState;
    for (let i = 0; i < lems.length; i++) {
      const lem = lems[i];
      if (!lem) {
        if (prev.present[i]) {
          const snap = {
            id: i,
            x: prev.x[i],
            y: prev.y[i],
            lookRight: prev.lookRight[i],
            frameIndex: prev.frameIndex[i],
            state: prev.state[i],
            canClimb: prev.canClimb[i],
            hasParachute: prev.hasParachute[i],
            removed: prev.removed[i],
            disabled: prev.disabled[i],
            countdown: prev.countdown[i],
            hasExploded: prev.hasExploded[i],
            lastTriggerType: prev.lastTriggerType[i],
            actionType: prev.actionType[i],
            countdownActive: prev.countdownActive[i]
          };
          delta.lemRemoved.push(snap);
          prev.present[i] = 0;
        }
        continue;
      }
  
      const actionType = this._getActionType(manager, lem.action);
      const countdownActive = !!lem.countdownAction;
      const lookRight = lem.lookRight ? 1 : 0;
      const state = lem.state ?? 0;
      const canClimb = lem.canClimb ? 1 : 0;
      const hasParachute = lem.hasParachute ? 1 : 0;
      const removed = lem.removed ? 1 : 0;
      const disabled = lem.disabled ? 1 : 0;
      const countdown = lem.countdown ?? 0;
      const hasExploded = lem.hasExploded ? 1 : 0;
      const lastTriggerType = Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1;
      const countdownActiveValue = countdownActive ? 1 : 0;
      if (!prev.present[i]) {
        delta.lemAdded.push(snapshotLemming(lem, actionType, countdownActive));
        this._writeLemmingState(prev, i, lem, actionType, countdownActive);
        continue;
      }
  
      if (
        prev.x[i] === lem.x &&
          prev.y[i] === lem.y &&
          prev.lookRight[i] === lookRight &&
          prev.frameIndex[i] === lem.frameIndex &&
          prev.state[i] === state &&
          prev.canClimb[i] === canClimb &&
          prev.hasParachute[i] === hasParachute &&
          prev.removed[i] === removed &&
          prev.disabled[i] === disabled &&
          prev.countdown[i] === countdown &&
          prev.hasExploded[i] === hasExploded &&
          prev.lastTriggerType[i] === lastTriggerType &&
          prev.actionType[i] === actionType &&
          prev.countdownActive[i] === countdownActiveValue
      ) {
        prev.present[i] = 1;
        continue;
      }
  
      this._diffLemmingField(delta, i, 0, prev.x[i], lem.x, prev.x);
      this._diffLemmingField(delta, i, 1, prev.y[i], lem.y, prev.y);
      this._diffLemmingField(delta, i, 2, prev.lookRight[i], lookRight, prev.lookRight);
      this._diffLemmingField(delta, i, 3, prev.frameIndex[i], lem.frameIndex, prev.frameIndex);
      this._diffLemmingField(delta, i, 4, prev.state[i], state, prev.state);
      this._diffLemmingField(delta, i, 5, prev.canClimb[i], canClimb, prev.canClimb);
      this._diffLemmingField(delta, i, 6, prev.hasParachute[i], hasParachute, prev.hasParachute);
      this._diffLemmingField(delta, i, 7, prev.removed[i], removed, prev.removed);
      this._diffLemmingField(delta, i, 8, prev.disabled[i], disabled, prev.disabled);
      this._diffLemmingField(delta, i, 9, prev.countdown[i], countdown, prev.countdown);
      this._diffLemmingField(delta, i, 10, prev.hasExploded[i], hasExploded, prev.hasExploded);
      this._diffLemmingField(delta, i, 11, prev.lastTriggerType[i], lastTriggerType, prev.lastTriggerType);
      this._diffLemmingField(delta, i, 12, prev.actionType[i], actionType, prev.actionType);
      this._diffLemmingField(delta, i, 13, prev.countdownActive[i], countdownActiveValue, prev.countdownActive);
      prev.present[i] = 1;
    }
  
    for (let i = lems.length; i < prev.present.length; i++) {
      if (prev.present[i]) {
        const snap = {
          id: i,
          x: prev.x[i],
          y: prev.y[i],
          lookRight: prev.lookRight[i],
          frameIndex: prev.frameIndex[i],
          state: prev.state[i],
          canClimb: prev.canClimb[i],
          hasParachute: prev.hasParachute[i],
          removed: prev.removed[i],
          disabled: prev.disabled[i],
          countdown: prev.countdown[i],
          hasExploded: prev.hasExploded[i],
          lastTriggerType: prev.lastTriggerType[i],
          actionType: prev.actionType[i],
          countdownActive: prev.countdownActive[i]
        };
        delta.lemRemoved.push(snap);
        prev.present[i] = 0;
      }
    }
  },

  _diffLemmingManager(manager, delta) {
    const next = this._readLemmingManager(manager);
    if (this._lemmingManagerState && next && !this._lemmingManagerEqual(this._lemmingManagerState, next)) {
      delta.lemmingManagerChanges = { prev: this._lemmingManagerState, next };
    }
    this._lemmingManagerState = next;
  },

  _readLemmingManager(manager) {
    if (!manager) return null;
    const sourceTargets = manager._nukeTargets;
    let targets = null;
    if (Array.isArray(sourceTargets)) {
      targets = new Array(sourceTargets.length);
      for (let i = 0; i < sourceTargets.length; i += 1) {
        targets[i] = sourceTargets[i]?.id ?? null;
      }
    }
    return {
      selectedIndex: manager.selectedIndex,
      spawnTotal: manager.spawnTotal,
      releaseTickIndex: manager.releaseTickIndex,
      mmTickCounter: manager.mmTickCounter,
      nextNukingLemmingsIndex: manager.nextNukingLemmingsIndex,
      nukeTargets: targets
    };
  },

  _lemmingManagerEqual(a, b) {
    if (!a || !b) return false;
    if (a.selectedIndex !== b.selectedIndex) return false;
    if (a.spawnTotal !== b.spawnTotal) return false;
    if (a.releaseTickIndex !== b.releaseTickIndex) return false;
    if (a.mmTickCounter !== b.mmTickCounter) return false;
    if (a.nextNukingLemmingsIndex !== b.nextNukingLemmingsIndex) return false;
    const aa = a.nukeTargets || [];
    const bb = b.nukeTargets || [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  },

  _diffLemmingField(delta, id, field, prevValue, nextValue, store) {
    if (prevValue === nextValue) return;
    delta.lemChanges.ids.push(id);
    delta.lemChanges.fields.push(field);
    delta.lemChanges.prev.push(prevValue);
    delta.lemChanges.next.push(nextValue);
    store[id] = nextValue;
  },

  _writeLemmingState(state, index, lem, actionType, countdownActive) {
    state.present[index] = 1;
    state.x[index] = lem.x;
    state.y[index] = lem.y;
    state.lookRight[index] = lem.lookRight ? 1 : 0;
    state.frameIndex[index] = lem.frameIndex;
    state.state[index] = lem.state ?? 0;
    state.canClimb[index] = lem.canClimb ? 1 : 0;
    state.hasParachute[index] = lem.hasParachute ? 1 : 0;
    state.removed[index] = lem.removed ? 1 : 0;
    state.disabled[index] = lem.disabled ? 1 : 0;
    state.countdown[index] = lem.countdown ?? 0;
    state.hasExploded[index] = lem.hasExploded ? 1 : 0;
    state.lastTriggerType[index] = Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1;
    state.actionType[index] = Number.isFinite(actionType) ? actionType : -1;
    state.countdownActive[index] = countdownActive ? 1 : 0;
  },

  _getActionType(manager, action) {
    if (!action || !manager) return -1;
    if (manager.actionTypeByAction?.has(action)) {
      return manager.actionTypeByAction.get(action);
    }
    const actions = manager.actions || [];
    for (let i = 0; i < actions.length; i++) {
      if (actions[i] === action) return i;
    }
    return -1;
  },

  _captureEntrances(level) {
    const entrances = level?.entrances || [];
    this._entranceOpened = new Uint8Array(entrances.length);
    for (let i = 0; i < entrances.length; i++) {
      this._entranceOpened[i] = entrances[i]?._opened ? 1 : 0;
    }
  },

  _diffEntrances(level, delta) {
    const entrances = level?.entrances || [];
    if (this._entranceOpened.length !== entrances.length) {
      this._captureEntrances(level);
      return;
    }
    for (let i = 0; i < entrances.length; i++) {
      const opened = entrances[i]?._opened ? 1 : 0;
      if (this._entranceOpened[i] !== opened) {
        delta.entranceChanges.indices.push(i);
        delta.entranceChanges.prev.push(this._entranceOpened[i]);
        delta.entranceChanges.next.push(opened);
        this._entranceOpened[i] = opened;
      }
    }
  },

  _captureScalarState(game) {
    this._skillsState = this._readSkills(game.getGameSkills?.(), this._skillsState);
    this._victoryState = this._readVictory(game.getVictoryCondition?.());
    this._timerState = this._readTimer(game.getGameTimer?.());
    this._gameState = this._readGameState(game);
  },

  _diffScalarState(game, delta) {
    const nextSkills = this._readSkills(game.getGameSkills?.(), this._skillsState);
    if (this._skillsState && nextSkills && this._skillsState !== nextSkills) {
      delta.skillsChanges = { prev: this._skillsState, next: nextSkills };
    }
    this._skillsState = nextSkills;
  
    const nextVictory = this._readVictory(game.getVictoryCondition?.());
    if (this._victoryState && nextVictory && !this._victoryEqual(this._victoryState, nextVictory)) {
      delta.victoryChanges = { prev: this._victoryState, next: nextVictory };
    }
    this._victoryState = nextVictory;
  
    const nextTimer = this._readTimer(game.getGameTimer?.());
    if (this._timerState && nextTimer && !this._timerEqual(this._timerState, nextTimer)) {
      delta.timerChanges = { prev: this._timerState, next: nextTimer };
    }
    this._timerState = nextTimer;
  
    const nextGame = this._readGameState(game);
    if (this._gameState && nextGame && !this._gameStateEqual(this._gameState, nextGame)) {
      delta.gameChanges = { prev: this._gameState, next: nextGame };
    }
    this._gameState = nextGame;
  },

  _readSkills(skills, previous = null) {
    if (!skills) return null;
    const source = Array.isArray(skills.skills) ? skills.skills : [];
    if (
      previous &&
        previous.selectedSkill === skills.selectedSkill &&
        !!previous.cheatMode === !!skills.cheatMode
    ) {
      const prevValues = previous.skills || [];
      if (prevValues.length === source.length) {
        let same = true;
        for (let i = 0; i < source.length; i += 1) {
          if (prevValues[i] !== source[i]) {
            same = false;
            break;
          }
        }
        if (same) return previous;
      }
    }
    return {
      selectedSkill: skills.selectedSkill,
      cheatMode: !!skills.cheatMode,
      skills: source.slice()
    };
  },

  _skillsEqual(a, b) {
    if (!a || !b) return false;
    if (a.selectedSkill !== b.selectedSkill) return false;
    if (!!a.cheatMode !== !!b.cheatMode) return false;
    const aa = a.skills || [];
    const bb = b.skills || [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  },

  _readVictory(victory) {
    if (!victory) return null;
    return {
      releaseRate: victory.releaseRate,
      minReleaseRate: victory.minReleaseRate,
      leftCount: victory.leftCount,
      outCount: victory.outCount,
      survivorCount: victory.survivorCount,
      isFinalize: !!victory.isFinalize
    };
  },

  _victoryEqual(a, b) {
    if (!a || !b) return false;
    return a.releaseRate === b.releaseRate
        && a.minReleaseRate === b.minReleaseRate
        && a.leftCount === b.leftCount
        && a.outCount === b.outCount
        && a.survivorCount === b.survivorCount
        && !!a.isFinalize === !!b.isFinalize;
  },

  _readTimer(timer, { includeTickIndex = false } = {}) {
    if (!timer) return null;
    const state = {
      speedFactor: timer.speedFactor,
      frameTime: timer.frameTime
    };
    if (includeTickIndex) {
      state.tickIndex = timer.tickIndex;
    }
    return state;
  },

  _timerEqual(a, b) {
    if (!a || !b) return false;
    return a.speedFactor === b.speedFactor
        && a.frameTime === b.frameTime;
  },

  _readGameState(game) {
    if (!game) return null;
    return { finalGameState: game.finalGameState };
  },

  _gameStateEqual(a, b) {
    if (!a || !b) return false;
    return a.finalGameState === b.finalGameState;
  },
};

export { historyStoreDiffMethods };
