import { expect } from 'chai';
import { Lemmings, ActionBashSystem, ActionBuildSystem, ActionCountdownSystem, ActionDiggSystem, ActionDrowningSystem, ActionExitingSystem, ActionExplodingSystem, ActionMineSystem, SoundEventTypes, SoundEffectIds, stubSprites, StubLemming, StubLevel, StubGVC, stubMasks, useSoundBus, attachRuntime, useActionFixtures } from './helpers/action-fixtures.js';

describe('Action systems events and draws', function() {
  useActionFixtures();

  it('ActionBaseSystem emitters fire for bashing and digging steel', function() {
    const calls = [];
    const restore = useSoundBus(calls);

    const bashLevel = new StubLevel();
    bashLevel.steelUnder = true;
    const bash = attachRuntime(new ActionBashSystem(stubSprites, stubMasks()), calls);
    const bashLem = new StubLemming();
    bashLem.id = 1;
    bashLem.frameIndex = 2; // -> state 3
    expect(bash.process(bashLevel, bashLem)).to.equal(Lemmings.LemmingStateType.SHRUG);

    const digLevel = new StubLevel();
    digLevel.steelGround = () => true;
    const dig = attachRuntime(new ActionDiggSystem(stubSprites), calls);
    const digLem = new StubLemming();
    digLem.id = 2;
    expect(dig.process(digLevel, digLem)).to.equal(Lemmings.LemmingStateType.SHRUG);

    restore();
    expect(calls[0].type).to.equal(SoundEventTypes.STEEL_HIT);
    expect(calls[1].type).to.equal(SoundEventTypes.STEEL_HIT);
  });

  it('emits terrain events with intensity for dig, bash, and mine', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const digLevel = new StubLevel();
    const dig = attachRuntime(new ActionDiggSystem(stubSprites), calls);
    const digLem = new StubLemming(10, 5);
    digLem.id = 9;
    for (let x = digLem.x - 4; x <= digLem.x; x++) {
      digLevel.ground.add(digLevel.key(x, 3));
    }
    dig.digRow(digLevel, digLem, 3);

    const mask = { offsetX: 0, offsetY: 0, width: 3, height: 1, at() { return false; } };
    const masks = { GetMask() { return { GetMask() { return mask; } }; } };

    const bashLevel = new StubLevel();
    bashLevel.clearCount = 3;
    const bash = attachRuntime(new ActionBashSystem(stubSprites, masks), calls);
    const bashLem = new StubLemming();
    bashLem.id = 10;
    bashLem.frameIndex = 2; // -> state 3
    bash.process(bashLevel, bashLem);

    const mineLevel = new StubLevel();
    mineLevel.clearCount = 2;
    const mine = attachRuntime(new ActionMineSystem(stubSprites, masks), calls);
    const mineLem = new StubLemming();
    mineLem.id = 11;
    mine.process(mineLevel, mineLem);

    restore();
    const digEvent = calls.find(call => call.type === SoundEventTypes.LEMMING_DIG);
    const bashEvent = calls.find(call => call.type === SoundEventTypes.LEMMING_BASH);
    const mineEvent = calls.find(call => call.type === SoundEventTypes.LEMMING_MINE);
    expect(digEvent).to.be.ok;
    expect(bashEvent).to.be.ok;
    expect(mineEvent).to.be.ok;
    expect(digEvent.data.intensity).to.be.greaterThan(1);
    expect(bashEvent.data.intensity).to.be.greaterThan(1);
    expect(mineEvent.data.intensity).to.be.greaterThan(1);
  });

  it('handles missing clear count with null bash masks', function() {
    const restore = useSoundBus([]);
    const level = {
      getGroundMaskLayer() { return { hasGroundAt() { return false; } }; },
      hasSteelUnderMask() { return false; },
      hasArrowUnderMask() { return false; },
      clearGroundWithMask(mask) { this.cleared = mask; }
    };
    const nullMasks = {
      GetMask() { return { GetMask() { return null; } }; }
    };
    const sys = new ActionBashSystem(stubSprites, nullMasks);
    const lem = new StubLemming();
    lem.frameIndex = 1; // -> state 2
    sys.process(level, lem);
    restore();
    expect(level.cleared).to.equal(null);
  });

  it('handles missing clear count with null mine masks', function() {
    const restore = useSoundBus([]);
    const level = {
      hasSteelUnderMask() { return false; },
      hasArrowUnderMask() { return false; },
      clearGroundWithMask(mask) { this.cleared = mask; }
    };
    const nullMasks = {
      GetMask() { return { GetMask() { return null; } }; }
    };
    const sys = new ActionMineSystem(stubSprites, nullMasks);
    const lem = new StubLemming();
    lem.frameIndex = 0; // -> state 1
    sys.process(level, lem);
    restore();
    expect(level.cleared).to.equal(null);
  });

  it('ActionBashSystem exits to walking when solid ends', function() {
    const level = new StubLevel();
    const sys = new ActionBashSystem(stubSprites, stubMasks());
    const lem = new StubLemming();
    lem.frameIndex = 4; // -> state 5
    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
  });

  it('ActionBuildSystem emits step and warning sounds', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const level = new StubLevel();
    const sys = attachRuntime(new ActionBuildSystem(stubSprites), calls);
    const lem = new StubLemming();
    lem.id = 3;
    lem.frameIndex = 8;
    lem.state = 9;

    sys.process(level, lem);
    restore();

    expect(calls.map(c => c.type)).to.eql([
      SoundEventTypes.BUILDER_STEP,
      SoundEventTypes.BUILDER_WARNING
    ]);
    expect(calls.map(c => c.sfxId)).to.eql([
      SoundEffectIds.BUILDER_STEP,
      SoundEffectIds.BUILDER_WARNING
    ]);
  });

  it('ActionBuildSystem handles frame-zero movement checks', function() {
    const level = new StubLevel();
    const sys = new ActionBuildSystem(stubSprites);
    const lem = new StubLemming();
    lem.frameIndex = 15; // -> 0
    level.ground.add(level.key(1, -2));

    expect(sys.process(level, lem)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem.lookRight).to.equal(false);

    const lem2 = new StubLemming();
    lem2.frameIndex = 15;
    level.ground.clear();
    level.ground.add(level.key(4, -10));
    expect(sys.process(level, lem2)).to.equal(Lemmings.LemmingStateType.WALKING);
    expect(lem2.lookRight).to.equal(false);
  });

  it('ActionCountdownSystem emits ohno when the timer hits zero', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const sys = attachRuntime(new ActionCountdownSystem(stubMasks()), calls);
    const lem = new StubLemming();
    lem.id = 4;
    lem.countdown = 1;
    lem.setCountDown = act => { lem.countdownAction = act; return true; };

    expect(sys.process(new StubLevel(), lem)).to.equal(Lemmings.LemmingStateType.OHNO);
    restore();

    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_OHNO);
    expect(calls[0].sfxId).to.equal(SoundEffectIds.OHNO);
  });

  it('ActionDrowningSystem and ExitingSystem emit sfx on entry', function() {
    const calls = [];
    const restore = useSoundBus(calls);

    const drowning = attachRuntime(new ActionDrowningSystem(stubSprites), calls);
    const drownLem = new StubLemming();
    drownLem.id = 5;
    drownLem.lastTriggerType = 'water';
    drowning.process(new StubLevel(), drownLem);

    const gvc = new StubGVC();
    const exit = attachRuntime(new ActionExitingSystem(stubSprites, gvc), calls);
    const exitLem = new StubLemming();
    exitLem.id = 6;
    exitLem.lastTriggerType = 'exit';
    exit.process(new StubLevel(), exitLem);

    restore();
    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_DROWN);
    expect(calls[1].type).to.equal(SoundEventTypes.LEMMING_EXIT);
  });

  it('ActionDrowningSystem moves when no ground is ahead', function() {
    const sys = new ActionDrowningSystem(stubSprites);
    const level = new StubLevel();
    const lem = new StubLemming();
    const x0 = lem.x;
    sys.process(level, lem);
    expect(lem.x).to.equal(x0 + 1);
  });

  it('ActionExplodingSystem emits and invalidates minimap', function() {
    const calls = [];
    const restore = useSoundBus(calls);
    const mask = { offsetX: -2, offsetY: -3, width: 4, height: 5 };
    const masks = { GetMask() { return { GetMask() { return mask; } }; } };
    const triggerManager = { removed: [], removeByOwner(lem) { this.removed.push(lem); } };
    const particleTable = { draw() {} };
    const miniMap = {
      invalidations: [],
      deaths: [],
      invalidateRegion(x, y, w, h) { this.invalidations.push({ x, y, w, h }); },
      addDeath(x, y) { this.deaths.push({ x, y }); }
    };
    const sys = attachRuntime(new ActionExplodingSystem(stubSprites, masks, triggerManager, particleTable), calls, miniMap);
    const level = { clearGroundWithMask() { return true; } };

    const lem = new StubLemming();
    lem.id = 7;
    sys.process(level, lem);

    restore();

    expect(calls[0].type).to.equal(SoundEventTypes.LEMMING_EXPLODE);
    expect(triggerManager.removed[0]).to.equal(lem);
    expect(miniMap.invalidations[0]).to.eql({ x: -2, y: -3, w: 4, h: 5 });
    expect(miniMap.deaths[0]).to.eql({ x: 0, y: 0 });
  });
});
