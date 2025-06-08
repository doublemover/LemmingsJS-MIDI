import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameView } from '../js/GameView.js';

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
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });

  after(function() {
    delete global.window;
    Lemmings.KeyboardShortcuts = this.origKeyboard;
    Lemmings.GameFactory = this.origFactory;
  });

  it('forwards replay string to start', async function() {
    const view = new GameView();
    let arg = null;
    view.start = async function(a) { arg = a; };
    await view.loadReplay('foo');
    expect(arg).to.equal('foo');
  });
});
