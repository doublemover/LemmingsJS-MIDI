import { SkillTypes } from './SkillTypes.js';
import { Trigger } from '../level/Trigger.js';

const DEFAULT_OPTIONS = Object.freeze({
  keyframeInterval: 120
});

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

const createDelta = (tick) => ({
  tick,
  lemChanges: { ids: [], fields: [], prev: [], next: [] },
  lemAdded: [],
  lemRemoved: [],
  lemmingManagerChanges: null,
  groundChanges: { indices: [], prevMask: [], prevR: [], prevG: [], prevB: [], nextMask: [], nextR: [], nextG: [], nextB: [] },
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

class HistoryStore {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.keyframes = new Map();
    this.deltas = new Map();
    this._recording = false;
    this._currentTick = null;
    this._currentDelta = null;
    this._lemmingState = createLemmingState(0);
    this._lemmingManagerState = null;
    this._entranceOpened = new Uint8Array(0);
    this._skillsState = null;
    this._victoryState = null;
    this._timerState = null;
    this._gameState = null;
    this._nextTriggerId = 1;
    this._triggerIds = new Map();
    this._triggerById = new Map();
    this._nextObjectId = 1;
    this._objectIds = new Map();
    this._objectById = new Map();
    this.game = null;
    this.timer = null;
    this._beforeTick = null;
    this._afterTick = null;
  }

  attach(game, { captureBaseline = true } = {}) {
    if (!game) return;
    this.game = game;
    this.timer = game.getGameTimer?.() || null;
    this._bindTimer();
    if (captureBaseline) {
      this.start();
    }
  }

  detach() {
    if (this.timer?.onBeforeGameTick && this._beforeTick) {
      this.timer.onBeforeGameTick.off(this._beforeTick);
    }
    if (this.timer?.onGameTick && this._afterTick) {
      this.timer.onGameTick.off(this._afterTick);
    }
    this._beforeTick = null;
    this._afterTick = null;
    this._recording = false;
    this.game = null;
    this.timer = null;
  }

  start() {
    if (!this.game) return;
    this.captureBaseline(this.game);
    this._recording = true;
  }

  _bindTimer() {
    if (!this.timer) return;
    this._beforeTick = (tick) => this.beginTick(tick);
    this._afterTick = () => this.endTick();
    this.timer.onBeforeGameTick?.on(this._beforeTick);
    this.timer.onGameTick?.on(this._afterTick);
  }

  beginTick(tick) {
    if (!this._recording) return;
    this._currentTick = tick;
    this._currentDelta = createDelta(tick);
  }

  endTick() {
    if (!this._recording || !this.game || !this._currentDelta) return;
    const tick = this._currentTick;
    this._diffState(this.game, this._currentDelta);
    this.deltas.set(tick, this._currentDelta);
    if ((tick % this.options.keyframeInterval) === 0) {
      this.keyframes.set(tick, this._captureKeyframe(this.game, tick));
    }
    this._currentDelta = null;
  }

  captureBaseline(game) {
    if (!game) return;
    this._captureScalarState(game);
    const manager = game.getLemmingManager?.();
    this._captureLemmingState(manager);
    this._lemmingManagerState = this._readLemmingManager(manager);
    this._captureEntrances(game.level);
  }

  recordSoundEvent(event) {
    if (!this._currentDelta) return;
    this._currentDelta.soundEvents.push(event);
  }

  recordGroundChange(index, prevMask, prevR, prevG, prevB, nextMask, nextR, nextG, nextB) {
    if (!this._currentDelta) return;
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
  }

  recordEntranceChange(index, prev, next) {
    if (!this._currentDelta) return;
    const changes = this._currentDelta.entranceChanges;
    changes.indices.push(index);
    changes.prev.push(prev ? 1 : 0);
    changes.next.push(next ? 1 : 0);
  }

  recordTriggerCooldown(trigger, prev, next) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    const changes = this._currentDelta.triggerCooldownChanges;
    changes.ids.push(id);
    changes.prev.push(prev);
    changes.next.push(next);
  }

  recordTriggerAdd(trigger, snapshot) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    this._currentDelta.triggerAdd.push({ id, ...snapshot });
  }

  recordTriggerRemove(trigger, snapshot) {
    if (!this._currentDelta) return;
    const id = this._ensureTriggerId(trigger);
    this._currentDelta.triggerRemove.push({ id, ...snapshot });
  }

  recordObjectAnimation(obj, prev, next) {
    if (!this._currentDelta) return;
    const id = this._ensureObjectId(obj);
    const changes = this._currentDelta.objectAnimChanges;
    changes.ids.push(id);
    changes.prevFirst.push(prev.firstFrameIndex);
    changes.prevFinished.push(prev.isFinished ? 1 : 0);
    changes.nextFirst.push(next.firstFrameIndex);
    changes.nextFinished.push(next.isFinished ? 1 : 0);
  }

  recordMinimapDeath(entry) {
    if (!this._currentDelta) return;
    this._currentDelta.minimapDeaths.push(entry);
  }

  _ensureTriggerId(trigger) {
    if (!trigger) return 0;
    if (trigger.__historyId) return trigger.__historyId;
    const id = this._nextTriggerId++;
    trigger.__historyId = id;
    this._triggerIds.set(trigger, id);
    this._triggerById.set(id, trigger);
    return id;
  }

  _ensureObjectId(obj) {
    if (!obj) return 0;
    if (obj.__historyId) return obj.__historyId;
    const id = this._nextObjectId++;
    obj.__historyId = id;
    this._objectIds.set(obj, id);
    this._objectById.set(id, obj);
    return id;
  }

  _captureKeyframe(game, tick) {
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
    const timer = this._readTimer(game.getGameTimer?.());
    const gameState = this._readGameState(game);
    const level = game.level || null;
    const groundMask = level?.groundMask?.mask ? new Uint8Array(level.groundMask.mask) : null;
    const groundImage = level?.groundImage ? new Uint8ClampedArray(level.groundImage) : null;
    return {
      tick,
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
  }

  _diffState(game, delta) {
    const manager = game.getLemmingManager?.();
    this._diffLemmings(manager, delta);
    this._diffLemmingManager(manager, delta);
    this._diffEntrances(game.level, delta);
    this._diffScalarState(game, delta);
  }

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
  }

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
      if (!prev.present[i]) {
        delta.lemAdded.push(snapshotLemming(lem, actionType, countdownActive));
        this._writeLemmingState(prev, i, lem, actionType, countdownActive);
        continue;
      }

      this._diffLemmingField(delta, i, 0, prev.x[i], lem.x, prev.x);
      this._diffLemmingField(delta, i, 1, prev.y[i], lem.y, prev.y);
      this._diffLemmingField(delta, i, 2, prev.lookRight[i], lem.lookRight ? 1 : 0, prev.lookRight);
      this._diffLemmingField(delta, i, 3, prev.frameIndex[i], lem.frameIndex, prev.frameIndex);
      this._diffLemmingField(delta, i, 4, prev.state[i], lem.state ?? 0, prev.state);
      this._diffLemmingField(delta, i, 5, prev.canClimb[i], lem.canClimb ? 1 : 0, prev.canClimb);
      this._diffLemmingField(delta, i, 6, prev.hasParachute[i], lem.hasParachute ? 1 : 0, prev.hasParachute);
      this._diffLemmingField(delta, i, 7, prev.removed[i], lem.removed ? 1 : 0, prev.removed);
      this._diffLemmingField(delta, i, 8, prev.disabled[i], lem.disabled ? 1 : 0, prev.disabled);
      this._diffLemmingField(delta, i, 9, prev.countdown[i], lem.countdown ?? 0, prev.countdown);
      this._diffLemmingField(delta, i, 10, prev.hasExploded[i], lem.hasExploded ? 1 : 0, prev.hasExploded);
      this._diffLemmingField(delta, i, 11, prev.lastTriggerType[i], Number.isFinite(lem.lastTriggerType) ? lem.lastTriggerType : -1, prev.lastTriggerType);
      this._diffLemmingField(delta, i, 12, prev.actionType[i], actionType, prev.actionType);
      this._diffLemmingField(delta, i, 13, prev.countdownActive[i], countdownActive ? 1 : 0, prev.countdownActive);
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
  }

  _diffLemmingManager(manager, delta) {
    const next = this._readLemmingManager(manager);
    if (this._lemmingManagerState && next && !this._lemmingManagerEqual(this._lemmingManagerState, next)) {
      delta.lemmingManagerChanges = { prev: this._lemmingManagerState, next };
    }
    this._lemmingManagerState = next;
  }

  _readLemmingManager(manager) {
    if (!manager) return null;
    const targets = Array.isArray(manager._nukeTargets)
      ? manager._nukeTargets.map(lem => (lem?.id ?? null))
      : null;
    return {
      selectedIndex: manager.selectedIndex,
      spawnTotal: manager.spawnTotal,
      releaseTickIndex: manager.releaseTickIndex,
      mmTickCounter: manager.mmTickCounter,
      nextNukingLemmingsIndex: manager.nextNukingLemmingsIndex,
      nukeTargets: targets
    };
  }

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
  }

  _diffLemmingField(delta, id, field, prevValue, nextValue, store) {
    if (prevValue === nextValue) return;
    delta.lemChanges.ids.push(id);
    delta.lemChanges.fields.push(field);
    delta.lemChanges.prev.push(prevValue);
    delta.lemChanges.next.push(nextValue);
    store[id] = nextValue;
  }

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
  }

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
  }

  _captureEntrances(level) {
    const entrances = level?.entrances || [];
    this._entranceOpened = new Uint8Array(entrances.length);
    for (let i = 0; i < entrances.length; i++) {
      this._entranceOpened[i] = entrances[i]?._opened ? 1 : 0;
    }
  }

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
  }

  _captureScalarState(game) {
    this._skillsState = this._readSkills(game.getGameSkills?.());
    this._victoryState = this._readVictory(game.getVictoryCondition?.());
    this._timerState = this._readTimer(game.getGameTimer?.());
    this._gameState = this._readGameState(game);
  }

  _diffScalarState(game, delta) {
    const nextSkills = this._readSkills(game.getGameSkills?.());
    if (this._skillsState && nextSkills && !this._skillsEqual(this._skillsState, nextSkills)) {
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
  }

  _readSkills(skills) {
    if (!skills) return null;
    const values = Array.isArray(skills.skills) ? skills.skills.slice() : [];
    return {
      selectedSkill: skills.selectedSkill,
      cheatMode: !!skills.cheatMode,
      skills: values
    };
  }

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
  }

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
  }

  _victoryEqual(a, b) {
    if (!a || !b) return false;
    return a.releaseRate === b.releaseRate
      && a.minReleaseRate === b.minReleaseRate
      && a.leftCount === b.leftCount
      && a.outCount === b.outCount
      && a.survivorCount === b.survivorCount
      && !!a.isFinalize === !!b.isFinalize;
  }

  _readTimer(timer) {
    if (!timer) return null;
    return {
      speedFactor: timer.speedFactor,
      frameTime: timer.frameTime,
      tickIndex: timer.tickIndex
    };
  }

  _timerEqual(a, b) {
    if (!a || !b) return false;
    return a.speedFactor === b.speedFactor
      && a.frameTime === b.frameTime
      && a.tickIndex === b.tickIndex;
  }

  _readGameState(game) {
    if (!game) return null;
    return { finalGameState: game.finalGameState };
  }

  _gameStateEqual(a, b) {
    if (!a || !b) return false;
    return a.finalGameState === b.finalGameState;
  }

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
          const ctor = manager._lemmingCtor || globalThis.lemmings?.Lemming || null;
          lem = ctor ? new ctor(state.x[i], state.y[i], i) : { id: i };
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
      manager.activeLemmings = manager.lemmings.filter(lem => lem && !lem.removed);
      for (let i = 0; i < manager.activeLemmings.length; i++) {
        manager.activeLemmings[i]._activeIndex = i;
      }
      manager._activeDirty = false;
    }

    if (manager && keyframe.lemmingManagerState) {
      const state = keyframe.lemmingManagerState;
      manager.selectedIndex = state.selectedIndex ?? -1;
      manager.spawnTotal = state.spawnTotal ?? 0;
      manager.releaseTickIndex = state.releaseTickIndex ?? 0;
      manager.mmTickCounter = state.mmTickCounter ?? 0;
      manager.nextNukingLemmingsIndex = state.nextNukingLemmingsIndex ?? -1;
      if (Array.isArray(state.nukeTargets)) {
        manager._nukeTargets = state.nukeTargets
          .map(id => (Number.isFinite(id) ? manager.lemmings[id] : null))
          .filter(Boolean);
      } else {
        manager._nukeTargets = null;
      }
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
        timer.speedFactor = keyframe.timer.speedFactor;
        timer.tickIndex = keyframe.timer.tickIndex;
      }
    }

    if (keyframe.gameState) {
      game.finalGameState = keyframe.gameState.finalGameState;
    }

    this.captureBaseline(game);
  }

  _readTriggerState(game) {
    const triggerManager = game?.triggerManager;
    const level = game?.level;
    if (!triggerManager || !level) return null;
    const staticTriggers = [];
    const dynamicTriggers = [];
    const levelTriggers = level.triggers || [];
    const staticSet = new Set(levelTriggers);
    for (let i = 0; i < levelTriggers.length; i++) {
      const trig = levelTriggers[i];
      if (!trig) continue;
      const id = this._ensureTriggerId(trig);
      staticTriggers.push({ id, disabledUntilTick: trig.disabledUntilTick });
    }
    for (const trig of triggerManager._triggers || []) {
      if (!trig || staticSet.has(trig)) continue;
      const ownerId = Number.isFinite(trig.owner?.id) ? trig.owner.id : null;
      if (ownerId == null) continue;
      const id = this._ensureTriggerId(trig);
      dynamicTriggers.push({
        id,
        ownerId,
        type: trig.type,
        x1: trig.x1,
        y1: trig.y1,
        x2: trig.x2,
        y2: trig.y2,
        disableTicksCount: trig.disableTicksCount,
        soundIndex: trig.soundIndex,
        disabledUntilTick: trig.disabledUntilTick
      });
    }
    return { staticTriggers, dynamicTriggers };
  }

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
    if (dynamic.length) {
      const removeOwners = new Set();
      for (const trig of triggerManager._triggers || []) {
        const ownerId = Number.isFinite(trig.owner?.id) ? trig.owner.id : null;
        if (ownerId != null) removeOwners.add(ownerId);
      }
      for (const ownerId of removeOwners) {
        const owner = game.getLemmingManager?.()?.getLemming?.(ownerId) ?? null;
        if (owner) triggerManager.removeByOwner(owner);
      }
      for (const snap of dynamic) {
        const owner = game.getLemmingManager?.()?.getLemming?.(snap.ownerId) ?? null;
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
        triggerManager.add(trig);
      }
    }
  }

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
  }

  _applyObjectState(level, state) {
    const objects = level?.objects || [];
    const byId = new Map();
    for (const obj of objects) {
      if (!obj?.animation) continue;
      const id = this._ensureObjectId(obj);
      byId.set(id, obj);
    }
    for (const entry of state || []) {
      const obj = byId.get(entry.id);
      if (!obj?.animation) continue;
      obj.animation.firstFrameIndex = entry.firstFrameIndex;
      obj.animation.isFinished = !!entry.isFinished;
    }
  }

  _readMinimapState(miniMap) {
    if (!miniMap) return null;
    return {
      deadDots: new Uint8Array(miniMap.deadDots || []),
      deadTTLs: new Uint8Array(miniMap.deadTTLs || []),
      deadCount: miniMap.deadCount ?? 0
    };
  }
}

export { HistoryStore };
