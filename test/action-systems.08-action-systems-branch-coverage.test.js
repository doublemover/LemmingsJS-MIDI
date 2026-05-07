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
