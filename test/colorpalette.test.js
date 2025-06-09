import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ColorPalette } from '../js/ColorPalette.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('ColorPalette', function() {
  it('maintains consistent RGB values', function() {
    const pal = new ColorPalette();
    pal.setColorRGB(0, 12, 34, 56);

    const stored = pal.getColor(0);
    const expected = ColorPalette.colorFromRGB(12, 34, 56)  >>> 0;
    expect(stored).to.equal(expected);
    expect(pal.getR(0)).to.equal(12);
    expect(pal.getG(0)).to.equal(34);
    expect(pal.getB(0)).to.equal(56);
  });

  it('can allocate a larger palette', function() {
    const pal = new ColorPalette(32);
    expect(pal.length).to.equal(32);
    pal.setColorRGB(31, 1, 2, 3);
    expect(pal.getR(31)).to.equal(1);
    expect(pal.getG(31)).to.equal(2);
    expect(pal.getB(31)).to.equal(3);
  });

  it('defines black and debugColor constants', function() {
    expect(ColorPalette.black).to.equal(0xFF000000);
    expect(ColorPalette.debugColor).to.equal(0xFFFF00FF);
  });
});
