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
});
