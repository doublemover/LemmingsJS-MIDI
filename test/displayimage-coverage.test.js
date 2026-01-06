import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import {
  DisplayImage,
  drawMarchingAntRect,
  drawDashedRect,
  scaleNearest,
  scaleXbrz,
  scaleHqx,
  __test__
} from '../js/render/DisplayImage.js';

class SimpleImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

const color32 = (r, g, b) => (
  (0xFF000000 | (b & 0xFF) << 16 | (g & 0xFF) << 8 | (r & 0xFF)) >>> 0
);

const makeStage = () => ({
  redraws: 0,
  createImage(display, w, h) {
    return new SimpleImageData(w, h);
  },
  redraw() { this.redraws += 1; },
  setGameViewPointPosition(x, y, options) {
    this.lastPosition = { x, y, options };
  }
});

const makeFrame = (width, height, options = {}) => {
  const {
    mask = null,
    buffer = null,
    offsetX = 0,
    offsetY = 0,
    spans = null,
    bounds = null
  } = options;
  const buf = buffer
    || Uint32Array.from({ length: width * height }, (_, i) => (i + 1) >>> 0);
  const maskBuf = mask
    || Uint8Array.from({ length: width * height }, () => 1);
  const frame = {
    width,
    height,
    offsetX,
    offsetY,
    getBuffer() { return buf; },
    getMask() { return maskBuf; }
  };
  if (spans) {
    frame.getSpanCache = () => ({ rows: spans, bounds });
  }
  return frame;
};

