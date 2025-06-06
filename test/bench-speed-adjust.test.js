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
    lemmings.stage = { guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } }, startOverlayFade() {} };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    clock.tick(1200); // more than 16 steps
    raf(clock.now);
    expect(timer.speedFactor).to.be.below(1);

  });

  it('scales thresholds with speedFactor', function() {
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    lemmings.stage = { guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } }, startOverlayFade() {} };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.speedFactor = 2; // faster game, lower slow threshold but min 10
    timer.continue();

    clock.tick(330); // 11 steps at 30ms
    raf(clock.now);
    expect(timer.speedFactor).to.be.below(2);
    timer.suspend();
    timer.speedFactor = 0.5;
    timer.continue();
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    clock.tick(1200); // 10 steps < threshold 32
    raf(clock.now);
    expect(timer.speedFactor).to.equal(0.5);
  });

  it('updates frameTime when speed changes', function() {
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    lemmings.stage = { guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } }, startOverlayFade() {} };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    clock.tick(1200); // trigger slowdown
    raf(clock.now);
    expect(timer.speedFactor).to.be.below(1);
    expect(timer.frameTime).to.equal(timer.TIME_PER_FRAME_MS / timer.speedFactor);
  });
});
