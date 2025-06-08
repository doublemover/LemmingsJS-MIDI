import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/ViewPoint.js';
import '../js/GameDisplay.js';

class KeyboardShortcutsStub {
  constructor() {}
  dispose() {}
}

class StageStub {
  constructor() {
    this.gameDisplay = {
      clearCalled: 0,
      redrawCalled: 0,
      setScreenPositionArgs: null,
      clear() { this.clearCalled++; },
      setScreenPosition(x, y) { this.setScreenPositionArgs = [x, y]; },
      redraw() { this.redrawCalled++; }
    };
  }
  getGameDisplay() { return this.gameDisplay; }
  getGuiDisplay() { return {}; }
  setCursorSprite() {}
  updateStageSize() {}
  resetFade() { this.resetCalled = (this.resetCalled || 0) + 1; }
}

class GameFactoryStub {
  async getGame() { return {}; }
  async getGameResources() { return {}; }
  get configReader() { return { configs: Promise.resolve([]) }; }
}

describe('GameView.loadLevel missing level', function () {
  let origStage;
  let origFactory;
  let origKeyboard;
  before(function () {
    global.window = {
      location: { search: '' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    origStage = Lemmings.Stage;
    origFactory = Lemmings.GameFactory;
    origKeyboard = Lemmings.KeyboardShortcuts;
    Lemmings.Stage = StageStub;
    Lemmings.GameFactory = GameFactoryStub;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsStub;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { UNKNOWN: 0, 0: 'unknown', toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });

  after(function () {
    delete global.window;
    Lemmings.Stage = origStage;
    Lemmings.GameFactory = origFactory;
    Lemmings.KeyboardShortcuts = origKeyboard;
  });

  it('returns early when getLevel returns null', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    let started = false;
    let updated = false;
    view.start = async () => {
      started = true;
    };
    view.updateQuery = () => {
      updated = true;
    };
    view.gameResources = {
      getLevel: async () => null,
      getLevelGroups: () => []
    };
    await view.loadLevel();
    expect(started).to.be.false;
    expect(updated).to.be.false;
  });
});
