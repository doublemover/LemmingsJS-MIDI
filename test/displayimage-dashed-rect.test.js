import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { DisplayImage, __test__ } from '../js/render/DisplayImage.js';

class SimpleImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class MockStage {
  constructor() { this.display = null; }
  createImage(display, w, h) { return new SimpleImageData(w, h); }
  getGameDisplay() {
    if (!this.display) this.display = new DisplayImage(this);
    return this.display;
  }
}

const color32 = (r, g, b) => (
  (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0
);

describe('DisplayImage dashed/marching rectangles', function () {
  useGlobalLemmings({ game: { showDebug: false } });

  it('drawDashedRect uses RGB signature to draw expected pixels', function () {
    const stage = new MockStage();
    const display = stage.getGameDisplay();
    display.initSize(6, 5);
    display.clear(0);

    display.drawDashedRect(1, 1, 3, 2, 10, 20, 30, 2);
    const color = color32(10, 20, 30);
    const expected = new Array(6 * 5).fill(0);
    const set = (x, y) => { expected[y * 6 + x] = color; };

    set(1, 1);
    set(2, 1);
    set(4, 2);
    set(4, 3);
    set(1, 3);
    set(1, 2);

    expect(Array.from(display.buffer32)).to.eql(expected);
  });

  it('drawMarchingAntRect honors the offset pattern', function () {
    const stage = new MockStage();
    const display = stage.getGameDisplay();
    display.initSize(5, 4);
    display.clear(0);

    const color1 = 0xFFFFFFFF >>> 0;
    const color2 = 0xFF000000 >>> 0;
    display.drawMarchingAntRect(1, 1, 2, 1, 2, 1, color1, color2);

    const expected = new Array(5 * 4).fill(0);
    const set = (x, y, color) => { expected[y * 5 + x] = color; };

    set(1, 1, color1);
    set(2, 1, color2);
    set(3, 1, color2);
    set(3, 2, color1);
    set(2, 2, color1);
    set(1, 2, color2);

    expect(Array.from(display.buffer32)).to.eql(expected);
  });

  it('clips marching ant rectangles that extend outside the display bounds', function () {
    const stage = new MockStage();
    const display = stage.getGameDisplay();
    display.initSize(4, 3);
    display.clear(0);

    display.drawMarchingAntRect(-1, -1, 3, 2, 2, 0, 0xFFFFFFFF, 0xFF000000);

    expect(Object.prototype.hasOwnProperty.call(display.buffer32, '-1')).to.equal(false);
    const changed = Array.from(display.buffer32).some(value => value !== 0);
    expect(changed).to.equal(true);
  });

  it('keeps marching-ant caches collision-proof for large dimensions', function () {
    __test__._marchingAntPerimeterCache.clear();
    __test__._marchingAntPatternCache.clear();

    const perimeterA = __test__.getMarchingAntPerimeterOffsets(2, 0, 1);
    const perimeterB = __test__.getMarchingAntPerimeterOffsets(1, 256, 1);
    expect(perimeterA).to.not.equal(perimeterB);
    expect(perimeterA.length).to.equal(2);
    expect(perimeterB.length).to.equal(514);
    expect(__test__._marchingAntPerimeterCache.size).to.equal(2);

    const patternA = __test__.getMarchingAntPaintPattern(2, 1, 0);
    const patternB = __test__.getMarchingAntPaintPattern(1, 257, 0);
    expect(patternA).to.not.equal(patternB);
    expect(patternA.first.length + patternA.second.length).to.equal(2);
    expect(patternB.first.length + patternB.second.length).to.equal(1);
    expect(__test__._marchingAntPatternCache.size).to.equal(2);
  });
});
