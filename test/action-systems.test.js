import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionBashSystem } from '../js/ActionBashSystem.js';
import { ActionBlockerSystem } from '../js/ActionBlockerSystem.js';
import { ActionBuildSystem } from '../js/ActionBuildSystem.js';
import { ActionClimbSystem } from '../js/ActionClimbSystem.js';
import { ActionCountdownSystem } from '../js/ActionCountdownSystem.js';
import { ActionDiggSystem } from '../js/ActionDiggSystem.js';
import { ActionDrowningSystem } from '../js/ActionDrowningSystem.js';
import { ActionExitingSystem } from '../js/ActionExitingSystem.js';
import { ActionExplodingSystem } from '../js/ActionExplodingSystem.js';
import { ActionFallSystem } from '../js/ActionFallSystem.js';
import { ActionFloatingSystem } from '../js/ActionFloatingSystem.js';
import { ActionFryingSystem } from '../js/ActionFryingSystem.js';
import { ActionHoistSystem } from '../js/ActionHoistSystem.js';
import { ActionJumpSystem } from '../js/ActionJumpSystem.js';
import { ActionMineSystem } from '../js/ActionMineSystem.js';
import { ActionOhNoSystem } from '../js/ActionOhNoSystem.js';
import { ActionShrugSystem } from '../js/ActionShrugSystem.js';
import { ActionSplatterSystem } from '../js/ActionSplatterSystem.js';
import { ActionWalkSystem } from '../js/ActionWalkSystem.js';
import '../js/Trigger.js';
import '../js/TriggerTypes.js';
import '../js/LemmingStateType.js';
import '../js/SpriteTypes.js';
import '../js/MaskTypes.js';
import '../js/Lemming.js';

// minimal global environment
globalThis.lemmings = {
  game: { lemmingManager: { miniMap: { addDeath() {}, invalidateRegion() {}, onGroundChanged() {} } }, showDebug: false }
};
globalThis.winW = 800;
globalThis.winH = 600;

const stubSprites = { getAnimation: () => ({ getFrame() { return {}; } }) };

class StubLemming {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.lookRight = true;
    this.frameIndex = 0;
    this.state = 0;
    this.canClimb = false;
    this.hasParachute = false;
    this.disabled = false;
    this.countdown = 0;
  }
  getDirection() { return this.lookRight ? 'right' : 'left'; }
  disable() { this.disabled = true; }
  setCountDown(act) { this.countdownAction = act; if (this.countdown > 0) return false; this.countdown = 80; return true; }
  getCountDownTime() { return 8 - (this.countdown >> 4); }
}

class StubLevel {
  constructor() {
    this.ground = new Set();
    this.clearedMasks = [];
    this.setGroundCalls = [];
    this.clearedPoints = [];
    this.steelUnder = false;
    this.arrowUnder = false;
    this.steelGround = () => false;
  }
  key(x, y) { return `${x},${y}`; }
  hasGroundAt(x, y) { return this.ground.has(this.key(x, y)); }
  getGroundMaskLayer() {
    const self = this;
    return {
      hasGroundAt(x, y) { return self.hasGroundAt(x, y); },
      getSubLayer(x, y, w, h) {
        return { width: w, height: h, hasGroundAt(dx, dy) { return self.hasGroundAt(x + dx, y + dy); } };
      }
    };
  }
  clearGroundWithMask(mask, x, y) { this.clearedMasks.push({ mask, x, y }); }
  hasSteelUnderMask() { return this.steelUnder; }
  hasArrowUnderMask() { return this.arrowUnder; }
  clearGroundAt(x, y) { this.clearedPoints.push(this.key(x, y)); this.ground.delete(this.key(x, y)); }
  setGroundAt(x, y) { this.setGroundCalls.push(this.key(x, y)); this.ground.add(this.key(x, y)); }
  isSteelGround(x, y) { return this.steelGround(this.key(x, y)); }
  isOutOfLevel(y) { return y < 0 || y >= 50; }
}

class StubTriggerManager {
  constructor() { this.added = []; this.removed = []; }
  add(t) { this.added.push(t); }
  removeByOwner(o) { this.removed.push(o); }
}

class StubGVC { constructor() { this.count = 0; } addSurvivor() { this.count++; } }

class DummyMask { constructor() { this.offsetX = 0; this.offsetY = 0; this.width = 0; this.height = 0; } at() { return false; } }
function stubMasks() {
  return {
    GetMask() {
      return { GetMask() { return new DummyMask(); } };
    }
  };
}

