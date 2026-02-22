import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import { DummyAction, withActionStubs } from './helpers/lemming-actions.js';
import { makeManager } from './helpers/lemming-manager.js';
import '../js/render/SolidLayer.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/Lemming.js';
import '../js/game/SkillTypes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import '../js/LemmingsBootstrap.js';

const makeMiniMap = (overrides = {}) => ({
  scaleX: 1,
  scaleY: 1,
  setLiveDots(arr) { this.dots = arr; },
  setSelectedDot() {},
  ...overrides
});

// unique classes for redundant skill detection
class BashAction extends DummyAction {}
class BlockAction extends DummyAction {}
class DigAction extends DummyAction {}
class MineAction extends DummyAction {}

useGlobalLemmings({ bench: false, extraLemmings: 0, game: { showDebug: true } });

beforeEach(function() {
  this._winW = global.winW;
  this._winH = global.winH;
  this._worldW = global.worldW;
  this._worldH = global.worldH;
  global.winW = 1600;
  global.winH = 1200;
  global.worldW = 1600;
  global.worldH = 1200;
  this._restoreActions = withActionStubs({
    ActionBashSystem: BashAction,
    ActionBlockerSystem: BlockAction,
    ActionDiggSystem: DigAction,
    ActionMineSystem: MineAction
  });
});

afterEach(function() {
  this._restoreActions();
});

