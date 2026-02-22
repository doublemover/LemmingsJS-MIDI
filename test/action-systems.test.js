import { expect } from 'chai';
import { Lemmings, setTestAppContext, useGlobalLemmings } from './helpers/lemmings.js';
import { getAppContext, setAppContext } from '../js/core/dependencies.js';
import { ActionBashSystem } from '../js/actions/ActionBashSystem.js';
import { ActionBlockerSystem } from '../js/actions/ActionBlockerSystem.js';
import { ActionBuildSystem } from '../js/actions/ActionBuildSystem.js';
import { ActionClimbSystem } from '../js/actions/ActionClimbSystem.js';
import { ActionCountdownSystem } from '../js/actions/ActionCountdownSystem.js';
import { ActionDiggSystem } from '../js/actions/ActionDiggSystem.js';
import { ActionDrowningSystem } from '../js/actions/ActionDrowningSystem.js';
import { ActionExitingSystem } from '../js/actions/ActionExitingSystem.js';
import { ActionExplodingSystem } from '../js/actions/ActionExplodingSystem.js';
import { ActionFallSystem } from '../js/actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../js/actions/ActionFloatingSystem.js';
import { ActionFryingSystem } from '../js/actions/ActionFryingSystem.js';
import { ActionHoistSystem } from '../js/actions/ActionHoistSystem.js';
import { ActionJumpSystem } from '../js/actions/ActionJumpSystem.js';
import { ActionMineSystem } from '../js/actions/ActionMineSystem.js';
import { ActionOhNoSystem } from '../js/actions/ActionOhNoSystem.js';
import { ActionShrugSystem } from '../js/actions/ActionShrugSystem.js';
import { ActionSplatterSystem } from '../js/actions/ActionSplatterSystem.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { SoundEventTypes, SoundEffectIds } from '../js/game/SoundEvents.js';
import '../js/level/Trigger.js';
import '../js/level/TriggerTypes.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/SpriteTypes.js';
import '../js/render/MaskTypes.js';
import '../js/lemmings/Lemming.js';

const makeMiniMap = () => ({
  addDeath() {},
  invalidateRegion() {},
  onGroundChanged() {}
});

const makeLemmings = () => ({
  game: {
    lemmingManager: { miniMap: makeMiniMap() },
    showDebug: false
  }
});

// minimal global environment
useGlobalLemmings(makeLemmings);
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
    this.stepHeight = null;
    this.gapDepth = null;
    this.steelGround = () => false;
    this.arrowAt = () => false;
  }
  key(x, y) { return `${x},${y}`; }
  hasGroundAt(x, y) { return this.ground.has(this.key(x, y)); }
  getGroundMaskLayer() {
    const self = this;
    return {
      hasGroundAt(x, y) { return self.hasGroundAt(x, y); },
      getSubLayer(x, y, w, h) {
        return { width: w, height: h, hasGroundAt(dx, dy) { return self.hasGroundAt(x + dx, y + dy); } };
      },
      getColumnStepHeight(x, yTop, height) {
        if (self.stepHeight !== null && self.stepHeight !== undefined) {
          return self.stepHeight;
        }
        const end = yTop + height - 1;
        for (let i = 0; i < height; i++) {
          const y = end - i;
          if (!self.hasGroundAt(x, y)) return i;
        }
        return height;
      },
      getColumnGapDepth(x, yTop, height) {
        if (self.gapDepth !== null && self.gapDepth !== undefined) {
          return self.gapDepth;
        }
        for (let i = 0; i < height; i++) {
          const y = yTop + i;
          if (self.hasGroundAt(x, y)) return i + 1;
        }
        return height + 1;
      }
    };
  }
  clearGroundWithMask(mask, x, y) { this.clearedMasks.push({ mask, x, y }); }   
  clearGroundWithMaskCount(mask, x, y) {
    this.clearGroundWithMask(mask, x, y);
    return this.clearCount ?? 1;
  }
  hasSteelUnderMask() { return this.steelUnder; }
  hasArrowUnderMask() { return this.arrowUnder; }
  isArrowAt(x, y, direction) { return this.arrowAt(x, y, direction); }
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

function useSoundBus(calls) {
  const base = getAppContext() ?? {};
  return setTestAppContext({
    ...base,
    game: {
      ...(base.game ?? {}),
      soundEvents: {
        emitSfx(type, sfxId, data) {
          calls.push({ type, sfxId, data });
        }
      }
    }
  });
}

function withoutSoundBus() {
  const base = getAppContext() ?? {};
  return setTestAppContext({
    ...base,
    game: {
      ...(base.game ?? {}),
      soundEvents: null
    }
  });
}

function withoutLemmingManager() {
  const base = getAppContext() ?? {};
  return setTestAppContext({
    ...base,
    game: {
      ...(base.game ?? {}),
      lemmingManager: null
    }
  });
}

function ensureMiniMap() {
  const app = getAppContext() && typeof getAppContext() === 'object'
    ? getAppContext()
    : {};
  if (!app.game || typeof app.game !== 'object') {
    app.game = {};
  }
  if (!app.game.lemmingManager || typeof app.game.lemmingManager !== 'object') {
    app.game.lemmingManager = { miniMap: makeMiniMap() };
  }
  setAppContext(app);
  return app.game.lemmingManager;
}

