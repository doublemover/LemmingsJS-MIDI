import { Lemmings, setTestAppContext, useGlobalLemmings } from './lemmings.js';
import { getAppContext } from '../../js/core/dependencies.js';
import { ActionBashSystem } from '../../js/actions/ActionBashSystem.js';
import { ActionBlockerSystem } from '../../js/actions/ActionBlockerSystem.js';
import { ActionBuildSystem } from '../../js/actions/ActionBuildSystem.js';
import { ActionClimbSystem } from '../../js/actions/ActionClimbSystem.js';
import { ActionCountdownSystem } from '../../js/actions/ActionCountdownSystem.js';
import { ActionDiggSystem } from '../../js/actions/ActionDiggSystem.js';
import { ActionDrowningSystem } from '../../js/actions/ActionDrowningSystem.js';
import { ActionExitingSystem } from '../../js/actions/ActionExitingSystem.js';
import { ActionExplodingSystem } from '../../js/actions/ActionExplodingSystem.js';
import { ActionFallSystem } from '../../js/actions/ActionFallSystem.js';
import { ActionFloatingSystem } from '../../js/actions/ActionFloatingSystem.js';
import { ActionFryingSystem } from '../../js/actions/ActionFryingSystem.js';
import { ActionHoistSystem } from '../../js/actions/ActionHoistSystem.js';
import { ActionJumpSystem } from '../../js/actions/ActionJumpSystem.js';
import { ActionMineSystem } from '../../js/actions/ActionMineSystem.js';
import { ActionOhNoSystem } from '../../js/actions/ActionOhNoSystem.js';
import { ActionShrugSystem } from '../../js/actions/ActionShrugSystem.js';
import { ActionSplatterSystem } from '../../js/actions/ActionSplatterSystem.js';
import { ActionWalkSystem } from '../../js/actions/ActionWalkSystem.js';
import { SoundEventTypes, SoundEffectIds } from '../../js/game/SoundEvents.js';
import '../../js/level/Trigger.js';
import '../../js/level/TriggerTypes.js';
import '../../js/lemmings/LemmingStateType.js';
import '../../js/lemmings/SpriteTypes.js';
import '../../js/render/MaskTypes.js';
import '../../js/lemmings/Lemming.js';

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

const useActionFixtures = () => {
  useGlobalLemmings(makeLemmings);
  let dimensions;
  beforeEach(() => {
    dimensions = Object.fromEntries(['winW', 'winH'].map(key => [key, { present: Object.hasOwn(globalThis, key), value: globalThis[key] }]));
    Object.assign(globalThis, { winW: 800, winH: 600 });
  });
  afterEach(() => {
    for (const [key, saved] of Object.entries(dimensions)) {
      if (saved.present) globalThis[key] = saved.value;
      else delete globalThis[key];
    }
  });
};

export { Lemmings, setTestAppContext, getAppContext, ActionBashSystem, ActionBlockerSystem, ActionBuildSystem, ActionClimbSystem, ActionCountdownSystem, ActionDiggSystem, ActionDrowningSystem, ActionExitingSystem, ActionExplodingSystem, ActionFallSystem, ActionFloatingSystem, ActionFryingSystem, ActionHoistSystem, ActionJumpSystem, ActionMineSystem, ActionOhNoSystem, ActionShrugSystem, ActionSplatterSystem, ActionWalkSystem, SoundEventTypes, SoundEffectIds, makeMiniMap, makeLemmings, stubSprites, StubLemming, StubLevel, StubTriggerManager, StubGVC, DummyMask, stubMasks, useSoundBus, withoutSoundBus, withoutLemmingManager, makeRuntime, attachRuntime, TestBashSystem, TestMineSystem, useActionFixtures };