describe('LemmingManager core behavior', function() {
  it('addLemming and addNewLemmings use release counts', function() {
    const { manager, gvc } = makeManager({ width: 100, height: 50, releaseCount: 2 });

    expect(gvc.getLeftCount()).to.equal(2);
    manager.addLemming(10, 10);
    expect(manager.lemmings.length).to.equal(1);
    expect(gvc.getLeftCount()).to.equal(2);

    manager.releaseTickIndex = 103;
    manager.addNewLemmings();
    expect(manager.lemmings.length).to.equal(2);
    expect(gvc.getLeftCount()).to.equal(1);

    manager.releaseTickIndex = 103;
    manager.addNewLemmings();
    expect(manager.lemmings.length).to.equal(3);
    expect(gvc.getLeftCount()).to.equal(0);

    manager.releaseTickIndex = 103;
    manager.addNewLemmings();
    expect(manager.lemmings.length).to.equal(3);
  });

  it('setLemmingState removes lemming on unknown state', function() {
    const { manager } = makeManager({ width: 50, height: 50 });

    manager.addLemming(5, 5);
    const lem = manager.lemmings[0];
    const logs = [];
    manager.logging.log = msg => logs.push(msg);
    let removed = false;
    manager.removeOne = () => { removed = true; };
    manager.setLemmingState(lem, 99);
    expect(removed).to.be.true;
    expect(logs[0]).to.match(/Error not an action/);
  });

  it('doLemmingAction rejects redundant skills and sets valid ones', function() {
    const { manager } = makeManager({ width: 50, height: 50 });

    manager.addLemming(5, 5);
    const lem = manager.lemmings[0];
    manager.setLemmingState(lem, Lemmings.LemmingStateType.WALKING);
    let ok = manager.doLemmingAction(lem, Lemmings.SkillTypes.BASHER);
    expect(ok).to.be.true;
    expect(lem.action).to.be.instanceof(BashAction);

    ok = manager.doLemmingAction(lem, Lemmings.SkillTypes.BASHER);
    expect(ok).to.be.false;

    manager.setLemmingState(lem, Lemmings.LemmingStateType.WALKING);
    ok = manager.doLemmingAction(lem, Lemmings.SkillTypes.BUILDER);
    expect(ok).to.be.true;
    expect(lem.action).to.be.instanceof(DummyAction);
  });

  it('updates minimap dots on tick', function() {
    const { manager } = makeManager({ width: 40, height: 40 });
    manager.addLemming(10, 10);

    const mm = makeMiniMap();
    manager.setMiniMap(mm);
    manager.mmTickCounter = 9;
    manager.tick();

    expect(mm.dots.length).to.equal(2);
  });

  it('processes super lemmings twice per tick', function() {
    const { manager } = makeManager({
      width: 40,
      height: 40,
      levelInit(level) { level.isSuperLemming = true; }
    });
    manager.addLemming(10, 10);
    const lem = manager.lemmings[0];
    let processCalls = 0;
    lem.process = () => {
      processCalls += 1;
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    };

    manager.tick();

    expect(processCalls).to.equal(2);
  });

  it('processes non-super lemmings once per tick', function() {
    const { manager } = makeManager({ width: 40, height: 40 });
    manager.addLemming(10, 10);
    const lem = manager.lemmings[0];
    let processCalls = 0;
    lem.process = () => {
      processCalls += 1;
      return Lemmings.LemmingStateType.NO_STATE_TYPE;
    };

    manager.tick();

    expect(processCalls).to.equal(1);
  });

  it('spawns and removes lemmings mid-level', function() {
    const { manager, gvc } = makeManager({ width: 50, height: 50, releaseCount: 1 });

    const mm = makeMiniMap({ addDeath(x, y) { this.deaths = [x, y]; } });
    manager.setMiniMap(mm);

    manager.releaseTickIndex = 103;
    manager.addNewLemmings();
    manager.mmTickCounter = 9;
    manager.tick();

    expect(manager.lemmings.length).to.equal(1);
    expect(gvc.getOutCount()).to.equal(1);
    expect(mm.dots.length).to.equal(2);

    manager.removeOne(manager.lemmings[0]);
    expect(gvc.getOutCount()).to.equal(0);
    expect(mm.deaths).to.eql([24, 14]);

    manager.addLemming(30, 30);
    manager.mmTickCounter = 9;
    manager.tick();

    expect(mm.dots.length).to.equal(2);
    expect(manager.lemmings[0]).to.equal(null);
  });

  it('getNearestLemming picks closest active lemming', function() {
    const { manager } = makeManager({ width: 60, height: 60 });

    manager.addLemming(5, 5);
    manager.addLemming(20, 20);

    const lem1 = manager.lemmings[0];
    const lem2 = manager.lemmings[1];

    manager.removeOne(lem2);

    let nearest = manager.getNearestLemming(6, 6);
    expect(nearest).to.equal(lem1);

    manager.addLemming(18, 18);
    const lem3 = manager.lemmings[2];
    nearest = manager.getNearestLemming(19, 19);
    expect(nearest).to.equal(lem3);
  });

  it('cycleSelection skips removed and disabled lemmings', function() {
    const { manager } = makeManager({ width: 20, height: 20 });

    manager.addLemming(1, 1);
    manager.addLemming(2, 2);
    manager.addLemming(3, 3);

    const [lem1, lem2, lem3] = manager.lemmings;
    lem1.remove();
    lem2.disable();

    const sel = manager.cycleSelection();
    expect(sel).to.equal(lem3);

    lem3.remove();
    const none = manager.cycleSelection();
    expect(none).to.equal(null);
    expect(manager.selectedIndex).to.equal(-1);
  });

  it('dispose resets key fields', function() {
    const { manager } = makeManager();
    manager.addLemming(5, 5);

    const mm = makeMiniMap();
    manager.setMiniMap(mm);

    manager.dispose();

    expect(manager.level).to.equal(null);
    expect(manager.miniMap).to.equal(null);
    expect(manager.lemmings.length).to.equal(0);
  });
});

describe('LemmingManager additional', function() {

  it('setLemmingState clears countdown on lethal state', function() {
    const { manager } = makeManager();
    manager.addLemming(1,1);
    const lem = manager.lemmings[0];
    lem.countdown = 5; lem.countdownAction = {};
    manager.setLemmingState(lem, Lemmings.LemmingStateType.DROWNING);
    expect(lem.countdown).to.equal(0);
    expect(lem.countdownAction).to.equal(null);
  });

  it('setLemmingState OUT_OF_LEVEL calls removeOne', function() {
    const { manager } = makeManager();
    manager.addLemming(2,2);
    const lem = manager.lemmings[0];
    let removed=false; manager.removeOne=()=>{removed=true;};
    manager.setLemmingState(lem, Lemmings.LemmingStateType.OUT_OF_LEVEL);
    expect(removed).to.be.true;
  });

  it('doLemmingAction removes blocker wall when switching skills', function() {
    const { manager } = makeManager();
    manager.addLemming(3,3);
    const lem = manager.lemmings[0];
    manager.setLemmingState(lem, Lemmings.LemmingStateType.BLOCKING);
    let removed=false; manager.triggerManager.removeByOwner=()=>{removed=true;};
    const ok = manager.doLemmingAction(lem, Lemmings.SkillTypes.DIGGER);        
    expect(ok).to.be.true;
    expect(removed).to.be.true;
  });
});

