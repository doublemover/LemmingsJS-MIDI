import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameTimer } from '../js/GameTimer.js';
import fakeTimers from '@sinonjs/fake-timers';

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class StageMock {
  constructor() { this.guiImgProps = { x:0, y:0, viewPoint:{ scale:1 }}; }
  getGameDisplay() { return {}; }
  getGuiDisplay() { return {}; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
  startFadeOut() {}
  startOverlayFade() {}
}

class GameMock {
  constructor() {
    this.timer = new GameTimer({ timeLimit: 1 });
    this.lemmingManager = { spawnCount:0, getLemmings: () => new Array(this.lemmingManager.spawnCount) };
    this.level = { width:100, height:50, entrances:[], screenPositionX:0, render(){} };
    this.onGameEnd = new Lemmings.EventHandler();
  }
  async loadLevel() {}
  setGameDisplay() {}
  setGuiDisplay() {}
  start() { this.timer.continue(); }
  getCommandManager() { return { loadReplay(){} }; }
  getGameTimer() { return this.timer; }
  getLemmingManager() { return this.lemmingManager; }
}

class GameResourcesMock {
  async getLevel() { return { width:100, height:50, screenPositionX:0, entrances:[], render(){}}; }
  getLevelGroups() { return [0]; }
}

class GameFactoryMock {
  async getGame() { return new GameMock(); }
  async getGameResources() { return new GameResourcesMock(); }
  get configReader() { return { configs: Promise.resolve([{ name:'test', gametype:1 }]) }; }
}

describe('bench sequence', function() {
  let clock;
  let origStage, origKeyboard, origFactory;
  before(function() {
    global.window = { location:{ search:'' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
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
  beforeEach(function(){ clock = fakeTimers.withGlobal(globalThis).install({ now:0 }); });
  afterEach(function(){ clock.uninstall(); });
  after(function(){
    delete global.window;
    Lemmings.Stage = origStage;
    Lemmings.KeyboardShortcuts = origKeyboard;
    Lemmings.GameFactory = origFactory;
  });

  it('pauses and logs before restarting', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    view.benchSequence = true;
    const logs = [];
    const orig = console.log; console.log = m => logs.push(m);
    await view.setup();

    let timer = view.game.getGameTimer();
    expect(timer.speedFactor).to.equal(6);
    timer.speedFactor = 0.9;
    timer.eachGameSecond.trigger();
    await Promise.resolve();

    expect(logs[0]).to.equal(10);
    timer = view.game.getGameTimer();
    timer.speedFactor = 0.9;
    timer.eachGameSecond.trigger();
    await Promise.resolve();
    expect(logs[1]).to.equal(5);

    console.log = orig;
  });
});
