import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { Animation } from '../js/Animation.js';
import '../js/ColorPalette.js';
import '../js/PaletteImage.js';
import '../js/Frame.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('Animation.loadFromFileWithPaletteSwap', function () {
  it('replaces FIRE_INDICES colors with ICE_COLORS', function () {
    const palette = new Lemmings.ColorPalette();
    for (let i = 0; i < 16; i++) palette.setColorRGB(i, i, i, i);

    const data = new Uint8Array([0x40]);
    const reader = new BinaryReader(data);

    const anim = new Animation();
    anim.loadFromFileWithPaletteSwap(reader, 4, 1, 1, 1, palette);

    const color = anim.frames[0].getBuffer()[0] >>> 0;
    const expected = Lemmings.ColorPalette.colorFromRGB(64, 160, 255) >>> 0;
    expect(color).to.equal(expected);
  });
});
