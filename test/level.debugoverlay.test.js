import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import { Range } from '../js/Range.js';
import '../js/ColorPalette.js';
import '../js/Frame.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level debug overlay caching', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

  it('reuses frame across debug toggles and rebuilds on changes', function() {
    const level = new Level(4, 4);
    const pal = new Lemmings.ColorPalette();
    level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));
    level.setPalettes(pal, pal);

    const range = Object.assign(new Range(), { x: 1, y: 1, width: 2, height: 1, direction: 0 });
    level.setArrowAreas([range]);

    const stub = { drawFrame() {} };
    level.renderDebug(stub);
    const first = level._debugFrame;

    // debug disabled: no render call
    // re-enable without changes
    level.renderDebug(stub);
    expect(level._debugFrame).to.equal(first);

    // change ranges while debug disabled
    const r2 = Object.assign(new Range(), { x: 0, y: 0, width: 1, height: 1, direction: 1 });
    level.setArrowAreas([range, r2]);
    level.renderDebug(stub);
    expect(level._debugFrame).to.not.equal(first);
  });
});
