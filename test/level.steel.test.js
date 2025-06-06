import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import { Range } from '../js/Range.js';
import '../js/ColorPalette.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level steel operations', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

  it('tracks steel ranges and ground', function() {
    const level = new Level(4, 4);
    const pal = new Lemmings.ColorPalette();
    level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));
    level.setPalettes(pal, pal);

    level.setSteelAreas([Object.assign(new Range(), { x: 1, y: 1, width: 2, height: 1 })]);
    level.steelMask.setMaskAt(1, 1);

    expect(level.isSteelAt(1, 1, true)).to.equal(true);
    expect(level.isSteelAt(3, 3, true)).to.equal(false);

    level.setGroundAt(1, 1, 0);
    expect(level.isSteelGround(1, 1)).to.equal(true);
    expect(level.isSteelGround(2, 1)).to.equal(false);
  });
});
