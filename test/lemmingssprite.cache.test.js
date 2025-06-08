import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { LemmingsSprite } from '../js/LemmingsSprite.js';
import '../js/SpriteTypes.js';
import '../js/ColorPalette.js';
import '../js/Animation.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('LemmingsSprite caching', function() {
  let OrigAnimation;
  let callCount;
  beforeEach(function() {
    OrigAnimation = Lemmings.Animation;
    callCount = 0;
    Lemmings.Animation = class {
      constructor() { callCount++; }
      loadFromFile() {}
    };
  });

  afterEach(function() {
    Lemmings.Animation = OrigAnimation;
  });

  it('reuses animations for identical palette', function() {
    const pal = new Lemmings.ColorPalette();
    const fr = {};
    const s1 = new LemmingsSprite(fr, pal);
    const first = callCount;
    const anim1 = s1.getAnimation(Lemmings.SpriteTypes.WALKING, true);

    const s2 = new LemmingsSprite(fr, pal);
    const anim2 = s2.getAnimation(Lemmings.SpriteTypes.WALKING, true);

    expect(anim2).to.equal(anim1);
    expect(callCount).to.equal(first);
  });

  it('creates animations for different palettes', function() {
    const fr = {};
    const pal1 = new Lemmings.ColorPalette();
    new LemmingsSprite(fr, pal1);
    const count1 = callCount;
    const pal2 = new Lemmings.ColorPalette();
    new LemmingsSprite(fr, pal2);
    expect(callCount).to.be.greaterThan(count1);
  });
});
