import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import { Range } from '../js/Range.js';
import '../js/ColorPalette.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level.newSetSteelAreas', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

  it('rebuilds steel mask from terrain data', function() {
    const level = new Level(4, 4);
    const pal = new Lemmings.ColorPalette();
    level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));
    level.setPalettes(pal, pal);
    level.setSteelAreas([Object.assign(new Range(), { x: 0, y: 0, width: 1, height: 1 })]);

    const levelReader = { levelWidth: 4, levelHeight: 4, terrains: [ { id: 1, x: 0, y: 0 } ] };
    const terrainImages = { 1: { isSteel: true, steelWidth: 1, steelHeight: 1, width: 1, height: 1 } };

    level.newSetSteelAreas(levelReader, terrainImages);

    expect(Array.from(level.steelRanges)).to.eql([0, 0, 1, 1]);
    expect(level.steelMask.hasMaskAt(0, 0)).to.equal(true);
  });
});
