import { expect } from 'chai';
import { Lemmings, ActionFallSystem, ActionFloatingSystem, ActionFryingSystem, ActionHoistSystem, ActionJumpSystem, ActionMineSystem, ActionOhNoSystem, ActionShrugSystem, ActionSplatterSystem, ActionWalkSystem, stubSprites, StubLemming, StubLevel, stubMasks, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action Systems process()', function() {
  useActionFixtures();

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
