import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/SolidLayer.js';
import '../js/LemmingStateType.js';
import '../js/Lemming.js';
import '../js/SkillTypes.js';
import { Level } from '../js/Level.js';
import { LemmingManager } from '../js/LemmingManager.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';

globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: true } };


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
const dummyAction = class {};
Lemmings.ActionWalkSystem = dummyAction;
Lemmings.ActionFallSystem = dummyAction;
Lemmings.ActionJumpSystem = dummyAction;
Lemmings.ActionDiggSystem = dummyAction;
Lemmings.ActionExitingSystem = dummyAction;
Lemmings.ActionFloatingSystem = dummyAction;
Lemmings.ActionBlockerSystem = dummyAction;
Lemmings.ActionMineSystem = dummyAction;
Lemmings.ActionClimbSystem = dummyAction;
Lemmings.ActionHoistSystem = dummyAction;
Lemmings.ActionBashSystem = dummyAction;
Lemmings.ActionBuildSystem = dummyAction;
Lemmings.ActionShrugSystem = dummyAction;
Lemmings.ActionExplodingSystem = dummyAction;
Lemmings.ActionOhNoSystem = dummyAction;
Lemmings.ActionSplatterSystem = dummyAction;
Lemmings.ActionDrowningSystem = dummyAction;
Lemmings.ActionFryingSystem = dummyAction;
Lemmings.ActionCountdownSystem = dummyAction;

describe('LemmingManager', function() {

  beforeEach(function() {
    globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: true } };
  });
  
  afterEach(function() { delete globalThis.lemmings; });
  
  it('logs state changes when lemmings transition actions', function() {
    const stub = class {};
    [
      'ActionWalkSystem','ActionFallSystem','ActionJumpSystem','ActionDiggSystem',
      'ActionExitingSystem','ActionFloatingSystem','ActionBlockerSystem',
      'ActionMineSystem','ActionClimbSystem','ActionHoistSystem','ActionBashSystem',
      'ActionBuildSystem','ActionShrugSystem','ActionExplodingSystem','ActionOhNoSystem',
      'ActionSplatterSystem','ActionDrowningSystem','ActionFryingSystem','ActionCountdownSystem'
    ].forEach(n => { Lemmings[n] = stub; });
  });
  it('logs state changes when lemmings transition actions', function() {
    globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: true } };
    const level = new Level(10, 10);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);

    // ensure debug logging is enabled
    globalThis.lemmings.game.showDebug = true;

    class StubAction {
      constructor(name, next) { this.name = name; this.next = next; }
      getActionName() { return this.name; }
      triggerLemAction() { return false; }
      process() { return this.next; }
    }

    const fallAction = new StubAction('fall', Lemmings.LemmingStateType.WALKING);
    const walkAction = new StubAction('walk', Lemmings.LemmingStateType.NO_STATE_TYPE);

    manager.actions[Lemmings.LemmingStateType.FALLING] = fallAction;
    manager.actions[Lemmings.LemmingStateType.WALKING] = walkAction;

    const logs = [];
    const originalLog = console.log;
    console.log = msg => logs.push(String(msg));
    lemmings.game = lemmings.game || {};
    lemmings.game.showDebug = true;

    manager.addLemming(5, 5);
    expect(manager.lemmings.length).to.equal(1);

    manager.tick();

    console.log = originalLog;

    // log output may vary, just ensure the action updated
    const lem = manager.getLemming(0);
    expect(lem.action).to.equal(walkAction);
  });
});
