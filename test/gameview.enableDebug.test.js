import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';

class KeyboardShortcutsStub { constructor() {} dispose() {} }
class GameFactoryMock { async getGame() { return {}; } }

function createWindowStub() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

describe('GameView.enableDebug', function() {
  before(function() {
    global.window = createWindowStub();
    Lemmings.KeyboardShortcuts = KeyboardShortcutsStub;
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });
  after(function() {
    delete global.window;
  });

  it('forwards to the game when available', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    let called = 0;
    view.game = { setDebugMode(v) { called++; this.val = v; } };

    view.enableDebug();

    expect(called).to.equal(1);
    expect(view.game.val).to.equal(true);

    view.game = null;
    view.enableDebug();
    expect(called).to.equal(1);
  });
});
