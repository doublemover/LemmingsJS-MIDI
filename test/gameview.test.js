import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/DisplayImage.js';
import { GameView } from '../js/GameView.js';

// minimal window for GameView.applyQuery and KeyboardShortcuts stub
function createWindow() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

// stub KeyboardShortcuts to avoid DOM access
class KeyboardShortcutsMock {
  constructor() {}
  dispose() {}
}

// stub Stage with basic displays and event wiring
class StageMock {
  constructor(canvas) {
    this.canvas = canvas;
    this.controller = {
      onMouseDown: new Lemmings.EventHandler(),
      onMouseUp: new Lemmings.EventHandler(),
      onMouseRightDown: new Lemmings.EventHandler(),
      onMouseRightUp: new Lemmings.EventHandler(),
      onMouseMove: new Lemmings.EventHandler(),
      onDoubleClick: new Lemmings.EventHandler(),
      onZoom: new Lemmings.EventHandler()
    };
    this.gameDisplay = new Lemmings.DisplayImage(this);
    this.guiDisplay = new Lemmings.DisplayImage(this);
    this.controller.onMouseDown.on(e => this.gameDisplay.onMouseDown.trigger(e));
    this.controller.onMouseUp.on(e => this.gameDisplay.onMouseUp.trigger(e));
    this.controller.onMouseRightDown.on(e => this.gameDisplay.onMouseRightDown.trigger(e));
    this.controller.onMouseRightUp.on(e => this.gameDisplay.onMouseRightUp.trigger(e));
    this.controller.onMouseMove.on(e => this.gameDisplay.onMouseMove.trigger(e));
    this.controller.onDoubleClick.on(e => this.gameDisplay.onDoubleClick.trigger(e));
  }
  getGameDisplay() { return this.gameDisplay; }
  getGuiDisplay() { return this.guiDisplay; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
  startFadeOut() {}
}

// simple Game stub used by GameFactory
class GameMock {
  constructor() {
    this.commandManager = { loadReplay() {} };
    this.gameTimer = { speedFactor: 1 };
    this.gameResources = { getCursorSprite: () => Promise.resolve(null) };
    this.onGameEnd = new Lemmings.EventHandler();
    this.setGameDisplayArgs = null;
    this.setGuiDisplayArgs = null;
    this.startCalled = false;
  }
  async loadLevel() {}
  setGameDisplay(d) { this.setGameDisplayArgs = d; }
  setGuiDisplay(d) { this.setGuiDisplayArgs = d; }
  start() { this.startCalled = true; }
  getCommandManager() { return this.commandManager; }
  getGameTimer() { return this.gameTimer; }
}

class GameFactoryMock {
  async getGame() { return new GameMock(); }
  async getGameResources() { return {}; }
  get configReader() { return { configs: Promise.resolve([]) }; }
}

// override engine classes
Lemmings.Stage = StageMock;
Lemmings.GameFactory = GameFactoryMock;
Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
Lemmings.GameTypes = { toString: () => '' };
Lemmings.GameStateTypes = { toString: () => '' };

global.lemmings = { game: { showDebug: false } };

describe('GameView', function () {
  beforeEach(function () {
    global.window = createWindow();
  });
  afterEach(function () {
    delete global.window;
  });
  it('initializes stage and connects displays', async function () {
    const view = new GameView();
    const canvas = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 480 }; }
    };

    view.gameCanvas = canvas;

    expect(view.stage).to.be.instanceOf(StageMock);
    const gameDisplay = view.stage.getGameDisplay();
    const guiDisplay = view.stage.getGuiDisplay();

    expect(gameDisplay).to.be.instanceOf(Lemmings.DisplayImage);
    expect(guiDisplay).to.be.instanceOf(Lemmings.DisplayImage);

    expect(view.stage.controller.onMouseDown.handlers.size).to.be.greaterThan(0);
    expect(gameDisplay.onMouseDown).to.be.instanceOf(Lemmings.EventHandler);

    await view.start();
    const game = view.game;
    expect(game.setGameDisplayArgs).to.equal(gameDisplay);
    expect(game.setGuiDisplayArgs).to.equal(guiDisplay);
    expect(game.startCalled).to.be.true;
  });
});
