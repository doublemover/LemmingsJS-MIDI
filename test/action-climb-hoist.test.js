import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionClimbSystem } from '../js/ActionClimbSystem.js';
import { ActionHoistSystem } from '../js/ActionHoistSystem.js';
import '../js/LemmingStateType.js';
import '../js/SpriteTypes.js';

class StubLemming {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.lookRight = true;
    this.frameIndex = 0;
    this.canClimb = false;
  }
  getDirection() { return this.lookRight ? 'right' : 'left'; }
}

class StubLevel { hasGroundAt() { return false; } }

const stubSprites = new Map([['both', { getFrame() { return {}; } }]]);

class StubDisplay {
  constructor() { this.calls = []; }
  drawFrame(frame, x, y) { this.calls.push({ frame, x, y }); }
}

describe('climb and hoist triggers', function() {
  it('ActionClimbSystem.triggerLemAction toggles canClimb', function() {
    const sys = new ActionClimbSystem(stubSprites);
    const lem = new StubLemming();
    expect(sys.triggerLemAction(lem)).to.equal(true);
    expect(lem.canClimb).to.equal(true);
    expect(sys.triggerLemAction(lem)).to.equal(false);
    expect(lem.canClimb).to.equal(true);
  });

  it('ActionHoistSystem trigger and draw', function() {
    const sys = new ActionHoistSystem(stubSprites);
    const lem = new StubLemming();
    const disp = new StubDisplay();
    expect(sys.triggerLemAction(lem)).to.equal(false);
    sys.draw(disp, lem);
    expect(disp.calls).to.have.lengthOf(1);
  });
});
