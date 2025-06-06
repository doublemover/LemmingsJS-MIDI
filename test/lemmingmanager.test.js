import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/SolidLayer.js';
import '../js/LemmingStateType.js';
import '../js/Lemming.js';
import '../js/SkillTypes.js';
import { Level } from '../js/Level.js';
import { LemmingManager } from '../js/LemmingManager.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';
import '../js/LemmingsBootstrap.js';

// minimal sprite and mask providers so the constructor doesn't fail
const spriteStub = {
  getAnimation() {
    return { frames: [], getFrame() { return {}; } };
  }
};

const maskStub = {
  GetMask() {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0, at() { return 0; } };
  }
};

const triggerStub = { trigger() { return 0; }, removeByOwner() {} };
const particleStub = {};

// stub action systems used during initialization
class DummyAction {
  constructor(name) { this.name = name; }
  getActionName() { return this.name; }
  triggerLemAction(lem) { lem.setAction(this); return true; }
  process() { return Lemmings.LemmingStateType.NO_STATE_TYPE; }
}

const actionKeys = [
  'ActionWalkSystem','ActionFallSystem','ActionJumpSystem','ActionDiggSystem',
  'ActionExitingSystem','ActionFloatingSystem','ActionBlockerSystem',
  'ActionMineSystem','ActionClimbSystem','ActionHoistSystem','ActionBashSystem',
  'ActionBuildSystem','ActionShrugSystem','ActionExplodingSystem','ActionOhNoSystem',
  'ActionSplatterSystem','ActionDrowningSystem','ActionFryingSystem','ActionCountdownSystem'
];
const originalActions = {};
for (const key of actionKeys) originalActions[key] = Lemmings[key];

// unique classes for redundant skill detection
class BashAction extends DummyAction {}
class BlockAction extends DummyAction {}
class DigAction extends DummyAction {}
class MineAction extends DummyAction {}

beforeEach(function() {
  globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: true } };
  for (const key of actionKeys) Lemmings[key] = DummyAction;
  Lemmings.ActionBashSystem = BashAction;
  Lemmings.ActionBlockerSystem = BlockAction;
  Lemmings.ActionDiggSystem = DigAction;
  Lemmings.ActionMineSystem = MineAction;
});

afterEach(function() {
  delete globalThis.lemmings;
  for (const key of actionKeys) Lemmings[key] = originalActions[key];
});

describe('LemmingManager core behavior', function() {
  it('addLemming and addNewLemmings use release counts', function() {
    const level = new Level(100, 50);
    level.entrances = [{ x: 0, y: 0 }];
    level.releaseCount = 2;
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);

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
    const level = new Level(50, 50);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);

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
    const level = new Level(50, 50);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);

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
    const level = new Level(40, 40);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);
    manager.addLemming(10, 10);

    const mm = { scaleX: 1, scaleY: 1, setLiveDots(arr) { this.dots = arr; }, setSelectedDot() {} };
    manager.setMiniMap(mm);
    manager.mmTickCounter = 9;
    manager.tick();

    expect(mm.dots.length).to.equal(2);
  });
});
