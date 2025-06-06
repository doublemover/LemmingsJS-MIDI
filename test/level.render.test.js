import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Level } from '../js/Level.js';
import '../js/ColorPalette.js';

const miniMapStub = { onGroundChanged() {} };

describe('Level render', function() {
  let saved;
  beforeEach(function() {
    saved = globalThis.lemmings;
    globalThis.lemmings = { game: { lemmingManager: { miniMap: miniMapStub }, showDebug: false } };
  });
  afterEach(function() { globalThis.lemmings = saved; });

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
});
