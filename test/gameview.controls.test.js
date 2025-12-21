import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import '../js/util/EventHandler.js';

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
  async getGame() { return {}; }
  async getGameResources() { return {}; }
  get configReader() { return { configs: Promise.resolve([]) }; }
}

describe('GameView game controls', function() {
  let origStage;
  let origKeyboard;
  let origFactory;
  before(function() {
    global.window = { location: { search: '' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
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

  it('relays cheat, suspend and continue to the game', async function() {
    const { GameView } = await import('../js/game/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    const timer = { suspendCalled: 0, continueCalled: 0, suspend() { this.suspendCalled++; }, continue() { this.continueCalled++; } };
    const game = { cheatCalled: 0, cheat() { this.cheatCalled++; }, getGameTimer() { return timer; } };
    view.game = game;
    view.cheat();
    view.suspend();
    view.continue();
    expect(game.cheatCalled).to.equal(1);
    expect(timer.suspendCalled).to.equal(1);
    expect(timer.continueCalled).to.equal(1);
  });

  it('does not throw when game is null', async function() {
    const { GameView } = await import('../js/game/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    view.game = null;
    expect(() => { view.cheat(); view.suspend(); view.continue(); }).to.not.throw();
  });
});
