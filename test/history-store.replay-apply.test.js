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

describe('HistoryStore replay application', function() {
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
    timer.speedFactor = 2;
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

    runHistoryOps(history, [
      ['recordSoundEvent', {}],
      ['recordGroundChange', 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ['recordEntranceChange', 0, false, false],
      ['recordTriggerCooldown', null, 0, 0],
      ['recordTriggerAdd', null, {}],
      ['recordTriggerRemove', null, {}],
      ['recordObjectAnimation', {}, { firstFrameIndex: 0, isFinished: false }, { firstFrameIndex: 0, isFinished: false }],
      ['recordMinimapDeath', {}]
    ]);

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
    const obj = {};
    const trigger = new Trigger(TriggerTypes.TRAP, 0, 0, 1, 1);
    runHistoryOps(history, [
      ['recordEntranceChange', 0, false, true],
      ['recordEntranceChange', 1, true, false],
      ['recordObjectAnimation', obj, { firstFrameIndex: 1, isFinished: false }, { firstFrameIndex: 2, isFinished: true }],
      ['recordObjectAnimation', obj, { firstFrameIndex: 2, isFinished: true }, { firstFrameIndex: 3, isFinished: false }],
      ['recordTriggerCooldown', trigger, 0, 2],
      ['recordTriggerAdd', trigger, {
        type: trigger.type,
        x1: trigger.x1,
        y1: trigger.y1,
        x2: trigger.x2,
        y2: trigger.y2,
        disableTicksCount: trigger.disableTicksCount,
        soundIndex: trigger.soundIndex,
        ownerId: null
      }],
      ['recordTriggerRemove', trigger, {
        type: trigger.type,
        x1: trigger.x1,
        y1: trigger.y1,
        x2: trigger.x2,
        y2: trigger.y2,
        disableTicksCount: trigger.disableTicksCount,
        soundIndex: trigger.soundIndex,
        ownerId: null
      }],
      ['recordMinimapDeath', { x: 1, y: 2, ttl: 3, prevCount: 0 }]
    ]);

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
});
