import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { MiniMap } from '../js/MiniMap.js';

function createDisplay(width, height) {
  return {
    width,
    height,
    drawFrameCalls: [],
    onMouseDown: new Lemmings.EventHandler(),
    onMouseUp: new Lemmings.EventHandler(),
    onMouseMove: new Lemmings.EventHandler(),
    getWidth() { return this.width; },
    getHeight() { return this.height; },
    drawFrame(frame, x, y) { this.drawFrameCalls.push({ frame, x, y }); },
    setScreenPosition(x, y) { this.lastScreenPosition = [x, y]; }
  };
}

function createLevel(width, height) {
  const mask = {
    width,
    height,
    data: new Uint8Array(width * height),
    hasGroundAt(x, y) { return this.data[y * this.width + x] !== 0; },
    setGroundAt(x, y) { this.data[y * this.width + x] = 1; },
    getSubLayer(x, y, w, h) {
      const sub = { width: w, height: h, mask: new Uint8Array(w * h) };
      for (let dy = 0; dy < h; ++dy) {
        const sy = y + dy;
        if (sy < 0 || sy >= this.height) continue;
        const srcRow = sy * this.width;
        const dstRow = dy * w;
        for (let dx = 0; dx < w; ++dx) {
          const sx = x + dx;
          if (sx < 0 || sx >= this.width) continue;
          sub.mask[dstRow + dx] = this.data[srcRow + sx];
        }
      }
      return sub;
    }
  };
  return {
    width,
    height,
    screenPositionX: 0,
    objects: [],
    getGroundMaskLayer() { return mask; }
  };
}

function makeStage(level, display) {
  return {
    getGameViewRect() {
      return { x: level.screenPositionX, y: 0, w: display.getWidth(), h: display.getHeight() };
    }
  };
}

describe('MiniMap', function() {
  afterEach(function() { delete globalThis.lemmings; });

  it('renders live dots at scaled coordinates', function() {
    const level = createLevel(300, 50);
    const display = createDisplay(150, 50);
    globalThis.lemmings = { stage: makeStage(level, display) };
    const mm = new MiniMap(null, level, display);
    const dot = Uint8Array.from([ (20 * mm.scaleX) | 0, (10 * mm.scaleY) | 0 ]);
    mm.setLiveDots(dot);
    mm.render();

    const idx = dot[1] * mm.width + dot[0];
    expect(mm.frame.data[idx]).to.equal(0x5500FFFF);

    const call = display.drawFrameCalls[0];
    expect(call.x).to.equal(display.getWidth() - mm.width);
    expect(call.y).to.equal(display.getHeight() - mm.height);
  });

  it('updates viewport when dragging', function() {
    const level = createLevel(300, 50);
    const display = createDisplay(150, 50);
    globalThis.lemmings = { stage: makeStage(level, display) };
    const mm = new MiniMap(null, level, display);

    const destX = display.getWidth() - mm.width;
    const destY = display.getHeight() - mm.height - 1;

    display.onMouseDown.trigger({ x: destX + mm.width / 2, y: destY + 1 });
    const first = ((level.width - display.getWidth()) * 0.5) | 0;
    expect(level.screenPositionX).to.equal(first);

    display.onMouseMove.trigger({ x: destX + mm.width * 0.75, y: destY + 1 });
    display.onMouseUp.trigger({ x: destX + mm.width * 0.75, y: destY + 1 });
    const expected = ((level.width - display.getWidth()) * 0.75) | 0;
    expect(level.screenPositionX).to.equal(expected);

    mm.render();
    const vp = (expected * mm.scaleX) | 0;
    expect(mm.frame.data[vp]).to.equal(0xFF00FF00);
  });
});
