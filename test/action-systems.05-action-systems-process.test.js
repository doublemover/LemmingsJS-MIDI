import { expect } from 'chai';
import { Lemmings, ActionWalkSystem, stubSprites, StubLemming, StubLevel, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action Systems process()', function() {
  useActionFixtures();

  it('ActionWalkSystem steps up small ledge', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 2;
    const lem = new StubLemming();
    sys.process(level, lem);
    expect(lem.y).to.equal(-1);
  });





  it('ActionWalkSystem clamps position to LEM_MIN_Y', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 2;
    const lem = new StubLemming();
    lem.y = Lemmings.Lemming.LEM_MIN_Y;
    sys.process(level, lem);
    expect(lem.y).to.equal(Lemmings.Lemming.LEM_MIN_Y);
  });

  it('ActionWalkSystem walks over shallow gaps', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 0;
    level.gapDepth = 1;
    const lem = new StubLemming();
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.y).to.equal(1);
  });
});
