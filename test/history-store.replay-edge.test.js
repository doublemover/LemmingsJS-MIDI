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

describe('HistoryStore replay edge cases', function() {
  it('handles truncation edge cases', function() {
    const empty = new HistoryStore();
    empty._truncateDeltasAfter(1);
    empty._truncateKeyframesAfter(1);
    empty._truncateBefore(1);

    const history = new HistoryStore();
    seedHistory(history, { deltas: [0, 1] });
    history._truncateDeltasAfter(1);
    expect(history.maxDeltaTick).to.equal(1);

    const historyGap = new HistoryStore();
    seedHistory(historyGap, { deltas: [0, 3] });
    historyGap._truncateDeltasAfter(1);
    expect(historyGap.maxDeltaTick).to.equal(0);

    const historyAll = new HistoryStore();
    seedHistory(historyAll, { deltas: [2] });
    historyAll._truncateDeltasAfter(1);
    expect(historyAll.minDeltaTick).to.equal(null);

    const keyframesAll = new HistoryStore();
    seedHistory(keyframesAll, { keyframes: [2, 3] });
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
    seedHistory(beforeGap, { deltas: [0, 3], keyframes: [0, 3] });
    beforeGap._truncateBefore(2);
    expect(beforeGap.minDeltaTick).to.equal(3);

    const beforeAll = new HistoryStore();
    seedHistory(beforeAll, { deltas: [0], keyframes: [0] });
    beforeAll._truncateBefore(2);
    expect(beforeAll.minDeltaTick).to.equal(null);
    expect(beforeAll.keyframeTicks).to.have.length(0);

    const beforeLast = new HistoryStore();
    seedHistory(beforeLast, { deltas: [0] });
    beforeLast.keyframeTicks = [2];
    beforeLast.keyframes[2] = undefined;
    beforeLast.minKeyframeTick = 2;
    beforeLast.maxKeyframeTick = 2;
    beforeLast._truncateBefore(0);
    expect(beforeLast._lastKeyframe).to.equal(null);

    const historySpan = new HistoryStore();
    seedHistory(historySpan, { deltas: [0, 5] });
    historySpan._truncateDeltasAfter(3);
    expect(historySpan.maxDeltaTick).to.equal(0);

    const historyClear = new HistoryStore();
    seedHistory(historyClear, { deltas: [5] });
    historyClear._truncateDeltasAfter(3);
    expect(historyClear.minDeltaTick).to.equal(null);

    const beforeSpan = new HistoryStore();
    seedHistory(beforeSpan, { deltas: [0, 5] });
    beforeSpan._truncateBefore(2);
    expect(beforeSpan.minDeltaTick).to.equal(5);

    const beforeClear = new HistoryStore();
    seedHistory(beforeClear, { deltas: [0] });
    beforeClear._truncateBefore(2);
    expect(beforeClear.maxDeltaTick).to.equal(null);
  });

  it('handles history warning and cap edge cases', function() {
    const history = new HistoryStore({ historyWarnTicks: 5 });
    history._maybeWarnHistory();
    seedHistory(history, { deltas: [0, 1] });
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
    seedHistory(capWithFrame, { deltas: [0, 1, 2], keyframes: [0] });
    capWithFrame._enforceHistoryCap();
    expect(capWithFrame.minDeltaTick).to.equal(0);

    const capNoFrame = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 2
    });
    seedHistory(capNoFrame, { deltas: [0, 1, 2] });
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
    expect(history._timerEqual(timerState, { ...timerState, tickIndex: 1 })).to.equal(true);
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
      actions: [walkAction],
      _lemmingCtor: function ReplayCtor(x, y, id) {
        this.x = x;
        this.y = y;
        this.id = id;
      }
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
});
