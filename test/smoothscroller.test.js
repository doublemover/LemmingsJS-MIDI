import { expect } from 'chai';
import { SmoothScroller } from '../js/GameGui.js';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('SmoothScroller', function() {
  it('clamps impulse magnitude and velocity', function() {
    const ss = new SmoothScroller();
    ss.addImpulse(0);
    expect(ss.velocity).to.equal(0);
    ss.addImpulse(1000);
    expect(ss.velocity).to.equal(500);
    ss.velocity = 490;
    ss.addImpulse(20);
    expect(ss.velocity).to.equal(500);
    ss.velocity = -490;
    ss.addImpulse(-20);
    expect(ss.velocity).to.equal(-500);
  });

  it('decays velocity and triggers event', function() {
    const ss = new SmoothScroller();
    let seen = null;
    ss.onHasVelocity.on(v => { seen = v; });
    ss.addImpulse(10);
    ss.update();
    expect(seen).to.be.a('number');
    const before = ss.velocity;
    ss.update();
    expect(ss.velocity).to.be.below(before);
  });
});
