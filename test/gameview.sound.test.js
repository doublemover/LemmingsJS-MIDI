import { Lemmings } from '../js/LemmingsNamespace.js';

class GameFactoryStub { constructor() {} }

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
  });

  afterEach(function() {
    delete global.window;
    delete global.history;
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
