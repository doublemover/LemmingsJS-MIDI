import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { TerrainImageInfo } from '../js/TerrainImageInfo.js';
import { BaseImageInfo } from '../js/BaseImageInfo.js';
import '../js/ColorPalette.js';
import { Frame } from '../js/Frame.js';

// Simple helper replicates GroundReader steel cropping
function computeSteelSize(info) {
  const frame = info.frames[0];
  let widest = 0;
  let tallest = 0;
  for (let y = info.height - 1; y >= 0; --y) {
    const rowBase = y * info.width;
    let rowHasPixel = false;
    for (let x = info.width - 1; x >= 0; --x) {
      if (frame[rowBase + x] !== 128) {
        if (x + 1 > widest) widest = x + 1;
        rowHasPixel = true;
        break;
      }
    }
    if (rowHasPixel && tallest === 0) {
      tallest = y + 1;
      if (widest === info.width) break;
    }
  }
  return { width: widest, height: tallest };
}



globalThis.lemmings = Lemmings;

describe('TerrainImageInfo', function() {
  it('calculates steel cropping dimensions', function() {
    const info = new TerrainImageInfo();
    info.width = 4;
    info.height = 3;
    info.frames = [
      Uint8Array.from([
        128,128,128,128,
        1,  1,  128,128,
        1,  2,  1,  128
      ])
    ];
    info.isSteel = true;

    const { width, height } = computeSteelSize(info);
    expect(width).to.equal(3);
    expect(height).to.equal(3);
  });

  it('uses palette indices and mask bits', function() {
    const pal = new Lemmings.ColorPalette();
    const c1 = Lemmings.ColorPalette.colorFromRGB(10, 20, 30);
    const c2 = Lemmings.ColorPalette.colorFromRGB(40, 50, 60);
    pal.setColorInt(1, c1);
    pal.setColorInt(2, c2);

    const info = new TerrainImageInfo();
    info.width = 2;
    info.height = 2;
    info.palette = pal;
    info.frames = [Uint8Array.from([1, 0x81, 2, 0x80])];

    const frame = new Frame(2, 2);
    frame.drawPaletteImage(info.frames[0], info.width, info.height, pal, 0, 0);

    const buf = frame.getBuffer();
    const mask = frame.getMask();

    expect(buf[0]).to.equal(c1);
    expect(mask[0]).to.equal(1);
    expect(buf[1]).to.equal(Lemmings.ColorPalette.black);
    expect(mask[1]).to.equal(0);

    expect(buf[2]).to.equal(c2);
    expect(mask[2]).to.equal(1);
    expect(buf[3]).to.equal(Lemmings.ColorPalette.black);
    expect(mask[3]).to.equal(0);
  it('extends BaseImageInfo', function() {
    const terrain = new TerrainImageInfo();
    expect(terrain).to.be.instanceOf(BaseImageInfo);
  });

  it('does not override BaseImageInfo defaults', function() {
    const base = new BaseImageInfo();
    const terrain = new TerrainImageInfo();
    for (const prop of [
      'width',
      'height',
      'imageLoc',
      'maskLoc',
      'vgaLoc',
      'frameDataSize',
      'frameCount',
      'palette'
    ]) {
      expect(terrain[prop]).to.equal(base[prop]);
    }
  });
});
