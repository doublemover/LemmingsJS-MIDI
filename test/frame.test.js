import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Frame } from '../js/Frame.js';
import { ColorPalette } from '../js/ColorPalette.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('Frame', function () {
  it('fills entire frame with a color', function () {
    const frame = new Frame(2, 2);
    frame.fill(1, 2, 3);
    const color = ColorPalette.colorFromRGB(1, 2, 3) >>> 0;
    expect(Array.from(frame.data)).to.eql([color, color, color, color]);
    expect(Array.from(frame.mask)).to.eql([1, 1, 1, 1]);
  });

  it('setPixel and clearPixel update data with bounds checks', function () {
    const frame = new Frame(2, 2);
    frame.fill(10, 20, 30);
    const color1 = ColorPalette.colorFromRGB(10, 20, 30) >>> 0;
    const color2 = ColorPalette.colorFromRGB(4, 5, 6) >>> 0;

    frame.setPixel(1, 0, color2);
    expect(frame.data[1]).to.equal(color2 >>> 0);
    expect(frame.mask[1]).to.equal(1);

    frame.setPixel(2, 2, color2);
    frame.setPixel(-1, 0, color2);
    expect(Array.from(frame.data)).to.eql([
      color1 >>> 0,
      color2 >>> 0,
      color1 >>> 0,
      color1 >>> 0
    ]);
    expect(Array.from(frame.mask)).to.eql([1, 1, 1, 1]);

    frame.clearPixel(1, 0);
    expect(frame.data[1]).to.equal(ColorPalette.black >>> 0);
    expect(frame.mask[1]).to.equal(0);

    frame.clearPixel(10, 0);
    frame.clearPixel(0, -1);
    expect(Array.from(frame.data)).to.eql([
      color1 >>> 0,
      ColorPalette.black >>> 0,
      color1 >>> 0,
      color1 >>> 0
    ]);
    expect(Array.from(frame.mask)).to.eql([1, 0, 1, 1]);
  });

  it('drawPaletteImage blits indexed images respecting transparency', function () {
    const frame = new Frame(2, 2);
    const palette = new ColorPalette();
    palette.setColorRGB(0, 1, 2, 3);
    palette.setColorRGB(1, 4, 5, 6);
    const img = new Uint8Array([0, 1, 0x81, 0]);

    frame.clear();
    frame.drawPaletteImage(img, 2, 2, palette, 0, 0);

    const c0 = ColorPalette.colorFromRGB(1, 2, 3) >>> 0;
    const c1 = ColorPalette.colorFromRGB(4, 5, 6) >>> 0;

    expect(Array.from(frame.data)).to.eql([
      c0 >>> 0, c1 >>> 0,
      ColorPalette.black >>> 0, c0 >>> 0
    ]);
    expect(Array.from(frame.mask)).to.eql([
      1, 1,
      0, 1
    ]);
  });
});