// helpers for controlled Action systems
class TestBashSystem extends ActionBashSystem {
  constructor(gap, horiz) { super(stubSprites, stubMasks()); this.gap = gap; this.horiz = horiz; }
  findGapDelta() { return this.gap; }
  findHorizontalSpace() { return this.horiz; }
}

class TestWalkSystem extends ActionWalkSystem {
  constructor(up, down) { super(stubSprites); this.up = up; this.down = down; }
  getGroundStepHeight() { return this.up; }
  getGroundGapDepth() { return this.down; }
}

class TestMineSystem extends ActionMineSystem {
  constructor(haveSteel, haveArrow) { super(stubSprites, stubMasks()); this.haveSteel = haveSteel; this.haveArrow = haveArrow; this.cleared = 0; }
  process(level, lem) { return super.process(level, lem); }
}


describe('Action Systems process()', function() {
  it('ActionBashSystem handles masks and gaps', function() {
    const level = new StubLevel();
    const lem = new StubLemming();
    const sys = new TestBashSystem(3, 0);
    lem.frameIndex = 10; // state 11 after ++
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);

    const sys2 = new TestBashSystem(0, 4);
    lem.frameIndex = 1; // ->2
    sys2.process(level, lem);
    expect(level.clearedMasks).to.have.length(1);

    level.steelUnder = true;
    lem.frameIndex = 2; // ->3
    expect(sys2.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    level.steelUnder = false;

    lem.frameIndex = 4; // ->5 horiz space 4
    expect(sys2.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);

    lem.frameIndex = 3; // ->4 horiz space !=4
    expect(sys2.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
  });

  it('ActionBlockerSystem adds and removes triggers', function() {
    const level = new StubLevel();
    const tm = new StubTriggerManager();
    const sys = new ActionBlockerSystem(stubSprites, tm);
    const lem = new StubLemming();
    lem.state = 0;
    sys.process(level, lem);
    expect(tm.added.length).to.equal(2);
    lem.state = 1;
    level.ground.delete(level.key(lem.x, lem.y + 1));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
    expect(tm.removed[0]).to.equal(lem);
  });

  it('ActionBuildSystem lays bricks and shrugs when done', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 8; // ->9 brick
    sys.process(level, lem);
    expect(level.setGroundCalls).to.have.length(6);

    lem.frameIndex = 15; // ->0
    lem.state = 11;
    sys.process(level, lem);
    expect(lem.state).to.equal(12);

    lem.frameIndex = 15;
    lem.state = 12;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('ActionClimbSystem hoists or falls', function() {
    const level = new StubLevel();
    const sys = new ActionClimbSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 2; // ->3, below 4 => check top
    level.ground.delete(level.key(lem.x, lem.y - 7 - 4));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.HOISTING);

    lem.frameIndex = 4; // ->5, climbing upward
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);

    lem.frameIndex = 6; // ->7 >=4 path
    level.ground.add(level.key(lem.x - 1, lem.y - 9));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('ActionCountdownSystem counts to explosion', function() {
    const sys = new ActionCountdownSystem({ GetMask() { return new DummyMask(); } });
    const lem = new StubLemming();
    lem.countdown = 2;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.countdown).to.equal(1);
    lem.countdown = 1;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.OHNO);
  });

  it('ActionDiggSystem digs until out', function() {
    const sys = new ActionDiggSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.state = 0;
    sys.process(level, lem);
    expect(lem.state).to.equal(1);

    lem.state = 1;
    lem.frameIndex = 7; // ->8 triggers digRow
    level.isOutOfLevel = () => false;
    sys.digRow = () => false;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);

    level.isOutOfLevel = () => true;
    lem.frameIndex = 15; // ->0 but !0 & 0x07 -> 1? Wait 0? We'll set 0.
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('ActionDrowningSystem toggles direction and exits', function() {
    const level = new StubLevel();
    const sys = new ActionDrowningSystem(stubSprites);
    const lem = new StubLemming();
    level.ground.add(level.key(lem.x + 8, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.disabled).to.equal(true);
    lem.frameIndex = 15;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });

  it('ActionExitingSystem awards survivor', function() {
    const gvc = new StubGVC();
    const sys = new ActionExitingSystem(stubSprites, gvc);
    const lem = new StubLemming();
    lem.frameIndex = 7;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
    expect(gvc.count).to.equal(1);
  });

  it('ActionExplodingSystem clears mask and exits', function() {
    const tm = new StubTriggerManager();
    const sys = new ActionExplodingSystem(stubSprites, stubMasks(), tm, { draw() {} });
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.frameIndex = 0;
    sys.process(level, lem); // ->1 no clear
    lem.frameIndex = 1;
    sys.process(level, lem); // ->2 clears
    expect(level.clearedMasks).to.have.length.above(0);
    lem.frameIndex = 51;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });

  it('ActionFallSystem detects splat and float', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    lem.state = 17;
    lem.hasParachute = true;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FLOATING);

    lem.state = 0;
    level.ground.add(level.key(lem.x, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);

    lem.state = Lemmings.Lemming.LEM_MAX_FALLING + 1;
    lem.hasParachute = false;
    level.ground.add(level.key(lem.x, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SPLATTING);
  });

  it('ActionFloatingSystem lands when hitting ground', function() {
    const sys = new ActionFloatingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    level.ground.add(level.key(lem.x, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(0);
    level.ground.clear();
    lem.frameIndex = 15;
    sys.process(level, lem);
    expect(lem.frameIndex).to.equal(8);
  });

  it('ActionFryingSystem burns then exits', function() {
    const level = new StubLevel();
    const sys = new ActionFryingSystem(stubSprites);
    const lem = new StubLemming();
    sys.process(level, lem);
    expect(lem.disabled).to.equal(true);
    lem.frameIndex = 13;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });

  it('ActionHoistSystem moves up then walks', function() {
    const level = new StubLevel();
    const sys = new ActionHoistSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 3;
    sys.process(level, lem);
    expect(lem.y).to.equal(-2);
    lem.frameIndex = 7;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionJumpSystem jumps up then walks', function() {
    const level = new StubLevel();
    level.ground.add(level.key(1, -1));
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    lem.y = -5;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionMineSystem clears ground and falls', function() {
    const level = new StubLevel();
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 1; // ->2 mask clear
    sys.process(level, lem);
    expect(level.clearedMasks.length).to.equal(1);
    lem.frameIndex = 14; // ->15 moves check ground
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
    level.ground.delete(level.key(lem.x, lem.y));
    lem.frameIndex = 15; // ->0 case 15
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
  });

  it('ActionOhNoSystem counts to explode', function() {
    const level = new StubLevel();
    const sys = new ActionOhNoSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.EXPLODING);
  });

  it('ActionShrugSystem returns to walking', function() {
    const sys = new ActionShrugSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 7;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionSplatterSystem finishes quickly', function() {
    const sys = new ActionSplatterSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
  });

  it('ActionWalkSystem handles steps and gaps', function() {
    const sys = new TestWalkSystem(8, 0);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.canClimb = true;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.CLIMBING);

    const sys2 = new TestWalkSystem(5, 0);
    expect(sys2.process(level, lem)).to.equal(Lemmings.LemmingStateType.JUMPING);

    const sys3 = new TestWalkSystem(2, 0);
    expect(sys3.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);

    const sys4 = new TestWalkSystem(0, 4);
    expect(sys4.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('ActionBashSystem stops on arrow under mask', function() {
    const level = new StubLevel();
    level.arrowUnder = true;
    const sys = new TestBashSystem(0, 0);
    const lem = new StubLemming();
    lem.frameIndex = 2; // ->3
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    expect(level.clearedMasks).to.have.length(0);
  });

  it('ActionBuildSystem turns around when hitting wall', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(new Map());
    const lem = new StubLemming();
    lem.frameIndex = 15; // ->0
    level.ground.add(level.key(lem.x + 1, lem.y - 1));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);
  });

  it('ActionBuildSystem walks when roof blocks path', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(new Map());
    const lem = new StubLemming();
    lem.frameIndex = 15; // ->0
    level.ground.add(level.key(4, -10));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionClimbSystem continues with ceiling present', function() {
    const level = new StubLevel();
    const sys = new ActionClimbSystem(new Map());
    const lem = new StubLemming();
    lem.frameIndex = 2; // ->3
    level.ground.add(level.key(lem.x, lem.y - 10));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(0);
  });

  it('ActionDiggSystem shrugs on steel', function() {
    const level = new StubLevel();
    level.steelGround = () => true;
    const sys = new ActionDiggSystem(new Map());
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('ActionDiggSystem digs rows while inside level', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(new Map());
    const lem = new StubLemming();
    lem.state = 1;
    lem.frameIndex = 7; // ->8
    let calls = 0;
    sys.digRow = () => { calls++; return true; };
    level.isOutOfLevel = () => false;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(1);
    expect(calls).to.equal(1);
  });

  it('ActionDiggSystem falls when digging out of level', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(new Map());
    const lem = new StubLemming();
    lem.state = 1;
    lem.y = 49;
    lem.frameIndex = 7; // ->8
    level.isOutOfLevel = y => y >= 50;
    sys.digRow = () => true;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('ActionDiggSystem falls when dig row removes nothing', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(new Map());
    const lem = new StubLemming();
    lem.state = 1;
    lem.frameIndex = 7; // ->8
    level.isOutOfLevel = () => false;
    sys.digRow = () => false;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('ActionDiggSystem cycles animation frames', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(new Map());
    const lem = new StubLemming();
    lem.state = 1;
    level.isOutOfLevel = () => false;
    let calls = 0;
    sys.digRow = () => { calls++; return true; };
    for (let i = 0; i < 16; i++) {
      sys.process(level, lem);
    }
    expect(lem.frameIndex).to.equal(0);
    expect(lem.y).to.equal(2);
    expect(calls).to.equal(2);
  });

  it('ActionDiggSystem shrugs when steel appears below', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(new Map());
    const lem = new StubLemming();
    lem.state = 1;
    lem.frameIndex = 7; // ->8
    level.isOutOfLevel = () => false;
    sys.digRow = () => true;
    level.steelGround = () => false;
    sys.process(level, lem); // dig first row
    level.steelGround = k => k === level.key(lem.x, lem.y);
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('ActionDrowningSystem moves when no wall', function() {
    const level = new StubLevel();
    const sys = new ActionDrowningSystem(new Map());
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionExitingSystem waits before exit', function() {
    const gvc = new StubGVC();
    const sys = new ActionExitingSystem(new Map(), gvc);
    const lem = new StubLemming();
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(gvc.count).to.equal(0);
  });

  it('ActionExplodingSystem clears mask on first frame', function() {
    const tm = new StubTriggerManager();
    const level = new StubLevel();
    const sys = new ActionExplodingSystem(new Map(), stubMasks(), tm, { draw() {} });
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(tm.removed[0]).to.equal(lem);
    expect(level.clearedMasks).to.have.length(1);
  });

  it('ActionFallSystem keeps falling without ground', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(new Map());
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(3);
    expect(lem.state).to.equal(3);
  });

  it('ActionFloatingSystem lands when ground below', function() {
    const sys = new ActionFloatingSystem(new Map());
    const level = new StubLevel();
    const lem = new StubLemming();
    level.ground.add(level.key(lem.x, lem.y + 2));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(2);
  });

  it('ActionFryingSystem moves then turns around', function() {
    const level = new StubLevel();
    const sys = new ActionFryingSystem(new Map());
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
    level.ground.add(level.key(lem.x + 8, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);
  });

  it('ActionHoistSystem pauses mid animation', function() {
    const sys = new ActionHoistSystem(new Map());
    const lem = new StubLemming();
    lem.frameIndex = 5; // ->6
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(0);
  });

  it('ActionJumpSystem lands immediately without ceiling', function() {
    const level = new StubLevel();
    const sys = new ActionJumpSystem(new Map());
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionJumpSystem ends after reaching max height', function() {
    const level = new StubLevel();
    const sys = new ActionJumpSystem(new Map());
    const lem = new StubLemming();
    lem.state = 2;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionMineSystem shrugs on steel ground', function() {
    const level = new StubLevel();
    level.steelGround = () => true;
    const sys = new ActionMineSystem(new Map(), stubMasks());
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('ActionMineSystem shrugs when arrow under mask', function() {
    const level = new StubLevel();
    const sys = new ActionMineSystem(new Map(), stubMasks());
    level.arrowUnder = true;
    const lem = new StubLemming();
    lem.frameIndex = 1; // ->2
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    expect(level.clearedMasks).to.have.length(0);
  });

  it('ActionOhNoSystem falls if unsupported', function() {
    const level = new StubLevel();
    const sys = new ActionOhNoSystem(new Map());
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(1);
  });

  it('ActionShrugSystem waits before walking', function() {
    const sys = new ActionShrugSystem(new Map());
    const lem = new StubLemming();
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.frameIndex).to.equal(1);
  });

  it('ActionSplatterSystem disables then exits', function() {
    const sys = new ActionSplatterSystem(new Map());
    const lem = new StubLemming();
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.disabled).to.equal(true);
  });

  it('ActionWalkSystem turns when blocked and cannot climb', function() {
    const sys = new TestWalkSystem(8, 0);
    const level = new StubLevel();
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);
  });

  it('ActionWalkSystem steps up small ledge', function() {
    const sys = new TestWalkSystem(2, 1);
    const level = new StubLevel();
    const lem = new StubLemming();
    sys.process(level, lem);
    expect(lem.y).to.equal(-1);
  });
});

