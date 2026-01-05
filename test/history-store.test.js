import { expect } from 'chai';
import { HistoryStore, __test__ } from '../js/game/HistoryStore.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { EventHandler } from '../js/util/EventHandler.js';

const createStubTimer = () => ({
  tickIndex: 0,
  speedFactor: 1,
  frameTime: 60,
  onBeforeGameTick: { on() {}, off() {} },
  onGameTick: { on() {}, off() {} }
});

const createHistoryFixture = () => {
  const timer = createStubTimer();
  const walkAction = { name: 'walk' };
  const bomberAction = { name: 'bomber' };
  const lemming = {
    id: 0,
    x: 5,
    y: 6,
    lookRight: true,
    frameIndex: 0,
    state: 1,
    canClimb: false,
    hasParachute: false,
    removed: false,
    disabled: false,
    countdown: 0,
    hasExploded: false,
    lastTriggerType: null,
    action: walkAction,
    countdownAction: null
  };
  const skillActions = [];
  skillActions[SkillTypes.BOMBER] = bomberAction;
  const manager = {
    lemmings: [lemming],
    activeLemmings: [lemming],
    _activeDirty: false,
    actions: [walkAction],
    skillActions,
    actionTypeByAction: new Map([[walkAction, 0]]),
    selectedIndex: -1,
    spawnTotal: 1,
    releaseTickIndex: 0,
    mmTickCounter: 0,
    nextNukingLemmingsIndex: -1,
    _nukeTargets: null,
    miniMap: null,
    getLemming: (id) => manager.lemmings[id] ?? null
  };
  const skills = { selectedSkill: 0, cheatMode: false, skills: [1] };
  const victory = {
    releaseRate: 1,
    minReleaseRate: 1,
    leftCount: 1,
    outCount: 0,
    survivorCount: 0,
    isFinalize: false
  };
  const level = {
    entrances: [{ _opened: false }],
    groundMask: { mask: new Uint8Array(4) },
    groundImage: new Uint8ClampedArray(16),
    objects: [],
    triggers: []
  };
  const triggerManager = {
    _triggers: new Set(),
    add(trigger) { this._triggers.add(trigger); },
    removeByOwner(owner) {
      for (const trig of Array.from(this._triggers)) {
        if (trig.owner === owner) this._triggers.delete(trig);
      }
    }
  };
  const game = {
    level,
    triggerManager,
    finalGameState: 0,
    getLemmingManager: () => manager,
    getGameTimer: () => timer,
    getGameSkills: () => skills,
    getVictoryCondition: () => victory
  };
  const history = new HistoryStore({ keyframeInterval: 5 });
  history.attach(game, { captureBaseline: true });
  return {
    history,
    game,
    timer,
    manager,
    skills,
    victory,
    level,
    triggerManager,
    lemming,
    walkAction,
    bomberAction
  };
};

