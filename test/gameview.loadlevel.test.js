import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/ViewPoint.js';
import '../js/GameDisplay.js';
import fakeTimers from '@sinonjs/fake-timers';

class KeyboardShortcutsStub { constructor() {} dispose() {} }

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

describe('GameView.loadLevel', function() {
  let origStage;
  let origFactory;
  let origKeyboard;
  before(function() {
    global.window = { location: { search: '' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
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

  after(function() {
    delete global.window;
    Lemmings.Stage = origStage;
    Lemmings.GameFactory = origFactory;
    Lemmings.KeyboardShortcuts = origKeyboard;
  });

  it('returns early when resources are missing', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    let started = false;
    let updated = false;
    view.start = async () => { started = true; };
    view.updateQuery = () => { updated = true; };
    view.gameResources = null;
    await view.loadLevel();
    expect(started).to.be.false;
    expect(updated).to.be.false;
  });

  it('clears autoMoveTimer before loading', async function() {
    const clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    view.gameResources = { getLevel: async () => ({ render() {}, screenPositionX: 0 }), getLevelGroups: () => [] };
    view.updateQuery = () => {};
    view.start = async () => {};
    const id = setTimeout(() => {}, 10);
    let cleared = null;
    window.clearTimeout = t => { cleared = t; };
    view.autoMoveTimer = id;
    await view.loadLevel();
    expect(cleared).to.equal(id);
    expect(view.autoMoveTimer).to.equal(null);
    clock.uninstall();
  });

  it('syncs selects and redraws stage', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    view.configs = [{ gametype: 1 }, { gametype: 2 }];
    view.gameType = 2;
    view.levelGroupIndex = 1;
    view.levelIndex = 0;
    view.elementSelectGameType = { selectedIndex: 0 };
    view.elementSelectLevelGroup = { selectedIndex: 0 };
    view.elementSelectLevel = { selectedIndex: 0 };
    let updateCount = 0;
    let startCount = 0;
    view.updateQuery = () => { updateCount++; };
    view.start = async () => { startCount++; };
    const level = { render() { renderCalled = true; }, screenPositionX: 5 };
    let renderCalled = false;
    view.gameResources = {
      getLevel: async (g, l) => { expect(g).to.equal(1); expect(l).to.equal(0); return level; },
      getLevelGroups: () => ['a', 'b']
    };
    await view.loadLevel();
    expect(view.stage.resetCalled).to.equal(1);
    expect(view.stage.gameDisplay.redrawCalled).to.equal(1);
    expect(renderCalled).to.be.true;
    expect(view.elementSelectGameType.selectedIndex).to.equal(1);
    expect(view.elementSelectLevelGroup.selectedIndex).to.equal(1);
    expect(view.elementSelectLevel.selectedIndex).to.equal(0);
    expect(updateCount).to.equal(1);
    expect(startCount).to.equal(1);
  });
});
