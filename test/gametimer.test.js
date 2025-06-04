import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameTimer } from '../js/GameTimer.js';
import fakeTimers from '@sinonjs/fake-timers';


describe('GameTimer', function() {
  let clock;
  beforeEach(function() {
    globalThis.lemmings = Lemmings;
    lemmings.bench = false;
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
});
