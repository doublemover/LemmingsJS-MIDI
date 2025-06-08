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

const spriteStub = { getAnimation() { return { frames: [], getFrame() { return {}; } }; } };
const maskStub = { GetMask() { return { width: 0, height: 0, offsetX: 0, offsetY: 0, at() { return 0; } }; } };
const triggerStub = { trigger() { return 0; }, removeByOwner() {} };
const particleStub = {};

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

beforeEach(function() {
  globalThis.lemmings = { bench: true, extraLemmings: 2, game: { showDebug: false } };
  for (const key of actionKeys) Lemmings[key] = DummyAction;
});

afterEach(function() {
  delete globalThis.lemmings;
  for (const key of actionKeys) Lemmings[key] = originalActions[key];
});

describe('LemmingManager extra spawning', function() {
  it('adds extra lemmings and updates spawnTotal', function() {
    const level = new Level(10, 10);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);
    manager.addLemming(1, 1);
    expect(manager.lemmings.length).to.equal(3);
    expect(manager.spawnTotal).to.equal(3);
    for (const lem of manager.lemmings) expect(typeof lem.lookRight).to.equal('boolean');
  });
});
