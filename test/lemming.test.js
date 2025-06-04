import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import { LemmingManager } from '../js/LemmingManager.js';
import { GameVictoryCondition } from '../js/GameVictoryCondition.js';
import '../js/LemmingsBootstrap.js';

let originalLemmings;

beforeEach(function () {
  originalLemmings = globalThis.lemmings;
  globalThis.lemmings = { bench: false, extraLemmings: 0, game: { showDebug: true } };
});

afterEach(function () {
  globalThis.lemmings = originalLemmings;
});

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

const triggerStub = { trigger() { return Lemmings.TriggerTypes.NO_TRIGGER; }, removeByOwner() {} };
const particleStub = {};

describe('LemmingManager', function() {
  it('logs state changes when lemmings transition actions', function() {
    const level = new Level(10, 10);
    level.entrances = [{ x: 0, y: 0 }];
    const gvc = new GameVictoryCondition(level);
    const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);

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

    manager.addLemming(5, 5);
    expect(manager.lemmings.length).to.equal(1);

    manager.tick();

    console.log = originalLog;

    expect(logs.some(l => l.includes('Action: fall'))).to.equal(true);
    expect(logs.some(l => l.includes('Action: walk'))).to.equal(true);
    const lem = manager.getLemming(0);
    expect(lem.action).to.equal(walkAction);
  });
});
