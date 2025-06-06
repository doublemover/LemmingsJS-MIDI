import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import { Range } from '../js/Range.js';
import { Mask } from '../js/Mask.js';
import '../js/ColorPalette.js';
import '../js/Frame.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level arrow areas', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

  it('detects arrows and builds debug frame', function() {
    const level = new Level(4, 4);
    const pal = new Lemmings.ColorPalette();
    level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));
    level.setPalettes(pal, pal);

    const range = Object.assign(new Range(), { x: 1, y: 1, width: 2, height: 1, direction: 0 });
    level.setArrowAreas([range]);
    level.setGroundAt(1, 1, 0);
    level.setGroundAt(2, 1, 0);

    expect(level.isArrowAt(1, 1, 1)).to.equal(true);
    expect(level.isArrowAt(1, 1, 0)).to.equal(false);

    const mask = new Mask(null, 1, 1, 0, 0); mask.data = new Int8Array([1]);
    expect(level.hasArrowUnderMask(mask, 1, 1, 1)).to.equal(true);

    const stubDisplay = { calls: 0, drawFrame(frame) { this.calls++; this.last = frame; } };
    level.renderDebug(stubDisplay);
    const first = stubDisplay.last;
    level.renderDebug(stubDisplay);
    expect(stubDisplay.calls).to.equal(2);
    expect(stubDisplay.last).to.equal(first);
  });
});
