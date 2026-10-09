import { expect } from 'chai';
import { Lemmings, ActionBuildSystem, ActionClimbSystem, ActionDiggSystem, ActionDrowningSystem, ActionExitingSystem, ActionExplodingSystem, stubSprites, StubLemming, StubLevel, StubTriggerManager, StubGVC, stubMasks, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action Systems process()', function() {
  useActionFixtures();

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
