import { expect } from 'chai';
import { Lemmings, withLemmingsGame } from './helpers/lemmings.js';
import { Level } from '../js/level/Level.js';
import '../js/render/ColorPalette.js';

// minimal global env for logging
const miniMapStub = { onGroundChanged() {} };

describe('Level ground operations', function() {
  let restore;
  beforeEach(function() {
    restore = withLemmingsGame({ lemmingManager: { miniMap: miniMapStub }, showDebug: false });
  });
  afterEach(function() { restore(); });

  it('sets and clears ground pixels', function() {
    const level = new Level(2, 2);
    const palette = new Lemmings.ColorPalette();
    palette.setColorRGB(1, 10, 20, 30);
    level.setGroundImage(new Uint8ClampedArray(2 * 2 * 4));
    level.setPalettes(palette, palette);

    expect(level.hasGroundAt(1, 1)).to.equal(false);
    level.setGroundAt(1, 1, 1);
    expect(level.hasGroundAt(1, 1)).to.equal(true);

    const idx = (1 * 2 + 1) * 4;
    expect(Array.from(level.groundImage.slice(idx, idx + 3))).to.eql([10, 20, 30]);

    level.clearGroundAt(1, 1);
    expect(level.hasGroundAt(1, 1)).to.equal(false);
    expect(Array.from(level.groundImage.slice(idx, idx + 3))).to.eql([0, 0, 0]);
  });

  it('clears ground with masks while skipping steel and bounds', function() {   
    const level = new Level(3, 3);
    const palette = new Lemmings.ColorPalette();
    palette.setColorRGB(1, 10, 20, 30);
    level.setGroundImage(new Uint8ClampedArray(3 * 3 * 4));
    level.setPalettes(palette, palette);

    level.setGroundAt(1, 0, 1);
    level.setGroundAt(1, 1, 1);
    level.steelMask.setMaskAt(0, 0);

    const mask = {
      offsetX: -1,
      offsetY: -1,
      width: 3,
      height: 3,
      at(dx, dy) { return dx === 1 && dy === 2; }
    };

    const result = level._clearGroundWithMaskInternal(mask, 0, 0);
    expect(result.changed).to.equal(true);
    expect(result.removed).to.be.greaterThan(0);
  });

  it('records ground changes when history is available', function() {
    const calls = [];
    globalThis.lemmings.game.history = {
      recordGroundChange(...args) { calls.push(args); }
    };
    const level = new Level(1, 1);
    const palette = new Lemmings.ColorPalette();
    palette.setColorRGB(1, 10, 20, 30);
    level.setGroundImage(new Uint8ClampedArray(1 * 1 * 4));
    level.setPalettes(palette, palette);

    level.setGroundAt(0, 0, 1);
    const mask = {
      offsetX: 0,
      offsetY: 0,
      width: 1,
      height: 1,
      at() { return false; }
    };
    level._clearGroundWithMaskInternal(mask, 0, 0);
    level.clearGroundAt(0, 0);

    expect(calls.length).to.equal(3);
  });
});
