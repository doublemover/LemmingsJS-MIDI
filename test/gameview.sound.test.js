import { Lemmings } from '../js/LemmingsNamespace.js';

class GameFactoryStub { constructor() {} }

class KeyboardShortcutsMock { constructor() {} dispose() {} }

globalThis.lemmings = { game: { showDebug: false } };

function createWindow() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

describe('GameView audio methods', function() {
  beforeEach(function() {
    global.window = createWindow();
    global.history = { replaceState() {} };
    Lemmings.GameFactory = GameFactoryStub;
    this.origKeyboard = Lemmings.KeyboardShortcuts;
    this.origGameTypes = Lemmings.GameTypes;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameTypes = { toString: () => '' };
  });

  afterEach(function() {
    delete global.window;
    delete global.history;
    Lemmings.KeyboardShortcuts = this.origKeyboard;
    Lemmings.GameTypes = this.origGameTypes;
  });

  it('playMusic and sound stubs execute without error', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.playMusic();
    view.stopMusic();
    view.stopSound();
    view.playSound();
  });
});
