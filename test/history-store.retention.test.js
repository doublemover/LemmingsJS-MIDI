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

describe('HistoryStore retention', function() {
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

    seedHistory(history, { deltas: [0, 2], keyframes: [2] });
    expect(history.getKeyframe(2)).to.be.ok;
    expect(history.getKeyframe(4)).to.equal(null);

    const stats = history.getHistoryStats();
    expect(stats.spanTicks).to.equal(3);
    expect(stats.deltaCount).to.equal(2);

    seedHistory(history, { keyframes: [5] });
    const found = history.getKeyframeAtOrBefore(4);
    expect(found.tickIndex).to.equal(2);
  });

  it('uses bounded retention defaults and normalizes retention settings', function() {
    const history = new HistoryStore();
    expect(history.getRetentionPolicy()).to.eql({
      preserveFutureHistory: false,
      enableHistoryCap: true,
      historyCapTicks: 20000,
      historyWarnTicks: 15000
    });

    const normalized = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 10,
      historyWarnTicks: 50
    });
    expect(normalized.getRetentionPolicy().historyWarnTicks).to.equal(10);

    const configured = normalized.configureRetention({
      enableHistoryCap: false,
      historyCapTicks: 5,
      historyWarnTicks: 3
    });
    expect(configured).to.eql({
      preserveFutureHistory: false,
      enableHistoryCap: false,
      historyCapTicks: 5,
      historyWarnTicks: 3
    });
    expect(normalized.getHistoryStats().retention).to.eql(configured);
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
    seedHistory(history, { deltas: [0, 2], keyframes: [0, 2] });

    history._truncateDeltasAfter(1);
    expect(history.maxDeltaTick).to.equal(0);
    history._truncateDeltasAfter(-1);
    expect(history.minDeltaTick).to.equal(null);

    history._truncateKeyframesAfter(-1);
    expect(history.keyframeTicks).to.have.length(0);
    expect(history.minKeyframeTick).to.equal(null);
  });
});
