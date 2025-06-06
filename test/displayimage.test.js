import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/ViewPoint.js';
import '../js/StageImageProperties.js';
import { Stage } from '../js/Stage.js';
import { DisplayImage } from '../js/DisplayImage.js';
import { Frame } from '../js/Frame.js';
import '../js/ColorPalette.js';

globalThis.lemmings = { game: { showDebug: false } };

function color32(r, g, b) {
  return (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0;
}

function createCanvasStub(width = 8, height = 8) {
  const ctx = {
    canvas: null,
    fillStyle: null,
    globalAlpha: 1,
    fillRect() {},
    drawImage() {},
    putImageData() {}
  };
  const canvas = {
    width,
    height,
    getContext() { return ctx; },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width, height }; }
  };
  ctx.canvas = canvas;
  return canvas;
}

class SimpleImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

describe('DisplayImage primitives', function() {
  let stage, display;

  beforeEach(function() {
    const canvas = createCanvasStub(8, 8);
    stage = new Stage(canvas);
    stage.createImage = function(d, w, h) {
      return new SimpleImageData(w, h);
    };
    display = stage.getGameDisplay();
    display.initSize(4, 4);
    display.clear(color32(0, 0, 0));
  });

  afterEach(function() {
    stage.dispose();
  });

  it('drawRect outlines correctly', function() {
    display.drawRect(0, 0, 2, 2, 255, 0, 0);
    const RED = color32(255, 0, 0);
    const BLACK = color32(0, 0, 0);
    expect(Array.from(display.buffer32)).to.eql([
      RED, RED, RED, BLACK,
      RED, BLACK, RED, BLACK,
      RED, RED, RED, BLACK,
      BLACK, BLACK, BLACK, BLACK
    ]);
  });

  it('drawHorizontalLine draws across row', function() {
    display.drawHorizontalLine(0, 1, 3, 0, 255, 0);
    const GREEN = color32(0, 255, 0);
    const BLACK = color32(0, 0, 0);
    expect(Array.from(display.buffer32)).to.eql([
      BLACK, BLACK, BLACK, BLACK,
      GREEN, GREEN, GREEN, GREEN,
      BLACK, BLACK, BLACK, BLACK,
      BLACK, BLACK, BLACK, BLACK
    ]);
  });

  it('drawVerticalLine draws column', function() {
    display.drawVerticalLine(2, 0, 3, 0, 0, 255);
    const BLUE = color32(0, 0, 255);
    const BLACK = color32(0, 0, 0);
    expect(Array.from(display.buffer32)).to.eql([
      BLACK, BLACK, BLUE, BLACK,
      BLACK, BLACK, BLUE, BLACK,
      BLACK, BLACK, BLUE, BLACK,
      BLACK, BLACK, BLUE, BLACK
    ]);
  });

  it('drawStippleRect fills pattern', function() {
    display.drawStippleRect(0, 0, 3, 3, 128, 128, 128);
    const GRAY = color32(128, 128, 128);
    const BLACK = color32(0, 0, 0);
    const expected = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expected.push(((x + y) & 1) === 0 ? GRAY : BLACK);
      }
    }
    expect(Array.from(display.buffer32)).to.eql(expected);
  });

  it('_blit scales frame', function() {
    const frame = new Frame(2, 2);
    frame.fill(255, 0, 0);
    display.clear(color32(0, 0, 0));
    display._blit(frame, 0, 0, { size: { width: 4, height: 4 } });
    const RED = color32(255, 0, 0);
    expect(Array.from(display.buffer32)).to.eql(new Array(16).fill(RED));
  });

  it('drawCornerRect draws L-shaped corners', function() {
    display.initSize(6, 6);
    display.clear(color32(0, 0, 0));
    display.drawCornerRect(0, 0, { width: 6, height: 6 }, 255, 0, 0, 1);
    const RED = color32(255, 0, 0);
    const BLACK = color32(0, 0, 0);
    expect(Array.from(display.buffer32)).to.eql([
      RED, RED, BLACK, BLACK, RED, RED,
      RED, BLACK, BLACK, BLACK, BLACK, RED,
      BLACK, BLACK, BLACK, BLACK, BLACK, BLACK,
      BLACK, BLACK, BLACK, BLACK, BLACK, BLACK,
      RED, BLACK, BLACK, BLACK, BLACK, RED,
      RED, RED, BLACK, BLACK, RED, RED
    ]);
  });

  it('drawCornerRect with midLine fills edges', function() {
    display.initSize(8, 8);
    display.clear(color32(0, 0, 0));
    display.drawCornerRect(0, 0, { width: 8, height: 8 }, 0, 255, 0, 1, true, 2);
    const GREEN = color32(0, 255, 0);
    const BLACK = color32(0, 0, 0);
    expect(Array.from(display.buffer32)).to.eql([
      GREEN, GREEN, BLACK, GREEN, GREEN, BLACK, GREEN, GREEN,
      GREEN, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, GREEN,
      BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK,
      GREEN, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, GREEN,
      GREEN, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, GREEN,
      BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK,
      GREEN, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, GREEN,
      GREEN, GREEN, BLACK, GREEN, GREEN, BLACK, GREEN, GREEN
    ]);
  });
});
