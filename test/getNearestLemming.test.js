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
    return { frames: [] };
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
  getActionName() { return 'dummy'; }
  triggerLemAction() { return false; }
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

// enable debug logging for Logger
beforeEach(function() {
  globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: false } };
  for (const key of actionKeys) Lemmings[key] = DummyAction;
});

afterEach(function() {
  delete globalThis.lemmings;
  for (const key of actionKeys) Lemmings[key] = originalActions[key];
});

describe('LemmingManager.getNearestLemming', function() {
  it('returns the closest lemming or null', function() {
    const level = new Level(100, 100);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);

    manager.addLemming(10, 10);
    manager.addLemming(50, 50);

    const lem1 = manager.lemmings[0];
    const lem2 = manager.lemmings[1];

    expect(manager.getNearestLemming(10, 10)).to.equal(lem1);
    expect(manager.getNearestLemming(52, 50)).to.equal(lem2);
    expect(manager.getNearestLemming(7, 8)).to.equal(lem1);
    expect(manager.getNearestLemming(100, 100)).to.equal(null);
  });
});
