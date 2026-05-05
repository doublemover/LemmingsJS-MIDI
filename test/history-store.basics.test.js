import { expect } from 'chai';
import { withConsoleStub } from './helpers/console.js';
import { HistoryStore, __test__ } from '../js/game/HistoryStore.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { EventHandler } from '../js/util/EventHandler.js';
import { runScenarioTable } from './support/scenario-table.js';
import {
  createHistoryFixture,
  createStubTimer,
  recordTick,
  runHistoryOps,
  scenario,
  seedHistory
} from './support/history-fixtures.js';

describe('HistoryStore basics and scalar replay', function() {
  it('captures lemming deltas and can replay them', function() {
    const { history, game, timer, manager } = createHistoryFixture();
    recordTick(history, timer, 0, () => {
      manager.lemmings[0].x = 10;
      manager.lemmings[0].y = 12;
      manager.selectedIndex = 0;
    });
  
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

  it('keeps replay state equivalent across backward/forward delta cycles', function() {
    const { history, game, timer, manager, triggerManager } = createHistoryFixture();
    const owner = manager.lemmings[0];
    const trigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 0, owner);
    triggerManager.add(trigger);
  
    scenario(history, timer)
      .tick(0, {
        ops: [['recordTriggerCooldown', trigger, 0, 5]],
        mutate() {
          owner.x = 12;
          owner.y = 9;
          owner.lookRight = false;
          manager.selectedIndex = owner.id;
        }
      })
      .tick(1, {
        mutate() {
          owner.x = 14;
          owner.y = 11;
          manager.mmTickCounter = 7;
        }
      });
  
    const delta = history.getDelta(1);
    const baseline = history._captureKeyframe(game);
  
    history.applyDeltaBackward(game, delta);
    history.applyDeltaForward(game, delta);
  
    const replayed = history._captureKeyframe(game);
    expect(replayed).to.deep.equal(baseline);
  });

  it('truncates future history unless preservation is enabled', function() {
    const history = new HistoryStore({ keyframeInterval: 5 });
    seedHistory(history, { deltas: [0, 2], keyframes: [0, 2] });
  
    history.truncateAfter(0);
    expect(!!history.deltas[2]).to.equal(false);
    expect(!!history.keyframes[2]).to.equal(false);
  
    seedHistory(history, { deltas: [2], keyframes: [2] });
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
    const manager = {
      lemmings: [],
      skillActions: [],
      actions: [],
      _lemmingCtor: function ReplayCtor(x, y, id) {
        this.x = x;
        this.y = y;
        this.id = id;
      }
    };
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
  
    scenario(history, timer).tick(0, {
      ops: [
        ['recordGroundChange', 1, 1, 10, 20, 30, 0, 0, 0, 0],
        ['recordGroundChange', 2, 1, 11, 21, 31, 0, 0, 0, 0],
        ['recordEntranceChange', 0, false, true],
        ['recordObjectAnimation', obj, { firstFrameIndex: 0, isFinished: false }, { firstFrameIndex: 5, isFinished: true }],
        ['recordMinimapDeath', { x: 1, y: 2, ttl: 3, prevCount: 0 }]
      ],
      mutate() {
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
      }
    });
  
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
  
    scenario(history, timer).tick(0, {
      ops: [['recordTriggerCooldown', trigger, 0, 5]]
    });
  
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
  
    scenario(history, timer).tick(0, {
      ops: [[
        'recordTriggerAdd',
        trigger,
        {
          type: trigger.type,
          x1: trigger.x1,
          y1: trigger.y1,
          x2: trigger.x2,
          y2: trigger.y2,
          disableTicksCount: trigger.disableTicksCount,
          soundIndex: trigger.soundIndex,
          ownerId: owner.id,
          disabledUntilTick: 0
        }
      ]]
    });
  
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
  
    seedHistory(history, { keyframes: [3] });
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
});
