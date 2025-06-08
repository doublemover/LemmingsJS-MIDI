import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/DisplayImage.js';
import '../js/ViewPoint.js';
import fakeTimers from '@sinonjs/fake-timers';
// prepare a minimal window object for GameView.applyQuery
function createWindowStub() {
  return {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

// minimal window for GameView.applyQuery and KeyboardShortcuts stub
function setupWindow() {
  global.window = {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

beforeEach(function() { globalThis.window = createWindowStub(); });
afterEach(function() { delete globalThis.window; });

import { GameView } from '../js/GameView.js';

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
    this.guiImgProps = { x: 10, y: 20, viewPoint: { scale: 2 } };
    this.controller.onMouseDown.on(e => this.gameDisplay.onMouseDown.trigger(e));
    this.controller.onMouseUp.on(e => this.gameDisplay.onMouseUp.trigger(e));
    this.controller.onMouseRightDown.on(e => this.gameDisplay.onMouseRightDown.trigger(e));
    this.controller.onMouseRightUp.on(e => this.gameDisplay.onMouseRightUp.trigger(e));
    this.controller.onMouseMove.on(e => this.gameDisplay.onMouseMove.trigger(e));
    this.controller.onDoubleClick.on(e => this.gameDisplay.onDoubleClick.trigger(e));
    this.updateStageSize();
  }
  getGameDisplay() { return this.gameDisplay; }
  getGuiDisplay() { return this.guiDisplay; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
  redraw() {}
  startFadeOut() {}
  startOverlayFade(color, rect) { this.overlayArgs = { color, rect }; }
  resetFade() { this.resetCalled = true; }
  setGameViewPointPosition() {}
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

describe('GameView', function () {
  before(function () {
    setupWindow();
    // override engine classes after all modules loaded
    this.origStage = Lemmings.Stage;
    Lemmings.Stage = StageMock;
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    global.lemmings = { game: { showDebug: false } };
  });

  after(function () {
    delete global.window;
    Lemmings.Stage = this.origStage;
  });
  it('initializes stage and connects displays', async function () {
    global.window = {
      location: { search: '' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    const { GameView } = await import('../js/GameView.js');
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

  it('calls updateStageSize when canvas is set', async function () {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    let called = 0;
    const orig = StageMock.prototype.updateStageSize;
    StageMock.prototype.updateStageSize = function () { called++; };

    const canvas = {
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };

    view.gameCanvas = canvas;

    expect(called).to.equal(1);
    StageMock.prototype.updateStageSize = orig;
  });

  it('rounds speed factor up when fraction is above .5', async function () {
    global.window = {
      location: { search: '?speed=2.6' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.gameSpeedFactor).to.equal(3);
  });

  it('rounds speed factor down when fraction is below .5', async function () {
    global.window = {
      location: { search: '?speed=2.2' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.gameSpeedFactor).to.equal(2);
  });

  it('keeps speed factor below or equal to one', async function () {
    global.window = {
      location: { search: '?speed=0.8' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.gameSpeedFactor).to.equal(0.8);
  });

  it('parses short speed flag from url', async function() {
    global.window = {
      location: { search: '?s=5' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.gameSpeedFactor).to.equal(5);
  });

  it('defaults to 1 when speed is out of range', async function() {
    global.window = {
      location: { search: '?speed=150' },
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    expect(view.gameSpeedFactor).to.equal(1);
  });

  it('suspendWithColor fades and resumes timer', async function() {
    const clock = fakeTimers.withGlobal(globalThis).install({ now: 0 });
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    view.bench = true;
    view.gameCanvas = {};
    const timer = { suspendCalled: 0, continueCalled: 0, suspend() { this.suspendCalled++; }, continue() { this.continueCalled++; } };
    view.game = { getGameTimer() { return timer; } };

    const stage = view.stage;
    view.suspendWithColor('green');

    const expected = {
      x: stage.guiImgProps.x + 160 * stage.guiImgProps.viewPoint.scale,
      y: stage.guiImgProps.y + 32 * stage.guiImgProps.viewPoint.scale,
      width: 16 * stage.guiImgProps.viewPoint.scale,
      height: 10 * stage.guiImgProps.viewPoint.scale
    };
    expect(stage.overlayArgs.rect).to.deep.equal(expected);
    expect(timer.suspendCalled).to.equal(1);
    clock.tick(2000);
    expect(timer.continueCalled).to.equal(1);
    clock.uninstall();
  });

  it('pointer to world coordinates respect scale', function() {
    const e = { x: 50, y: 70 };
    const scales = [1, 2, 0.5];
    const results = scales.map(sc => {
      const img = { x: 10, y: 20, viewPoint: new Lemmings.ViewPoint(3, 4, sc) };
      const localX = e.x - img.x;
      const localY = e.y - img.y;
      const x = Math.trunc(localX / sc) + Math.trunc(img.viewPoint.x);
      const y = Math.trunc(localY / sc) + Math.trunc(img.viewPoint.y);
      return { scale: sc, x, y };
    });

    expect(results[0]).to.deep.equal({ scale: 1, x: 43, y: 54 });
    expect(results[1]).to.deep.equal({ scale: 2, x: 23, y: 29 });
    expect(results[2]).to.deep.equal({ scale: 0.5, x: 83, y: 104 });
  });

  it('nextFrame ticks forward then renders', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const calls = [];
    const timer = { tick(v) { calls.push(['tick', v]); }, speedFactor: 1 };
    const game = { getGameTimer() { return timer; }, render() { calls.push(['render']); } };
    view.game = game;
    view.nextFrame();
    expect(calls).to.deep.equal([[ 'tick', 1 ], [ 'render' ]]);
  });

  it('prevFrame ticks backward then renders', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const calls = [];
    const timer = { tick(v) { calls.push(['tick', v]); }, speedFactor: 1 };
    const game = { getGameTimer() { return timer; }, render() { calls.push(['render']); } };
    view.game = game;
    view.prevFrame();
    expect(calls).to.deep.equal([[ 'tick', -1 ], [ 'render' ]]);
  });

  it('selectSpeedFactor updates timer speed', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    const timer = { tick() {}, speedFactor: 1 };
    view.game = { getGameTimer() { return timer; } };
    view.selectSpeedFactor(5);
    expect(view.gameSpeedFactor).to.equal(5);
    expect(timer.speedFactor).to.equal(5);
  });

  it('resetFade is called when loading a level', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    view.updateQuery = () => {};
    view.start = async () => {};
    view.gameResources = {
      getLevel: async () => ({ render() {}, screenPositionX: 0 }),
      getLevelGroups: () => []
    };
    await view.loadLevel();
    expect(view.stage.resetCalled).to.equal(true);
  });

  it('enableDebug forwards to the game', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    let called = 0;
    view.game = {
      setDebugMode(v) { called++; this.val = v; }
    };

    view.enableDebug();

    expect(called).to.equal(1);
    expect(view.game.val).to.equal(true);

    view.game = null;
    view.enableDebug();
    expect(called).to.equal(1);
  });
});
