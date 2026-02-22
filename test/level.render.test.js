import { expect } from 'chai';
import { Lemmings, withLemmingsGame } from './helpers/lemmings.js';
import { Level } from '../js/level/Level.js';
import '../js/render/ColorPalette.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level render', function() {
  let restore;
  beforeEach(function() {
    restore = withLemmingsGame({ lemmingManager: { miniMap: miniMapStub }, showDebug: false });
  });
  afterEach(function() { restore(); });

  it('draws ground image via GameDisplay', function() {
    const level = new Level(3, 3);
    const pal = new Lemmings.ColorPalette();
    level.setGroundImage(new Uint8ClampedArray(3 * 3 * 4));
    level.setPalettes(pal, pal);

    const calls = [];
    const gd = {
      initSize(w, h) { calls.push(['init', w, h]); },
      setBackground(img, mask) { calls.push(['bg', img, mask]); }
    };

    level.render(gd);

    expect(calls[0]).to.eql(['init', 3, 3]);
    expect(calls[1][0]).to.equal('bg');
    expect(calls[1][1]).to.equal(level.groundImage);
    expect(calls[1][2]).to.equal(level.groundMask);
  });

  it('syncs cached backgrounds and only pushes terrain deltas', function() {
    const level = new Level(4, 4);
    const pal = new Lemmings.ColorPalette();
    level.setGroundImage(new Uint8ClampedArray(4 * 4 * 4));
    level.setPalettes(pal, pal);

    const syncCalls = [];
    let hasBackground = false;
    const gd = {
      initSize() {},
      restoreBackground() {},
      hasBackground() { return hasBackground; },
      syncBackground(img, mask, dirtyRects) {
        syncCalls.push([img, mask, dirtyRects]);
        hasBackground = true;
      }
    };

    level.render(gd);
    level.render(gd);
    level.setGroundAt(1, 1, 7);
    level.render(gd);

    expect(syncCalls.length).to.equal(2);
    expect(syncCalls[0][2]).to.equal(null);
    expect(Array.isArray(syncCalls[1][2])).to.equal(true);
    expect(syncCalls[1][2].length).to.equal(1);
  });
});
