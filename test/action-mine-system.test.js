import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionMineSystem } from '../js/ActionMineSystem.js';
import '../js/LemmingStateType.js';
import '../js/MaskTypes.js';

class DummyMask {
  constructor() { this.offsetX = 0; this.offsetY = 0; this.width = 1; this.height = 1; }
  at() { return false; }
}
function stubMasks() {
  return new Map([
    ['left', { GetMask() { return new DummyMask(); } }],
    ['right', { GetMask() { return new DummyMask(); } }]
  ]);
}

class StubLemming {
  constructor() { this.x = 0; this.y = 0; this.lookRight = true; this.frameIndex = 0; }
  getDirection() { return this.lookRight ? 'right' : 'left'; }
}

class StubLevel {
  constructor() { this.ground = new Set(); this.cleared = []; this.steel = false; this.arrow = false; }
  key(x, y) { return `${x},${y}`; }
  hasGroundAt(x, y) { return this.ground.has(this.key(x, y)); }
  clearGroundWithMask(m, x, y) { this.cleared.push({ m, x, y }); }
  hasSteelUnderMask() { return this.steel; }
  hasArrowUnderMask() { return this.arrow; }
}

describe('ActionMineSystem state handling', function () {
  it('returns SHRUG when steel or arrow under mask', function () {
    const level = new StubLevel();
    const sys = new ActionMineSystem(new Map(), stubMasks());
    const lem = new StubLemming();

    level.steel = true;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);

    level.steel = false;
    level.arrow = true;
    lem.frameIndex = 1; // ->2
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('increments y at frame 3 and falls without ground', function () {
    const level = new StubLevel();
    const sys = new ActionMineSystem(new Map(), stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 2; // ->3
    const ret = sys.process(level, lem);
    expect(lem.y).to.equal(1);
    expect(ret).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('clears ground and continues when unobstructed', function () {
    const level = new StubLevel();
    level.ground.add(level.key(0, 0));
    const sys = new ActionMineSystem(new Map(), stubMasks());
    const lem = new StubLemming();
    const ret = sys.process(level, lem); // frame 0 -> 1
    expect(ret).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(level.cleared.length).to.equal(1);
  });
});
