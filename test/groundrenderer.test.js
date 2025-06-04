import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ColorPalette.js';
import { DrawProperties } from '../js/DrawProperties.js';
import { GroundRenderer } from '../js/GroundRenderer.js';
import { DisplayImage } from '../js/DisplayImage.js';

class SimpleImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class MockStage {
  constructor() { this.display = null; }
  createImage(display, w, h) { return new SimpleImageData(w, h); }
  getGameDisplay() {
    if (!this.display) this.display = new DisplayImage(this);
    return this.display;
  }
}

function makePalette(color) {
  const pal = new Lemmings.ColorPalette();
  pal.setColorInt(1, color);
  return pal;
}

function makeTerrain(arr, width, height, palette) {
  return { width, height, frames: [Uint8Array.from(arr)], palette };
}

function color32(r, g, b) {
  return (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0;
}

describe('GroundRenderer small maps', function() {
  afterEach(function() { delete globalThis.lemmings; });

  it('renders a simple 2x2 block', function() {
    globalThis.lemmings = { game: { showDebug: false } };

    const pal = makePalette(color32(10, 20, 30));
    const terrainImages = [makeTerrain([1,1,1,1], 2, 2, pal)];

    const levelReader = {
      levelWidth: 4,
      levelHeight: 4,
      terrains: [{ id: 0, x: 1, y: 1, drawProperties: new DrawProperties(false, false, false, false) }]
    };

    const gr = new GroundRenderer();
    gr.createGroundMap(levelReader, terrainImages);

    const stage = new MockStage();
    const display = stage.getGameDisplay();
    display.initSize(4, 4);
    display.setBackground(gr.img.getData());

    const c = color32(10,20,30);
    const buf = Array.from(display.buffer32);
    const BLACK = color32(0,0,0);
    expect(buf).to.eql([
      BLACK, BLACK, BLACK, BLACK,
      BLACK, c,     c,     BLACK,
      BLACK, c,     c,     BLACK,
      BLACK, BLACK, BLACK, BLACK
    ]);
  });

  it('applies vertical flip', function() {
    globalThis.lemmings = { game: { showDebug: false } };

    const pal = makePalette(color32(1,2,3));
    const arr = [1,0x81,0x81,1]; // bottom row transparent
    const terrainImages = [makeTerrain(arr, 2, 2, pal)];
    const levelReader = {
      levelWidth: 2,
      levelHeight: 3,
      terrains: [{ id: 0, x: 0, y: 1, drawProperties: new DrawProperties(true, false, false, false) }]
    };

    const gr = new GroundRenderer();
    gr.createGroundMap(levelReader, terrainImages);

    const stage = new MockStage();
    const display = stage.getGameDisplay();
    display.initSize(2,3);
    display.setBackground(gr.img.getData());

    const col = color32(1,2,3);
    const BLACK = color32(0,0,0);
    expect(Array.from(display.buffer32)).to.eql([
      BLACK, BLACK,
      BLACK, col,
      col,   BLACK
    ]);
  });
});
