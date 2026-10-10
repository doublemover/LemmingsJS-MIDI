import { expect } from 'chai';
import { Lemmings, ActionDrowningSystem, ActionFallSystem, ActionFloatingSystem, ActionFryingSystem, ActionHoistSystem, ActionMineSystem, ActionOhNoSystem, ActionSplatterSystem, ActionWalkSystem, SoundEventTypes, SoundEffectIds, stubSprites, StubLemming, StubLevel, stubMasks, useSoundBus, attachRuntime, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action systems events and draws', function() {
  useActionFixtures();

  it('ActionFallSystem and FloatingSystem draw frames', function() {
    const display = { frames: [], drawFrame(frame, x, y) { this.frames.push({ frame, x, y }); } };

    const fall = new ActionFallSystem(stubSprites);
    const fallLem = new StubLemming();
    fall.draw(display, fallLem);

    const floatSys = new ActionFloatingSystem(stubSprites);
    const floatLem = new StubLemming();
    floatSys.draw(display, floatLem);

    expect(display.frames.length).to.equal(2);
  });

  it('ActionFryingSystem reports deaths to minimap', function() {
    const miniMap = { deaths: [], addDeath(x, y) { this.deaths.push({ x, y }); } };
    const sys = attachRuntime(new ActionFryingSystem(stubSprites), [], miniMap);
    const level = new StubLevel();
    const lem = new StubLemming();
    lem.frameIndex = 12;

    sys.process(level, lem);

    expect(miniMap.deaths[0]).to.eql({ x: 0, y: 0 });
  });

  it('ActionFryingSystem moves when no ground is ahead', function() {
    const sys = new ActionFryingSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionHoistSystem handles invalid frameIndex values', function() {
    const sys = new ActionHoistSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = NaN;
    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
  });

  it('ActionMineSystem emits steel hit sound', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const level = new StubLevel();
    level.steelUnder = true;
    const sys = attachRuntime(new ActionMineSystem(stubSprites, stubMasks()), calls);
    const lem = new StubLemming();
    lem.id = 8;
    sys.process(level, lem);
    restore();

    expect(calls[0].type).to.equal(SoundEventTypes.STEEL_HIT);
    expect(calls[0].sfxId).to.equal(SoundEffectIds.STEEL_HIT);
  });

  it('ActionMineSystem keeps mining when ground remains', function() {
    const level = new StubLevel();
    const sys = new ActionMineSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 14; // -> 15
    level.ground.add(level.key(1, 0));
    const res = sys.process(level, lem);
    expect(res).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.x).to.equal(1);
  });

  it('ActionOhNoSystem and SplatterSystem trigger handlers', function() {
    const calls = [];
    const restore = useSoundBus(calls);

    const miniMap = { deaths: [], addDeath(x, y) { this.deaths.push({ x, y }); } };
    const ohNo = attachRuntime(new ActionOhNoSystem(stubSprites), calls, miniMap);
    const ohNoLem = new StubLemming();
    ohNoLem.frameIndex = 15;
    expect(ohNo.triggerLemAction(ohNoLem)).to.equal(false);

    ohNo.draw({ drawFrame() {} }, ohNoLem);

    const splatter = attachRuntime(new ActionSplatterSystem(stubSprites), calls, miniMap);
    const splatLem = new StubLemming();
    splatLem.id = 9;
    splatLem.frameIndex = 15;
    splatLem.lastTriggerType = null;
    expect(splatter.triggerLemAction(splatLem)).to.equal(false);
    splatter.draw({ drawFrame() {} }, splatLem);
    splatLem.frameIndex = 0;
    splatter.process(new StubLevel(), splatLem);

    restore();

    expect(miniMap.deaths.length).to.equal(2);
    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_SPLAT);
  });

  it('ActionWalkSystem triggerLemAction returns false', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(false);
  });

  it('ActionWalkSystem advances when the path is clear', function() {
    const sys = new ActionWalkSystem(stubSprites);
    const level = new StubLevel();
    level.stepHeight = 0;
    level.gapDepth = 1;
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionDrowningSystem triggerLemAction returns false', function() {
    const sys = new ActionDrowningSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(false);
  });
});
