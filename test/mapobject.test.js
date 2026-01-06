import { expect } from 'chai';
import { setGlobalLemmings, useGlobalLemmings, withGlobalLemmings } from './helpers/lemmings.js';
import { MapObject } from '../js/level/MapObject.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { Animation } from '../js/render/Animation.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import '../js/render/Frame.js';

/** simple helper to create an object image stub */
function makeObjectImage(loop = true, palette = null) {
  const pal = palette || new ColorPalette();
  if (!palette) {
    pal.setColorRGB(0, 1, 2, 3);
    pal.setColorRGB(1, 4, 5, 6);
  }
  return {
    width: 2,
    height: 1,
    frames: [Uint8Array.from([0, 1])],
    palette: pal,
    animationLoop: loop,
    firstFrameIndex: 0,
  };
}

const withSoundEvents = (events, fn) => {
  const restore = setGlobalLemmings({
    game: {
      soundEvents: {
        emitSfx(type, id, payload) {
          events.push({ type, id, payload });
        }
      }
    }
  });
  try {
    return fn();
  } finally {
    restore();
  }
};

useGlobalLemmings({ game: { showDebug: false } });

describe('MapObject', function () {
  it('caches frames in WeakMap per object image', function () {
    MapObject._frameCache = new WeakMap();
    const img = makeObjectImage();
    const mo1 = new MapObject({ id: 0, x: 0, y: 0, drawProperties: {} }, img, new Animation());
    const cached = MapObject._frameCache.get(img);
    expect(cached).to.be.an('array').with.lengthOf(1);
    expect(mo1.animation.frames).to.equal(cached);

    const mo2 = new MapObject({ id: 0, x: 0, y: 0, drawProperties: {} }, img, new Animation());
    expect(MapObject._frameCache.get(img)).to.equal(cached);
    expect(mo2.animation.frames).to.equal(cached);
  });

  it('restarts animation on trigger when not looping', function () {
    MapObject._frameCache = new WeakMap();
    const img = makeObjectImage(false);
    const anim = new Animation();
    const mo = new MapObject({ id: 0, x: 0, y: 0, drawProperties: {} }, img, anim);
    anim.firstFrameIndex = 42;
    anim.isFinished = true;
    mo.onTrigger(99);
    expect(anim.firstFrameIndex).to.equal(99);
    expect(anim.isFinished).to.equal(false);
  });

  it('records animation changes when history is available', function () {
    const records = [];
    withGlobalLemmings({
      game: {
        history: {
          recordObjectAnimation(obj, prev, next) {
            records.push({ obj, prev, next });
          }
        }
      }
    }, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(false);
      const anim = new Animation();
      const mo = new MapObject({ id: 0, x: 0, y: 0, drawProperties: {} }, img, anim);
      anim.firstFrameIndex = 12;
      anim.isFinished = true;

      mo.onTrigger(20);

      expect(records).to.have.length(1);
      expect(records[0].prev.firstFrameIndex).to.equal(12);
      expect(records[0].next.firstFrameIndex).to.equal(20);
      expect(records[0].next.isFinished).to.equal(false);
    });
  });

  it('draws frames using the provided palette', function () {
    MapObject._frameCache = new WeakMap();
    const palette = new ColorPalette();
    palette.setColorRGB(0, 10, 20, 30);
    palette.setColorRGB(1, 40, 50, 60);
    const img = makeObjectImage(true, palette);
    const mo = new MapObject({ id: 0, x: 0, y: 0, drawProperties: {} }, img, new Animation());
    const frame = mo.animation.frames[0];
    const buf = frame.getBuffer();
    const c0 = ColorPalette.colorFromRGB(10, 20, 30) >>> 0;
    const c1 = ColorPalette.colorFromRGB(40, 50, 60) >>> 0;
    expect(Array.from(buf.slice(0, 2))).to.eql([c0, c1]);
  });

  it('emits trap and fire sounds on trigger', function () {
    const events = [];
    withSoundEvents(events, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(true);
      const mo = new MapObject({ id: 5, x: 1, y: 2, drawProperties: {} }, img, new Animation(), 0);

      const trap = { type: TriggerTypes.TRAP, soundIndex: 2 };
      mo.onTrigger(0, { id: 1, x: 10, y: 11 }, trap, 9, 8);
      expect(events.length).to.equal(1);

      const kill = { type: TriggerTypes.KILL };
      mo.onTrigger(0, { id: 2, x: 0, y: 0 }, kill);
      expect(events.length).to.equal(2);
    });
  });

  it('falls back to lemming position when trigger coordinates are missing', function () {
    const events = [];
    withSoundEvents(events, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(true);
      const mo = new MapObject({ id: 9, x: 1, y: 2, drawProperties: {} }, img, new Animation(), 0);

      const trap = { type: TriggerTypes.TRAP, soundIndex: 2 };
      const lem = { id: 4, x: 7, y: 8 };
      mo.onTrigger(0, lem, trap);

      expect(events.length).to.equal(1);
      expect(events[0].payload.x).to.equal(7);
      expect(events[0].payload.y).to.equal(8);
    });
  });

  it('falls back to object position when no trigger or lemming coordinates are provided', function () {
    const events = [];
    withSoundEvents(events, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(true);
      const mo = new MapObject({ id: 12, x: 3, y: 4, drawProperties: {} }, img, new Animation(), 0);

      const trap = { type: TriggerTypes.TRAP, soundIndex: 3 };
      mo.onTrigger(0, null, trap);

      expect(events.length).to.equal(1);
      expect(events[0].payload.trapSoundId).to.equal(3);
      expect(events[0].payload.x).to.equal(3);
      expect(events[0].payload.y).to.equal(4);
    });
  });

  it('skips sound emission when sfxId is not positive', function () {
    const events = [];
    withSoundEvents(events, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(true);
      const mo = new MapObject({ id: 5, x: 1, y: 2, drawProperties: {} }, img, new Animation(), TriggerTypes.TRAP);
      mo.onTrigger(0, null, { type: TriggerTypes.TRAP, soundIndex: 0 });
      expect(events.length).to.equal(0);
    });
  });

  it('handles trap triggers without explicit trigger data', function () {
    const events = [];
    withSoundEvents(events, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(true);
      const mo = new MapObject({ id: 5, x: 1, y: 2, drawProperties: {} }, img, new Animation(), TriggerTypes.TRAP);
      mo.onTrigger(0);
      expect(events.length).to.equal(0);
    });
  });

  it('emits frying sounds and preserves explicit trigger coordinates', function () {
    const events = [];
    withSoundEvents(events, () => {
      MapObject._frameCache = new WeakMap();
      const img = makeObjectImage(true);
      const mo = new MapObject({ id: 6, x: 3, y: 4, drawProperties: {} }, img, new Animation(), 0);
      const fry = { type: TriggerTypes.FRYING };
      mo.onTrigger(0, { id: 1, x: 9, y: 8 }, fry, 0, 0);
      expect(events.length).to.equal(1);
      expect(events[0].payload.x).to.equal(0);
      expect(events[0].payload.y).to.equal(0);
    });
  });
});
