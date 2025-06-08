import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameView } from '../js/GameView.js';

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class StageMock {
  constructor() {}
  getGameDisplay() { return {}; }
  getGuiDisplay() { return {}; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
  startFadeOut() {}
  startOverlayFade() {}
}
class GameFactoryMock {
  constructor() { this.getGameCalls = 0; }
  async getGame() { this.getGameCalls++; return {}; }
  async getGameResources() { return {}; }
  get configReader() { return { configs: Promise.resolve([]) }; }
}

function createWindowStub() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

describe('GameView.start existing game', function() {
  let origStage;
  let origKeyboard;
  let origFactory;
  before(function() {
    global.window = createWindowStub();
    origStage = Lemmings.Stage;
    origKeyboard = Lemmings.KeyboardShortcuts;
    origFactory = Lemmings.GameFactory;
    Lemmings.Stage = StageMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });
  after(function() {
    delete global.window;
    Lemmings.Stage = origStage;
    Lemmings.KeyboardShortcuts = origKeyboard;
    Lemmings.GameFactory = origFactory;
  });
  it('continues current game and skips getGame', async function() {
    const view = new GameView();
    const factory = view.gameFactory;
    const game = { continueCalled: 0, continue() { this.continueCalled++; } };
    view.game = game;
    await view.start('abc');
    expect(game.continueCalled).to.equal(1);
    expect(factory.getGameCalls).to.equal(0);
  });
});
