import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';
import { GameView } from '../js/game/GameView.js';

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
    setDependency('Stage', StageMock);
    setDependency('KeyboardShortcuts', KeyboardShortcutsMock);
    setDependency('GameFactory', GameFactoryMock);
    setDependency('GameTypes', { toString: () => '' });
    setDependency('GameStateTypes', { toString: () => '' });
    global.lemmings = { game: { showDebug: false } };
  });
  after(function() {
    delete global.window;
    setDependency('Stage', origStage);
    setDependency('KeyboardShortcuts', origKeyboard);
    setDependency('GameFactory', origFactory);
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
