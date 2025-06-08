import { expect } from 'chai';
import { Level } from '../js/Level.js';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ColorPalette.js';

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
});
