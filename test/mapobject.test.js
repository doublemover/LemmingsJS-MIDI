import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { MapObject } from '../js/MapObject.js';
import { Animation } from '../js/Animation.js';
import { ColorPalette } from '../js/ColorPalette.js';
import '../js/Frame.js';

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

globalThis.lemmings = { game: { showDebug: false } };

describe('MapObject', function () {
  afterEach(function () { delete globalThis.lemmings; });

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
});
