import { expect } from 'chai';
import { setDependency, resetDependencies } from './helpers/lemmings.js';
import { GameView } from '../js/game/GameView.js';

describe('GameView benchReverse flags', function() {
  const originalWindow = globalThis.window;
  const originalLemmings = globalThis.lemmings;

  beforeEach(function() {
    setDependency('GameFactory', class { constructor() {} });
    setDependency('KeyboardShortcuts', class { constructor() {} });
  });

  afterEach(function() {
    resetDependencies();
    globalThis.window = originalWindow;
    globalThis.lemmings = originalLemmings;
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
});
