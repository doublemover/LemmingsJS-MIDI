import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionCountdownSystem } from '../js/ActionCountdownSystem.js';
import '../js/LemmingStateType.js';

import '../js/MaskTypes.js';
class StubLemming {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.countdown = 0;
  }
  getCountDownTime() { return 8 - (this.countdown >> 4); }
  setCountDown(action) { this.lastAction = action; return true; }
}

class DummyDisplay {
  constructor() { this.calls = []; }
  drawMask(mask, x, y) { this.calls.push({ mask, x, y }); }
}

function stubMasks() {
  return {
    GetMask() {
      return { GetMask(n) { return `mask-${n}`; } };
    }
  };
}

describe('ActionCountdownSystem countdown flow', function() {
  beforeEach(function() {
    ActionCountdownSystem.numberMasks.clear();
  });

  it('triggerLemAction delegates to setCountDown', function() {
    const sys = new ActionCountdownSystem(stubMasks());
    const lem = new StubLemming();
    lem.setCountDown = function(arg) { this.calledWith = arg; return 'ret'; };
    const ret = sys.triggerLemAction(lem);
    expect(ret).to.equal('ret');
    expect(lem.calledWith).to.equal(sys);
  });

  it('draw shows remaining seconds when active', function() {
    const sys = new ActionCountdownSystem(stubMasks());
    const lem = new StubLemming();
    lem.countdown = 32; // -> count 6
    const disp = new DummyDisplay();
    sys.draw(disp, lem);
    expect(disp.calls[0]).to.deep.equal({ mask: 'mask-6', x: 0, y: 0 });

    disp.calls = [];
    lem.getCountDownTime = () => 0;
    sys.draw(disp, lem);
    expect(disp.calls.length).to.equal(0);
  });

  it('process decrements and triggers explosion at zero', function() {
    const sys = new ActionCountdownSystem(stubMasks());
    const lem = new StubLemming();
    lem.countdown = 2;
    expect(sys.process({}, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
    expect(lem.countdown).to.equal(1);

    lem.setCountDown = function(a) { this.explodedWith = a; };
    expect(sys.process({}, lem)).to.equal(Lemmings.LemmingStateType.OHNO);
    expect(lem.explodedWith).to.equal(null);

    expect(sys.process({}, lem)).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
  });
});
