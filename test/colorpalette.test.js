import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ColorPalette } from '../js/ColorPalette.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('ColorPalette', function() {
  it('maintains consistent RGB values', function() {
    const pal = new ColorPalette();
    pal.setColorRGB(0, 12, 34, 56);

    const stored = pal.getColor(0);
    const expected = ColorPalette.colorFromRGB(12, 34, 56) >>> 0;
    expect(stored).to.equal(expected);
    expect(pal.getR(0)).to.equal(12);
    expect(pal.getG(0)).to.equal(34);
    expect(pal.getB(0)).to.equal(56);
  });

  it('defines black and debugColor constants', function() {
    expect(ColorPalette.black).to.equal(0xFF000000);
    expect(ColorPalette.debugColor).to.equal(0xFFFF00FF);
  });
});
