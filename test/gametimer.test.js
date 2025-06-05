import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameTimer } from '../js/GameTimer.js';
import fakeTimers from '@sinonjs/fake-timers';


describe('GameTimer', function() {
  let clock;
  let visHandler;
  beforeEach(function() {
    globalThis.lemmings = Lemmings;
    lemmings.bench = false;
    lemmings.endless = false;

    visHandler = undefined;
    globalThis.document = {
      visibilityState: 'visible',
      hasFocus() { return true; },
      addEventListener(evt, handler) {
        if (evt === 'visibilitychange') visHandler = handler;
      },
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
    visHandler = undefined;
  });

  it('emits ticks and stops when paused', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    let before = 0;
    let after = 0;
    timer.onBeforeGameTick.on(() => { before++; });
    timer.onGameTick.on(() => { after++; });

    timer.continue();
    clock.tick(240);

    expect(before).to.equal(4);
    expect(after).to.equal(4);

    timer.suspend();
    clock.tick(240);

    expect(before).to.equal(4);
    expect(after).to.equal(4);
  });

  it('auto pauses when document is hidden and resumes on visible', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    const handler = visHandler;
    timer.continue();
    expect(timer.isRunning()).to.equal(true);

    document.visibilityState = 'hidden';
    handler();
    expect(timer.isRunning()).to.equal(false);

    document.visibilityState = 'visible';
    handler();
    expect(timer.isRunning()).to.equal(true);
  });

  it('benchSpeedAdjust lowers speed and suspends when far behind', function() {
    lemmings.bench = true;
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();
    clock.tick(1200);
    raf(clock.now);
    expect(timer.speedFactor).to.be.below(1);
    expect(timer.isRunning()).to.equal(false);
  });

  it('catchupSpeedAdjust restores normal speed after delay', function() {
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();
    clock.tick(240);
    raf(clock.now);
    expect(timer.speedFactor).to.be.closeTo(0.25, 0.0001);
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    clock.tick(960);
    raf(clock.now);
    expect(timer.speedFactor).to.equal(1);
  });
});
