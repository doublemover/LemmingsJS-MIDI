import { expect } from 'chai';
import { Lemmings, ActionBashSystem, ActionBuildSystem, ActionClimbSystem, ActionCountdownSystem, ActionDiggSystem, ActionDrowningSystem, ActionExitingSystem, ActionExplodingSystem, ActionFryingSystem, ActionJumpSystem, ActionMineSystem, ActionSplatterSystem, ActionWalkSystem, stubSprites, StubLemming, StubLevel, StubGVC, stubMasks, withoutSoundBus, withoutLemmingManager, TestBashSystem, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action systems branch coverage', function() {
  useActionFixtures();

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
