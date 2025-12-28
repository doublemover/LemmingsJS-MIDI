import { expect } from 'chai';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

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
    history._setDelta(0, { tick: 0 });
    history._setDelta(2, { tick: 2 });
    history._setKeyframe(0, { tickIndex: 0 });
    history._setKeyframe(2, { tickIndex: 2 });

    history.truncateAfter(0);
    expect(!!history.deltas[2]).to.equal(false);
    expect(!!history.keyframes[2]).to.equal(false);

    history._setDelta(2, { tick: 2 });
    history._setKeyframe(2, { tickIndex: 2 });
    history.setPreserveFutureHistory(true);
    history.truncateAfter(0);
    expect(!!history.deltas[2]).to.equal(true);
    expect(!!history.keyframes[2]).to.equal(true);
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
      history._setDelta(0, { tick: 0 });
      history._setDelta(1, { tick: 1 });
      history._maybeWarnHistory();
      expect(warnings).to.have.length(1);
      history._maybeWarnHistory();
      expect(warnings).to.have.length(1);

      history._setDelta(2, { tick: 2 });
      history._enforceHistoryCap();
      expect(history.getDelta(0)).to.equal(null);
      expect(history.getDelta(1)).to.be.ok;
      expect(history.getDelta(2)).to.be.ok;
    } finally {
      console.warn = originalWarn;
    }
  });
});
