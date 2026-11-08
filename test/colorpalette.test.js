import { expect } from 'chai';
import { ColorPalette } from '../js/render/ColorPalette.js';



describe('ColorPalette', function() {

  it('shares lookups outside frozen palettes and invalidates them after color edits', function() {
    const palette = new ColorPalette();
    palette.setColorRGB(0, 12, 34, 56);
    Object.freeze(palette);
    const first = ColorPalette.getRgbaLookup(palette);
    expect(first[0]).to.equal(palette.getColor(0));
    expect(ColorPalette.getRgbaLookup(palette)).to.equal(first);
    expect(Object.hasOwn(palette, '_rgbaCache')).to.equal(false);
    palette.setColorRGB(0, 65, 43, 21);
    const changed = ColorPalette.getRgbaLookup(palette);
    expect(changed).not.to.equal(first);
    expect(changed[0]).to.equal(palette.getColor(0));
  });

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

  it('defines black and debugColor constants', function() {
    expect(ColorPalette.black).to.equal(0xFF000000);
    expect(ColorPalette.debugColor).to.equal(0xFFFF00FF);
  });
});
