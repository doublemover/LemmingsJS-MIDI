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

describe('HistoryStore state application', function() {
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
    seedHistory(history, { deltas: [0] });
    history._enforceHistoryCap();
    expect(history.getDelta(0)).to.be.ok;

    const capped = new HistoryStore({
      enableHistoryCap: true,
      historyCapTicks: 3
    });
    seedHistory(capped, { deltas: [0, 1, 2] });
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
    seedHistory(history, { deltas: [0, 1, 2], keyframes: [0, 2] });

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
    const restoreConsole = withConsoleStub({ warn: msg => warnings.push(msg) });
    try {
      seedHistory(history, { deltas: [0, 1] });
      history._maybeWarnHistory();
      expect(warnings).to.have.length(1);
      history._maybeWarnHistory();
      expect(warnings).to.have.length(1);

      seedHistory(history, { deltas: [2] });
      history._enforceHistoryCap();
      expect(history.getDelta(0)).to.equal(null);
      expect(history.getDelta(1)).to.be.ok;
      expect(history.getDelta(2)).to.be.ok;
    } finally {
      restoreConsole();
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
      _lemmingCtor: function ReplayCtor(x, y, id) {
        this.x = x;
        this.y = y;
        this.id = id;
      },
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

    scenario(history, timer).tick(0, {
      mutate() {
        manager.lemmings[0] = null;
        manager.lemmings.length = 1;
      }
    });

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

    scenario(history, timer).tick(0, {
      mutate() {
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
      }
    });

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

    scenario(history, timer).tick(0, {
      mutate() {
        manager.selectedIndex = 1;
        manager.nextNukingLemmingsIndex = 2;
        manager._nukeTargets = [lemmingB, null];
      }
    });

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
});