describe('HistoryStore', function() {
  it('captures lemming deltas and can replay them', function() {
    const timer = { tickIndex: 0, speedFactor: 1, frameTime: 60 };
    const walkAction = { name: 'walk' };
    const bomberAction = { name: 'bomber' };
    const lemming = {
      id: 0,
      x: 5,
      y: 6,
      lookRight: true,
      frameIndex: 0,
      state: 1,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: null,
      action: walkAction,
      countdownAction: null
    };
    const skillActions = [];
    skillActions[SkillTypes.BOMBER] = bomberAction;
    const manager = {
      lemmings: [lemming],
      activeLemmings: [lemming],
      _activeDirty: false,
      actions: [walkAction],
      skillActions,
      actionTypeByAction: new Map([[walkAction, 0]]),
      selectedIndex: -1,
      spawnTotal: 1,
      releaseTickIndex: 0,
      mmTickCounter: 0,
      nextNukingLemmingsIndex: -1,
      _nukeTargets: null
    };
    const skills = { selectedSkill: 0, cheatMode: false, skills: [1] };
    const victory = {
      releaseRate: 1,
      minReleaseRate: 1,
      leftCount: 1,
      outCount: 0,
      survivorCount: 0,
      isFinalize: false
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => skills,
      getVictoryCondition: () => victory
    };

    const history = new HistoryStore({ keyframeInterval: 5 });
    history.attach(game, { captureBaseline: true });

    history.beginTick(0);
    manager.lemmings[0].x = 10;
    manager.lemmings[0].y = 12;
    manager.selectedIndex = 0;
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    expect(delta).to.be.ok;

    history.applyDeltaBackward(game, delta);
    expect(manager.lemmings[0].x).to.equal(5);
    expect(manager.lemmings[0].y).to.equal(6);
    expect(manager.selectedIndex).to.equal(-1);

    history.applyDeltaForward(game, delta);
    expect(manager.lemmings[0].x).to.equal(10);
    expect(manager.lemmings[0].y).to.equal(12);
    expect(manager.selectedIndex).to.equal(0);
  });

  it('truncates future history unless preservation is enabled', function() {
    const history = new HistoryStore({ keyframeInterval: 5 });
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(0, { tickIndex: 0 });
    history._setKeyframe(2, { tickIndex: 2 });

    history.truncateAfter(0);
    expect(!!history.deltas[2]).to.equal(false);
    expect(!!history.keyframes[2]).to.equal(false);

    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(2, { tickIndex: 2 });
    history.setPreserveFutureHistory(true);
    history.truncateAfter(0);
    expect(!!history.deltas[2]).to.equal(true);
    expect(!!history.keyframes[2]).to.equal(true);
  });

  it('snapshots lemming boolean flags', function() {
    const lem = {
      id: 1,
      x: 0,
      y: 0,
      lookRight: false,
      frameIndex: 0,
      state: 0,
      canClimb: false,
      hasParachute: true,
      removed: true,
      disabled: true,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: 1
    };
    const snap = __test__.snapshotLemming(lem, 2, true);
    expect(snap.hasParachute).to.equal(1);
    expect(snap.removed).to.equal(1);
    expect(snap.disabled).to.equal(1);
    expect(snap.countdownActive).to.equal(1);
  });

  it('handles keyframe access and resume without a game', function() {
    const history = new HistoryStore();
    expect(history.getKeyframe('bad')).to.equal(null);
    history.resume();
  });

  it('truncates all deltas when cutting after the last tick', function() {
    const history = new HistoryStore();
    history.deltas[1] = history._allocDelta(1);
    history.minDeltaTick = 1;
    history.maxDeltaTick = 1;
    history.deltaCount = 1;
    history._truncateDeltasAfter(0);
    expect(history.minDeltaTick).to.equal(null);
    expect(history.maxDeltaTick).to.equal(null);
  });

  it('truncates deltas before a cutoff and clears ranges', function() {
    const history = new HistoryStore();
    history.deltas[0] = history._allocDelta(0);
    history.deltas[1] = history._allocDelta(1);
    history.minDeltaTick = 0;
    history.maxDeltaTick = 1;
    history.deltaCount = 2;
    history._truncateBefore(2);
    expect(history.minDeltaTick).to.equal(null);
    expect(history.maxDeltaTick).to.equal(null);
  });

  it('uses fallback tick indices when timers are missing', function() {
    const history = new HistoryStore({ keyframeInterval: 1 });
    history._recording = true;
    history._currentTick = 0;
    history._currentDelta = history._allocDelta(0);
    history.game = {};
    history.timer = { tickIndex: undefined };
    history._diffState = () => {};
    history._compressGroundChanges = () => {};
    history._setDelta = () => {};
    history._captureKeyframe = () => ({ tickIndex: 0 });
    let keyframeTick = null;
    history._setKeyframe = (tickIndex) => { keyframeTick = tickIndex; };
    history._maybeWarnHistory = () => {};
    history._enforceHistoryCap = () => {};
    history.endTick();
    expect(keyframeTick).to.equal(1);
  });

  it('compares skill arrays with missing values', function() {
    const history = new HistoryStore();
    const a = { selectedSkill: 1, cheatMode: false };
    const b = { selectedSkill: 1, cheatMode: false, skills: [1] };
    expect(history._skillsEqual(a, b)).to.equal(false);
  });

  it('applies keyframes with lemming list resizing and speed ignores', function() {
    const history = new HistoryStore();
    const timer = { speedFactor: 2, tickIndex: 0 };
    const manager = { lemmings: [], skillActions: [], actions: [] };
    const game = {
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      timeTravel: { isReversing: true, ignoreSpeedOnReverse: true }
    };
    const stateSize = 2;
    const keyframe = {
      tickIndex: 1,
      lemmingState: {
        present: [true, true],
        x: [0, 1],
        y: [0, 1],
        lookRight: [0, 1],
        frameIndex: [0, 0],
        state: [0, 0],
        canClimb: [0, 0],
        hasParachute: [0, 0],
        removed: [0, 0],
        disabled: [0, 0],
        countdown: [0, 0],
        hasExploded: [0, 0],
        lastTriggerType: [-1, -1],
        actionType: [-1, -1],
        countdownActive: [0, 0]
      },
      timer: { speedFactor: 5, tickIndex: 1 }
    };
    history.applyKeyframe(game, keyframe);
    expect(manager.lemmings).to.have.length(stateSize);
    expect(timer.speedFactor).to.equal(2);
  });

  it('applies timer changes without overwriting reverse speed', function() {
    const history = new HistoryStore();
    const timer = { speedFactor: 3, tickIndex: 0 };
    const game = {
      getGameTimer: () => timer,
      timeTravel: { ignoreSpeedOnReverse: true }
    };
    const delta = {
      timerChanges: {
        prev: { speedFactor: 10, tickIndex: 5 },
        next: { speedFactor: 2, tickIndex: 2 }
      }
    };
    history._applyScalarChanges(game, delta, false);
    expect(timer.speedFactor).to.equal(3);
    expect(timer.tickIndex).to.equal(5);
  });

  it('applies non-lemming deltas and scalar changes', function() {
    const {
      history,
      game,
      timer,
      manager,
      skills,
      victory,
      level
    } = createHistoryFixture();

    manager.miniMap = {
      deadDots: new Uint8Array(0),
      deadTTLs: new Uint8Array(0),
      deadCount: 0
    };

    const obj = { animation: { firstFrameIndex: 0, isFinished: false } };
    level.objects = [obj];
    level.groundMask.mask[1] = 1;
    level.groundMask.mask[2] = 1;
    level.groundImage[4] = 10;
    level.groundImage[5] = 20;
    level.groundImage[6] = 30;
    level.groundImage[8] = 11;
    level.groundImage[9] = 21;
    level.groundImage[10] = 31;

    history.beginTick(0);
    history.recordGroundChange(1, 1, 10, 20, 30, 0, 0, 0, 0);
    history.recordGroundChange(2, 1, 11, 21, 31, 0, 0, 0, 0);
    history.recordEntranceChange(0, false, true);
    history.recordObjectAnimation(
      obj,
      { firstFrameIndex: 0, isFinished: false },
      { firstFrameIndex: 5, isFinished: true }
    );
    history.recordMinimapDeath({ x: 1, y: 2, ttl: 3, prevCount: 0 });

    skills.selectedSkill = 1;
    skills.cheatMode = true;
    skills.skills[0] = 2;
    victory.releaseRate = 2;
    victory.leftCount = 0;
    victory.outCount = 2;
    victory.survivorCount = 1;
    victory.isFinalize = true;
    timer.speedFactor = 2;
    game.finalGameState = 3;
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    history.applyDeltaForward(game, delta);

    expect(level.groundMask.mask[1]).to.equal(0);
    expect(level.groundMask.mask[2]).to.equal(0);
    expect(level.groundImage[4]).to.equal(0);
    expect(level.groundImage[8]).to.equal(0);
    expect(level.entrances[0]._opened).to.equal(true);
    expect(obj.animation.firstFrameIndex).to.equal(5);
    expect(obj.animation.isFinished).to.equal(true);
    expect(manager.miniMap.deadCount).to.equal(1);
    expect(manager.miniMap.deadDots[0]).to.equal(1);
    expect(manager.miniMap.deadDots[1]).to.equal(2);
    expect(manager.miniMap.deadTTLs[0]).to.equal(3);
    expect(skills.selectedSkill).to.equal(1);
    expect(skills.cheatMode).to.equal(true);
    expect(skills.skills[0]).to.equal(2);
    expect(victory.releaseRate).to.equal(2);
    expect(victory.leftCount).to.equal(0);
    expect(victory.outCount).to.equal(2);
    expect(victory.survivorCount).to.equal(1);
    expect(victory.isFinalize).to.equal(true);
    expect(timer.speedFactor).to.equal(2);
    expect(timer.tickIndex).to.equal(1);
    expect(game.finalGameState).to.equal(3);

    history.applyDeltaBackward(game, delta);
    expect(level.groundMask.mask[1]).to.equal(1);
    expect(level.groundMask.mask[2]).to.equal(1);
    expect(level.groundImage[4]).to.equal(10);
    expect(level.groundImage[5]).to.equal(20);
    expect(level.groundImage[6]).to.equal(30);
    expect(level.groundImage[8]).to.equal(11);
    expect(level.groundImage[9]).to.equal(21);
    expect(level.groundImage[10]).to.equal(31);
    expect(level.entrances[0]._opened).to.equal(false);
    expect(obj.animation.firstFrameIndex).to.equal(0);
    expect(obj.animation.isFinished).to.equal(false);
    expect(manager.miniMap.deadCount).to.equal(0);
    expect(skills.selectedSkill).to.equal(0);
    expect(skills.cheatMode).to.equal(false);
    expect(skills.skills[0]).to.equal(1);
    expect(victory.releaseRate).to.equal(1);
    expect(victory.leftCount).to.equal(1);
    expect(victory.outCount).to.equal(0);
    expect(victory.survivorCount).to.equal(0);
    expect(victory.isFinalize).to.equal(false);
    expect(timer.speedFactor).to.equal(1);
    expect(timer.tickIndex).to.equal(0);
    expect(game.finalGameState).to.equal(0);
  });

  it('applies trigger cooldown changes', function() {
    const { history, game, timer, manager, triggerManager } = createHistoryFixture();
    const owner = manager.lemmings[0];
    const trigger = new Trigger(
      TriggerTypes.TRAP,
      1,
      1,
      2,
      2,
      5,
      7,
      owner
    );
    triggerManager.add(trigger);

    history.beginTick(0);
    history.recordTriggerCooldown(trigger, 0, 5);
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    history.applyDeltaForward(game, delta);
    expect(trigger.disabledUntilTick).to.equal(5);
    history.applyDeltaBackward(game, delta);
    expect(trigger.disabledUntilTick).to.equal(0);
  });

  it('applies trigger add/remove deltas', function() {
    const { history, game, timer, manager, triggerManager } = createHistoryFixture();
    const owner = manager.lemmings[0];
    const trigger = new Trigger(
      TriggerTypes.TRAP,
      2,
      2,
      3,
      3,
      0,
      9,
      owner
    );

    history.beginTick(0);
    history.recordTriggerAdd(trigger, {
      type: trigger.type,
      x1: trigger.x1,
      y1: trigger.y1,
      x2: trigger.x2,
      y2: trigger.y2,
      disableTicksCount: trigger.disableTicksCount,
      soundIndex: trigger.soundIndex,
      ownerId: owner.id,
      disabledUntilTick: 0
    });
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    history.applyDeltaForward(game, delta);
    expect(triggerManager._triggers.size).to.equal(1);
    const added = Array.from(triggerManager._triggers)[0];
    expect(added.type).to.equal(trigger.type);
    expect(added.x1).to.equal(trigger.x1);
    expect(added.y1).to.equal(trigger.y1);
    expect(added.x2).to.equal(trigger.x2);
    expect(added.y2).to.equal(trigger.y2);

    history.applyDeltaBackward(game, delta);
    expect(triggerManager._triggers.size).to.equal(0);
  });

  it('handles invalid ticks and keyframe lookups', function() {
    const history = new HistoryStore();
    expect(history.getDelta(NaN)).to.equal(null);
    expect(history.getKeyframeAtOrBefore(NaN)).to.equal(null);
    expect(history.getKeyframeAtOrBefore(1)).to.equal(null);

    history._setKeyframe(3, { tickIndex: 3 });
    expect(history.getKeyframeAtOrBefore(2)).to.equal(null);
    expect(history.getKeyframeAtOrBefore(3)).to.be.ok;
  });

  it('releases deltas while respecting pool limits', function() {
    const history = new HistoryStore({ deltaPoolLimit: 1 });
    const delta = history._allocDelta(0);
    history._releaseDelta(delta);
    expect(history._deltaPool).to.have.length(1);
    history._releaseDelta(history._allocDelta(1));
    expect(history._deltaPool).to.have.length(1);
    history._releaseDelta(null);
  });

  it('attaches and detaches timer handlers', function() {
    const history = new HistoryStore();
    const calls = { onBefore: 0, onAfter: 0, offBefore: 0, offAfter: 0 };
    const before = {
      on(fn) { this.fn = fn; calls.onBefore += 1; },
      off(fn) { if (fn === this.fn) calls.offBefore += 1; }
    };
    const after = {
      on(fn) { this.fn = fn; calls.onAfter += 1; },
      off(fn) { if (fn === this.fn) calls.offAfter += 1; }
    };
    const timer = {
      tickIndex: 0,
      onBeforeGameTick: before,
      onGameTick: after
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getGameTimer: () => timer,
      getLemmingManager: () => ({ lemmings: [] }),
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };

    history.attach(game, { captureBaseline: false });
    expect(calls.onBefore).to.equal(1);
    expect(calls.onAfter).to.equal(1);
    history.detach();
    expect(calls.offBefore).to.equal(1);
    expect(calls.offAfter).to.equal(1);
  });

  it('inserts keyframe ticks in order and skips duplicates', function() {
    const history = new HistoryStore();
    history._insertKeyframeTick(2);
    history._insertKeyframeTick(2);
    history._insertKeyframeTick(1);
    expect(history.keyframeTicks).to.eql([1, 2]);
  });

  it('compresses ground changes into spans', function() {
    const history = new HistoryStore();
    const changes = { indices: [5], spans: null };
    history._compressGroundChanges(changes);
    expect(changes.spans).to.equal(null);

    changes.indices = [1, 2, 4, 5];
    history._compressGroundChanges(changes);
    expect(changes.spans.starts).to.eql([1, 4]);
    expect(changes.spans.lengths).to.eql([2, 2]);
    expect(changes.indices).to.have.length(0);
  });

  it('enforces history caps only when needed', function() {
    const history = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 0
    });
    history._setDelta(0, history._allocDelta(0));
    history._enforceHistoryCap();
    expect(history.getDelta(0)).to.be.ok;

    const capped = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 3
    });
    capped._setDelta(0, capped._allocDelta(0));
    capped._setDelta(1, capped._allocDelta(1));
    capped._setDelta(2, capped._allocDelta(2));
    capped._enforceHistoryCap();
    expect(capped.getDelta(0)).to.be.ok;
  });

  it('reuses previous ground snapshots when not dirty', function() {
    const { history, game } = createHistoryFixture();
    history._groundDirty = false;
    history._lastKeyframe = {
      groundMask: new Uint8Array([9, 9]),
      groundImage: new Uint8ClampedArray([1, 2, 3, 4])
    };

    const frame = history._captureKeyframe(game, 0);

    expect(frame.groundMask).to.equal(history._lastKeyframe.groundMask);
    expect(frame.groundImage).to.equal(history._lastKeyframe.groundImage);
  });

  it('applies ground changes with spans', function() {
    const history = new HistoryStore();
    const level = {
      groundMask: { mask: new Uint8Array(4) },
      groundImage: new Uint8ClampedArray(16)
    };
    const changes = {
      spans: { starts: [0], lengths: [2] },
      indices: [],
      prevMask: [],
      prevR: [],
      prevG: [],
      prevB: [],
      nextMask: [1, 1],
      nextR: [10, 20],
      nextG: [30, 40],
      nextB: [50, 60]
    };

    history._applyGroundChanges(level, changes, true);

    expect(level.groundMask.mask[0]).to.equal(1);
    expect(level.groundMask.mask[1]).to.equal(1);
    expect(level.groundImage[0]).to.equal(10);
    expect(level.groundImage[4]).to.equal(20);
  });

  it('applies minimap deaths forward and backward', function() {
    const history = new HistoryStore();
    const manager = {
      miniMap: {
        deadDots: new Uint8Array(0),
        deadTTLs: new Uint8Array(0),
        deadCount: 0
      }
    };
    history._applyMinimapDeaths(manager, [{ x: 1, y: 2, ttl: 3, prevCount: 0 }], true);
    expect(manager.miniMap.deadCount).to.equal(1);
    history._applyMinimapDeaths(manager, [{ prevCount: 0 }], false);
    expect(manager.miniMap.deadCount).to.equal(0);
  });

  it('handles trigger id lookups from cache', function() {
    const history = new HistoryStore();
    const trigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2);
    trigger.__historyId = 5;
    history._triggerById.set(5, trigger);
    expect(history._findTriggerById({ _triggers: new Set() }, 5)).to.equal(trigger);
    expect(history._findTriggerById({ _triggers: new Set() }, 0)).to.equal(null);
  });

  it('truncates history before a cutoff', function() {
    const history = new HistoryStore({ keyframeInterval: 2 });
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(1, history._allocDelta(1));
    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(0, { tickIndex: 0 });
    history._setKeyframe(2, { tickIndex: 2 });

    history._truncateBefore(2);

    expect(history.getDelta(0)).to.equal(null);
    expect(history.getDelta(1)).to.equal(null);
    expect(history.getDelta(2)).to.be.ok;
    expect(history.minDeltaTick).to.equal(2);
    expect(history.keyframes[0]).to.equal(undefined);
    expect(history.keyframes[2]).to.be.ok;
    expect(history.minKeyframeTick).to.equal(2);
  });

  it('reads and applies trigger state snapshots', function() {
    const { history, game, manager, triggerManager, level } = createHistoryFixture();
    const owner = manager.lemmings[0];
    const staticTrigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 5, null);
    staticTrigger.disabledUntilTick = 5;
    const dynamicTrigger = new Trigger(TriggerTypes.FRYING, 3, 3, 4, 4, 0, 7, owner);
    const extraTrigger = new Trigger(TriggerTypes.KILL, 5, 5, 6, 6, 0, 8, owner);
    level.triggers = [staticTrigger];
    triggerManager._triggers.add(staticTrigger);
    triggerManager._triggers.add(dynamicTrigger);
    triggerManager._triggers.add(extraTrigger);

    const state = history._readTriggerState(game);
    expect(state.staticTriggers).to.have.length(1);
    expect(state.dynamicTriggers).to.have.length(2);
    expect(state.staticTriggers[0].disabledUntilTick).to.equal(5);

    staticTrigger.disabledUntilTick = 0;
    state.dynamicTriggers = state.dynamicTriggers.slice(0, 1);
    history._applyTriggerState(game, state);

    expect(staticTrigger.disabledUntilTick).to.equal(5);
    const dynamic = Array.from(triggerManager._triggers)
      .filter(tr => tr.owner === owner);
    expect(dynamic).to.have.length(1);
    expect(dynamic[0].type).to.equal(state.dynamicTriggers[0].type);
  });

  it('captures and restores object animation state', function() {
    const { history, level } = createHistoryFixture();
    const objA = { animation: { firstFrameIndex: 1, isFinished: false } };
    const objB = { animation: { firstFrameIndex: 5, isFinished: true } };
    level.objects = [objA, objB];

    const state = history._readObjectState(level);
    objA.animation.firstFrameIndex = 9;
    objA.animation.isFinished = true;
    objB.animation.firstFrameIndex = 11;
    objB.animation.isFinished = false;

    history._applyObjectState(level, state);

    expect(objA.animation.firstFrameIndex).to.equal(1);
    expect(objA.animation.isFinished).to.equal(false);
    expect(objB.animation.firstFrameIndex).to.equal(5);
    expect(objB.animation.isFinished).to.equal(true);
  });

  it('copies minimap state when reading', function() {
    const { history } = createHistoryFixture();
    const miniMap = {
      deadDots: new Uint8Array([1, 2]),
      deadTTLs: new Uint8Array([3]),
      deadCount: 1
    };
    const state = history._readMinimapState(miniMap);
    expect(Array.from(state.deadDots)).to.eql([1, 2]);
    state.deadDots[0] = 9;
    expect(miniMap.deadDots[0]).to.equal(1);
  });

  it('caps history and warns when configured', function() {
    const history = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2,
      historyWarnTicks: 2
    });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      history._setDelta(0, history._allocDelta(0));
      history._setDelta(1, history._allocDelta(1));
      history._maybeWarnHistory();
      expect(warnings).to.have.length(1);
      history._maybeWarnHistory();
      expect(warnings).to.have.length(1);

      history._setDelta(2, history._allocDelta(2));
      history._enforceHistoryCap();
      expect(history.getDelta(0)).to.equal(null);
      expect(history.getDelta(1)).to.be.ok;
      expect(history.getDelta(2)).to.be.ok;
    } finally {
      console.warn = originalWarn;
    }
  });

  it('returns action types from map or actions list', function() {
    const history = new HistoryStore();
    const actionA = { name: 'action-a' };
    const actionB = { name: 'action-b' };
    const manager = {
      actions: [actionA, actionB],
      actionTypeByAction: new Map([[actionA, 7]])
    };

    expect(history._getActionType(manager, actionA)).to.equal(7);
    expect(history._getActionType(manager, actionB)).to.equal(1);
    expect(history._getActionType(manager, null)).to.equal(-1);
    expect(history._getActionType({ actions: [actionA] }, { name: 'missing' })).to.equal(-1);
  });

  it('removes lemmings when slots clear or the array shrinks', function() {
    const timer = createStubTimer();
    const walkAction = { name: 'walk' };
    const makeLemming = (id) => ({
      id,
      x: id,
      y: id + 1,
      lookRight: true,
      frameIndex: 0,
      state: 0,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: null,
      action: walkAction,
      countdownAction: null
    });
    const lemmingA = makeLemming(0);
    const lemmingB = makeLemming(1);
    const manager = {
      lemmings: [lemmingA, lemmingB],
      activeLemmings: [lemmingA, lemmingB],
      _activeDirty: false,
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map([[walkAction, 0]]),
      selectedIndex: -1,
      spawnTotal: 2,
      releaseTickIndex: 0,
      mmTickCounter: 0,
      nextNukingLemmingsIndex: -1,
      _nukeTargets: null
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history = new HistoryStore({ keyframeInterval: 5 });
    history.attach(game, { captureBaseline: true });

    history.beginTick(0);
    manager.lemmings[0] = null;
    manager.lemmings.length = 1;
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    expect(delta.lemRemoved).to.have.length(2);

    history.applyDeltaBackward(game, delta);
    expect(manager.lemmings[0]).to.be.ok;
    expect(manager.lemmings[1]).to.be.ok;

    history.applyDeltaForward(game, delta);
    expect(manager.lemmings[0]).to.equal(null);
    expect(manager.lemmings[1]).to.equal(null);
  });

  it('applies all lemming field changes', function() {
    const timer = createStubTimer();
    const walkAction = { name: 'walk' };
    const bomberAction = { name: 'bomber' };
    const skillActions = [];
    skillActions[SkillTypes.BOMBER] = bomberAction;
    const lemming = {
      id: 0,
      x: 5,
      y: 6,
      lookRight: true,
      frameIndex: 0,
      state: 1,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: 4,
      action: walkAction,
      countdownAction: null
    };
    const manager = {
      lemmings: [lemming],
      activeLemmings: [lemming],
      _activeDirty: false,
      actions: [walkAction],
      skillActions,
      actionTypeByAction: new Map([[walkAction, 0]]),
      selectedIndex: -1,
      spawnTotal: 1,
      releaseTickIndex: 0,
      mmTickCounter: 0,
      nextNukingLemmingsIndex: -1,
      _nukeTargets: null
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history = new HistoryStore({ keyframeInterval: 5 });
    history.attach(game, { captureBaseline: true });

    history.beginTick(0);
    lemming.x = 11;
    lemming.y = 22;
    lemming.lookRight = false;
    lemming.frameIndex = 3;
    lemming.state = 2;
    lemming.canClimb = true;
    lemming.hasParachute = true;
    lemming.removed = true;
    lemming.disabled = true;
    lemming.countdown = 5;
    lemming.hasExploded = true;
    lemming.lastTriggerType = null;
    lemming.action = null;
    lemming.countdownAction = bomberAction;
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    history.applyDeltaForward(game, delta);

    expect(lemming.x).to.equal(11);
    expect(lemming.y).to.equal(22);
    expect(lemming.lookRight).to.equal(false);
    expect(lemming.frameIndex).to.equal(3);
    expect(lemming.state).to.equal(2);
    expect(lemming.canClimb).to.equal(true);
    expect(lemming.hasParachute).to.equal(true);
    expect(lemming.removed).to.equal(true);
    expect(lemming.disabled).to.equal(true);
    expect(lemming.countdown).to.equal(5);
    expect(lemming.hasExploded).to.equal(true);
    expect(lemming.lastTriggerType).to.equal(null);
    expect(lemming.action).to.equal(null);
    expect(lemming.countdownAction).to.equal(bomberAction);

    history.applyDeltaBackward(game, delta);
    expect(lemming.x).to.equal(5);
    expect(lemming.y).to.equal(6);
    expect(lemming.lookRight).to.equal(true);
    expect(lemming.frameIndex).to.equal(0);
    expect(lemming.state).to.equal(1);
    expect(lemming.canClimb).to.equal(false);
    expect(lemming.hasParachute).to.equal(false);
    expect(lemming.removed).to.equal(false);
    expect(lemming.disabled).to.equal(false);
    expect(lemming.countdown).to.equal(0);
    expect(lemming.hasExploded).to.equal(false);
    expect(lemming.lastTriggerType).to.equal(4);
    expect(lemming.action).to.equal(walkAction);
    expect(lemming.countdownAction).to.equal(null);
  });

  it('applies lemming manager nuke target changes', function() {
    const timer = createStubTimer();
    const walkAction = { name: 'walk' };
    const makeLemming = (id) => ({
      id,
      x: id,
      y: id + 1,
      lookRight: true,
      frameIndex: 0,
      state: 0,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: null,
      action: walkAction,
      countdownAction: null
    });
    const lemmingA = makeLemming(0);
    const lemmingB = makeLemming(1);
    const manager = {
      lemmings: [lemmingA, lemmingB],
      activeLemmings: [lemmingA, lemmingB],
      _activeDirty: false,
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map([[walkAction, 0]]),
      selectedIndex: -1,
      spawnTotal: 2,
      releaseTickIndex: 0,
      mmTickCounter: 0,
      nextNukingLemmingsIndex: -1,
      _nukeTargets: [lemmingA]
    };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history = new HistoryStore({ keyframeInterval: 5 });
    history.attach(game, { captureBaseline: true });

    history.beginTick(0);
    manager.selectedIndex = 1;
    manager.nextNukingLemmingsIndex = 2;
    manager._nukeTargets = [lemmingB, null];
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    history.applyDeltaForward(game, delta);
    expect(manager.selectedIndex).to.equal(1);
    expect(manager.nextNukingLemmingsIndex).to.equal(2);
    expect(manager._nukeTargets).to.eql([lemmingB]);

    history.applyDeltaBackward(game, delta);
    expect(manager.selectedIndex).to.equal(-1);
    expect(manager.nextNukingLemmingsIndex).to.equal(-1);
    expect(manager._nukeTargets).to.eql([lemmingA]);
  });

  it('resets entrance tracking when entrance count changes', function() {
    const timer = createStubTimer();
    const manager = {
      lemmings: [],
      activeLemmings: [],
      _activeDirty: false,
      actions: [],
      skillActions: [],
      actionTypeByAction: new Map(),
      selectedIndex: -1,
      spawnTotal: 0,
      releaseTickIndex: 0,
      mmTickCounter: 0,
      nextNukingLemmingsIndex: -1,
      _nukeTargets: null
    };
    const level = { entrances: [{ _opened: false }] };
    const game = {
      level,
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history = new HistoryStore({ keyframeInterval: 5 });
    history.attach(game, { captureBaseline: true });

    history.beginTick(0);
    level.entrances.push({ _opened: true });
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    expect(delta.entranceChanges.indices).to.have.length(0);
    expect(history._entranceOpened).to.have.length(2);
  });

  it('removes triggers by resolving ids from trigger sets', function() {
    const history = new HistoryStore();
    const owner = { id: 0 };
    const trigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 0, owner);
    trigger.__historyId = 7;
    const triggerManager = {
      _triggers: new Set([trigger]),
      add(trig) { this._triggers.add(trig); },
      removeByOwner(ownerRef) {
        for (const trig of Array.from(this._triggers)) {
          if (trig.owner === ownerRef) this._triggers.delete(trig);
        }
      }
    };
    const game = {
      triggerManager,
      getLemmingManager: () => ({ getLemming: () => owner })
    };
    const delta = {
      triggerAdd: [],
      triggerRemove: [{ id: 7 }]
    };

    history._applyTriggerChanges(game, delta, true);

    expect(triggerManager._triggers.size).to.equal(0);
    expect(history._triggerById.get(7)).to.equal(trigger);
  });

  it('applies object changes by resolving ids from level objects', function() {
    const history = new HistoryStore();
    const obj = { animation: { firstFrameIndex: 0, isFinished: false } };
    const level = { objects: [obj] };
    const changes = {
      ids: [1],
      prevFirst: [0],
      prevFinished: [0],
      nextFirst: [5],
      nextFinished: [1]
    };

    history._applyObjectChanges(level, changes, true);

    expect(obj.animation.firstFrameIndex).to.equal(5);
    expect(obj.animation.isFinished).to.equal(true);
  });

  it('handles non-array skill lists', function() {
    const history = new HistoryStore();
    const skills = history._readSkills({ selectedSkill: 1, cheatMode: 1, skills: null });
    expect(skills.skills).to.eql([]);
    expect(skills.cheatMode).to.equal(true);
    expect(history._skillsEqual(skills, { selectedSkill: 1, cheatMode: true, skills: [] })).to.equal(true);
    expect(history._skillsEqual(skills, { selectedSkill: 2, cheatMode: true, skills: [] })).to.equal(false);
  });

  it('start no-ops without a game and skips existing keyframes', function() {
    const history = new HistoryStore();
    history.start();
    expect(history._recording).to.equal(false);

    const timer = createStubTimer();
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => ({ lemmings: [] }),
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history2 = new HistoryStore({ keyframeInterval: 5 });
    history2.attach(game, { captureBaseline: true });
    const count = history2.keyframeCount;
    history2.timer = null;
    history2.start();
    expect(history2.keyframeCount).to.equal(count);
  });

  it('captures keyframes without ground data and handles null minimaps', function() {
    const history = new HistoryStore();
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => ({ lemmings: [], miniMap: null }),
      getGameTimer: () => createStubTimer(),
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };

    const frame = history._captureKeyframe(game, 0);

    expect(frame.groundMask).to.equal(null);
    expect(frame.groundImage).to.equal(null);
    expect(history._readMinimapState(null)).to.equal(null);
  });

  it('records lemming adds and ignores unknown change fields', function() {
    const { history, timer, manager, walkAction } = createHistoryFixture();
    const newLem = {
      id: 1,
      x: 10,
      y: 11,
      lookRight: true,
      frameIndex: 0,
      state: 0,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: null,
      action: walkAction,
      countdownAction: null
    };

    history.beginTick(0);
    manager.lemmings.push(newLem);
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    expect(delta.lemAdded).to.have.length(1);

    history._applyLemmingChanges(manager, {
      ids: [0],
      fields: [99],
      prev: [0],
      next: [1]
    }, true);
    expect(manager.lemmings[0].x).to.equal(5);
  });

  it('skips delta application and ground changes when data is missing', function() {
    const history = new HistoryStore();
    history._applyDelta(null, null, true);

    const level = { groundMask: null, groundImage: null };
    history._applyGroundChanges(level, {
      indices: [0],
      prevMask: [0],
      prevR: [0],
      prevG: [0],
      prevB: [0],
      nextMask: [1],
      nextR: [1],
      nextG: [1],
      nextB: [1]
    }, true);
    expect(level.groundImage).to.equal(null);
  });

  it('adds lemmings with constructors and skips invalid entries', function() {
    const history = new HistoryStore();
    const created = [];
    function LemCtor(x, y, id) {
      this.id = id;
      this.x = x;
      this.y = y;
      created.push(this);
    }
    const manager = { lemmings: null, actions: [], skillActions: [], _lemmingCtor: LemCtor };
    const snap = {
      id: 0,
      x: 1,
      y: 2,
      lookRight: 1,
      frameIndex: 0,
      state: 0,
      canClimb: 0,
      hasParachute: 0,
      removed: 0,
      disabled: 0,
      countdown: 0,
      hasExploded: 0,
      lastTriggerType: -1,
      actionType: -1,
      countdownActive: 0
    };

    history._applyLemmingAdds(manager, [null, { id: NaN }, snap]);

    expect(created).to.have.length(1);
    expect(manager.lemmings[0]).to.be.instanceOf(LemCtor);
  });

  it('handles trigger changes with missing owners and cooldown ids', function() {
    const history = new HistoryStore();
    const trigger = new Trigger(TriggerTypes.TRAP, 0, 0, 1, 1);
    trigger.__historyId = 3;
    trigger.owner = null;
    const triggerManager = {
      _triggers: new Set([trigger]),
      add(trig) { this._triggers.add(trig); },
      removeByOwner(owner) {
        for (const entry of Array.from(this._triggers)) {
          if (entry.owner === owner) this._triggers.delete(entry);
        }
      }
    };
    const game = { triggerManager, getLemmingManager: () => ({ getLemming: () => null }) };
    const delta = {
      triggerAdd: [],
      triggerRemove: [{ id: 3 }],
      triggerCooldownChanges: { ids: [9], prev: [0], next: [1] }
    };

    history._applyTriggerChanges(game, delta, true);

    expect(triggerManager._triggers.size).to.equal(1);
  });

  it('skips ownerless dynamic triggers and ignores empty dynamic state', function() {
    const history = new HistoryStore();
    const ownerless = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 0, null);
    const staticTrigger = new Trigger(TriggerTypes.FRYING, 2, 2, 3, 3, 0, 0, null);
    staticTrigger.disabledUntilTick = 2;
    const level = { triggers: [staticTrigger] };
    const triggerManager = {
      _triggers: new Set([staticTrigger, ownerless]),
      add(trig) { this._triggers.add(trig); },
      removeByOwner(owner) {
        for (const entry of Array.from(this._triggers)) {
          if (entry.owner === owner) this._triggers.delete(entry);
        }
      }
    };
    const game = {
      level,
      triggerManager,
      getLemmingManager: () => ({ getLemming: () => null })
    };

    const state = history._readTriggerState(game);
    expect(state.dynamicTriggers).to.have.length(0);
    state.staticTriggers[0].disabledUntilTick = 5;
    state.dynamicTriggers = [];

    history._applyTriggerState(game, state);

    expect(staticTrigger.disabledUntilTick).to.equal(5);
    expect(triggerManager._triggers.has(ownerless)).to.equal(true);
  });

  it('skips objects without animations in state helpers', function() {
    const history = new HistoryStore();
    const objWithAnim = { animation: { firstFrameIndex: 2, isFinished: false } };
    const objNoAnim = {};
    const level = { objects: [objWithAnim, objNoAnim] };
    const state = history._readObjectState(level);
    expect(state).to.have.length(1);

    history._applyObjectState(level, [{ id: 999, firstFrameIndex: 9, isFinished: true }]);
    expect(objWithAnim.animation.firstFrameIndex).to.equal(2);
  });

  it('applies game state even when other scalars are missing', function() {
    const history = new HistoryStore();
    const game = {
      finalGameState: 0,
      getGameSkills: () => null,
      getVictoryCondition: () => null,
      getGameTimer: () => null
    };
    const delta = {
      skillsChanges: { prev: null, next: { selectedSkill: 1, cheatMode: false, skills: [] } },
      victoryChanges: { prev: null, next: { releaseRate: 1, minReleaseRate: 1, leftCount: 0, outCount: 0, survivorCount: 0, isFinalize: false } },
      timerChanges: { prev: null, next: { speedFactor: 1, frameTime: 60, tickIndex: 2 } },
      gameChanges: { prev: { finalGameState: 0 }, next: { finalGameState: 4 } }
    };

    history._applyScalarChanges(game, delta, true);

    expect(game.finalGameState).to.equal(4);
  });

  it('handles early returns and null helpers', function() {
    const history = new HistoryStore({ deltaPoolLimit: 0 });
    const delta = history._allocDelta(0);
    history._releaseDelta(delta);
    expect(history._deltaPool).to.have.length(0);

    history.attach(null);
    history._bindTimer();
    history.beginTick(0);
    history.endTick();
    history.captureBaseline(null);

    history.recordSoundEvent({ type: 'sfx' });
    history.recordGroundChange(0, 0, 0, 0, 0, 1, 1, 1, 1);
    history.recordEntranceChange(0, false, true);
    history.recordTriggerCooldown(null, 0, 1);
    history.recordTriggerAdd(null, {});
    history.recordTriggerRemove(null, {});
    history.recordObjectAnimation(null, { firstFrameIndex: 0, isFinished: false }, { firstFrameIndex: 1, isFinished: true });
    history.recordMinimapDeath({ x: 1 });

    expect(history._ensureTriggerId(null)).to.equal(0);
    expect(history._ensureObjectId(null)).to.equal(0);
  });

  it('records delta entries for sound, entrances, and objects', function() {
    const { history, timer, level } = createHistoryFixture();
    const obj = { animation: { firstFrameIndex: 0, isFinished: false } };
    level.objects = [obj];

    history.beginTick(0);
    history.recordSoundEvent({ type: 'step' });
    history.recordEntranceChange(0, false, true);
    history.recordObjectAnimation(
      obj,
      { firstFrameIndex: 0, isFinished: false },
      { firstFrameIndex: 2, isFinished: true }
    );
    history.recordMinimapDeath({ x: 2, y: 3, ttl: 4, prevCount: 0 });
    timer.tickIndex = 1;
    history.endTick();

    const delta = history.getDelta(0);
    expect(delta.soundEvents).to.have.length(1);
    expect(delta.entranceChanges.prev[0]).to.equal(0);
    expect(delta.entranceChanges.next[0]).to.equal(1);
    expect(delta.objectAnimChanges.prevFinished[0]).to.equal(0);
    expect(delta.objectAnimChanges.nextFinished[0]).to.equal(1);
    expect(delta.minimapDeaths).to.have.length(1);
  });

  it('truncates deltas and keyframes when removing all history', function() {
    const history = new HistoryStore({ keyframeInterval: 2 });
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(0, { tickIndex: 0 });
    history._setKeyframe(2, { tickIndex: 2 });

    history._truncateDeltasAfter(-1);
    expect(history.minDeltaTick).to.equal(null);
    expect(history.maxDeltaTick).to.equal(null);

    history._setKeyframe(1, { tickIndex: 1 });
    history._truncateKeyframesAfter(0);
    expect(history.keyframeTicks).to.have.length(1);
    expect(history.keyframeTicks[0]).to.equal(0);

    history._setDelta(0, history._allocDelta(0));
    history._truncateBefore(5);
    expect(history.minDeltaTick).to.equal(null);
  });

  it('applies keyframes across game subsystems', function() {
    const history = new HistoryStore();
    const walkAction = { name: 'walk' };
    const bomberAction = { name: 'bomber' };
    const created = [];
    function LemCtor(x, y, id) {
      this.id = id;
      this.x = x;
      this.y = y;
      created.push(this);
    }
    const skillActions = [];
    skillActions[SkillTypes.BOMBER] = bomberAction;
    const manager = {
      lemmings: [],
      actions: [walkAction],
      skillActions,
      _lemmingCtor: LemCtor,
      activeLemmings: [],
      _activeDirty: true,
      actionTypeByAction: new Map([[walkAction, 0]]),
      miniMap: { deadDots: new Uint8Array([1, 2]), deadTTLs: new Uint8Array([3]), deadCount: 1 },
      getLemming: id => manager.lemmings[id] ?? null
    };
    const staticTrigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 0, null);
    const existingOwner = { id: 0 };
    const existingTrigger = new Trigger(TriggerTypes.FRYING, 2, 2, 3, 3, 0, 0, existingOwner);
    const level = {
      entrances: [{ _opened: false }],
      triggers: [staticTrigger],
      objects: [{ animation: { firstFrameIndex: 0, isFinished: false } }],
      groundMask: { mask: new Uint8Array(4) },
      groundImage: new Uint8ClampedArray(16)
    };
    const triggerManager = {
      _triggers: new Set([staticTrigger, existingTrigger]),
      add(trig) { this._triggers.add(trig); },
      removeByOwner(owner) {
        for (const trig of Array.from(this._triggers)) {
          if (trig.owner === owner) this._triggers.delete(trig);
        }
      }
    };
    const victory = {
      releaseRate: 1,
      minReleaseRate: 1,
      leftCount: 1,
      outCount: 0,
      survivorCount: 0,
      isFinalize: false
    };
    const skills = { selectedSkill: 0, cheatMode: false, skills: [1] };
    const timer = { speedFactor: 1, tickIndex: 0, frameTime: 60 };
    const game = {
      level,
      triggerManager,
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameSkills: () => skills,
      getVictoryCondition: () => victory,
      getGameTimer: () => timer
    };
    const lemmingState = {
      present: new Uint8Array([1, 0]),
      x: new Int32Array([10, 0]),
      y: new Int32Array([20, 0]),
      lookRight: new Uint8Array([1, 0]),
      frameIndex: new Int32Array([2, 0]),
      state: new Int32Array([3, 0]),
      canClimb: new Uint8Array([1, 0]),
      hasParachute: new Uint8Array([0, 0]),
      removed: new Uint8Array([0, 0]),
      disabled: new Uint8Array([0, 0]),
      countdown: new Int32Array([5, 0]),
      hasExploded: new Uint8Array([0, 0]),
      lastTriggerType: new Int32Array([TriggerTypes.TRAP, -1]),
      actionType: new Int32Array([0, -1]),
      countdownActive: new Uint8Array([1, 0])
    };
    const keyframe = {
      tickIndex: 10,
      lemmingState,
      lemmingManagerState: {
        selectedIndex: 1,
        spawnTotal: 2,
        releaseTickIndex: 3,
        mmTickCounter: 4,
        nextNukingLemmingsIndex: 5,
        nukeTargets: [0, 99]
      },
      entranceOpened: new Uint8Array([1]),
      triggerState: {
        staticTriggers: [{ id: 100, disabledUntilTick: 7 }],
        dynamicTriggers: [{
          id: 200,
          ownerId: 0,
          type: TriggerTypes.KILL,
          x1: 0,
          y1: 0,
          x2: 1,
          y2: 1,
          disableTicksCount: 0,
          soundIndex: 2,
          disabledUntilTick: 4
        }]
      },
      objectState: [{
        id: history._ensureObjectId(level.objects[0]),
        firstFrameIndex: 5,
        isFinished: true
      }],
      minimapState: { deadDots: new Uint8Array([9, 10]), deadTTLs: new Uint8Array([5]), deadCount: 1 },
      groundMask: new Uint8Array([1, 1, 0, 0]),
      groundImage: new Uint8ClampedArray(16).fill(2),
      victory: { releaseRate: 2, minReleaseRate: 1, leftCount: 0, outCount: 1, survivorCount: 1, isFinalize: true },
      skills: { selectedSkill: 1, cheatMode: true, skills: [9] },
      timer: { speedFactor: 2, tickIndex: 5 },
      gameState: { finalGameState: 9 }
    };

    history.applyKeyframe(game, keyframe);

    expect(created).to.have.length(1);
    expect(manager.lemmings[0]).to.be.ok;
    expect(manager.lemmings[1]).to.equal(null);
    expect(manager.activeLemmings).to.have.length(1);
    expect(manager.activeLemmings[0].action).to.equal(walkAction);
    expect(manager.activeLemmings[0].countdownAction).to.equal(bomberAction);
    expect(manager.selectedIndex).to.equal(1);
    expect(manager._nukeTargets).to.eql([manager.lemmings[0]]);
    expect(level.entrances[0]._opened).to.equal(true);
    expect(level.objects[0].animation.firstFrameIndex).to.equal(5);
    expect(manager.miniMap.deadDots[0]).to.equal(9);
    expect(level.groundMask.mask[0]).to.equal(1);
    expect(victory.releaseRate).to.equal(2);
    expect(skills.selectedSkill).to.equal(1);
    expect(timer.speedFactor).to.equal(2);
    expect(game.finalGameState).to.equal(9);
  });

  it('applies ground changes without spans and scans triggers by id', function() {
    const history = new HistoryStore();
    const level = {
      groundMask: { mask: new Uint8Array(4) },
      groundImage: new Uint8ClampedArray(16)
    };
    const changes = {
      spans: null,
      indices: [2],
      prevMask: [0],
      prevR: [0],
      prevG: [0],
      prevB: [0],
      nextMask: [1],
      nextR: [10],
      nextG: [20],
      nextB: [30]
    };

    history._applyGroundChanges(level, changes, true);
    expect(level.groundMask.mask[2]).to.equal(1);
    expect(level.groundImage[8]).to.equal(10);

    const trigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2);
    trigger.__historyId = 9;
    const triggerManager = { _triggers: new Set([trigger]) };
    const found = history._findTriggerById(triggerManager, 9);
    expect(found).to.equal(trigger);
  });

  it('returns null from readers with missing inputs', function() {
    const history = new HistoryStore();
    expect(history._readSkills(null)).to.equal(null);
    expect(history._readVictory(null)).to.equal(null);
    expect(history._readTimer(null)).to.equal(null);
    expect(history._readGameState(null)).to.equal(null);
    expect(history._skillsEqual(null, null)).to.equal(false);
    expect(history._victoryEqual(null, null)).to.equal(false);
    expect(history._timerEqual(null, null)).to.equal(false);
    expect(history._gameStateEqual(null, null)).to.equal(false);
  });

  it('skips ownerless trigger entries when reading state', function() {
    const history = new HistoryStore();
    const level = { triggers: [null] };
    const triggerManager = { _triggers: new Set([new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2)]) };
    const game = { level, triggerManager };
    const state = history._readTriggerState(game);
    expect(state.staticTriggers).to.have.length(0);
    expect(state.dynamicTriggers).to.have.length(0);
  });

  it('exposes lemming helpers for snapshots and cloning', function() {
    const state = __test__.createLemmingState(1);
    state.present[0] = 1;
    state.x[0] = 7;
    state.y[0] = 8;
    state.lookRight[0] = 1;
    state.countdownActive[0] = 1;

    const cloneDefault = __test__.cloneLemmingState(state);
    const cloneShort = __test__.cloneLemmingState(state, 0);
    expect(cloneDefault.present.length).to.equal(1);
    expect(cloneShort.present.length).to.equal(0);

    const grown = __test__.ensureLemmingCapacity(state, 2);
    const same = __test__.ensureLemmingCapacity(grown, 1);
    expect(grown.present.length).to.be.at.least(2);
    expect(same).to.equal(grown);

    const lem = {
      id: 1,
      x: 2,
      y: 3,
      lookRight: false,
      frameIndex: 4,
      state: null,
      canClimb: true,
      hasParachute: false,
      removed: false,
      disabled: true,
      countdown: null,
      hasExploded: true,
      lastTriggerType: NaN
    };
    const snap = __test__.snapshotLemming(lem, NaN, false);
    expect(snap.lastTriggerType).to.equal(-1);
    expect(snap.actionType).to.equal(-1);
    expect(snap.countdownActive).to.equal(0);

    const walk = { name: 'walk' };
    const bomb = { name: 'bomber' };
    const target = {};
    __test__.applyLemmingSnapshot(
      target,
      { ...snap, lastTriggerType: 3, countdownActive: 1 },
      walk,
      bomb
    );
    expect(target.lastTriggerType).to.equal(3);
    expect(target.action).to.equal(walk);
    expect(target.countdownAction).to.equal(bomb);

    __test__.applyLemmingSnapshot(
      target,
      { ...snap, lastTriggerType: -1, countdownActive: 0 },
      null,
      bomb
    );
    expect(target.lastTriggerType).to.equal(null);
    expect(target.countdownAction).to.equal(null);
  });

  it('reports history stats and keyframe lookups', function() {
    const history = new HistoryStore();
    expect(history.getKeyframe(NaN)).to.equal(null);
    expect(history.getHistoryStats().spanTicks).to.equal(0);

    history._setDelta(0, history._allocDelta(0));
    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(2, { tickIndex: 2 });
    expect(history.getKeyframe(2)).to.be.ok;
    expect(history.getKeyframe(4)).to.equal(null);

    const stats = history.getHistoryStats();
    expect(stats.spanTicks).to.equal(3);
    expect(stats.deltaCount).to.equal(2);

    history._setKeyframe(5, { tickIndex: 5 });
    const found = history.getKeyframeAtOrBefore(4);
    expect(found.tickIndex).to.equal(2);
  });

  it('pauses and resumes recording with baseline updates', function() {
    const { history } = createHistoryFixture();
    history.beginTick(0);
    history.pause();
    expect(history._recording).to.equal(false);
    expect(history._currentDelta).to.equal(null);

    history.resume();
    expect(history._recording).to.equal(true);
    expect(history._groundDirty).to.equal(true);
  });

  it('truncates deltas and keyframes across gaps', function() {
    const history = new HistoryStore({ keyframeInterval: 2 });
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(0, { tickIndex: 0 });
    history._setKeyframe(2, { tickIndex: 2 });

    history._truncateDeltasAfter(1);
    expect(history.maxDeltaTick).to.equal(0);
    history._truncateDeltasAfter(-1);
    expect(history.minDeltaTick).to.equal(null);

    history._truncateKeyframesAfter(-1);
    expect(history.keyframeTicks).to.have.length(0);
    expect(history.minKeyframeTick).to.equal(null);
  });

  it('truncates before gaps and clears keyframes', function() {
    const history = new HistoryStore({ keyframeInterval: 2 });
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(2, history._allocDelta(2));
    history._setKeyframe(0, { tickIndex: 0 });
    history._setKeyframe(1, { tickIndex: 1 });

    history._truncateBefore(1);
    expect(history.minDeltaTick).to.equal(2);

    history._truncateBefore(5);
    expect(history.minDeltaTick).to.equal(null);

    const history2 = new HistoryStore({ keyframeInterval: 2 });
    history2._setDelta(0, history2._allocDelta(0));
    history2._setKeyframe(0, { tickIndex: 0 });
    history2._setKeyframe(1, { tickIndex: 1 });
    history2._truncateBefore(2);
    expect(history2.keyframeTicks).to.have.length(0);
  });

  it('warns and caps history spans', function() {
    const history = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2,
      historyWarnTicks: 2
    });
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(1, history._allocDelta(1));
    history._setDelta(2, history._allocDelta(2));
    history._setDelta(3, history._allocDelta(3));
    history._setKeyframe(1, { tickIndex: 1 });

    let warned = 0;
    const originalWarn = console.warn;
    console.warn = () => { warned += 1; };
    try {
      history._maybeWarnHistory();
      history._maybeWarnHistory();
    } finally {
      console.warn = originalWarn;
    }
    expect(warned).to.equal(1);

    history._enforceHistoryCap();
    expect(history.minDeltaTick).to.equal(1);
  });

  it('skips history caps when a keyframe is before the minimum tick', function() {
    const history = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2
    });
    history._setDelta(5, history._allocDelta(5));
    history._setDelta(6, history._allocDelta(6));
    history._setDelta(7, history._allocDelta(7));
    history._setKeyframe(0, { tickIndex: 0 });

    history._enforceHistoryCap();
    expect(history.minDeltaTick).to.equal(5);
  });

  it('captures keyframes with ground data when dirty', function() {
    const { history, game } = createHistoryFixture();
    history._groundDirty = true;
    game.level.groundMask.mask[0] = 1;
    game.level.groundImage[0] = 5;

    const frame = history._captureKeyframe(game, 0);
    expect(frame.groundMask[0]).to.equal(1);
    expect(frame.groundImage[0]).to.equal(5);
  });

  it('diffs lemming adds, removals, and changes', function() {
    const history = new HistoryStore();
    const walkAction = { name: 'walk' };
    const manager = {
      lemmings: [
        {
          id: 0,
          x: 1,
          y: 2,
          lookRight: true,
          frameIndex: 0,
          state: 1,
          canClimb: false,
          hasParachute: false,
          removed: false,
          disabled: false,
          countdown: 0,
          hasExploded: false,
          lastTriggerType: null,
          action: walkAction,
          countdownAction: null
        },
        {
          id: 1,
          x: 3,
          y: 4,
          lookRight: false,
          frameIndex: 0,
          state: 1,
          canClimb: false,
          hasParachute: false,
          removed: false,
          disabled: false,
          countdown: 0,
          hasExploded: false,
          lastTriggerType: null,
          action: walkAction,
          countdownAction: null
        }
      ],
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map()
    };

    history._captureLemmingState(manager);
    const delta = history._allocDelta(0);

    manager.lemmings[0] = null;
    manager.lemmings[1].x = 10;
    manager.lemmings.push({
      id: 2,
      x: 5,
      y: 6,
      lookRight: true,
      frameIndex: 0,
      state: 1,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: 0,
      hasExploded: false,
      lastTriggerType: 2,
      action: walkAction,
      countdownAction: null
    });

    history._diffLemmings(manager, delta);
    expect(delta.lemRemoved).to.have.length(1);
    expect(delta.lemAdded).to.have.length(1);
    expect(delta.lemChanges.ids).to.include(1);
  });

  it('removes lemmings beyond the current length', function() {
    const history = new HistoryStore();
    const walkAction = { name: 'walk' };
    const manager = {
      lemmings: [
        { id: 0, x: 1, y: 2, lookRight: true, frameIndex: 0, state: 1, canClimb: false, hasParachute: false, removed: false, disabled: false, countdown: 0, hasExploded: false, lastTriggerType: null, action: walkAction, countdownAction: null },
        { id: 1, x: 3, y: 4, lookRight: false, frameIndex: 0, state: 1, canClimb: false, hasParachute: false, removed: false, disabled: false, countdown: 0, hasExploded: false, lastTriggerType: null, action: walkAction, countdownAction: null },
        { id: 2, x: 5, y: 6, lookRight: true, frameIndex: 0, state: 1, canClimb: false, hasParachute: false, removed: false, disabled: false, countdown: 0, hasExploded: false, lastTriggerType: null, action: walkAction, countdownAction: null }
      ],
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map()
    };

    history._captureLemmingState(manager);
    manager.lemmings.length = 1;
    const delta = history._allocDelta(0);
    history._diffLemmings(manager, delta);
    expect(delta.lemRemoved).to.have.length(2);
  });

  it('skips lemming diffs when values match', function() {
    const history = new HistoryStore();
    const delta = history._allocDelta(0);
    const store = new Int32Array(1);
    history._diffLemmingField(delta, 0, 0, 1, 1, store);
    expect(delta.lemChanges.ids).to.have.length(0);
  });

  it('compares lemming manager state including nuke targets', function() {
    const history = new HistoryStore();
    const a = {
      selectedIndex: 0,
      spawnTotal: 1,
      releaseTickIndex: 2,
      mmTickCounter: 3,
      nextNukingLemmingsIndex: 4,
      nukeTargets: [1, 2]
    };
    const b = { ...a, nukeTargets: [1, 3] };
    const c = { ...a, nukeTargets: [1, 2] };
    expect(history._lemmingManagerEqual(a, b)).to.equal(false);
    expect(history._lemmingManagerEqual(a, c)).to.equal(true);
  });

  it('diffs entrance and scalar changes', function() {
    const history = new HistoryStore();
    const skills = { selectedSkill: 0, cheatMode: false, skills: [1] };
    const victory = {
      releaseRate: 1,
      minReleaseRate: 1,
      leftCount: 1,
      outCount: 0,
      survivorCount: 0,
      isFinalize: false
    };
    const timer = { speedFactor: 1, frameTime: 60, tickIndex: 0 };
    const level = { entrances: [{ _opened: false }] };
    const game = {
      level,
      finalGameState: 0,
      getGameSkills: () => skills,
      getVictoryCondition: () => victory,
      getGameTimer: () => timer
    };

    history._captureScalarState(game);
    history._captureEntrances(level);

    const noChange = history._allocDelta(0);
    history._diffScalarState(game, noChange);
    expect(noChange.skillsChanges).to.equal(null);

    skills.selectedSkill = 1;
    victory.leftCount = 0;
    timer.tickIndex = 5;
    game.finalGameState = 2;
    level.entrances[0]._opened = true;

    const delta = history._allocDelta(0);
    history._diffScalarState(game, delta);
    history._diffEntrances(level, delta);

    expect(delta.skillsChanges).to.be.ok;
    expect(delta.victoryChanges).to.be.ok;
    expect(delta.timerChanges).to.be.ok;
    expect(delta.gameChanges).to.be.ok;
    expect(delta.entranceChanges.indices).to.have.length(1);
  });

  it('applies lemming removals, changes, and manager targets', function() {     
    const history = new HistoryStore();
    const bombAction = { name: 'bomber' };
    const walkAction = { name: 'walk' };
    const skillActions = [];
    skillActions[SkillTypes.BOMBER] = bombAction;
    const lem = { id: 0, action: null, countdownAction: null };
    const manager = {
      lemmings: [lem],
      actions: [walkAction],
      skillActions
    };

    history._applyLemmingRemovals(manager, [null, { id: NaN }, { id: 0 }]);
    expect(manager.lemmings[0]).to.equal(null);

    manager.lemmings[0] = lem;
    history._applyLemmingChanges(manager, {
      ids: [0, 0, 0],
      fields: [11, 12, 13],
      prev: [-1, -1, 0],
      next: [2, 0, 1]
    }, true);
    expect(lem.lastTriggerType).to.equal(2);
    expect(lem.action).to.equal(walkAction);
    expect(lem.countdownAction).to.equal(bombAction);

    const changes = {
      prev: {
        selectedIndex: 0,
        spawnTotal: 1,
        releaseTickIndex: 0,
        mmTickCounter: 0,
        nextNukingLemmingsIndex: 0,
        nukeTargets: []
      },
      next: {
        selectedIndex: 2,
        spawnTotal: 2,
        releaseTickIndex: 1,
        mmTickCounter: 1,
        nextNukingLemmingsIndex: 1,
        nukeTargets: [0]
      }
    };
    history._applyLemmingManagerState(manager, changes, true);
    expect(manager._nukeTargets).to.eql([lem]);
  });

  it('resets entrance tracking when entrance list changes', function() {
    const history = new HistoryStore();
    const level = { entrances: [{ _opened: false }] };
    const delta = history._allocDelta(0);
    history._captureEntrances(level);
    level.entrances.push({ _opened: true });
    history._diffEntrances(level, delta);
    expect(history._entranceOpened).to.have.length(2);
  });

  it('captures null lemmings in baseline state', function() {
    const history = new HistoryStore();
    const walkAction = { name: 'walk' };
    const manager = {
      lemmings: [
        null,
        {
          id: 1,
          x: 1,
          y: 2,
          lookRight: true,
          frameIndex: 0,
          state: 0,
          canClimb: false,
          hasParachute: false,
          removed: false,
          disabled: false,
          countdown: 0,
          hasExploded: false,
          lastTriggerType: null,
          action: walkAction,
          countdownAction: null
        }
      ],
      actions: [walkAction],
      skillActions: [],
      actionTypeByAction: new Map([[walkAction, 0]])
    };

    history._captureLemmingState(manager);
    expect(history._lemmingState.present[0]).to.equal(0);
    expect(history._lemmingState.present[1]).to.equal(1);
  });

  it('handles helper defaults and early exits', function() {
    const history = new HistoryStore();
    const state = __test__.createLemmingState(1);

    __test__.cloneLemmingState(state, null);
    __test__.cloneLemmingState(state, 1);

    const delta = history._allocDelta(0);
    history.options.deltaPoolLimit = null;
    history._releaseDelta(delta);
    expect(history._deltaPool).to.have.length(1);

    history.options.deltaPoolLimit = 0;
    history._releaseDelta(history._allocDelta(1));
    expect(history._deltaPool).to.have.length(0);

    history._bindTimer();
    history.attach(null);
    history.start();
    history.truncateAfter(NaN);
    history.beginTick(0);
    history.captureBaseline(null);

    history.recordSoundEvent({});
    history.recordGroundChange(0, 0, 0, 0, 0, 0, 0, 0, 0);
    history.recordEntranceChange(0, false, false);
    history.recordTriggerCooldown(null, 0, 0);
    history.recordTriggerAdd(null, {});
    history.recordTriggerRemove(null, {});
    history.recordObjectAnimation(
      {},
      { firstFrameIndex: 0, isFinished: false },
      { firstFrameIndex: 0, isFinished: false }
    );
    history.recordMinimapDeath({});

    const historyWithTimer = new HistoryStore();
    const timer = createStubTimer();
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getGameTimer: () => timer,
      getLemmingManager: () => ({ lemmings: [] }),
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    historyWithTimer.attach(game, { captureBaseline: false });
    expect(historyWithTimer.timer).to.equal(timer);

    const historyNoTimer = new HistoryStore();
    const gameNoTimer = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => ({ lemmings: [] }),
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    historyNoTimer.attach(gameNoTimer, { captureBaseline: false });
    expect(historyNoTimer.timer).to.equal(null);
  });

  it('records changes with boolean conversions and ids', function() {
    const history = new HistoryStore();
    history._recording = true;
    history.beginTick(0);

    history.recordEntranceChange(0, false, true);
    history.recordEntranceChange(1, true, false);

    const obj = {};
    history.recordObjectAnimation(
      obj,
      { firstFrameIndex: 1, isFinished: false },
      { firstFrameIndex: 2, isFinished: true }
    );
    history.recordObjectAnimation(
      obj,
      { firstFrameIndex: 2, isFinished: true },
      { firstFrameIndex: 3, isFinished: false }
    );

    const trigger = new Trigger(TriggerTypes.TRAP, 0, 0, 1, 1);
    history.recordTriggerCooldown(trigger, 0, 2);
    history.recordTriggerAdd(trigger, {
      type: trigger.type,
      x1: trigger.x1,
      y1: trigger.y1,
      x2: trigger.x2,
      y2: trigger.y2,
      disableTicksCount: trigger.disableTicksCount,
      soundIndex: trigger.soundIndex,
      ownerId: null
    });
    history.recordTriggerRemove(trigger, {
      type: trigger.type,
      x1: trigger.x1,
      y1: trigger.y1,
      x2: trigger.x2,
      y2: trigger.y2,
      disableTicksCount: trigger.disableTicksCount,
      soundIndex: trigger.soundIndex,
      ownerId: null
    });
    history.recordMinimapDeath({ x: 1, y: 2, ttl: 3, prevCount: 0 });

    const existingTrigger = { __historyId: 9 };
    expect(history._ensureTriggerId(existingTrigger)).to.equal(9);
    expect(history._ensureTriggerId(null)).to.equal(0);
    const newTrigger = {};
    expect(history._ensureTriggerId(newTrigger)).to.be.greaterThan(0);

    const existingObj = { __historyId: 11 };
    expect(history._ensureObjectId(existingObj)).to.equal(11);
    expect(history._ensureObjectId(null)).to.equal(0);
    const newObj = {};
    expect(history._ensureObjectId(newObj)).to.be.greaterThan(0);
  });

  it('covers keyframe search branches', function() {
    const history = new HistoryStore();
    history.keyframeTicks = [2, 4];
    history._insertKeyframeTick(1);
    history._insertKeyframeTick(3);
    expect(history.keyframeTicks).to.eql([1, 2, 3, 4]);

    history.keyframes[2] = { tickIndex: 2 };
    history.keyframes[3] = { tickIndex: 3 };
    history.keyframes[4] = { tickIndex: 4 };
    expect(history.getKeyframeAtOrBefore(3).tickIndex).to.equal(3);

    history.keyframeTicks = [5, 10];
    history.keyframes[5] = { tickIndex: 5 };
    history.keyframes[10] = { tickIndex: 10 };
    expect(history.getKeyframeAtOrBefore(6).tickIndex).to.equal(5);

    history.keyframeTicks = [7];
    history.keyframes[7] = undefined;
    expect(history.getKeyframeAtOrBefore(7)).to.equal(null);
  });

  it('handles truncation edge cases', function() {
    const empty = new HistoryStore();
    empty._truncateDeltasAfter(1);
    empty._truncateKeyframesAfter(1);
    empty._truncateBefore(1);

    const history = new HistoryStore();
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(1, history._allocDelta(1));
    history._truncateDeltasAfter(1);
    expect(history.maxDeltaTick).to.equal(1);

    const historyGap = new HistoryStore();
    historyGap._setDelta(0, historyGap._allocDelta(0));
    historyGap._setDelta(3, historyGap._allocDelta(3));
    historyGap._truncateDeltasAfter(1);
    expect(historyGap.maxDeltaTick).to.equal(0);

    const historyAll = new HistoryStore();
    historyAll._setDelta(2, historyAll._allocDelta(2));
    historyAll._truncateDeltasAfter(1);
    expect(historyAll.minDeltaTick).to.equal(null);

    const keyframesAll = new HistoryStore();
    keyframesAll._setKeyframe(2, { tickIndex: 2 });
    keyframesAll._setKeyframe(3, { tickIndex: 3 });
    keyframesAll._truncateKeyframesAfter(1);
    expect(keyframesAll.keyframeTicks).to.have.length(0);

    const keyframesMissing = new HistoryStore();
    keyframesMissing.keyframeTicks = [5];
    keyframesMissing.keyframes[5] = undefined;
    keyframesMissing.minKeyframeTick = 5;
    keyframesMissing.maxKeyframeTick = 5;
    keyframesMissing._truncateKeyframesAfter(5);
    expect(keyframesMissing._lastKeyframe).to.equal(null);

    const beforeGap = new HistoryStore();
    beforeGap._setDelta(0, beforeGap._allocDelta(0));
    beforeGap._setDelta(3, beforeGap._allocDelta(3));
    beforeGap._setKeyframe(0, { tickIndex: 0 });
    beforeGap._setKeyframe(3, { tickIndex: 3 });
    beforeGap._truncateBefore(2);
    expect(beforeGap.minDeltaTick).to.equal(3);

    const beforeAll = new HistoryStore();
    beforeAll._setDelta(0, beforeAll._allocDelta(0));
    beforeAll._setKeyframe(0, { tickIndex: 0 });
    beforeAll._truncateBefore(2);
    expect(beforeAll.minDeltaTick).to.equal(null);
    expect(beforeAll.keyframeTicks).to.have.length(0);

    const beforeLast = new HistoryStore();
    beforeLast._setDelta(0, beforeLast._allocDelta(0));
    beforeLast.keyframeTicks = [2];
    beforeLast.keyframes[2] = undefined;
    beforeLast.minKeyframeTick = 2;
    beforeLast.maxKeyframeTick = 2;
    beforeLast._truncateBefore(0);
    expect(beforeLast._lastKeyframe).to.equal(null);

    const historySpan = new HistoryStore();
    historySpan._setDelta(0, historySpan._allocDelta(0));
    historySpan._setDelta(5, historySpan._allocDelta(5));
    historySpan._truncateDeltasAfter(3);
    expect(historySpan.maxDeltaTick).to.equal(0);

    const historyClear = new HistoryStore();
    historyClear._setDelta(5, historyClear._allocDelta(5));
    historyClear._truncateDeltasAfter(3);
    expect(historyClear.minDeltaTick).to.equal(null);

    const beforeSpan = new HistoryStore();
    beforeSpan._setDelta(0, beforeSpan._allocDelta(0));
    beforeSpan._setDelta(5, beforeSpan._allocDelta(5));
    beforeSpan._truncateBefore(2);
    expect(beforeSpan.minDeltaTick).to.equal(5);

    const beforeClear = new HistoryStore();
    beforeClear._setDelta(0, beforeClear._allocDelta(0));
    beforeClear._truncateBefore(2);
    expect(beforeClear.maxDeltaTick).to.equal(null);
  });

  it('handles history warning and cap edge cases', function() {
    const history = new HistoryStore({ historyWarnTicks: 5 });
    history._maybeWarnHistory();
    history._setDelta(0, history._allocDelta(0));
    history._setDelta(1, history._allocDelta(1));
    history._maybeWarnHistory();

    const capDefault = new HistoryStore({ enableHistoryCap: true });
    capDefault.options.historyCapTicks = null;
    capDefault._enforceHistoryCap();

    const capEmpty = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2
    });
    capEmpty._enforceHistoryCap();

    const capWithFrame = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2
    });
    capWithFrame._setDelta(0, capWithFrame._allocDelta(0));
    capWithFrame._setDelta(1, capWithFrame._allocDelta(1));
    capWithFrame._setDelta(2, capWithFrame._allocDelta(2));
    capWithFrame._setKeyframe(0, { tickIndex: 0 });
    capWithFrame._enforceHistoryCap();
    expect(capWithFrame.minDeltaTick).to.equal(0);

    const capNoFrame = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2
    });
    capNoFrame._setDelta(0, capNoFrame._allocDelta(0));
    capNoFrame._setDelta(1, capNoFrame._allocDelta(1));
    capNoFrame._setDelta(2, capNoFrame._allocDelta(2));
    capNoFrame._enforceHistoryCap();
    expect(capNoFrame.minDeltaTick).to.equal(1);
  });

  it('diffs lemmings through state transitions', function() {
    const history = new HistoryStore();
    history._captureLemmingState(null);

    const walk = { name: 'walk' };
    const manager = {
      lemmings: [{
        id: 0,
        x: 1,
        y: 2,
        lookRight: true,
        frameIndex: 0,
        state: 1,
        canClimb: true,
        hasParachute: true,
        removed: false,
        disabled: false,
        countdown: 3,
        hasExploded: false,
        lastTriggerType: 4,
        action: walk,
        countdownAction: null
      }],
      actions: [walk],
      skillActions: [],
      actionTypeByAction: new Map([[walk, 0]])
    };

    history._captureLemmingState({
      lemmings: [null],
      actions: [walk],
      skillActions: [],
      actionTypeByAction: new Map()
    });

    history._captureLemmingState(manager);

    const delta = history._allocDelta(0);
    manager.lemmings[0].lookRight = false;
    manager.lemmings[0].state = null;
    manager.lemmings[0].canClimb = false;
    manager.lemmings[0].hasParachute = false;
    manager.lemmings[0].removed = true;
    manager.lemmings[0].disabled = true;
    manager.lemmings[0].countdown = null;
    manager.lemmings[0].hasExploded = true;
    manager.lemmings[0].lastTriggerType = NaN;
    manager.lemmings[0].countdownAction = {};
    history._diffLemmings(manager, delta);

    const delta2 = history._allocDelta(1);
    manager.lemmings[0].lookRight = true;
    manager.lemmings[0].state = 2;
    manager.lemmings[0].canClimb = true;
    manager.lemmings[0].hasParachute = true;
    manager.lemmings[0].removed = false;
    manager.lemmings[0].disabled = false;
    manager.lemmings[0].countdown = 4;
    manager.lemmings[0].hasExploded = false;
    manager.lemmings[0].lastTriggerType = 2;
    manager.lemmings[0].countdownAction = null;
    history._diffLemmings(manager, delta2);

    const delta3 = history._allocDelta(2);
    manager.lemmings[0] = null;
    history._diffLemmings(manager, delta3);

    const delta4 = history._allocDelta(3);
    history._diffLemmings(null, delta4);
    history._diffLemmings({}, delta4);

    const historyNew = new HistoryStore();
    const managerNew = {
      lemmings: [{
        id: 0,
        x: 1,
        y: 1,
        lookRight: true,
        frameIndex: 0,
        state: 0,
        canClimb: false,
        hasParachute: false,
        removed: false,
        disabled: false,
        countdown: 0,
        hasExploded: false,
        lastTriggerType: null,
        action: null,
        countdownAction: null
      }],
      actions: [],
      skillActions: [],
      actionTypeByAction: new Map()
    };
    const deltaNew = historyNew._allocDelta(0);
    historyNew._diffLemmings(managerNew, deltaNew);
  });

  it('handles lemming manager comparisons with mismatches', function() {
    const history = new HistoryStore();
    expect(history._readLemmingManager(null)).to.equal(null);

    const readManager = {
      selectedIndex: 1,
      spawnTotal: 2,
      releaseTickIndex: 3,
      mmTickCounter: 4,
      nextNukingLemmingsIndex: 5,
      _nukeTargets: [{ id: 7 }, {}]
    };
    const readState = history._readLemmingManager(readManager);
    expect(readState.nukeTargets).to.eql([7, null]);

    const base = {
      selectedIndex: 1,
      spawnTotal: 2,
      releaseTickIndex: 3,
      mmTickCounter: 4,
      nextNukingLemmingsIndex: 5,
      nukeTargets: [1, 2]
    };
    expect(history._lemmingManagerEqual(null, null)).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, selectedIndex: 0 })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, spawnTotal: 3 })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, releaseTickIndex: 4 })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, mmTickCounter: 5 })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, nextNukingLemmingsIndex: 6 })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, nukeTargets: [1] })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base, nukeTargets: [1, 3] })).to.equal(false);
    expect(history._lemmingManagerEqual(base, { ...base })).to.equal(true);
  });

  it('writes lemming state defaults and resolves action types', function() {
    const history = new HistoryStore();
    const state = __test__.createLemmingState(1);
    const action = { name: 'walk' };

    const lemFalse = {
      id: 0,
      x: 0,
      y: 0,
      lookRight: false,
      frameIndex: 0,
      state: null,
      canClimb: false,
      hasParachute: false,
      removed: false,
      disabled: false,
      countdown: null,
      hasExploded: false,
      lastTriggerType: NaN
    };
    history._writeLemmingState(state, 0, lemFalse, NaN, false);

    const lemTrue = {
      id: 0,
      x: 1,
      y: 2,
      lookRight: true,
      frameIndex: 3,
      state: 4,
      canClimb: true,
      hasParachute: true,
      removed: true,
      disabled: true,
      countdown: 5,
      hasExploded: true,
      lastTriggerType: 2
    };
    history._writeLemmingState(state, 0, lemTrue, 1, true);

    const manager = {
      actions: [action],
      actionTypeByAction: new Map([[action, 0]])
    };
    expect(history._getActionType(null, action)).to.equal(-1);
    expect(history._getActionType(manager, null)).to.equal(-1);

    const managerNoMap = { actions: [action], actionTypeByAction: new Map() };
    expect(history._getActionType(managerNoMap, action)).to.equal(0);

    const managerNoActions = { actionTypeByAction: new Map() };
    expect(history._getActionType(managerNoActions, action)).to.equal(-1);
  });

  it('captures and diffs entrances with changes', function() {
    const history = new HistoryStore();
    history._captureEntrances(null);
    history._diffEntrances(null, history._allocDelta(0));

    const level = { entrances: [{ _opened: true }, { _opened: false }, null] };
    history._captureEntrances(level);
    const delta = history._allocDelta(1);
    history._diffEntrances(level, delta);

    level.entrances[0]._opened = false;
    level.entrances[1]._opened = true;
    history._diffEntrances(level, delta);
    expect(delta.entranceChanges.indices).to.have.length(2);

    level.entrances.push({ _opened: true });
    const delta2 = history._allocDelta(2);
    history._diffEntrances(level, delta2);
    expect(history._entranceOpened).to.have.length(4);
  });

  it('compares scalar state snapshots', function() {
    const history = new HistoryStore();
    expect(history._readSkills(null)).to.equal(null);
    expect(history._readVictory(null)).to.equal(null);
    expect(history._readTimer(null)).to.equal(null);
    expect(history._readGameState(null)).to.equal(null);

    const skills = { selectedSkill: 1, cheatMode: true, skills: [1, 2] };
    const skillsState = history._readSkills(skills);
    expect(history._skillsEqual(skillsState, { ...skillsState })).to.equal(true);
    expect(history._skillsEqual(skillsState, { ...skillsState, selectedSkill: 2 })).to.equal(false);
    expect(history._skillsEqual(skillsState, { ...skillsState, cheatMode: false })).to.equal(false);
    expect(history._skillsEqual(skillsState, { ...skillsState, skills: [1] })).to.equal(false);
    expect(history._skillsEqual(skillsState, { ...skillsState, skills: [1, 3] })).to.equal(false);
    expect(history._skillsEqual(skillsState, { selectedSkill: 1, cheatMode: true })).to.equal(false);
    expect(history._skillsEqual(null, skillsState)).to.equal(false);

    const victory = {
      releaseRate: 1,
      minReleaseRate: 1,
      leftCount: 1,
      outCount: 0,
      survivorCount: 0,
      isFinalize: false
    };
    const victoryState = history._readVictory(victory);
    expect(history._victoryEqual(victoryState, { ...victoryState })).to.equal(true);
    expect(history._victoryEqual(victoryState, { ...victoryState, outCount: 1 })).to.equal(false);
    expect(history._victoryEqual(null, victoryState)).to.equal(false);

    const timer = { speedFactor: 1, frameTime: 60, tickIndex: 0 };
    const timerState = history._readTimer(timer);
    expect(history._timerEqual(timerState, { ...timerState })).to.equal(true);
    expect(history._timerEqual(timerState, { ...timerState, tickIndex: 1 })).to.equal(false);
    expect(history._timerEqual(null, timerState)).to.equal(false);

    const gameState = history._readGameState({ finalGameState: 1 });
    expect(history._gameStateEqual(gameState, { finalGameState: 1 })).to.equal(true);
    expect(history._gameStateEqual(gameState, { finalGameState: 2 })).to.equal(false);
    expect(history._gameStateEqual(null, gameState)).to.equal(false);
  });

  it('applies lemming adds and changes across fields', function() {
    const history = new HistoryStore();
    history._applyDelta(null, null, true);

    const walkAction = { name: 'walk' };
    const bombAction = { name: 'bomb' };

    const manager = {
      lemmings: null,
      actions: [walkAction]
    };

    const addList = [{
      id: 0,
      x: 1,
      y: 2,
      lookRight: 1,
      frameIndex: 0,
      state: 0,
      canClimb: 0,
      hasParachute: 0,
      removed: 0,
      disabled: 0,
      countdown: 0,
      hasExploded: 0,
      lastTriggerType: -1,
      actionType: -1,
      countdownActive: 0
    }];
    history._applyLemmingAdds(manager, addList);
    expect(Array.isArray(manager.lemmings)).to.equal(true);

    const missingChanges = { ids: [1], fields: [0], prev: [0], next: [1] };
    history._applyLemmingChanges(manager, missingChanges, true);

    manager.skillActions = [];
    manager.skillActions[SkillTypes.BOMBER] = bombAction;

    history._applyLemmingAdds(manager, [{
      id: 1,
      x: 3,
      y: 4,
      lookRight: 1,
      frameIndex: 0,
      state: 0,
      canClimb: 0,
      hasParachute: 0,
      removed: 0,
      disabled: 0,
      countdown: 0,
      hasExploded: 0,
      lastTriggerType: -1,
      actionType: -1,
      countdownActive: 1
    }]);

    const lem = manager.lemmings[0];
    const fields = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 12, 12, 13, 13, 99];
    const ids = new Array(fields.length).fill(0);
    const next = [
      10, 20, 1, 3, 4, 1, 1, 1, 1, 7, 1,
      -1, 2,
      -1, 0,
      0, 1,
      0
    ];
    const prev = new Array(fields.length).fill(0);
    const changes = { ids, fields, prev, next };
    history._applyLemmingChanges(manager, changes, true);

    expect(lem.x).to.equal(10);
    expect(lem.y).to.equal(20);
    expect(lem.lookRight).to.equal(true);
    expect(lem.frameIndex).to.equal(3);
    expect(lem.state).to.equal(4);
    expect(lem.canClimb).to.equal(true);
    expect(lem.hasParachute).to.equal(true);
    expect(lem.removed).to.equal(true);
    expect(lem.disabled).to.equal(true);
    expect(lem.countdown).to.equal(7);
    expect(lem.hasExploded).to.equal(true);
    expect(lem.lastTriggerType).to.equal(2);
    expect(lem.action).to.equal(walkAction);
    expect(lem.countdownAction).to.equal(bombAction);

    const managerNoSkill = { lemmings: [{ id: 0 }], actions: [walkAction] };
    history._applyLemmingChanges(
      managerNoSkill,
      { ids: [0], fields: [2], prev: [0], next: [1] },
      true
    );
  });

  it('applies manager state defaults and rebuilds active list', function() {
    const history = new HistoryStore();
    history._applyLemmingManagerState(null, null, true);
    history._rebuildActiveLemmings(null);

    const lem = { id: 0, removed: false };
    const manager = { lemmings: [lem] };
    history._applyLemmingManagerState(manager, {
      next: {
        selectedIndex: 2,
        spawnTotal: 3,
        releaseTickIndex: 4,
        mmTickCounter: 5,
        nextNukingLemmingsIndex: 6,
        nukeTargets: [0]
      }
    }, true);
    expect(manager._nukeTargets).to.eql([lem]);

    history._applyLemmingManagerState(manager, {
      next: { nukeTargets: null }
    }, true);
    expect(manager.selectedIndex).to.equal(-1);
    expect(manager.spawnTotal).to.equal(0);
    expect(manager.releaseTickIndex).to.equal(0);
    expect(manager.mmTickCounter).to.equal(0);
    expect(manager.nextNukingLemmingsIndex).to.equal(-1);
    expect(manager._nukeTargets).to.equal(null);

    history._applyLemmingManagerState(manager, { next: null }, true);
  });

  it('handles entrance and ground change fallbacks', function() {
    const history = new HistoryStore();
    history._applyEntranceChanges(null, null, true);
    history._applyGroundChanges(null, null, true);

    const level = {
      entrances: [{ _opened: false }],
      groundMask: { mask: new Uint8Array(1) },
      groundImage: new Uint8ClampedArray(4)
    };
    const entranceChanges = { indices: [0], prev: [0], next: [1] };
    history._applyEntranceChanges(level, entranceChanges, true);
    expect(level.entrances[0]._opened).to.equal(true);

    const groundChanges = {
      spans: null,
      indices: [0],
      prevMask: [0],
      prevR: [0],
      prevG: [0],
      prevB: [0],
      nextMask: [1],
      nextR: [1],
      nextG: [2],
      nextB: [3]
    };
    history._applyGroundChanges(level, groundChanges, false);
    expect(level.groundMask.mask[0]).to.equal(0);
  });

  it('applies trigger changes and resolves ids', function() {
    const history = new HistoryStore();
    const owner = { id: 1 };
    const cooldownOwner = { id: 2 };
    const manager = {
      lemmings: [owner, cooldownOwner],
      getLemming: (id) => (id === 1 ? owner : cooldownOwner)
    };
    const triggerManager = {
      _triggers: new Set(),
      add(trigger) { this._triggers.add(trigger); },
      removeByOwner(ownerTarget) {
        for (const trig of Array.from(this._triggers)) {
          if (trig.owner === ownerTarget) this._triggers.delete(trig);
        }
      }
    };
    const existing = new Trigger(TriggerTypes.TRAP, 0, 0, 1, 1, 0, 0, owner);
    existing.__historyId = 2;
    existing.disabledUntilTick = 5;
    triggerManager._triggers.add(existing);

    const cooldown = new Trigger(TriggerTypes.TRAP, 2, 2, 3, 3, 0, 0, cooldownOwner);
    cooldown.__historyId = 3;
    triggerManager._triggers.add(cooldown);

    const game = { triggerManager, getLemmingManager: () => manager };
    const delta = {
      triggerAdd: [{
        id: 10,
        type: TriggerTypes.KILL,
        x1: 1,
        y1: 1,
        x2: 2,
        y2: 2,
        disableTicksCount: 0,
        soundIndex: 1,
        ownerId: null
      }],
      triggerRemove: [{ id: 2 }],
      triggerCooldownChanges: { ids: [3, 99], prev: [0, 0], next: [7, 8] }
    };

    history._applyTriggerChanges(game, delta, true);
    expect(triggerManager._triggers.has(existing)).to.equal(false);
    const added = Array.from(triggerManager._triggers)
      .find(trig => trig.__historyId === 10);
    expect(added).to.be.ok;
    expect(added.disabledUntilTick).to.equal(0);
    expect(cooldown.disabledUntilTick).to.equal(7);

    const found = history._findTriggerById(triggerManager, 3);
    expect(found).to.equal(cooldown);
    expect(history._findTriggerById(triggerManager, 123)).to.equal(null);
    expect(history._findTriggerById({}, 5)).to.equal(null);

    history._applyTriggerChanges(game, { triggerAdd: [], triggerRemove: null }, true);
    history._applyTriggerChanges(game, { triggerAdd: null, triggerRemove: [] }, true);
  });

  it('reads and applies trigger state with missing data', function() {
    const history = new HistoryStore();
    const owner = { id: 1 };
    const staticTrigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 5, null);
    const dynamicTrigger = new Trigger(TriggerTypes.KILL, 3, 3, 4, 4, 0, 7, owner);
    const orphanTrigger = new Trigger(TriggerTypes.KILL, 5, 5, 6, 6, 0, 8, { id: NaN });
    const level = { triggers: [null, staticTrigger] };
    const triggerManager = {
      _triggers: new Set([staticTrigger, dynamicTrigger, orphanTrigger]),
      add(trigger) { this._triggers.add(trigger); },
      removeByOwner(ownerTarget) {
        for (const trig of Array.from(this._triggers)) {
          if (trig.owner === ownerTarget) this._triggers.delete(trig);
        }
      }
    };
    const game = {
      level,
      triggerManager,
      getLemmingManager: () => ({ getLemming: (id) => (id === 1 ? owner : null) })
    };
    const state = history._readTriggerState(game);
    expect(state.staticTriggers).to.have.length(1);
    expect(state.dynamicTriggers).to.have.length(1);

    const stateNoTriggers = history._readTriggerState({
      level: {},
      triggerManager: { _triggers: new Set() }
    });
    expect(stateNoTriggers.staticTriggers).to.have.length(0);

    history._applyTriggerState({ level: null, triggerManager: null }, null);

    const applyGameEmpty = {
      level: { triggers: [staticTrigger, null] },
      triggerManager: { _triggers: undefined, add() {}, removeByOwner() {} },
      getLemmingManager: () => null
    };
    history._applyTriggerState(applyGameEmpty, { staticTriggers: state.staticTriggers });

    const applyGameNoList = {
      level: {},
      triggerManager: { _triggers: undefined, add() {}, removeByOwner() {} },
      getLemmingManager: () => null
    };
    history._applyTriggerState(applyGameNoList, {
      dynamicTriggers: [{
        id: 99,
        ownerId: null,
        type: TriggerTypes.TRAP,
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        disableTicksCount: 0,
        soundIndex: 0,
        disabledUntilTick: 0
      }]
    });

    const missingOwnerTrigger = new Trigger(TriggerTypes.KILL, 2, 2, 3, 3, 0, 0, { id: 2 });
    const applyManager = {
      _triggers: new Set([dynamicTrigger, missingOwnerTrigger]),
      add(trigger) { this._triggers.add(trigger); },
      removeByOwner(ownerTarget) {
        for (const trig of Array.from(this._triggers)) {
          if (trig.owner === ownerTarget) this._triggers.delete(trig);
        }
      }
    };
    const applyGame = {
      level: { triggers: [staticTrigger, null] },
      triggerManager: applyManager,
      getLemmingManager: () => ({ getLemming: (id) => (id === 1 ? owner : null) })
    };
    const applyState = {
      staticTriggers: state.staticTriggers,
      dynamicTriggers: [{
        id: 10,
        ownerId: 1,
        type: TriggerTypes.TRAP,
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        disableTicksCount: 0,
        soundIndex: 0,
        disabledUntilTick: 2
      }, {
        id: 11,
        ownerId: 2,
        type: TriggerTypes.KILL,
        x1: 1,
        y1: 1,
        x2: 2,
        y2: 2,
        disableTicksCount: 0,
        soundIndex: 0,
        disabledUntilTick: 0
      }]
    };
    history._applyTriggerState(applyGame, applyState);
  });

  it('handles object state and changes with missing animations', function() {
    const history = new HistoryStore();
    const obj = { animation: { firstFrameIndex: 0, isFinished: false } };
    const level = { objects: [obj, {}] };

    const state = history._readObjectState(level);
    expect(state).to.have.length(1);

    const objId = history._ensureObjectId(obj);
    const changes = {
      ids: [objId, 999],
      prevFirst: [0, 0],
      prevFinished: [0, 0],
      nextFirst: [2, 1],
      nextFinished: [1, 1]
    };
    history._applyObjectChanges(level, changes, true);
    expect(obj.animation.firstFrameIndex).to.equal(2);

    obj.animation = null;
    history._applyObjectChanges(level, {
      ids: [objId],
      prevFirst: [0],
      prevFinished: [0],
      nextFirst: [1],
      nextFinished: [1]
    }, true);

    history._objectById = new Map();
    history._applyObjectChanges({}, {
      ids: [objId],
      prevFirst: [0],
      prevFinished: [0],
      nextFirst: [1],
      nextFinished: [1]
    }, true);

    history._applyObjectState(level, null);

    history._objectById = new Map();
    const entries = [{ id: objId, firstFrameIndex: 5, isFinished: true }];
    obj.animation = { firstFrameIndex: 0, isFinished: false };
    history._applyObjectState(level, entries);
    expect(obj.animation.firstFrameIndex).to.equal(5);

    obj.animation = null;
    history._applyObjectState(level, entries);

    history._applyObjectState(null, [{
      id: 123,
      firstFrameIndex: 0,
      isFinished: false
    }]);
  });

  it('applies minimap deaths and reads defaults', function() {
    const history = new HistoryStore();
    const manager = {
      miniMap: {
        deadDots: new Uint8Array(0),
        deadTTLs: new Uint8Array(0)
      }
    };

    history._applyMinimapDeaths(manager, [{
      x: undefined,
      y: undefined,
      ttl: undefined,
      prevCount: undefined
    }], true);
    expect(manager.miniMap.deadDots[0]).to.equal(0);
    expect(manager.miniMap.deadTTLs[0]).to.equal(0);

    history._applyMinimapDeaths(manager, [{
      x: 2,
      y: 3,
      ttl: 4,
      prevCount: 1
    }], true);

    history._applyMinimapDeaths(manager, [{ prevCount: 1 }, {}], false);
    expect(manager.miniMap.deadCount).to.equal(1);

    const minimapState = history._readMinimapState({
      deadDots: null,
      deadTTLs: null,
      deadCount: undefined
    });
    expect(minimapState.deadDots).to.be.instanceof(Uint8Array);
    expect(minimapState.deadTTLs).to.be.instanceof(Uint8Array);
    expect(minimapState.deadCount).to.equal(0);
  });

  it('captures keyframes without level data', function() {
    const history = new HistoryStore();
    const game = {
      finalGameState: 0,
      getLemmingManager: () => ({ lemmings: [] }),
      getGameTimer: () => null,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const frame = history._captureKeyframe(game, 0);
    expect(frame.entranceOpened).to.have.length(0);
    expect(frame.groundMask).to.equal(null);

    const gameWithLevel = {
      level: { entrances: [{ _opened: true }, { _opened: false }] },
      finalGameState: 0,
      getLemmingManager: () => ({ lemmings: [] }),
      getGameTimer: () => null,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const frameWithLevel = history._captureKeyframe(gameWithLevel, 1);
    expect(frameWithLevel.entranceOpened[0]).to.equal(1);
    expect(frameWithLevel.entranceOpened[1]).to.equal(0);
  });

  it('captures interval keyframes during endTick', function() {
    const { history, timer } = createHistoryFixture();
    history.beginTick(0);
    timer.tickIndex = 5;
    history.endTick();
    expect(history.getKeyframe(5)).to.be.ok;
  });

  it('binds before tick handlers when timers provide hooks', function() {
    const timer = {
      tickIndex: 0,
      speedFactor: 1,
      frameTime: 60,
      onBeforeGameTick: new EventHandler(),
      onGameTick: new EventHandler()
    };
    const manager = { lemmings: [], actions: [], skillActions: [] };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => timer,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const history = new HistoryStore();
    history.attach(game, { captureBaseline: true });
    timer.onBeforeGameTick.trigger(3);
    expect(history._currentTick).to.equal(3);
  });

  it('applies keyframes without nuke targets arrays', function() {
    const { history, game, manager } = createHistoryFixture();
    history.applyKeyframe(game, {
      lemmingManagerState: { nukeTargets: null }
    });
    expect(manager._nukeTargets).to.equal(null);
  });

  it('applies minimap keyframe defaults', function() {
    const { history, game, manager } = createHistoryFixture();
    manager.miniMap = {
      deadDots: new Uint8Array([1, 2]),
      deadTTLs: new Uint8Array([3]),
      deadCount: 1
    };
    history.applyKeyframe(game, {
      minimapState: { deadDots: null, deadTTLs: null, deadCount: undefined }
    });
    expect(manager.miniMap.deadDots).to.have.length(0);
    expect(manager.miniMap.deadTTLs).to.have.length(0);
    expect(manager.miniMap.deadCount).to.equal(0);
  });

  it('skips applyKeyframe when inputs are missing', function() {
    const history = new HistoryStore();
    history.applyKeyframe(null, { lemmingState: {} });
    history.applyKeyframe({ getLemmingManager: () => ({}) }, null);
  });

  it('initializes missing lemming arrays during keyframe apply', function() {
    const history = new HistoryStore();
    const manager = { actions: [], skillActions: [] };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => null,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const lemmingState = __test__.createLemmingState(1);
    lemmingState.present[0] = 1;
    lemmingState.x[0] = 2;
    lemmingState.y[0] = 3;
    lemmingState.actionType[0] = -1;
    history.applyKeyframe(game, { lemmingState });
    expect(Array.isArray(manager.lemmings)).to.equal(true);
    expect(manager.lemmings[0]).to.be.ok;
  });

  it('applies keyframe action and entrance fallbacks', function() {
    const { history, game, manager, walkAction } = createHistoryFixture();
    game.level.entrances = undefined;
    manager.actions = [walkAction];

    const lemmingState = __test__.createLemmingState(1);
    lemmingState.present[0] = 1;
    lemmingState.x[0] = 1;
    lemmingState.y[0] = 2;
    lemmingState.actionType[0] = -1;

    history.applyKeyframe(game, {
      lemmingState,
      lemmingManagerState: { nukeTargets: [NaN] },
      entranceOpened: new Uint8Array(0)
    });

    expect(manager.lemmings[0].action).to.equal(null);
    expect(manager._nukeTargets).to.eql([]);
  });

  it('constructs lemmings from keyframes without skill actions', function() {
    const history = new HistoryStore();
    const ctorCalls = [];
    const LemCtor = function(x, y, id) {
      this.id = id;
      this.x = x;
      this.y = y;
      ctorCalls.push([x, y, id]);
    };
    const manager = { lemmings: [], actions: [], _lemmingCtor: LemCtor };
    const game = {
      level: { entrances: [] },
      finalGameState: 0,
      getLemmingManager: () => manager,
      getGameTimer: () => null,
      getGameSkills: () => null,
      getVictoryCondition: () => null
    };
    const lemmingState = __test__.createLemmingState(1);
    lemmingState.present[0] = 1;
    lemmingState.x[0] = 4;
    lemmingState.y[0] = 5;
    lemmingState.actionType[0] = -1;
    history.applyKeyframe(game, { lemmingState });
    expect(manager.lemmings[0]).to.be.ok;
    expect(ctorCalls).to.have.length(1);

    manager._lemmingCtor = null;
    manager.lemmings = [];
    lemmingState.x[0] = 7;
    lemmingState.y[0] = 8;
    history.applyKeyframe(game, { lemmingState });
    expect(manager.lemmings[0]).to.be.ok;
  });
});
