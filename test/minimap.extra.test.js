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

describe('MiniMap extra', function() {
  afterEach(function() { delete globalThis.lemmings; });

  it('onGroundChanged and invalidateRegion modify terrain', function() {
    const level = createLevel(127, 24);
    const mm = new MiniMap(null, level, null);
    const idx = 5 * mm.width + 10;
    expect(mm.terrain[idx]).to.equal(0);

    mm.onGroundChanged(10, 5, false);
    expect(mm.terrain[idx]).to.equal(1);

    mm.onGroundChanged(10, 5, true);
    expect(mm.terrain[idx]).to.equal(0);

    mm.onGroundChanged(10, 5, true);
    expect(mm.terrain[idx]).to.equal(0);

    const mask = level.getGroundMaskLayer();
    mask.setGroundAt(10, 5);
    mm.invalidateRegion(10, 5, 1, 1);
    expect(mm.terrain[idx]).to.equal(1);

    mask.data[5 * mask.width + 10] = 0;
    mm.invalidateRegion(10, 5, 1, 1);
    expect(mm.terrain[idx]).to.equal(0);
  });

  it('addDeath stores coords/TTLs and render manages TTLs', function() {
    const level = createLevel(127, 24);
    const display = createDisplay(150, 50);
    globalThis.lemmings = { stage: makeStage(level, display) };
    const mm = new MiniMap(null, level, display);

    mm.addDeath(20, 10);
    const sx = (20 * mm.scaleX) | 0;
    const sy = (10 * mm.scaleY) | 0;
    expect(Array.from(mm.deadDots)).to.eql([sx, sy]);
    expect(Array.from(mm.deadTTLs)).to.eql([MiniMap.DEATH_DOT_TTL]);

    const idx = sy * mm.width + sx;
    mm.render();
    expect(mm.deadTTLs[0]).to.equal(MiniMap.DEATH_DOT_TTL - 1);
    expect(mm.frame.data[idx]).to.equal(0xFF0000FF);

    mm.deadTTLs[0] = 1;
    mm.render();
    expect(mm.deadDots.length).to.equal(0);
    expect(mm.deadTTLs.length).to.equal(0);
  });

  it('dispose detaches listeners and clears references', function() {
    const level = createLevel(127, 24);
    const display = createDisplay(150, 50);
    globalThis.lemmings = { stage: makeStage(level, display) };
    const mm = new MiniMap(null, level, display);

    expect(display.onMouseDown.handlers.size).to.equal(1);
    expect(display.onMouseUp.handlers.size).to.equal(1);
    expect(display.onMouseMove.handlers.size).to.equal(1);

    mm.dispose();

    expect(display.onMouseDown.handlers.size).to.equal(0);
    expect(display.onMouseUp.handlers.size).to.equal(0);
    expect(display.onMouseMove.handlers.size).to.equal(0);
    expect(mm._displayListeners).to.equal(null);
    expect(mm.gameDisplay).to.equal(null);
    expect(mm.level).to.equal(null);
    expect(mm.guiDisplay).to.equal(null);
    expect(mm.terrain).to.equal(null);
    expect(mm.fog).to.equal(null);
    expect(mm.liveDots).to.equal(null);
    expect(mm.selectedDot).to.equal(null);
    expect(mm.deadDots).to.equal(null);
    expect(mm.deadTTLs).to.equal(null);
    expect(mm.frame).to.equal(null);
  });
});
