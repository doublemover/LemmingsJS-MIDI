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

describe('HistoryStore keyframes', function() {
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
    const midiOwner = {
      id: 'midi_flag_2_0',
      __historyKind: 'midi_flag',
      __historyData: { midiFlagId: 2, triggerType: 9002, pieceId: 22 }
    };
    const staticTrigger = new Trigger(TriggerTypes.TRAP, 1, 1, 2, 2, 0, 5, null);
    const dynamicTrigger = new Trigger(TriggerTypes.KILL, 3, 3, 4, 4, 0, 7, owner);
    const midiTrigger = new Trigger(TriggerTypes.NO_TRIGGER, 7, 7, 9, 9, 0, -1, midiOwner);
    const orphanTrigger = new Trigger(TriggerTypes.KILL, 5, 5, 6, 6, 0, 8, { id: NaN });
    const level = { triggers: [null, staticTrigger] };
    const triggerManager = {
      _triggers: new Set([staticTrigger, dynamicTrigger, midiTrigger, orphanTrigger]),
      add(trigger) { this._triggers.add(trigger); },
      remove(trigger) { this._triggers.delete(trigger); },
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
    expect(state.dynamicTriggers).to.have.length(2);
    const midiState = state.dynamicTriggers.find(entry => entry.ownerKind === 'midi_flag');
    expect(midiState.ownerData.midiFlagId).to.equal(2);

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
      remove(trigger) { this._triggers.delete(trigger); },
      removeByOwner(ownerTarget) {
        for (const trig of Array.from(this._triggers)) {
          if (trig.owner === ownerTarget) this._triggers.delete(trig);
        }
      }
    };
    const applyGame = {
      level: { triggers: [staticTrigger, null] },
      triggerManager: applyManager,
      soundEvents: { events: [], emit(event) { this.events.push(event); } },
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
      }, {
        id: 12,
        ownerKind: 'midi_flag',
        ownerId: 'midi_flag_2_0',
        ownerData: { midiFlagId: 2, triggerType: 9002, pieceId: 22 },
        type: TriggerTypes.NO_TRIGGER,
        x1: 7,
        y1: 7,
        x2: 9,
        y2: 9,
        disableTicksCount: 0,
        soundIndex: -1,
        disabledUntilTick: 0
      }]
    };
    history._applyTriggerState(applyGame, applyState);
    const restoredMidi = Array.from(applyManager._triggers)
      .find(trigger => trigger.__historyId === 12);
    restoredMidi.owner.onTrigger(3, { id: 42 }, restoredMidi, 8, 8);
    expect(applyGame.soundEvents.events[0]).to.include({
      type: 'trap-trigger',
      triggerType: 9002,
      midiFlagId: 2,
      pieceId: 22,
      lemmingId: 42
    });

    history._applyTriggerState(applyGame, {
      staticTriggers: state.staticTriggers,
      dynamicTriggers: []
    });
    expect(Array.from(applyManager._triggers)
      .some(trigger => trigger.owner?.__historyKind === 'midi_flag')).to.equal(false);
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
    recordTick(history, timer, 0, null, 5);
    expect(history.getKeyframe(5)).to.be.ok;
  });
});
