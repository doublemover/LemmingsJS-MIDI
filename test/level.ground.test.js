import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import '../js/ColorPalette.js';

// minimal global env for logging
const miniMapStub = { onGroundChanged() {} };

describe('Level ground operations', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

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
});
