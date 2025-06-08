import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { LemmingsSprite } from '../js/LemmingsSprite.js';
import '../js/SpriteTypes.js';
import '../js/ColorPalette.js';
import '../js/Animation.js';

// Ensure quiet logging
globalThis.lemmings = { game: { showDebug: false } };

/** Simple stub to track instantiations */
class StubAnimation {
  constructor() { StubAnimation.count++; }
  loadFromFile() {}
}
StubAnimation.count = 0;

describe('LemmingsSprite animation retrieval', function () {
  let origAnimation;

  beforeEach(function () {
    origAnimation = Lemmings.Animation;
    Lemmings.Animation = StubAnimation;
    StubAnimation.count = 0;
  });

  afterEach(function () {
    Lemmings.Animation = origAnimation;
  });

  it('reuses cached animations for the same palette', function () {
    const palette = {};
    const sprite1 = new LemmingsSprite({}, palette);
    const sprite2 = new LemmingsSprite({}, palette);

    const anim1 = sprite1.getAnimation(Lemmings.SpriteTypes.WALKING, true);
    const anim2 = sprite2.getAnimation(Lemmings.SpriteTypes.WALKING, true);

    expect(anim1).to.equal(anim2);
    // only one animation should be created
    expect(StubAnimation.count).to.be.greaterThan(0);
    expect(StubAnimation.count).to.be.below(100); // sanity
  });

  it('exposes palette and animation table via getters', function () {
    const palette = {};
    const sprite = new LemmingsSprite({}, palette);

    expect(sprite.colorPalette).to.equal(palette);

    const list1 = sprite.lemmingAnimation;
    list1[0] = 'changed';
    const list2 = sprite.lemmingAnimation;

    expect(list2[0]).to.not.equal('changed');
    expect(list2).to.have.length.greaterThan(0);
  });
});