describe('DisplayImage coverage', function() {
  useGlobalLemmings({ game: { showDebug: false } });

  it('initializes buffers and background helpers', function() {
    const stage = makeStage();
    const display = new DisplayImage(stage);
    expect(display.getWidth()).to.equal(0);
    expect(display.getHeight()).to.equal(0);

    const coldDisplay = new DisplayImage(stage);
    coldDisplay.setPixel(0, 0, 1, 2, 3);

    display.initSize(2, 2);
    display.initSize(2, 2);
    expect(display.worldDataSize).to.eql({ width: 2, height: 2 });
    display.worldDataSize = { width: 3, height: 4 };
    expect(display.getWidth()).to.equal(3);
    expect(display.getHeight()).to.equal(4);

    display.clear(0x11223344);
    expect(display.buffer32[0]).to.equal(0x11223344);

    const bytes = new Uint8ClampedArray(display.getWidth() * display.getHeight() * 4);
    bytes[0] = 7;
    display.setBackground(bytes);
    expect(display.imgData.data[0]).to.equal(7);

    const words = new Uint32Array(display.getWidth() * display.getHeight());
    words[0] = 0x89ABCDEF;
    display.setBackground(words);
    expect(display.buffer32[0]).to.equal(0x89ABCDEF);

    const logs = [];
    display.log.log = (msg) => logs.push(msg);
    display.setBackground([1, 2, 3]);
    expect(logs[0]).to.include('setBackground');

    display.setPixel(1, 1, 10, 20, 30);
    expect(display.buffer32[1 + display.getWidth()]).to.equal(color32(10, 20, 30));
    display.setDebugPixel(0, 0);
    expect(display.buffer32[0]).to.equal(0xFF0000FF);

    display.setScreenPosition(5, 6, { snapped: true });
    expect(stage.lastPosition).to.eql({ x: 5, y: 6, options: { snapped: true } });
    display.redraw();
    expect(stage.redraws).to.equal(1);
  });

  it('draws primitives and masks', function() {
    const stage = makeStage();
    const display = new DisplayImage(stage);
    display.drawVerticalLine(0, 0, 1, 1, 2, 3);
    display.drawHorizontalLine(0, 0, 1, 1, 2, 3);
    display.drawStippleRect(0, 0, 1, 1);

    display.initSize(6, 6);
    display.clear(0);
    display.drawRect(1, 1, 2, 2, 10, 20, 30, true);
    display.drawRect(0, 0, 1, 1, 10, 20, 30, false);
    display.drawHorizontalLine(4, 2, 2, 10, 20, 30);
    display.drawVerticalLine(2, 4, 2, 10, 20, 30);
    display.drawStippleRect(0, 0, 2, 2);

    display.drawCornerRect(0, 0, { width: 4, height: 4 }, 1, 2, 3, 1, false, 0);
    display.drawCornerRect(1, 1, 3, 4, 5, 6, 2, true, 2);

    const tinyFrame = makeFrame(1, 1);
    display.drawFrame(tinyFrame, 0, 0);
    display.drawFrameCovered(tinyFrame, 0, 0, 1, 2, 3);

    const mask = makeFrame(2, 2, {
      mask: Uint8Array.from([1, 0, 1, 1]),
      offsetX: -1,
      offsetY: 0
    });
    display.drawMask(mask, 1, 1);
    display.drawMask(mask, -10, 1);
    display.drawMask(mask, 1, -10);

    const coldMaskDisplay = new DisplayImage(stage);
    coldMaskDisplay.drawMask(mask, 1, 1);

    display.drawDashedRect(1, 1, 2, 1, 3, 0, 0xFFFFFFFF, 0xFF000000);
    display.drawDashedRect(1, 1, 2, 1, 3, 0, 255, Number.NaN);
    drawDashedRect(display, 0, 0, 1, 1);
    drawMarchingAntRect(null, 0, 0, 1, 1);

    expect(__test__.cyrb53('abc', 1)).to.be.a('number');
  });

  it('blits with span caches and per-pixel fallbacks', function() {
    const stage = makeStage();
    const display = new DisplayImage(stage);
    display.initSize(4, 4);
    display.clear(0);

    const spans = [
      [0, 2],
      null,
      [1, 3]
    ];
    const frame = makeFrame(3, 3, {
      offsetX: -1,
      spans,
      bounds: { minY: 0, maxY: 2 }
    });
    const frameNoBounds = makeFrame(3, 3, {
      offsetX: -1,
      spans
    });

    display._blit(frame, 0, 0, { checkGround: false });
    display._blit(frameNoBounds, 0, 0, { checkGround: false });
    display._blit(frame, 0, 0, { checkGround: false, upsideDown: true });
    display._blit(frame, 0, -10, { checkGround: false });

    const skipFrame = makeFrame(3, 3, {
      offsetX: 10,
      spans: [
        [0, 1],
        [0, 1],
        [0, 1]
      ],
      bounds: { minY: 1, maxY: 1 }
    });
    display._blit(skipFrame, 0, 0, { checkGround: false });

    const groundMask = {
      hasGroundAt(x) {
        return x % 2 === 0;
      }
    };
    display._blit(frame, 0, 0, {
      checkGround: true,
      noOverwrite: true,
      groundMask
    });
    display._blit(frame, 0, 0, {
      checkGround: true,
      onlyOverwrite: true,
      groundMask
    });

    const sparseMask = Uint8Array.from([1, 0, 1, 1]);
    const sparseFrame = makeFrame(2, 2, {
      mask: sparseMask,
      offsetX: -1
    });
    display._blit(sparseFrame, 0, 0);
    display._blit(sparseFrame, 0, -5);
    display._blit(sparseFrame, 0, 0, {
      nullColor32: 0x12345678,
      upsideDown: true
    });
    display._blit(sparseFrame, 0, 0, {
      checkGround: true,
      noOverwrite: true,
      groundMask
    });
    display._blit(sparseFrame, 0, 0, {
      checkGround: true,
      onlyOverwrite: true,
      groundMask: { hasGroundAt: () => false }
    });

    display.groundMask = groundMask;
    display.drawFrameFlags(sparseFrame, 0, 0, {
      onlyOverwrite: true,
      noOverwrite: false,
      isUpsideDown: true
    });

    display.drawFrameResized(frame, 0, 0, 2, 2);
  });

  it('scales frames with multiple algorithms', function() {
    const stage = makeStage();
    const display = new DisplayImage(stage);
    display.initSize(4, 4);

    const frame = makeFrame(2, 2, {
      buffer: Uint32Array.from([1, 2, 3, 4]),
      mask: Uint8Array.from([1, 1, 1, 1])
    });

    display._blit(frame, 0, 0, { size: { width: 4, height: 4 }, scaleMode: 'nearest' });
    display._blit(frame, 0, 0, { size: { width: 4, height: 4 }, scaleMode: 'xbrz' });
    display._blit(frame, 0, 0, { size: { width: 4, height: 4 }, scaleMode: 'hqx' });

    scaleNearest(frame, 2, 2, {});
    scaleNearest(frame, 2, 2, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      nullColor32: 0x10101010,
      checkGround: true,
      noOverwrite: true,
      groundMask: { hasGroundAt: () => true }
    });
    scaleNearest(frame, 2, 2, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      checkGround: true,
      onlyOverwrite: true,
      groundMask: { hasGroundAt: () => false }
    });
    scaleXbrz(frame, 3, 3, { dest32: display.buffer32, destW: 4, destH: 4, baseX: 0, baseY: 0 });
    scaleXbrz(frame, 2, 2, {});
    scaleHqx(frame, 3, 3, { dest32: display.buffer32, destW: 4, destH: 4, baseX: 0, baseY: 0 });
    scaleHqx(frame, 2, 2, {});

    const maskedFrame = makeFrame(2, 2, {
      buffer: Uint32Array.from([1, 2, 3, 4]),
      mask: Uint8Array.from([1, 0, 1, 1])
    });
    scaleXbrz(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      nullColor32: 0x10203040,
      checkGround: true,
      noOverwrite: true,
      groundMask: { hasGroundAt: () => true }
    });
    scaleXbrz(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: -1,
      baseY: 0
    });
    scaleXbrz(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: -1
    });
    scaleXbrz(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      nullColor32: 0x10203040,
      checkGround: true,
      onlyOverwrite: true,
      groundMask: { hasGroundAt: () => false }
    });
    scaleXbrz(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      upsideDown: true
    });
    scaleHqx(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      nullColor32: 0x10203040,
      checkGround: true,
      noOverwrite: true,
      groundMask: { hasGroundAt: () => true }
    });
    scaleHqx(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      nullColor32: 0x10203040,
      checkGround: true,
      onlyOverwrite: true,
      groundMask: { hasGroundAt: () => false }
    });
    scaleHqx(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: -1
    });
    scaleHqx(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: -1,
      baseY: 0
    });
    scaleHqx(maskedFrame, 4, 4, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      upsideDown: true
    });

    scaleNearest(maskedFrame, 2, 2, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: 0,
      nullColor32: 0x10101010
    });
    scaleNearest(maskedFrame, 2, 2, {
      dest32: display.buffer32,
      destW: 4,
      destH: 4,
      baseX: 0,
      baseY: -1,
      upsideDown: true
    });
  });

  it('disposes event handlers safely', function() {
    const stage = makeStage();
    const display = new DisplayImage(stage);
    display.initSize(1, 1);
    display.dispose();
    expect(display.buffer32).to.equal(null);
    expect(display.stage).to.equal(null);
  });
});
