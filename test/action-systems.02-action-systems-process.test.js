import { expect } from 'chai';
import { Lemmings, ActionBashSystem, ActionBuildSystem, ActionFallSystem, ActionFloatingSystem, ActionFryingSystem, ActionHoistSystem, ActionJumpSystem, ActionMineSystem, ActionOhNoSystem, ActionShrugSystem, ActionSplatterSystem, ActionWalkSystem, stubSprites, StubLemming, StubLevel, stubMasks, TestBashSystem, useActionFixtures } from './helpers/action-fixtures.js';
import { runScenarioTable } from './support/scenario-table.js';

describe('Action Systems process()', function() {
  useActionFixtures();

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

  it('ActionShrugSystem waits through eight frames then returns to walking', function() {
    const sys = new ActionShrugSystem(stubSprites), lem = new StubLemming(), level = new StubLevel();
    for (let tick = 0; tick < 7; tick++) {
      expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
      expect(lem.frameIndex).to.equal(tick + 1);
    }
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
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
