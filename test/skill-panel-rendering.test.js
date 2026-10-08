import { expect } from 'chai';
import { PaletteImage } from '../js/render/PaletteImage.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { createNeonCabaretGroundSet } from '../js/decorations/NeonCabaretGroundSet.js';
import { NEON_CABARET_PALETTE } from '../js/decorations/NeonCabaretPack.js';
import { loadPanelFixture, renderPanelFixture } from './support/skill-panel-fixture.js';

const pixel = (display, x, y) => display.buffer32[y * 320 + x];
const half = color => ColorPalette.colorFromRGB(Math.round((color & 255) * 0.5), Math.round(((color >>> 8) & 255) * 0.5), Math.round(((color >>> 16) & 255) * 0.5));

describe('native skill panel rendering', function() {
  this.timeout(10000);
  for (const [pack, ground] of [['lemmings', 0], ['lemmings_ohNo', 0], ['xmas91', 2], ['xmas92', 2], ['holiday93', 2], ['holiday94', 2]]) {
    it(`retains the decoded ${pack} panel and source colors byte-for-byte`, async () => {
      const { sprites, source, main } = await loadPanelFixture(pack, ground);
      const indexed = new PaletteImage(320, 40); indexed.processImage(main.getPart(6), 4);
      expect(sprites.getPanelSprite().getData()).to.deep.equal(indexed.createFrame(source.colorPalette).getData());
      const original = sprites.getPanelSprite().data.slice();
      const dimmed = sprites.getDisabledButton(2);
      expect(sprites.getDisabledButton(2)).to.equal(dimmed);
      expect(dimmed.width).to.equal(16); expect(dimmed.height).to.equal(24);
      expect(sprites.getPanelSprite().data).to.deep.equal(original);
      expect(sprites.getDisabledButton(-1)).to.equal(null); expect(sprites.getDisabledButton(12)).to.equal(null);
    });
  }

  it('keeps unavailable icons recognizable and the number well black without adjacent-tile bleed', async () => {
    const { sprites } = await loadPanelFixture(), { display } = renderPanelFixture(sprites);
    const original = sprites.getPanelSprite().data;
    for (let panel = 2; panel < 9; panel++) {
      for (let y = 25; y < 40; y++) for (let x = panel * 16; x < (panel + 1) * 16; x++) {
        expect(pixel(display, x, y), `${x},${y}`).to.equal(half(original[y * 320 + x]));
      }
      for (let y = 17; y < 25; y++) for (let x = panel * 16 + 4; x < panel * 16 + 12; x++) expect(pixel(display, x, y)).to.equal(0xff000000);
    }
    for (let y = 25; y < 40; y++) for (let x = 9 * 16; x < 10 * 16; x++) expect(pixel(display, x, y)).to.equal(original[y * 320 + x]);
    expect(sprites.getNumberSpriteEmpty().width).to.equal(8);
  });

  it('restores source art on restocking and clears previous digits when the skill reaches zero again', async () => {
    const { sprites } = await loadPanelFixture(), state = renderPanelFixture(sprites);
    state.counts[SkillTypes.CLIMBER] = 12; state.skills.onCountChanged.trigger(); state.gui.render();
    for (let y = 25; y < 40; y++) for (let x = 32; x < 48; x++) expect(pixel(state.display, x, y)).to.equal(sprites.getPanelSprite().data[y * 320 + x]);
    state.counts[SkillTypes.CLIMBER] = 0; state.skills.onCountChanged.trigger(); state.gui.render();
    for (let y = 17; y < 25; y++) for (let x = 36; x < 44; x++) expect(pixel(state.display, x, y)).to.equal(0xff000000);
    const before = state.display.buffer32.slice(); state.gui.render(); expect(state.display.buffer32).to.deep.equal(before);
  });

  it('uses a readable classic HUD palette for the custom theme without recoloring its scene palette', async () => {
    const palette = createNeonCabaretGroundSet().colorPalette;
    const classic = await loadPanelFixture(), themed = await loadPanelFixture('lemmings', 0, palette);
    expect(themed.sprites.getPanelSprite().data).to.deep.equal(classic.sprites.getPanelSprite().data);
    expect(themed.sprites.getLetterSprite('A').data).to.deep.equal(classic.sprites.getLetterSprite('A').data);
    const a = renderPanelFixture(classic.sprites), b = renderPanelFixture(themed.sprites);
    expect(b.display.buffer32).to.deep.equal(a.display.buffer32);
    for (let i = 0; i < 20; i++) expect(palette.getColor(i)).to.equal(NEON_CABARET_PALETTE.getColor(i));
  });
});
