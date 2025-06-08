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
    delete lemmings.suspendWithColor;
    lemmings.bench = false;
    lemmings.endless = false;
    delete lemmings.stage;
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

  it('benchSpeedAdjust lowers speed without pausing when far behind', function() {
    lemmings.bench = true;
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    lemmings.stage = { guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } }, startOverlayFade() {} };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();
    clock.tick(1200);
    raf(clock.now);
    expect(timer.speedFactor).to.be.below(1);
    expect(timer.isRunning()).to.equal(true);
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

  it('pause/resume via visibilitychange stops ticks', function() {
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    const timer = new GameTimer({ timeLimit: 1 });
    const handler = visHandler;
    let count = 0;
    timer.onGameTick.on(() => { count++; });
    timer.continue();
    clock.tick(240);
    raf(clock.now);
    expect(count).to.equal(4);

    document.visibilityState = 'hidden';
    handler();
    clock.tick(240);
    expect(count).to.equal(4);

    document.visibilityState = 'visible';
    handler();
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    clock.tick(240);
    raf(clock.now);
    expect(count).to.equal(8);
  });

  it('catchupSpeedAdjust scales across repeated delays', function() {
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    clock.tick(120);
    raf(clock.now);
    expect(timer.speedFactor).to.be.closeTo(0.5, 0.0001);

    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    clock.tick(240);
    raf(clock.now);
    expect(timer.speedFactor).to.be.closeTo(0.25, 0.0001);

    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    clock.tick(60);
    raf(clock.now);
    expect(timer.speedFactor).to.equal(1);
  });

  it('benchSpeedAdjust pauses when over 100 queued frames', function() {
    lemmings.bench = true;
    let raf;
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    lemmings.stage = { guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } }, startOverlayFade() {} };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    clock.tick(6100);
    raf(clock.now);

    expect(timer.isRunning()).to.equal(false);
    expect(timer.speedFactor).to.be.closeTo(0.1, 0.0001);
  });

  it('benchSpeedAdjust triggers overlay fade with a color', function() {
    lemmings.bench = true;
    let raf;
    const calls = [];
    window.requestAnimationFrame = cb => { raf = cb; return 1; };
    lemmings.stage = {
      guiImgProps: { x: 0, y: 0, viewPoint: { scale: 1 } },
      startOverlayFade(color) { calls.push(color); }
    };
    const timer = new GameTimer({ timeLimit: 1 });
    timer.continue();

    clock.tick(1200);
    raf(clock.now);

    expect(calls.length).to.equal(1);
    expect(calls[0]).to.match(/^rgba\(/);
  });

  it('stop disposes and nulls event handlers', function() {
    const timer = new GameTimer({ timeLimit: 1 });
    timer.stop();
    expect(timer.onBeforeGameTick).to.equal(null);
    expect(timer.onGameTick).to.equal(null);
    expect(timer.eachGameSecond).to.equal(null);
  });

  it('tick steps once without starting the loop', function() {
    let rafCalled = false;
    window.requestAnimationFrame = () => { rafCalled = true; return 1; };
    const timer = new GameTimer({ timeLimit: 1 });
    let before = 0;
    let after = 0;
    timer.onBeforeGameTick.on(() => { before++; });
    timer.onGameTick.on(() => { after++; });
    timer.tick();
    expect(before).to.equal(1);
    expect(after).to.equal(1);
    expect(timer.isRunning()).to.equal(false);
    expect(rafCalled).to.equal(false);
  });
});
