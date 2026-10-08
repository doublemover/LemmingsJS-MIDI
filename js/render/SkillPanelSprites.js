import { ColorPalette } from './ColorPalette.js';
import { Frame } from './Frame.js';
import { PaletteImage } from './PaletteImage.js';

class SkillPanelSprites {
  constructor(fr2, fr6, colorPalette) {
    this.letterSprite = {};
    this.disabledButtonSprites = [];
    const hudPalette = colorPalette?.hudPalette || colorPalette;
    this.numberSpriteLeft = [];
    this.numberSpriteRight = [];
    /// read skill panel
    let paletteImg = new PaletteImage(320, 40);
    paletteImg.processImage(fr6, 4);
    this.panelSprite = paletteImg.createFrame(hudPalette);
    /// read green panel letters
    let letters = ['%', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    for (let l = 0; l < letters.length; l++) {
      let paletteImg = new PaletteImage(8, 16);
      paletteImg.processImage(fr6, 3);
      this.letterSprite[letters[l]] = paletteImg.createFrame(hudPalette);
    }
    /// add space
    let emptyFrame = new Frame(8, 16);
    emptyFrame.fill(0, 0, 0);
    this.letterSprite[' '] = emptyFrame;
    let blackAndWithPalette = new ColorPalette();
    blackAndWithPalette.setColorRGB(1, 255, 255, 255);
    /// read panel skill-count number letters
    fr2.setOffset(0x1900);
    for (let i = 0; i < 10; i++) {
      let paletteImgRight = new PaletteImage(8, 8);
      paletteImgRight.processImage(fr2, 1);
      paletteImgRight.processTransparentByColorIndex(0);
      this.numberSpriteRight.push(paletteImgRight.createFrame(blackAndWithPalette));
      let paletteImgLeft = new PaletteImage(8, 8);
      paletteImgLeft.processImage(fr2, 1);
      paletteImgLeft.processTransparentByColorIndex(0);
      this.numberSpriteLeft.push(paletteImgLeft.createFrame(blackAndWithPalette));
    }
    /// add space
    this.emptyNumberSprite = new Frame(8, 8);
    this.emptyNumberSprite.fill(0, 0, 0);
  }
  /** return the sprite for the skill panel */
  getPanelSprite() {
    return this.panelSprite;
  }
  /** return a green letter */
  getLetterSprite(letter) {
    return this.letterSprite[letter.toUpperCase()];
  }
  /** return a number letter */
  getNumberSpriteLeft(number) {
    return this.numberSpriteLeft[number];
  }
  /** return a number letter */
  getNumberSpriteRight(number) {
    return this.numberSpriteRight[number];
  }
  getNumberSpriteEmpty() {
    return this.emptyNumberSprite;
  }

  /** extract a rectangular patch from the panel background */
  getBackgroundPatch(x, y, w, h) {
    const src = this.panelSprite;
    const out = new Frame(w, h);
    for (let yy = 0; yy < h; yy++) {
      const srcRow = (y + yy) * src.width + x;
      const dstRow = yy * w;
      for (let xx = 0; xx < w; xx++) {
        out.data[dstRow + xx] = src.data[srcRow + xx];
        out.mask[dstRow + xx] = 1;
      }
    }
    return out;
  }

  /** tile a patch across a larger area */
  createTiledBackground(x, y, w, h, outW, outH) {
    const patch = this.getBackgroundPatch(x, y, w, h);
    const out = new Frame(outW, outH);
    for (let yy = 0; yy < outH; yy++) {
      for (let xx = 0; xx < outW; xx++) {
        const px = xx % w;
        const py = yy % h;
        const srcIdx = py * w + px;
        const dstIdx = yy * outW + xx;
        out.data[dstIdx] = patch.data[srcIdx];
        out.mask[dstIdx] = 1;
      }
    }
    return out;
  }

  /** Keep unavailable skills recognizable without painting over their artwork. */
  getDisabledButton(panelIndex) {
    if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= 12) return null;
    if (!this.disabledButtonSprites[panelIndex]) {
      const frame = this.getBackgroundPatch(panelIndex * 16, 16, 16, 24);
      for (let i = 0; i < frame.data.length; i++) {
        const color = frame.data[i];
        frame.data[i] = ColorPalette.colorFromRGB(Math.round((color & 255) * 0.5), Math.round(((color >>> 8) & 255) * 0.5), Math.round(((color >>> 16) & 255) * 0.5));
      }
      this.disabledButtonSprites[panelIndex] = frame;
    }
    return this.disabledButtonSprites[panelIndex];
  }

  /** return a brightened copy of the specified button region */
  getHighlightedButton(panelIndex) {
    const x = panelIndex * 16;
    const y = 16;
    const w = 16;
    const h = 23;
    const patch = this.getBackgroundPatch(x, y, w, h);
    for (let i = 0; i < patch.data.length; i++) {
      let c = patch.data[i];
      let r = Math.min(255, (c       & 0xFF) + 40);
      let g = Math.min(255, ((c>>8)  & 0xFF) + 40);
      let b = Math.min(255, ((c>>16) & 0xFF) + 40);
      patch.data[i] = 0xFF000000 | (b<<16) | (g<<8) | r;
      patch.mask[i] = 1;
    }
    return patch;
  }
}

export { SkillPanelSprites };
