import { expect } from 'chai';
import { setDependency, resetDependencies, useGlobalLemmings } from './helpers/lemmings.js';
import { GameView } from '../js/game/GameView.js';

describe('GameView benchReverse flags', function() {
  const originalWindow = globalThis.window;
  useGlobalLemmings({});

  beforeEach(function() {
    setDependency('GameFactory', class { constructor() {} });
    setDependency('KeyboardShortcuts', class { constructor() {} });
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
  });

  it('honors benchReverse when it is the only bench flag', function() {
    globalThis.window = { location: { search: '?benchReverse=true' } };
    const view = new GameView();
    expect(view.benchReverse).to.equal(true);
    expect(view.bench).to.equal(false);
    expect(view.bench2).to.equal(false);
    expect(view.benchSequence).to.equal(false);
  });

  it('disables benchReverse when other bench flags are set', function() {
    globalThis.window = {
      location: { search: '?benchReverse=true&bench=true&bench2=true&benchSequence=true' }
    };
    const view = new GameView();
    expect(view.benchReverse).to.equal(false);
    expect(view.bench).to.equal(true);
    expect(view.bench2).to.equal(true);
    expect(view.benchSequence).to.equal(true);
  });

  it('keeps benchReverse enabled under perf profile when no other bench flags are set', function() {
    globalThis.window = {
      location: { search: '?profile=perf&benchReverse=true' }
    };
    const view = new GameView();
    expect(view.startupProfile).to.equal('perf');
    expect(view.benchReverse).to.equal(true);
    expect(view.performanceAPI).to.equal(true);
    expect(view.perfOverlay).to.equal(true);
  });
});
