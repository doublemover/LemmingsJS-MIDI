import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameTimer } from '../js/GameTimer.js';
import fakeTimers from '@sinonjs/fake-timers';


describe('benchSpeedAdjust recovery', function() {
  let clock;

  beforeEach(function() {
    globalThis.lemmings = Lemmings;
    lemmings.bench = true;
    lemmings.endless = false;

    globalThis.document = {
      visibilityState: 'visible',
      hasFocus() { return true; },
      addEventListener() {},
      removeEventListener() {}
    };

    const win = globalThis;
    win.addEventListener = () => {};
    win.removeEventListener = () => {};
    win.requestAnimationFrame = () => {};
    win.cancelAnimationFrame = () => {};
    globalThis.window = win;

    clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
  });

  afterEach(function() {
    clock.uninstall();
    delete globalThis.window;
    delete globalThis.document;
  });

  it('lowers speed when far behind and restores after stable ticks', function() {
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    const timer = new GameTimer({ timeLimit: 1 });
    lemmings.suspendWithColor = () => {};
    timer.continue();

    clock.tick(1200); // more than 16 steps
    raf(clock.now);
    expect(timer.speedFactor).to.be.below(1);

    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    for (let i = 0; i < 40; ++i) {
      clock.tick(80);
      raf(clock.now);
      window.requestAnimationFrame = cb => { raf = cb; return 1; };
    }
    expect(timer.speedFactor).to.be.closeTo(1, 0.1);
  });
});
