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
    expect(ss.velocity).to.equal(50);

    ss.velocity = 490;
    ss.addImpulse(20);
    expect(ss.velocity).to.equal(500);

    ss.velocity = -490;
    ss.addImpulse(-20);
    expect(ss.velocity).to.equal(-500);
  });

  it('clamps negative impulses at -50', function() {
    const ss = new SmoothScroller();
    ss.addImpulse(-60);
    expect(ss.velocity).to.equal(-50);
  });

  it('never exceeds ±500', function() {
    const ss = new SmoothScroller();
    for (let i = 0; i < 30; i++) {
      ss.addImpulse(1000);
    }
    expect(ss.velocity).to.equal(500);
    for (let i = 0; i < 30; i++) {
      ss.addImpulse(-1000);
    }
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

  it('triggers event once when stopping', function() {
    const ss = new SmoothScroller();
    ss.friction = 0.5;
    ss.addImpulse(20);
    const events = [];
    ss.onHasVelocity.on(v => { events.push(v); });
    for (let i = 0; i < 10; i++) {
      ss.update();
    }
    expect(events.filter(v => v === 0)).to.have.lengthOf(1);
  });

  it('applies friction factor each update', function() {
    const ss = new SmoothScroller();
    ss.friction = 0.5;
    ss.addImpulse(10);
    ss.update();
    expect(ss.velocity).to.equal(5);
  });

  it('stops when velocity falls below threshold', function() {
    const ss = new SmoothScroller();
    ss.friction = 0.5;
    ss.minVelocity = 2;
    ss.addImpulse(3);
    ss.update();
    expect(ss.velocity).to.equal(0);
  });
});
