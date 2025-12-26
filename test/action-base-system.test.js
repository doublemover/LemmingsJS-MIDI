import { expect } from 'chai';
import { Lemmings } from './helpers/lemmings.js';
import { ActionBaseSystem } from '../js/actions/ActionBaseSystem.js';
import '../js/lemmings/SpriteTypes.js';
import '../js/render/MaskTypes.js';

// minimal global environment for logging
globalThis.lemmings = { game: { showDebug: false } };

class StubAnimation {
  constructor(label) { this.label = label; }
  getFrame(idx) { return `${this.label}-${idx}`; }
}

class StubSprites {
  constructor() { this.calls = []; }
  getAnimation(type, right) {
    this.calls.push({ type, right });
    return new StubAnimation(`sprite-${type}-${right}`);
  }
}

class StubMasks {
  GetMask(type) { return `mask-${type}`; }
}

class StubLemming {
  constructor() {
    this.action = null;
    this.frameIndex = 0;
    this.x = 0;
    this.y = 0;
    this.lookRight = true;
  }
  getDirection() { return this.lookRight ? 'right' : 'left'; }
  setAction(act) { this.action = act; }
}

class StubDisplay {
  constructor() { this.calls = []; }
  drawFrame(frame, x, y) { this.calls.push({ frame, x, y }); }
}

describe('ActionBaseSystem', function() {
  beforeEach(function() {
    ActionBaseSystem.spriteCache = new WeakMap();
    ActionBaseSystem.maskCache = new WeakMap();
  });

  it('reuses sprite and mask caches for identical options', function() {
    const sprites = new StubSprites();
    const masks = new StubMasks();

    const opts = {
      sprites,
      spriteType: Lemmings.SpriteTypes.WALKING,
      masks,
      maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R },
      actionName: 'test'
    };

    const a1 = new ActionBaseSystem(opts);
    const a2 = new ActionBaseSystem(opts);

    expect(a1.sprites).to.equal(a2.sprites);
    expect(a1.masks).to.equal(a2.masks);
  });

  it('triggerLemAction assigns action', function() {
    const sys = new ActionBaseSystem();
    const lem = new StubLemming();

    const result = sys.triggerLemAction(lem);
    expect(result).to.equal(true);
    expect(lem.action).to.equal(sys);
  });

  it('draw chooses correct frame based on direction', function() {
    const sprites = new StubSprites();
    const sys = new ActionBaseSystem({ sprites, spriteType: Lemmings.SpriteTypes.WALKING });
    const display = new StubDisplay();
    const lem = new StubLemming();
    lem.frameIndex = 2;

    lem.lookRight = true;
    sys.draw(display, lem);
    lem.lookRight = false;
    sys.draw(display, lem);

    expect(display.calls[0]).to.deep.equal({ frame: 'sprite-0-true-2', x: 0, y: 0 });
    expect(display.calls[1]).to.deep.equal({ frame: 'sprite-0-false-2', x: 0, y: 0 });
  });

  it('draw uses single sprite when configured', function() {
    const sprites = new StubSprites();
    const sys = new ActionBaseSystem({
      sprites,
      spriteType: Lemmings.SpriteTypes.FRYING,
      singleSprite: true
    });
    const display = new StubDisplay();
    const lem = new StubLemming();
    lem.frameIndex = 3;

    sys.draw(display, lem);

    expect(display.calls[0]).to.deep.equal({
      frame: `sprite-${Lemmings.SpriteTypes.FRYING}-false-3`,
      x: 0,
      y: 0
    });
  });

  it('caches separately for different action names', function() {
    const sprites = new StubSprites();
    const masks = new StubMasks();

    const opts1 = {
      sprites,
      spriteType: Lemmings.SpriteTypes.WALKING,
      masks,
      maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R },
      actionName: 'a1'
    };
    const opts2 = { ...opts1, actionName: 'a2' };

    const a1 = new ActionBaseSystem(opts1);
    const a2 = new ActionBaseSystem(opts2);

    expect(a1.sprites).to.not.equal(a2.sprites);
    expect(a1.masks).to.not.equal(a2.masks);
  });

  it('singleSprite caches under both key', function() {
    const sprites = new StubSprites();
    const masks = new StubMasks();

    const opts = {
      sprites,
      spriteType: Lemmings.SpriteTypes.FRYING,
      singleSprite: true,
      masks,
      maskTypes: Lemmings.MaskTypes.EXPLODING,
      actionName: 'single'
    };

    const sys = new ActionBaseSystem(opts);

    expect(Array.from(sys.sprites.keys())).to.deep.equal(['both']);
    expect(Array.from(sys.masks.keys())).to.deep.equal(['both']);
    expect(sprites.calls.some(c => c.right === true)).to.equal(false);
  });

  it('getActionName returns the configured action name', function() {
    const sys = new ActionBaseSystem();
    expect(sys.getActionName()).to.equal('');
    sys.actionName = 'walking';
    expect(sys.getActionName()).to.equal('walking');
  });

  it('draw exits early when sprites are missing', function() {
    const sys = new ActionBaseSystem();
    const display = new StubDisplay();
    const lem = new StubLemming();
    sys.draw(display, lem);
    expect(display.calls).to.have.length(0);
  });
});