describe('LemmingManager triggers and nuking', function() {
  it('runTrigger maps triggers and flips blockers', function() {
    const { manager } = makeManager();
    manager.addLemming(5, 5);
    const lem = manager.lemmings[0];

    manager.triggerManager.trigger = () => TriggerTypes.DROWN;
    let state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.DROWNING);
    expect(lem.lastTriggerType).to.equal(TriggerTypes.DROWN);

    manager.triggerManager.trigger = () => TriggerTypes.FRYING;
    state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.FRYING);
    expect(lem.lastTriggerType).to.equal(TriggerTypes.FRYING);

    manager.triggerManager.trigger = () => TriggerTypes.TRAP;
    state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.SPLATTING);
    expect(lem.lastTriggerType).to.equal(TriggerTypes.TRAP);

    manager.triggerManager.trigger = () => TriggerTypes.EXIT_LEVEL;
    state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.EXITING);
    expect(lem.lastTriggerType).to.equal(TriggerTypes.EXIT_LEVEL);

    manager.triggerManager.trigger = () => TriggerTypes.KILL;
    state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.SPLATTING);
    expect(lem.lastTriggerType).to.equal(TriggerTypes.KILL);

    manager.triggerManager.trigger = () => TriggerTypes.BLOCKER_LEFT;
    lem.lookRight = true;
    state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);

    manager.triggerManager.trigger = () => TriggerTypes.BLOCKER_RIGHT;
    lem.lookRight = false;
    state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(true);
  });

  it('runTrigger logs unknown trigger types', function() {
    const { manager } = makeManager();
    manager.addLemming(4, 4);
    const lem = manager.lemmings[0];

    const logs = [];
    manager.logging.log = msg => logs.push(msg);
    manager.triggerManager.trigger = () => 999;

    const state = manager.runTrigger(lem);
    expect(state).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(logs[0]).to.match(/unknown trigger type/i);
  });

  it('nuking skips disabled targets and ends when applied', function() {        
    const { manager } = makeManager();
    manager.addLemming(1, 1);
    manager.addLemming(2, 2);

    manager.doNukeAllLemmings();
    const [lem1, lem2] = manager.lemmings;
    lem1.disable();

    const calls = [];
    manager.doLemmingAction = (lem, skill) => {
      calls.push({ lem, skill });
      return true;
    };

    manager._nukeNextLemming();

    expect(calls.length).to.equal(1);
    expect(calls[0].lem).to.equal(lem2);
    expect(calls[0].skill).to.equal(Lemmings.SkillTypes.BOMBER);
    expect(manager.isNuking()).to.equal(false);
  });

  it('clears nuke targets when index is out of range', function() {
    const { manager } = makeManager();
    manager._nukeTargets = [{ id: 1 }];
    manager.nextNukingLemmingsIndex = 1;

    manager._nukeNextLemming();

    expect(manager.nextNukingLemmingsIndex).to.equal(-1);
    expect(manager._nukeTargets).to.equal(null);
  });

  it('clears nuke targets when index jumps beyond count', function() {     
    const { manager } = makeManager();
    manager._nukeTargets = [{ id: 1 }];
    let calls = 0;
    Object.defineProperty(manager, 'nextNukingLemmingsIndex', {
      configurable: true,
      get() {
        calls += 1;
        if (calls === 1) return 0;
        if (calls === 2) return 0;
        return 5;
      },
      set(value) { this._nextNukeIndex = value; }
    });

    manager._nukeNextLemming();

    expect(manager._nukeTargets).to.equal(null);
  });

  it('returns early when nuking with no targets', function() {
    const { manager } = makeManager();
    manager._nukeTargets = null;
    manager.nextNukingLemmingsIndex = 0;
    manager._nukeNextLemming();
    expect(manager.nextNukingLemmingsIndex).to.equal(0);
  });

  it('cycleSelection returns null when no active lemmings exist', function() {
    const { manager } = makeManager();
    manager.activeLemmings.length = 0;
    expect(manager.cycleSelection()).to.equal(null);
  });
});
