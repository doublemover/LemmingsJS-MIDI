import { expect } from 'chai';
import fakeTimers from '@sinonjs/fake-timers';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';

// minimal global setup
globalThis.lemmings = { game: { showDebug: false } };

describe('KeyboardShortcuts event paths', function() {
  let clock;
  let win;
  let view;
  let ks;

  beforeEach(function() {
    win = {
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(cb) { win.cb = cb; return 1; },
      cancelAnimationFrame() {}
    };
    global.window = win;
    global.requestAnimationFrame = win.requestAnimationFrame;
    clock = fakeTimers.withGlobal(globalThis).install({
      now: 0,
      toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date','performance']
    });
    view = {
      levelGroupIndex: 0,
      gameType: 1,
      gameResources: { getLevelGroups() { return [1,2]; } },
      moveCalls: 0,
      selectCalls: [],
      moveToLevel(n) { this.moveCalls++; this.moveArg = n; },
      selectLevelGroup(i) { this.selectCalls.push(['group', i]); this.levelGroupIndex = i; },
      selectGameType(t) { this.selectCalls.push(['type', t]); this.gameType = t; },
      game: { getGameTimer() { return {}; }, gameGui: {} }
    };
    ks = new KeyboardShortcuts(view);
  });

  afterEach(function() {
    clock.uninstall();
    delete global.window;
    delete global.requestAnimationFrame;
  });

  it('starts the animation loop', function() {
    expect(ks._raf).to.equal(null);
    ks._startLoop();
    expect(ks._raf).to.equal(1);
    expect(ks._last).to.equal(0);
    ks._startLoop();
    expect(ks._raf).to.equal(1);
  });

  it('selects previous level group with Shift+Comma', function() {
    view.levelGroupIndex = 2;
    let prevented = false;
    const evt = { code: 'Comma', shiftKey: true, ctrlKey: false, metaKey: false,
      preventDefault() { prevented = true; } };
    ks._onKeyDown(evt);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.selectCalls).to.deep.equal([['group', 1]]);
    expect(prevented).to.be.true;
  });

  it('selects previous game type when first group with Shift+Comma', function() {
    view.levelGroupIndex = 0;
    view.gameType = 2;
    let prevented = false;
    const evt = { code: 'Comma', shiftKey: true, ctrlKey: false, metaKey: false,
      preventDefault() { prevented = true; } };
    ks._onKeyDown(evt);
    expect(view.gameType).to.equal(1);
    expect(view.selectCalls).to.deep.equal([['type', 1]]);
    expect(prevented).to.be.true;
  });

  it('selects next level group with Shift+Period', function() {
    view.levelGroupIndex = 0;
    let prevented = false;
    const evt = { code: 'Period', shiftKey: true, ctrlKey: false, metaKey: false,
      preventDefault() { prevented = true; } };
    ks._onKeyDown(evt);
    expect(view.levelGroupIndex).to.equal(1);
    expect(view.selectCalls).to.deep.equal([['group', 1]]);
    expect(prevented).to.be.true;
  });

  it('advances game type when last group with Shift+Period', function() {
    view.levelGroupIndex = 1;
    view.gameType = 1;
    let prevented = false;
    const evt = { code: 'Period', shiftKey: true, ctrlKey: false, metaKey: false,
      preventDefault() { prevented = true; } };
    ks._onKeyDown(evt);
    expect(view.gameType).to.equal(2);
    expect(view.selectCalls).to.deep.equal([['type', 2]]);
    expect(prevented).to.be.true;
  });

  it('ignores unknown keys', function() {
    let prevented = false;
    const evt = { code: 'F1', shiftKey: false, ctrlKey: false, metaKey: false,
      preventDefault() { prevented = true; } };
    ks._onKeyDown(evt);
    expect(prevented).to.be.false;
  });
});
