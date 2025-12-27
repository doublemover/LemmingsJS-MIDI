import { expect } from 'chai';
import { Level } from '../js/level/Level.js';
import { Lemmings } from './helpers/lemmings.js';
import '../js/render/ColorPalette.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level misc helpers', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

  it('checks coordinates with isOutOfLevel', function() {
    const level = new Level(4, 3);
    expect(level.isOutOfLevel(-1)).to.equal(true);
    expect(level.isOutOfLevel(0)).to.equal(false);
    expect(level.isOutOfLevel(2)).to.equal(false);
    expect(level.isOutOfLevel(3)).to.equal(true);
  });

  it('clears ground with mask constraints', function() {
    const level = new Level(2, 2);
    level.groundImage = new Uint8ClampedArray(2 * 2 * 4);
    const pixelIndex = (1 * 2 + 0) * 4;
    level.groundImage[pixelIndex] = 255;
    level.isSteelAt = (x, y) => x === 1 && y === 0;

    const mask = {
      offsetX: -1,
      offsetY: 0,
      width: 4,
      height: 2,
      at(dx, dy) {
        return dx === 1 && dy === 0;
      }
    };

    const removed = level.clearGroundWithMaskCount(mask, 0, 0);
    expect(removed).to.equal(1);
    expect(level.groundImage[pixelIndex]).to.equal(0);
  });
});