// helpers for controlled Action systems
class TestBashSystem extends ActionBashSystem {
  constructor(gap, horiz) { super(stubSprites, stubMasks()); this.gap = gap; this.horiz = horiz; }
  findGapDelta() { return this.gap; }
  findHorizontalSpace() { return this.horiz; }
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

  it('ActionBashSystem moves horizontally after frame 10', function() {
    const level = new StubLevel();
    const sys = new TestBashSystem(0, 0);

    const lem1 = new StubLemming();
    lem1.frameIndex = 9; // ->10
    const x1 = lem1.x;
    sys.process(level, lem1);
    expect(lem1.x).to.equal(x1);

    const lem2 = new StubLemming();
    lem2.frameIndex = 10; // ->11
    const x2 = lem2.x;
    expect(sys.process(level, lem2)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem2.x).to.equal(x2 + 1);

    const lem3 = new StubLemming();
    lem3.lookRight = false;
    lem3.frameIndex = 10; // ->11
    const x3 = lem3.x;
    sys.process(level, lem3);
    expect(lem3.x).to.equal(x3 - 1);
  });

  it('ActionBashSystem keeps bashing when space remains', function() {
    const level = new StubLevel();
    const sys = new TestBashSystem(0, 3); // horizontal space < 4
    const lem = new StubLemming();
    lem.frameIndex = 4; // ->5
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
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

  it('ActionBlockerSystem keeps triggers until ground is lost', function() {
    const level = new StubLevel();
    const tm = new StubTriggerManager();
    const sys = new ActionBlockerSystem(stubSprites, tm);
    const lem = new StubLemming();
    level.ground.add(level.key(lem.x, lem.y + 1));
    lem.state = 0;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(tm.added.length).to.equal(2);
    expect(tm.removed.length).to.equal(0);
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

  it('ActionClimbSystem triggers HOISTING at the top', function() {
    const level = new StubLevel();
    const sys = new ActionClimbSystem(stubSprites);
    const lem = new StubLemming();
    // wall continues for two steps but top is clear
    level.ground.add(level.key(lem.x, lem.y - 8));
    level.ground.add(level.key(lem.x, lem.y - 9));
    lem.frameIndex = 2; // ->3 near the top
    const result = sys.process(level, lem);
    expect(result).to.equal(Lemmings.LemmingStateType.HOISTING);
    expect(lem.y).to.equal(-1);
  });

  it('ActionClimbSystem falls and flips when side blocked', function() {
    const level = new StubLevel();
    const sys = new ActionClimbSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 4; // ->5 climbing up the wall
    level.ground.add(level.key(lem.x - 1, lem.y - 9));
    const result = sys.process(level, lem);
    expect(result).to.equal(Lemmings.LemmingStateType.FALLING);
    expect(lem.lookRight).to.equal(false);
    expect(lem.x).to.equal(-2);
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

  it('ActionFloatingSystem trigger sets hasParachute once', function() {
    const sys = new ActionFloatingSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(true);
    expect(lem.hasParachute).to.equal(true);
    expect(sys.triggerLemAction(lem)).to.equal(false);
    expect(lem.hasParachute).to.equal(true);
  });

  it('opens umbrella mid fall and walks on landing', function() {
    const fallSys = new ActionFallSystem(stubSprites);
    const floatSys = new ActionFloatingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.state = 17;
    fallSys.process(level, lem); // fall one step
    expect(lem.y).to.equal(3);
    expect(floatSys.triggerLemAction(lem)).to.equal(true);
    level.ground.add(level.key(lem.x, 5));
    expect(fallSys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FLOATING);
    expect(floatSys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(5);
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
    const sys = new ActionWalkSystem(stubSprites);

    const level1 = new StubLevel();
    const lem1 = new StubLemming();
    lem1.canClimb = true;
    level1.stepHeight = 8;
    expect(sys.process(level1, lem1)).to.equal(Lemmings.LemmingStateType.CLIMBING);

    const level2 = new StubLevel();
    const lem2 = new StubLemming();
    level2.stepHeight = 5;
    expect(sys.process(level2, lem2)).to.equal(Lemmings.LemmingStateType.JUMPING);

    const level3 = new StubLevel();
    const lem3 = new StubLemming();
    level3.stepHeight = 2;
    expect(sys.process(level3, lem3)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);

    const level4 = new StubLevel();
    const lem4 = new StubLemming();
    level4.stepHeight = 0;
    level4.gapDepth = 4;
    expect(sys.process(level4, lem4)).to.equal(Lemmings.LemmingStateType.FALLING);
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

  it('ActionBashSystem stops on steel under mask', function() {
    const level = new StubLevel();
    level.steelUnder = true;
    const sys = new TestBashSystem(0, 0);
    const lem = new StubLemming();
    lem.frameIndex = 2; // ->3
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    expect(level.clearedMasks).to.have.length(0);
  });

  it('ActionBashSystem finishes when no horizontal space found', function() {
    const level = new StubLevel();
    const sys = new ActionBashSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 4; // ->5
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionBashSystem helper functions inspect ground', function() {
    const level = new StubLevel();
    const sys = new ActionBashSystem(stubSprites, stubMasks());
    const gm = level.getGroundMaskLayer();

    expect(sys.findGapDelta(gm, 0, 0)).to.equal(3);
    level.ground.add(level.key(0, 2));
    expect(sys.findGapDelta(gm, 0, 0)).to.equal(2);
    level.ground.add(level.key(0, 0));
    level.ground.delete(level.key(0, 2));
    expect(sys.findGapDelta(gm, 0, 0)).to.equal(0);

    level.ground.clear();
    expect(sys.findHorizontalSpace(gm, 0, 0, true)).to.equal(4);
    level.ground.add(level.key(1, 0));
    expect(sys.findHorizontalSpace(gm, 0, 0, true)).to.equal(1);
    level.ground.clear();
    level.ground.add(level.key(-3, 0));
    expect(sys.findHorizontalSpace(gm, 0, 0, false)).to.equal(3);
  });

  it('ActionBuildSystem turns around when hitting wall', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15; // ->0
    level.ground.add(level.key(lem.x + 1, lem.y - 2));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);
  });

  it('ActionBuildSystem walks when roof blocks path', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15; // ->0
    level.ground.add(level.key(4, -10));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionBuildSystem builds twelve bricks then shrugs', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();

    for (let i = 0; i < 11; i++) {
      lem.frameIndex = 8; // ->9 lay brick
      sys.process(level, lem);
      lem.frameIndex = 15; // ->0 step up
      sys.process(level, lem);
    }

    expect(lem.state).to.equal(11);
    expect(lem.x).to.equal(22);
    expect(lem.y).to.equal(-11);

    lem.frameIndex = 8; // ->9 lay final brick
    sys.process(level, lem);
    lem.frameIndex = 15; // ->0 last step
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    expect(level.setGroundCalls).to.have.length(72);
    expect(lem.x).to.equal(24);
    expect(lem.y).to.equal(-12);
  });

  it('ActionBuildSystem turns around mid-step when ground blocks path', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 8; // lay first brick
    sys.process(level, lem);
    lem.frameIndex = 15; // stepping forward
    level.ground.add(level.key(lem.x + 1, lem.y - 2));
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);
    expect(lem.x).to.equal(1);
    expect(lem.y).to.equal(-1);
    expect(lem.state).to.equal(0);
  });

  it('ActionBuildSystem turns around when ceiling blocks next step', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 8; // lay brick
    sys.process(level, lem);
    lem.frameIndex = 15; // step forward
    level.ground.add(level.key(4, -10));
    const result = sys.process(level, lem);
    expect(result).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);
    expect(lem.x).to.equal(2);
    expect(lem.y).to.equal(-1);
    expect(lem.state).to.equal(1);
  });

  it('ActionBuildSystem lays bricks facing left', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming(10, 0);
    lem.lookRight = false;
    lem.frameIndex = 8; // ->9 brick
    sys.process(level, lem);
    expect(level.setGroundCalls).to.eql([
      '6,-1','7,-1','8,-1','9,-1','10,-1','11,-1'
    ]);
  });

  it('ActionBuildSystem steps forward without obstacles', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15; // ->0 step
    const result = sys.process(level, lem);
    expect(result).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.x).to.equal(2);
    expect(lem.y).to.equal(-1);
    expect(lem.state).to.equal(1);
    expect(lem.lookRight).to.equal(true);
  });

  it('ActionBuildSystem clips brick placement to level bounds', function() {
    const level = new StubLevel();
    level.width = 12;
    level.height = 20;
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming(10, 5);
    lem.frameIndex = 8; // ->9 brick
    sys.process(level, lem);
    expect(level.setGroundCalls).to.eql(['10,4', '11,4']);
  });

  it('ActionBuildSystem turns around at horizontal level edges', function() {
    const level = new StubLevel();
    level.width = 2;
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming(1, 0);
    lem.frameIndex = 15; // ->0 step
    const result = sys.process(level, lem);
    expect(result).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);
    expect(lem.x).to.equal(1);
  });

  it('ActionBuildSystem bounces off opposing one-way walls and keeps building', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming(10, 12);
    lem.frameIndex = 15; // ->0 movement step
    level.arrowAt = (x, y, direction) => direction === true && x === 11 && y === 10;

    const result = sys.process(level, lem);

    expect(result).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);
    expect(lem.x).to.equal(10);
    expect(lem.y).to.equal(11);
    expect(lem.state).to.equal(0);
  });

  it('ActionClimbSystem continues with ceiling present', function() {
    const level = new StubLevel();
    const sys = new ActionClimbSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 2; // ->3
    level.ground.add(level.key(lem.x, lem.y - 10));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(0);
  });

  it('ActionDiggSystem shrugs on steel', function() {
    const level = new StubLevel();
    level.steelGround = () => true;
    const sys = new ActionDiggSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('ActionDiggSystem digs rows while inside level', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(stubSprites);
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
    const sys = new ActionDiggSystem(stubSprites);
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
    const sys = new ActionDiggSystem(stubSprites);
    const lem = new StubLemming();
    lem.state = 1;
    lem.frameIndex = 7; // ->8
    level.isOutOfLevel = () => false;
    sys.digRow = () => false;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
  });

  it('ActionDiggSystem cycles animation frames', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(stubSprites);
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
    const sys = new ActionDiggSystem(stubSprites);
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

  it('digRow returns false when no ground present', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(stubSprites);
    const lem = new StubLemming();
    lem.x = 10;
    const res = sys.digRow(level, lem, 0);
    expect(res).to.equal(false);
    expect(level.clearedPoints).to.have.length(0);
  });

  it('digRow clears boundary ground points', function() {
    const level = new StubLevel();
    const sys = new ActionDiggSystem(stubSprites);
    const lem = new StubLemming();
    lem.x = 10;
    level.setGroundAt(lem.x - 4, 0);
    level.setGroundAt(lem.x + 4, 0);
    const res = sys.digRow(level, lem, 0);
    expect(res).to.equal(true);
    expect(level.clearedPoints).to.have.members([
      level.key(lem.x - 4, 0),
      level.key(lem.x + 4, 0)
    ]);
  });

  it('ActionDrowningSystem moves when no wall', function() {
    const level = new StubLevel();
    const sys = new ActionDrowningSystem(stubSprites);
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionExitingSystem waits before exit', function() {
    const gvc = new StubGVC();
    const sys = new ActionExitingSystem(stubSprites, gvc);
    const lem = new StubLemming();
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(gvc.count).to.equal(0);
  });

  it('ActionExplodingSystem clears mask on first frame', function() {
    const tm = new StubTriggerManager();
    const level = new StubLevel();
    const sys = new ActionExplodingSystem(stubSprites, stubMasks(), tm, { draw() {} });
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(tm.removed[0]).to.equal(lem);
    expect(level.clearedMasks).to.have.length(1);
  });

  it('ActionFallSystem keeps falling without ground', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(3);
    expect(lem.state).to.equal(3);
  });

  it('ActionFallSystem accumulates state over time', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    sys.process(level, lem); // state ->3
    const result = sys.process(level, lem); // state ->6
    expect(result).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(6);
    expect(lem.state).to.equal(6);
  });

  it('ActionFallSystem floats once fall distance exceeds 16 with parachute', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    lem.hasParachute = true;
    let state;
    for (let i = 0; i < 7; i++) {
      state = sys.process(level, lem);
    }
    expect(state).to.equal(Lemmings.LemmingStateType.FLOATING);
    expect(lem.state).to.be.above(16);
  });

  it('ActionFallSystem lands with parachute when ground one step below', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    lem.hasParachute = true;
    level.ground.add(level.key(lem.x, lem.y + 1));
    const state = sys.process(level, lem);
    expect(state).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(1);
    expect(lem.state).to.equal(0);
  });

  it('ActionFallSystem lands with parachute when ground two steps below', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    lem.hasParachute = true;
    level.ground.add(level.key(lem.x, lem.y + 2));
    const state = sys.process(level, lem);
    expect(state).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(2);
    expect(lem.state).to.equal(0);
  });

  it('ActionFallSystem walks or splats depending on fall distance', function() {
    const level = new StubLevel();
    const sys = new ActionFallSystem(stubSprites);
    const lem = new StubLemming();
    level.ground.add(level.key(lem.x, lem.y));
    lem.state = Lemmings.Lemming.LEM_MAX_FALLING;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);

    level.ground.add(level.key(lem.x, lem.y));
    lem.state = Lemmings.Lemming.LEM_MAX_FALLING + 1;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SPLATTING);
  });

  it('ActionFloatingSystem lands when ground below', function() {
    const sys = new ActionFloatingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    level.ground.add(level.key(lem.x, lem.y + 2));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(2);
  });

  it('ActionFryingSystem moves then turns around', function() {
    const level = new StubLevel();
    const sys = new ActionFryingSystem(stubSprites);
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
    level.ground.add(level.key(lem.x + 8, lem.y));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);
  });

  it('ActionHoistSystem pauses mid animation', function() {
    const sys = new ActionHoistSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 5; // ->6
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(0);
  });

  it('ActionJumpSystem lands immediately without ceiling', function() {
    const level = new StubLevel();
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionJumpSystem ends after reaching max height', function() {
    const level = new StubLevel();
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    lem.state = 2;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionJumpSystem climbs two cells then ends', function() {
    const level = new StubLevel();
    level.ground.add(level.key(1, -1));
    level.ground.add(level.key(1, -2));
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(-2);
    expect(lem.state).to.equal(0);
  });

  it('ActionJumpSystem ends when no ceiling remains', function() {
    const level = new StubLevel();
    level.ground.add(level.key(1, -1));
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(-1);
  });

  it('ActionJumpSystem enforces LEM_MIN_Y', function() {
    const level = new StubLevel();
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    lem.y = -6;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.y).to.equal(Lemmings.Lemming.LEM_MIN_Y);
  });

  it('ActionJumpSystem resets state after jump', function() {
    const level = new StubLevel();
    level.ground.add(level.key(1, -1));
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    sys.process(level, lem);
    expect(lem.state).to.equal(0);
  });

  it('ActionJumpSystem triggerLemAction refuses to activate', function() {
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(false);
  });

  it('ActionJumpSystem draw delegates to base system', function() {
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    let called = false;
    const display = { drawFrame() { called = true; } };
    sys.draw(display, lem);
    expect(called).to.equal(true);
  });

  it('ActionJumpSystem initializes state and keeps jumping', function() {
    const level = new StubLevel();
    level.hasGroundAt = () => true;
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    lem.state = -1;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.JUMPING);
    expect(lem.state).to.equal(1);
    expect(lem.y).to.equal(-2);
  });

  it('ActionJumpSystem initializes null state then ends', function() {
    const level = new StubLevel();
    level.ground.add(level.key(1, -1));
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    lem.state = null;
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.state).to.equal(0);
    expect(lem.y).to.equal(-1);
  });

  it('ActionMineSystem shrugs on steel ground', function() {
    const level = new StubLevel();
    level.steelUnder = true;
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
  });

  it('ActionMineSystem shrugs when arrow under mask', function() {
    const level = new StubLevel();
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    level.arrowUnder = true;
    const lem = new StubLemming();
    lem.frameIndex = 1; // ->2
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    expect(level.clearedMasks).to.have.length(0);
  });

  it('ActionOhNoSystem falls if unsupported', function() {
    const level = new StubLevel();
    const sys = new ActionOhNoSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(1);
  });

  it('ActionShrugSystem waits before walking', function() {
    const sys = new ActionShrugSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.frameIndex).to.equal(1);
  });

  it('ActionSplatterSystem disables then exits', function() {
    const sys = new ActionSplatterSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.disabled).to.equal(true);
  });

  it('ActionWalkSystem turns when blocked and cannot climb', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 8;
    const lem = new StubLemming();
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.lookRight).to.equal(false);
  });

  it('ActionWalkSystem steps up small ledge', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 2;
    const lem = new StubLemming();
    sys.process(level, lem);
    expect(lem.y).to.equal(-1);
  });

  it('getColumnStepHeight counts ground from bottom', function() {
    const level = new StubLevel();
    const mask = level.getGroundMaskLayer();
    level.ground.add(level.key(0, 3));
    expect(mask.getColumnStepHeight(0, 0, 4)).to.equal(1);
    level.ground.add(level.key(0, 0));
    level.ground.add(level.key(0, 1));
    level.ground.add(level.key(0, 2));
    expect(mask.getColumnStepHeight(0, 0, 4)).to.equal(4);
    level.ground.clear();
    expect(mask.getColumnStepHeight(0, 0, 4)).to.equal(0);
  });

  it('getColumnGapDepth counts gap from top', function() {
    const level = new StubLevel();
    const mask = level.getGroundMaskLayer();
    level.ground.add(level.key(0, 2));
    expect(mask.getColumnGapDepth(0, 0, 3)).to.equal(3);
    level.ground.clear();
    expect(mask.getColumnGapDepth(0, 0, 3)).to.equal(4);
  });

  it('ActionWalkSystem clamps position to LEM_MIN_Y', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 2;
    const lem = new StubLemming();
    lem.y = Lemmings.Lemming.LEM_MIN_Y;
    sys.process(level, lem);
    expect(lem.y).to.equal(Lemmings.Lemming.LEM_MIN_Y);
  });

  it('ActionWalkSystem walks over shallow gaps', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 0;
    level.gapDepth = 1;
    const lem = new StubLemming();
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(1);
  });
});

