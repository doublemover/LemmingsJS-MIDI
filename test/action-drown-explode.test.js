import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionDrowningSystem } from '../js/ActionDrowningSystem.js';
import { ActionExplodingSystem } from '../js/ActionExplodingSystem.js';
import '../js/Trigger.js';
import '../js/TriggerTypes.js';
import '../js/LemmingStateType.js';

// Minimal stubs shared with existing tests
class StubLemming {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.lookRight = true;
    this.frameIndex = 0;
    this.state = 0;
    this.disabled = false;
  }
  getDirection() { return this.lookRight ? 'right' : 'left'; }
  disable() { this.disabled = true; }
}

class StubLevel {
  constructor() { this.ground = new Set(); this.clearedMasks = []; }
  key(x, y) { return `${x},${y}`; }
  hasGroundAt(x, y) { return this.ground.has(this.key(x, y)); }
  clearGroundWithMask(mask, x, y) { this.clearedMasks.push({ mask, x, y }); return true; }
}

class StubTriggerManager {
  constructor() { this.removed = []; }
  removeByOwner(o) { this.removed.push(o); }
}

const stubSprites = { getAnimation() { return { getFrame() { return {}; } }; } };

class DummyMask { constructor() { this.offsetX = 0; this.offsetY = 0; this.width = 1; this.height = 1; } }
function stubMasks() {
  return {
    GetMask() {
      return { GetMask() { return new DummyMask(); } };
    }
  };
}

// fake game environment
before(() => {
  globalThis.lemmings = { game: { lemmingManager: { miniMap: { deaths: 0, addDeath() { this.deaths++; }, invalidateRegion() {} } } } };
});

describe('ActionDrowningSystem behavior', function() {
  it('moves, turns and exits', function() {
    const level = new StubLevel();
    const sys = new ActionDrowningSystem(stubSprites);
    const lem = new StubLemming();

    // first step, no wall -> move
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.x).to.equal(1);

    // next with wall -> turn
    level.ground.add(level.key(lem.x + 8, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);

    // advance to exit
    lem.frameIndex = 15;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });

  it('draw records death once frame >= 15', function() {
    const sys = new ActionDrowningSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15;
    sys.draw({ drawFrame() {} }, lem);
    expect(lemmings.game.lemmingManager.miniMap.deaths).to.equal(1);
  });
});

describe('ActionExplodingSystem behavior', function() {
  it('clears ground and exits at frame 52', function() {
    const level = new StubLevel();
    const tm = new StubTriggerManager();
    const sys = new ActionExplodingSystem(stubSprites, stubMasks(), tm, { draw() {} });
    const lem = new StubLemming();

    // first frame triggers mask and trigger removal
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(tm.removed[0]).to.equal(lem);
    expect(level.clearedMasks.length).to.equal(1);

    // at frame 51 -> 52 should exit
    lem.frameIndex = 51;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });

  it('triggerLemAction returns false', function() {
    const sys = new ActionExplodingSystem(new Map(), stubMasks(), new StubTriggerManager(), { draw() {} });
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(false);
  });

  it('process increments frameIndex and disables on first frame', function() {
    const level = new StubLevel();
    const tm = new StubTriggerManager();
    const sys = new ActionExplodingSystem(new Map([['both', { getFrame() {} }]]), stubMasks(), tm, { draw() {} });
    const lem = new StubLemming();
    sys.process(level, lem); // frame 0 -> 1
    expect(lem.frameIndex).to.equal(1);
    expect(lem.disabled).to.equal(true);
  });

  it('draw switches from sprite to particles', function() {
    const particleCalls = [];
    const sys = new ActionExplodingSystem(stubSprites, stubMasks(), new StubTriggerManager(), { draw(...args) { particleCalls.push(args); } });
    const lem = new StubLemming();
    sys.draw({ drawFrame() {} }, lem); // frameIndex 0 uses sprite
    expect(particleCalls.length).to.equal(0);
    lem.frameIndex = 1;
    sys.draw({ drawFrame() {} }, lem); // now use particles
    expect(particleCalls.length).to.equal(1);
  });
});
