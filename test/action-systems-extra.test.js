import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionExitingSystem } from '../js/ActionExitingSystem.js';
import { ActionFryingSystem } from '../js/ActionFryingSystem.js';
import '../js/LemmingStateType.js';
import '../js/SpriteTypes.js';

// minimal globals
globalThis.lemmings = { game: { showDebug: false, lemmingManager: { miniMap: { addDeath() {} } } } };

const stubSprites = { getAnimation: () => ({ getFrame() { return {}; } }) };

class StubDisplay {
  constructor() { this.calls = []; }
  drawFrame(frame, x, y) { this.calls.push({ frame, x, y }); }
}

class StubLemming {
  constructor() { this.x = 0; this.y = 0; this.lookRight = true; this.frameIndex = 0; this.disabled = false; }
  getDirection() { return this.lookRight ? 'right' : 'left'; }
  disable() { this.disabled = true; }
}

class StubLevel { hasGroundAt() { return false; } }
class StubGVC { constructor(){ this.count=0; } addSurvivor(){ this.count++; } }

describe('extra action system coverage', function() {
  it('ActionExitingSystem triggers, draws and exits', function() {
    const gvc = new StubGVC();
    const sys = new ActionExitingSystem(stubSprites, gvc);
    const lem = new StubLemming();
    const disp = new StubDisplay();
    expect(sys.triggerLemAction(lem)).to.equal(false);
    sys.draw(disp, lem);
    lem.frameIndex = 7;
    const res = sys.process(new StubLevel(), lem);
    expect(res).to.equal(Lemmings.LemmingStateType.OUT_OF_LEVEL);
    expect(gvc.count).to.equal(1);
    expect(disp.calls).to.have.lengthOf(1);
  });

  it('ActionFryingSystem triggers, draws and turns around', function() {
    const sys = new ActionFryingSystem(stubSprites);
    const lem = new StubLemming();
    const disp = new StubDisplay();
    expect(sys.triggerLemAction(lem)).to.equal(false);
    sys.draw(disp, lem);
    const lvl = new StubLevel();
    sys.process(lvl, lem); // move right
    lvl.hasGroundAt = () => true;
    sys.process(lvl, lem); // turn around
    expect(lem.lookRight).to.equal(false);
    expect(disp.calls).to.have.lengthOf(1);
  });
});