describe('Action systems events and draws', function() {
  it('ActionBaseSystem emitters fire for bashing and digging steel', function() {
    const calls = [];
    const restore = useSoundBus(calls);

    const bashLevel = new StubLevel();
    bashLevel.steelUnder = true;
    const bash = new ActionBashSystem(stubSprites, stubMasks());
    const bashLem = new StubLemming();
    bashLem.id = 1;
    bashLem.frameIndex = 2; // -> state 3
    expect(bash.process(bashLevel, bashLem)).to.equal(Lemmings.LemmingStateType.SHRUG);

    const digLevel = new StubLevel();
    digLevel.steelGround = () => true;
    const dig = new ActionDiggSystem(stubSprites);
    const digLem = new StubLemming();
    digLem.id = 2;
    expect(dig.process(digLevel, digLem)).to.equal(Lemmings.LemmingStateType.SHRUG);

    restore();
    expect(calls[0].type).to.equal(SoundEventTypes.STEEL_HIT);
    expect(calls[1].type).to.equal(SoundEventTypes.STEEL_HIT);
  });

  it('emits terrain events with intensity for dig, bash, and mine', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const digLevel = new StubLevel();
    const dig = new ActionDiggSystem(stubSprites);
    const digLem = new StubLemming(10, 5);
    digLem.id = 9;
    for (let x = digLem.x - 4; x <= digLem.x; x++) {
      digLevel.ground.add(digLevel.key(x, 3));
    }
    dig.digRow(digLevel, digLem, 3);

    const mask = { offsetX: 0, offsetY: 0, width: 3, height: 1, at() { return false; } };
    const masks = { GetMask() { return { GetMask() { return mask; } }; } };

    const bashLevel = new StubLevel();
    bashLevel.clearCount = 3;
    const bash = new ActionBashSystem(stubSprites, masks);
    const bashLem = new StubLemming();
    bashLem.id = 10;
    bashLem.frameIndex = 2; // -> state 3
    bash.process(bashLevel, bashLem);

    const mineLevel = new StubLevel();
    mineLevel.clearCount = 2;
    const mine = new ActionMineSystem(stubSprites, masks);
    const mineLem = new StubLemming();
    mineLem.id = 11;
    mine.process(mineLevel, mineLem);

    restore();
    const digEvent = calls.find(call => call.type === SoundEventTypes.LEMMING_DIG);
    const bashEvent = calls.find(call => call.type === SoundEventTypes.LEMMING_BASH);
    const mineEvent = calls.find(call => call.type === SoundEventTypes.LEMMING_MINE);
    expect(digEvent).to.be.ok;
    expect(bashEvent).to.be.ok;
    expect(mineEvent).to.be.ok;
    expect(digEvent.data.intensity).to.be.greaterThan(1);
    expect(bashEvent.data.intensity).to.be.greaterThan(1);
    expect(mineEvent.data.intensity).to.be.greaterThan(1);
  });

  it('handles missing clear count with null bash masks', function() {
    const restore = useSoundBus([]);
    const level = {
      getGroundMaskLayer() { return { hasGroundAt() { return false; } }; },
      hasSteelUnderMask() { return false; },
      hasArrowUnderMask() { return false; },
      clearGroundWithMask(mask) { this.cleared = mask; }
    };
    const nullMasks = {
      GetMask() { return { GetMask() { return null; } }; }
    };
    const sys = new ActionBashSystem(stubSprites, nullMasks);
    const lem = new StubLemming();
    lem.frameIndex = 1; // -> state 2
    sys.process(level, lem);
    restore();
    expect(level.cleared).to.equal(null);
  });

  it('handles missing clear count with null mine masks', function() {
    const restore = useSoundBus([]);
    const level = {
      hasSteelUnderMask() { return false; },
      hasArrowUnderMask() { return false; },
      clearGroundWithMask(mask) { this.cleared = mask; }
    };
    const nullMasks = {
      GetMask() { return { GetMask() { return null; } }; }
    };
    const sys = new ActionMineSystem(stubSprites, nullMasks);
    const lem = new StubLemming();
    lem.frameIndex = 0; // -> state 1
    sys.process(level, lem);
    restore();
    expect(level.cleared).to.equal(null);
  });

  it('ActionBashSystem exits to walking when solid ends', function() {
    const level = new StubLevel();
    const sys = new ActionBashSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 4; // -> state 5
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionBuildSystem emits step and warning sounds', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.id = 3;
    lem.frameIndex = 8;
    lem.state = 9;

    sys.process(level, lem);
    restore();

    expect(calls.map(c => c.type)).to.eql([
      SoundEventTypes.BUILDER_STEP,
      SoundEventTypes.BUILDER_WARNING
    ]);
    expect(calls.map(c => c.sfxId)).to.eql([
      SoundEffectIds.BUILDER_STEP,
      SoundEffectIds.BUILDER_WARNING
    ]);
  });

  it('ActionBuildSystem handles frame-zero movement checks', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15; // -> 0
    level.ground.add(level.key(1, -2));

    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);

    const lem2 = new StubLemming();
    lem2.frameIndex = 15;
    level.ground.clear();
    level.ground.add(level.key(4, -10));
    expect(sys.process(level, lem2)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem2.lookRight).to.equal(false);
  });

  it('ActionCountdownSystem emits ohno when the timer hits zero', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const sys = new ActionCountdownSystem(stubMasks());
    const lem = new StubLemming();
    lem.id = 4;
    lem.countdown = 1;
    lem.setCountDown = act => { lem.countdownAction = act; return true; };

    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.OHNO);
    restore();

    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_OHNO);
    expect(calls[0].sfxId).to.equal(SoundEffectIds.OHNO);
  });

  it('ActionDrowningSystem and ExitingSystem emit sfx on entry', function() {
    const calls = [];
    const restore = useSoundBus(calls);

    const drowning = new ActionDrowningSystem(stubSprites);
    const drownLem = new StubLemming();
    drownLem.id = 5;
    drownLem.lastTriggerType = 'water';
    drowning.process(new StubLevel(), drownLem);

    const gvc = new StubGVC();
    const exit = new ActionExitingSystem(stubSprites, gvc);
    const exitLem = new StubLemming();
    exitLem.id = 6;
    exitLem.lastTriggerType = 'exit';
    exit.process(new StubLevel(), exitLem);

    restore();
    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_DROWN);
    expect(calls[1].type).to.equal(SoundEventTypes.LEMMING_EXIT);
  });

  it('ActionDrowningSystem moves when no ground is ahead', function() {
    const sys = new ActionDrowningSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionExplodingSystem emits and invalidates minimap', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const mask = { offsetX: -2, offsetY: -3, width: 4, height: 5 };
    const masks = { GetMask() { return { GetMask() { return mask; } }; } };
    const triggerManager = { removed: [], removeByOwner(lem) { this.removed.push(lem); } };
    const particleTable = { draw() {} };
    const sys = new ActionExplodingSystem(stubSprites, masks, triggerManager, particleTable);
    const level = { clearGroundWithMask() { return true; } };

    const miniMap = {
      invalidations: [],
      deaths: [],
      invalidateRegion(x, y, w, h) { this.invalidations.push({ x, y, w, h }); },
      addDeath(x, y) { this.deaths.push({ x, y }); }
    };
    const manager = ensureMiniMap();
    const prevMiniMap = manager.miniMap;
    manager.miniMap = miniMap;

    const lem = new StubLemming();
    lem.id = 7;
    sys.process(level, lem);

    manager.miniMap = prevMiniMap;
    restore();

    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_EXPLODE);
    expect(triggerManager.removed[0]).to.equal(lem);
    expect(miniMap.invalidations[0]).to.eql({ x: -2, y: -3, w: 4, h: 5 });
    expect(miniMap.deaths[0]).to.eql({ x: 0, y: 0 });
  });

  it('ActionFallSystem and FloatingSystem draw frames', function() {
    const display = { frames: [], drawFrame(frame, x, y) { this.frames.push({ frame, x, y }); } };

    const fall = new ActionFallSystem(stubSprites);
    const fallLem = new StubLemming();
    fall.draw(display, fallLem);

    const floatSys = new ActionFloatingSystem(stubSprites);
    const floatLem = new StubLemming();
    floatSys.draw(display, floatLem);

    expect(display.frames.length).to.equal(2);
  });

  it('ActionFryingSystem reports deaths to minimap', function() {
    const sys = new ActionFryingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.frameIndex = 12;

    const miniMap = { deaths: [], addDeath(x, y) { this.deaths.push({ x, y }); } };
    const manager = ensureMiniMap();
    const prevMiniMap = manager.miniMap;
    manager.miniMap = miniMap;

    sys.process(level, lem);

    manager.miniMap = prevMiniMap;
    expect(miniMap.deaths[0]).to.eql({ x: 0, y: 0 });
  });

  it('ActionFryingSystem moves when no ground is ahead', function() {
    const sys = new ActionFryingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionHoistSystem handles invalid frameIndex values', function() {
    const sys = new ActionHoistSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = NaN;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
  });

  it('ActionMineSystem emits steel hit sound', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const level = new StubLevel();
    level.steelUnder = true;
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.id = 8;
    sys.process(level, lem);
    restore();

    expect(calls[0].type).to.equal(SoundEventTypes.STEEL_HIT);
    expect(calls[0].sfxId).to.equal(SoundEffectIds.STEEL_HIT);
  });

  it('ActionMineSystem keeps mining when ground remains', function() {
    const level = new StubLevel();
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 14; // -> 15
    level.ground.add(level.key(1, 0));
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.x).to.equal(1);
  });

  it('ActionOhNoSystem and SplatterSystem trigger handlers', function() {
    const calls = [];
    const restore = useSoundBus(calls);

    const ohNo = new ActionOhNoSystem(stubSprites);
    const ohNoLem = new StubLemming();
    ohNoLem.frameIndex = 15;
    expect(ohNo.triggerLemAction(ohNoLem)).to.equal(false);

    const miniMap = { deaths: [], addDeath(x, y) { this.deaths.push({ x, y }); } };
    const manager = ensureMiniMap();
    const prevMiniMap = manager.miniMap;
    manager.miniMap = miniMap;

    ohNo.draw({ drawFrame() {} }, ohNoLem);

    const splatter = new ActionSplatterSystem(stubSprites);
    const splatLem = new StubLemming();
    splatLem.id = 9;
    splatLem.frameIndex = 15;
    splatLem.lastTriggerType = null;
    expect(splatter.triggerLemAction(splatLem)).to.equal(false);
    splatter.draw({ drawFrame() {} }, splatLem);
    splatLem.frameIndex = 0;
    splatter.process(new StubLevel(), splatLem);

    manager.miniMap = prevMiniMap;
    restore();

    expect(miniMap.deaths.length).to.equal(2);
    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_SPLAT);
  });

  it('ActionWalkSystem triggerLemAction returns false', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(false);
  });

  it('ActionWalkSystem advances when the path is clear', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 0;
    level.gapDepth = 1;
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionDrowningSystem triggerLemAction returns false', function() {
    const sys = new ActionDrowningSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(false);
  });
});

