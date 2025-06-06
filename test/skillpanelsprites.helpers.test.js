import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Frame } from '../js/Frame.js';
import { ColorPalette } from '../js/ColorPalette.js';
import { SkillPanelSprites } from '../js/SkillPanelSprites.js';
import '../js/LogHandler.js';
import '../js/PaletteImage.js';

globalThis.lemmings = { game: { showDebug: false } };

class FakeReader {
  setOffset() {}
  readByte() { return 0; }
}

describe('SkillPanelSprites helper methods', function () {
  it('extracts a background patch', function () {
    const pal = new ColorPalette();
    pal.setColorRGB(0, 0, 0, 0);
    const sp = new SkillPanelSprites(new FakeReader(), new FakeReader(), pal);
    const panel = new Frame(4, 4);
    for (let i = 0; i < panel.data.length; i++) {
      const c = ColorPalette.colorFromRGB(i, i, i) >>> 0;
      panel.data[i] = c;
      panel.mask[i] = 1;
    }
    sp.panelSprite = panel;

    const patch = sp.getBackgroundPatch(1, 1, 2, 2);
    expect(patch.width).to.equal(2);
    expect(patch.height).to.equal(2);
    const c5 = ColorPalette.colorFromRGB(5, 5, 5) >>> 0;
    const c6 = ColorPalette.colorFromRGB(6, 6, 6) >>> 0;
    const c9 = ColorPalette.colorFromRGB(9, 9, 9) >>> 0;
    const c10 = ColorPalette.colorFromRGB(10, 10, 10) >>> 0;
    expect(Array.from(patch.data)).to.eql([c5, c6, c9, c10]);
    expect(Array.from(patch.mask)).to.eql([1, 1, 1, 1]);
  });

  it('tiles a patch to fill a background', function () {
    const pal = new ColorPalette();
    const sp = new SkillPanelSprites(new FakeReader(), new FakeReader(), pal);
    const panel = new Frame(4, 4);
    for (let i = 0; i < panel.data.length; i++) {
      panel.data[i] = ColorPalette.colorFromRGB(i, i, i) >>> 0;
      panel.mask[i] = 1;
    }
    sp.panelSprite = panel;

    const tiled = sp.createTiledBackground(0, 0, 2, 2, 3, 3);
    const c0 = ColorPalette.colorFromRGB(0, 0, 0) >>> 0;
    const c1 = ColorPalette.colorFromRGB(1, 1, 1) >>> 0;
    const c4 = ColorPalette.colorFromRGB(4, 4, 4) >>> 0;
    const c5 = ColorPalette.colorFromRGB(5, 5, 5) >>> 0;
    expect(tiled.width).to.equal(3);
    expect(tiled.height).to.equal(3);
    expect(Array.from(tiled.data)).to.eql([
      c0, c1, c0,
      c4, c5, c4,
      c0, c1, c0
    ]);
    expect(Array.from(tiled.mask)).to.eql([
      1, 1, 1,
      1, 1, 1,
      1, 1, 1
    ]);
  });

  it('brightens a button region', function () {
    const pal = new ColorPalette();
    pal.setColorRGB(0, 10, 20, 30);
    const sp = new SkillPanelSprites(new FakeReader(), new FakeReader(), pal);
    const panel = new Frame(16, 40);
    const base = ColorPalette.colorFromRGB(10, 20, 30) >>> 0;
    panel.data.fill(base);
    panel.mask.fill(1);
    sp.panelSprite = panel;

    const highlight = sp.getHighlightedButton(0);
    expect(highlight.width).to.equal(16);
    expect(highlight.height).to.equal(23);
    const bright = ColorPalette.colorFromRGB(50, 60, 70) >>> 0;
    expect(Array.from(new Set(highlight.data))).to.eql([bright]);
    expect(highlight.mask.every(m => m === 1)).to.be.true;
  });
});
