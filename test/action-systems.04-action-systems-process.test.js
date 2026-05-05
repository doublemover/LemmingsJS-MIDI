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
});
