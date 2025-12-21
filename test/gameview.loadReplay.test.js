import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';
import { GameView } from '../js/game/GameView.js';

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class GameFactoryMock { constructor() {} }

describe('GameView.loadReplay', function() {
  before(function() {
    global.window = {
      location: { search: '' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    this.origKeyboard = Lemmings.KeyboardShortcuts;
    this.origFactory = Lemmings.GameFactory;
    setDependency('KeyboardShortcuts', KeyboardShortcutsMock);
    setDependency('GameFactory', GameFactoryMock);
    setDependency('GameTypes', { toString: () => '' });
    global.lemmings = { game: { showDebug: false } };
  });

  after(function() {
    delete global.window;
    setDependency('KeyboardShortcuts', this.origKeyboard);
    setDependency('GameFactory', this.origFactory);
  });

  it('forwards replay string to start', async function() {
    const view = new GameView();
    let arg = null;
    view.start = async function(a) { arg = a; };
    await view.loadReplay('foo');
    expect(arg).to.equal('foo');
  });
});
