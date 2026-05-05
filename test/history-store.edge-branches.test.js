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

describe('HistoryStore edge branches', function() {
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
  
    scenario(history, timer).tick(0, {
      mutate() {
        level.entrances.push({ _opened: true });
      }
    });
  
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
  
    scenario(history, timer).tick(0, {
      mutate() {
        manager.lemmings.push(newLem);
      }
    });
  
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
  
    runHistoryOps(history, [
      ['recordSoundEvent', { type: 'sfx' }],
      ['recordGroundChange', 0, 0, 0, 0, 0, 1, 1, 1, 1],
      ['recordEntranceChange', 0, false, true],
      ['recordTriggerCooldown', null, 0, 1],
      ['recordTriggerAdd', null, {}],
      ['recordTriggerRemove', null, {}],
      ['recordObjectAnimation', null, { firstFrameIndex: 0, isFinished: false }, { firstFrameIndex: 1, isFinished: true }],
      ['recordMinimapDeath', { x: 1 }]
    ]);
  
    expect(history._ensureTriggerId(null)).to.equal(0);
    expect(history._ensureObjectId(null)).to.equal(0);
  });

  it('records delta entries for sound, entrances, and objects', function() {
    const { history, timer, level } = createHistoryFixture();
    const obj = { animation: { firstFrameIndex: 0, isFinished: false } };
    level.objects = [obj];
  
    scenario(history, timer).tick(0, {
      ops: [
        ['recordSoundEvent', { type: 'step' }],
        ['recordEntranceChange', 0, false, true],
        ['recordObjectAnimation', obj, { firstFrameIndex: 0, isFinished: false }, { firstFrameIndex: 2, isFinished: true }],
        ['recordMinimapDeath', { x: 2, y: 3, ttl: 4, prevCount: 0 }]
      ]
    });
  
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
    seedHistory(history, { deltas: [0, 2], keyframes: [0, 2] });
  
    history._truncateDeltasAfter(-1);
    expect(history.minDeltaTick).to.equal(null);
    expect(history.maxDeltaTick).to.equal(null);
  
    seedHistory(history, { keyframes: [1] });
    history._truncateKeyframesAfter(0);
    expect(history.keyframeTicks).to.have.length(1);
    expect(history.keyframeTicks[0]).to.equal(0);
  
    seedHistory(history, { deltas: [0] });
    history._truncateBefore(5);
    expect(history.minDeltaTick).to.equal(null);
  });
});