describe('Action systems branch coverage', function() {
  it('ActionBashSystem handles steel without sound bus', function() {
    const level = new StubLevel();
    level.steelUnder = true;
    const sys = new ActionBashSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 2;
    const restore = withoutSoundBus();
    try {
      expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    } finally {
      restore();
    }
  });

  it('ActionBashSystem checks left edge when bashing', function() {
    const level = new StubLevel();
    const sys = new TestBashSystem(0, 4);
    const lem = new StubLemming();
    lem.lookRight = false;
    lem.frameIndex = 4;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionBuildSystem skips missing sound bus', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 8;
    lem.state = 9;
    const restore = withoutSoundBus();
    try {
      expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    } finally {
      restore();
    }
  });

  it('ActionBuildSystem moves left when blocked', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.lookRight = false;
    lem.frameIndex = 15;
    level.ground.add(level.key(-1, -2));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.x).to.equal(-1);
  });

  it('ActionBuildSystem checks roof behind when building backwards', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.lookRight = false;
    lem.frameIndex = 15;
    lem.state = 10;
    level.ground.add(level.key(-4, -10));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(true);
  });

  it('ActionClimbSystem flips from the left wall', function() {
    const level = new StubLevel();
    const sys = new ActionClimbSystem(stubSprites);
    const lem = new StubLemming();
    lem.lookRight = false;
    lem.frameIndex = 4;
    level.ground.add(level.key(lem.x + 1, lem.y - 9));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.FALLING);
    expect(lem.lookRight).to.equal(true);
    expect(lem.x).to.equal(2);
  });

  it('ActionCountdownSystem handles no sound bus at zero', function() {
    const sys = new ActionCountdownSystem(stubMasks());
    const lem = new StubLemming();
    lem.countdown = 1;
    lem.setCountDown = act => { lem.countdownAction = act; return true; };
    const restore = withoutSoundBus();
    try {
      expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.OHNO);
    } finally {
      restore();
    }
  });

  it('ActionDiggSystem shrugs on steel without sound bus', function() {
    const sys = new ActionDiggSystem(stubSprites);
    const level = new StubLevel();
    level.steelGround = () => true;
    const lem = new StubLemming();
    const restore = withoutSoundBus();
    try {
      expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    } finally {
      restore();
    }
  });

  it('ActionDrowningSystem moves left without sound bus', function() {
    const sys = new ActionDrowningSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.lookRight = false;
    const restore = withoutSoundBus();
    try {
      sys.process(level, lem);
    } finally {
      restore();
    }
    expect(lem.x).to.equal(-1);
  });

  it('ActionExitingSystem handles missing sound bus on entry', function() {
    const gvc = new StubGVC();
    const sys = new ActionExitingSystem(stubSprites, gvc);
    const lem = new StubLemming();
    const restore = withoutSoundBus();
    try {
      expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    } finally {
      restore();
    }
    expect(gvc.count).to.equal(0);
  });

  it('ActionExplodingSystem handles missing sound bus and minimap', function() {
    const triggerManager = { removed: [], removeByOwner(lem) { this.removed.push(lem); } };
    const sys = new ActionExplodingSystem(stubSprites, stubMasks(), triggerManager, { draw() {} });
    const level = { clearGroundWithMask() { return false; } };
    const lem = new StubLemming();
    const restoreSound = withoutSoundBus();
    const restoreManager = withoutLemmingManager();
    try {
      sys.process(level, lem);
    } finally {
      restoreManager();
      restoreSound();
    }
    expect(triggerManager.removed[0]).to.equal(lem);
  });

  it('ActionFryingSystem ignores missing minimap', function() {
    const sys = new ActionFryingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.frameIndex = 12;
    const restore = withoutLemmingManager();
    try {
      sys.process(level, lem);
    } finally {
      restore();
    }
    expect(lem.frameIndex).to.equal(13);
  });

  it('ActionFryingSystem moves left when no ground', function() {
    const sys = new ActionFryingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.lookRight = false;
    sys.process(level, lem);
    expect(lem.x).to.equal(-1);
  });

  it('ActionJumpSystem moves left when jumping', function() {
    const level = new StubLevel();
    const sys = new ActionJumpSystem(stubSprites);
    const lem = new StubLemming();
    lem.lookRight = false;
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.x).to.equal(-1);
  });

  it('ActionMineSystem shrugs on steel without sound bus', function() {
    const level = new StubLevel();
    level.steelUnder = true;
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    const restore = withoutSoundBus();
    try {
      expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.SHRUG);
    } finally {
      restore();
    }
  });

  it('ActionMineSystem moves left when mining', function() {
    const level = new StubLevel();
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.lookRight = false;
    lem.frameIndex = 14;
    level.ground.add(level.key(-1, 0));
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.x).to.equal(-1);
  });

  it('ActionSplatterSystem skips sound bus when missing', function() {
    const sys = new ActionSplatterSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 0;
    const restore = withoutSoundBus();
    try {
      expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    } finally {
      restore();
    }
  });

  it('ActionWalkSystem moves left when walking', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 0;
    level.gapDepth = 1;
    const lem = new StubLemming();
    lem.lookRight = false;
    sys.process(level, lem);
    expect(lem.x).to.equal(-1);
  });
});
