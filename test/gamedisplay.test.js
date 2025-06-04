import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ColorPalette.js';
import { Frame } from '../js/Frame.js';
import { DisplayImage } from '../js/DisplayImage.js';

// minimal global env for logging
globalThis.lemmings = { game: { showDebug: false } };

class MockStage {
  constructor() {
    this.display = null;
  }
  createImage(display, w, h) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  getGameDisplay() {
    if (!this.display) this.display = new DisplayImage(this);
    return this.display;
  }
}

describe('GameDisplay drawFrame', function() {
  it('draws frames into the buffer', function() {
    const stage = new MockStage();
    const gd = stage.getGameDisplay();
    gd.initSize(5, 5);

    const redFrame = new Frame(2, 2);
    redFrame.fill(255, 0, 0); // red
    gd.drawFrame(redFrame, 1, 1);

    const buf = gd.buffer32;
    const w = gd.getWidth();
    const red = Lemmings.ColorPalette.colorFromRGB(255, 0, 0) >>> 0;
    expect(buf[1 + 1 * w]).to.equal(red);
    expect(buf[2 + 1 * w]).to.equal(red);
    expect(buf[1 + 2 * w]).to.equal(red);
    expect(buf[2 + 2 * w]).to.equal(red);
  });

  it('applies frame offsets', function() {
    const stage = new MockStage();
    const gd = stage.getGameDisplay();
    gd.initSize(4, 4);

    const blueFrame = new Frame(1, 1, 1, 1);
    blueFrame.fill(0, 0, 255); // blue
    gd.drawFrame(blueFrame, 0, 0); // should draw at (1,1)

    const buf = gd.buffer32;
    const w = gd.getWidth();
    const blue = Lemmings.ColorPalette.colorFromRGB(0, 0, 255) >>> 0;
    expect(buf[1 + 1 * w]).to.equal(blue);
  });

  it('overwrites previous pixels on overlap', function() {
    const stage = new MockStage();
    const gd = stage.getGameDisplay();
    gd.initSize(3, 3);

    const greenFrame = new Frame(1, 1);
    greenFrame.fill(0, 255, 0);
    gd.drawFrame(greenFrame, 1, 1);

    const yellowFrame = new Frame(1, 1);
    yellowFrame.fill(255, 255, 0);
    gd.drawFrame(yellowFrame, 1, 1);

    const buf = gd.buffer32;
    const w = gd.getWidth();
    const yellow = Lemmings.ColorPalette.colorFromRGB(255, 255, 0) >>> 0;
    expect(buf[1 + 1 * w]).to.equal(yellow);
  });
});
