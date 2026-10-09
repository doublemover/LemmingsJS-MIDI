import { expect } from 'chai';
import { Lemmings, ActionBashSystem, ActionBlockerSystem, ActionBuildSystem, ActionClimbSystem, ActionCountdownSystem, ActionDiggSystem, ActionDrowningSystem, ActionExitingSystem, ActionExplodingSystem, ActionFallSystem, stubSprites, StubLemming, StubLevel, StubTriggerManager, StubGVC, DummyMask, stubMasks, TestBashSystem, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action Systems process()', function() {
  useActionFixtures();

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
});
