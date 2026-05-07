import { expect } from 'chai';
import { Lemmings, setTestAppContext, useGlobalLemmings } from './helpers/lemmings.js';
import { getAppContext } from '../js/core/dependencies.js';
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
import { runScenarioTable } from './support/scenario-table.js';

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

function makeRuntime(calls = [], miniMap = makeMiniMap()) {
  return {
    soundEvents: {
      emitSfx(type, sfxId, data) {
        calls.push({ type, sfxId, data });
      }
    },
    miniMap
  };
}

function attachRuntime(sys, calls = [], miniMap = makeMiniMap()) {
  sys.setRuntime?.(makeRuntime(calls, miniMap));
  return sys;
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

  runScenarioTable([
    {
      name: 'ActionBashSystem stops on arrow under mask',
      apply(level) {
        level.arrowUnder = true;
      }
    },
    {
      name: 'ActionBashSystem stops on steel under mask',
      apply(level) {
        level.steelUnder = true;
      }
    }
  ], ({ apply }) => {
    const level = new StubLevel();
    apply(level);
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
});
