import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ColorPalette.js';
import { Frame } from '../js/Frame.js';
import { DisplayImage } from '../js/DisplayImage.js';
import '../js/EventHandler.js';
import '../js/SkillTypes.js';

// minimal global env for logging
globalThis.lemmings = { game: { showDebug: false } };

class MockStage {
  constructor() {
    this.display = null;
  }
  createImage(display, w, h) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  getGameDisplay() {
    if (!this.display) this.display = new DisplayImage(this);
    return this.display;
  }
}

describe('GameDisplay drawFrame', function() {
  it('draws frames into the buffer', function() {
    const stage = new MockStage();
    const gd = stage.getGameDisplay();
    gd.initSize(5, 5);

    const redFrame = new Frame(2, 2);
    redFrame.fill(255, 0, 0); // red
    gd.drawFrame(redFrame, 1, 1);

    const buf = gd.buffer32;
    const { width: w } = gd.worldDataSize;
    const red = Lemmings.ColorPalette.colorFromRGB(255, 0, 0) >>> 0;
    expect(buf[1 + 1 * w]).to.equal(red);
    expect(buf[2 + 1 * w]).to.equal(red);
    expect(buf[1 + 2 * w]).to.equal(red);
    expect(buf[2 + 2 * w]).to.equal(red);
  });

  it('applies frame offsets', function() {
    const stage = new MockStage();
    const gd = stage.getGameDisplay();
    gd.initSize(4, 4);

    const blueFrame = new Frame(1, 1, 1, 1);
    blueFrame.fill(0, 0, 255); // blue
    gd.drawFrame(blueFrame, 0, 0); // should draw at (1,1)

    const buf = gd.buffer32;
    const { width: w } = gd.worldDataSize;
    const blue = Lemmings.ColorPalette.colorFromRGB(0, 0, 255) >>> 0;
    expect(buf[1 + 1 * w]).to.equal(blue);
  });

  it('overwrites previous pixels on overlap', function() {
    const stage = new MockStage();
    const gd = stage.getGameDisplay();
    gd.initSize(3, 3);

    const greenFrame = new Frame(1, 1);
    greenFrame.fill(0, 255, 0);
    gd.drawFrame(greenFrame, 1, 1);

    const yellowFrame = new Frame(1, 1);
    yellowFrame.fill(255, 255, 0);
    gd.drawFrame(yellowFrame, 1, 1);

    const buf = gd.buffer32;
    const { width: w } = gd.worldDataSize;
    const yellow = Lemmings.ColorPalette.colorFromRGB(255, 255, 0) >>> 0;
    expect(buf[1 + 1 * w]).to.equal(yellow);
  });

  it('does not modify selection on click', function() {
    const stage = new MockStage();
    const display = stage.getGameDisplay();

    let selected = null;
    const lem = { id: 1 };
    const lm = {
      getNearestLemming() { return lem; },
      setSelectedLemming(l) { selected = l; },
      render() {},
      renderDebug() {},
      getSelectedLemming() { return selected; }
    };
    const lvl = { render() {}, renderDebug() {}, screenPositionX: 0 };
    const obj = { render() {} };
    const trg = { renderDebug() {} };
    const gd = new Lemmings.GameDisplay({ showDebug: false }, lvl, lm, obj, trg);
    gd.setGuiDisplay(display);

    display.onMouseDown.trigger({ x: 1, y: 1 });

    expect(selected).to.equal(null);
  });

  it('keeps selection when clicking empty space', function() {
    const stage = new MockStage();
    const display = stage.getGameDisplay();

    let selected = { id: 1 };
    const lm = {
      getNearestLemming() { return null; },
      setSelectedLemming(l) { selected = l; },
      render() {},
      renderDebug() {},
      getSelectedLemming() { return selected; }
    };
    const lvl = { render() {}, renderDebug() {}, screenPositionX: 0 };
    const obj = { render() {} };
    const trg = { renderDebug() {} };
    const gd = new Lemmings.GameDisplay({ showDebug: false }, lvl, lm, obj, trg);
    gd.setGuiDisplay(display);

    display.onMouseDown.trigger({ x: 2, y: 2 });

    expect(selected).to.deep.equal({ id: 1 });
  });
});

describe('GameDisplay hover and selection rendering', function() {
  function createDisplay() {
    return {
      onMouseMove: new Lemmings.EventHandler(),
      drawCornerRectCalls: [],
      drawCornerRect(...args) { this.drawCornerRectCalls.push(args); }
    };
  }

  it('draws hover rectangle with correct color and tracks mouse', function() {
    const { render, renderDebug, screenPositionX } = { render() {}, renderDebug() {}, screenPositionX: 0 };
    const hovered = { x: 10, y: 20, removed: false };
    const lm = {
      render() {},
      renderDebug() {},
      getSelectedLemming() { return null; },
      getNearestLemming(x, y) { return x === hovered.x && y === hovered.y ? hovered : null; }
    };
    const gd = new Lemmings.GameDisplay({ showDebug: false }, { render, renderDebug, screenPositionX }, lm, { render() {} }, { renderDebug() {} });
    const display = createDisplay();
    gd.setGuiDisplay(display);

    display.onMouseMove.trigger({ x: 10, y: 20 });
    expect(gd.hoverLemming).to.equal(hovered);
    expect(gd._mouseX).to.equal(10);
    expect(gd._mouseY).to.equal(20);

    gd.render();
    expect(display.drawCornerRectCalls).to.have.lengthOf(1);
    const args = display.drawCornerRectCalls[0];
    expect(args[0]).to.equal(5);
    expect(args[1]).to.equal(9);
    expect(args[2]).to.eql({ width: 10, height: 13 });
    expect(args.slice(3, 6)).to.eql([0x5e, 0x5e, 0x5e]);
  });

  it('draws selection rectangle for selected lemming', function() {
    const selected = { x: 15, y: 25, removed: false, action: {} };
    const lm = {
      render() {},
      renderDebug() {},
      getSelectedLemming() { return selected; },
      getNearestLemming() { return null; }
    };
    const level = { render() {}, renderDebug() {}, screenPositionX: 0 };
    const gd = new Lemmings.GameDisplay({
      showDebug: false,
      getGameSkills() { return { getSelectedSkill() { return Lemmings.SkillTypes.UNKNOWN; } }; }
    }, level, lm, { render() {} }, { renderDebug() {} });
    const display = createDisplay();
    gd.setGuiDisplay(display);

    gd.render();
    expect(display.drawCornerRectCalls).to.have.lengthOf(1);
    const args = display.drawCornerRectCalls[0];
    expect(args[0]).to.equal(10);
    expect(args[1]).to.equal(14);
    expect(args[2]).to.eql({ width: 10, height: 13 });
    expect(args.slice(3, 6)).to.eql([0x00, 0xff, 0x00]);
  });

  it('dispose removes mouse listeners', function() {
    const gd = new Lemmings.GameDisplay({ showDebug: false }, { render() {}, renderDebug() {}, screenPositionX: 0 }, { render() {}, renderDebug() {}, getSelectedLemming() { return null; }, getNearestLemming() { return null; } }, { render() {} }, { renderDebug() {} });
    const display = createDisplay();

    gd.setGuiDisplay(display);
    expect(display.onMouseMove.handlers.size).to.equal(1);
    gd.dispose();
    expect(display.onMouseMove.handlers.size).to.equal(0);
    expect(gd._mouseMoveHandler).to.equal(null);
  });
});
