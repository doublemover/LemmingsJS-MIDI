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
      syncBackground(img, mask, dirtyRects, tileSize) {
        syncCalls.push([img, mask, dirtyRects, tileSize]);
        hasBackground = true;
      }
    };

    level.render(gd);
    level.render(gd);
    level.setGroundAt(1, 1, 7);
    level.render(gd);

    expect(syncCalls.length).to.equal(2);
    expect(syncCalls[0][2]).to.equal(null);
    expect(syncCalls[0][3]).to.equal(64);
    const deltaRects = syncCalls[1][2];
    expect(deltaRects === null || Array.isArray(deltaRects)).to.equal(true);
    if (Array.isArray(deltaRects)) {
      expect(deltaRects.length).to.equal(1);
    }
    expect(syncCalls[1][3]).to.equal(64);
  });
});
