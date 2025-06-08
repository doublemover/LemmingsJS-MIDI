import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import { GameTimer } from '../js/GameTimer.js';
import fakeTimers from '@sinonjs/fake-timers';

class KeyboardShortcutsMock { constructor() {} dispose() {} }
class StageMock {
  constructor() {
    this.guiImgProps = { x:0, y:0, viewPoint:{ scale:1 }};
    this.gameImgProps = { viewPoint: { scale: 1 } };
  }
  getGameDisplay() { return { clear() {}, setScreenPosition() {}, redraw() {} }; }
  getGuiDisplay() { return {}; }
  setCursorSprite() {}
  updateStageSize() {}
  clear() {}
  redraw() {}
  resetFade() {}
  startFadeOut() {}
  startOverlayFade() {}
  applyViewport() {}
}

class LemmingManagerMock {
  constructor() { this._spawnCount = 0; this.spawnTotal = 0; }
  get spawnCount() { return this._spawnCount; }
  set spawnCount(v) { this._spawnCount = v; this.spawnTotal += v; }
  getLemmings() { return new Array(this._spawnCount); }
}

class GameMock {
  constructor() {
    this.timer = new GameTimer({ timeLimit: 1 });
    this.lemmingManager = new LemmingManagerMock();
    this.level = {
      width: 100,
      height: 50,
      entrances: [],
      triggers: [],
      screenPositionX: 0,
      getGroundMaskLayer() { return { hasGroundAt() { return false; } }; },
      render() {}
    };
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
  async getConfig() { return { level: { order: [[0]], getGroupLength(){return 1;} } }; }
  async getGameResources() { return new GameResourcesMock(); }
  get configReader() { return { configs: Promise.resolve([{ name:'test', gametype:1 }]) }; }
}

describe('bench sequence', function() {
  let clock;
  let origStage, origKeyboard, origFactory;
  before(function() {
    function createDocumentStub() {
      return {
        createElement() {
          const ctx = { canvas:{}, fillRect() {}, drawImage() {}, putImageData() {}, createImageData(w, h) { return { width:w, height:h, data:new Uint8ClampedArray(w*h*4) }; } };
          return { width:0, height:0, getContext() { ctx.canvas = this; return ctx; } };
        },
        querySelector() { return null; },
        addEventListener() {},
        removeEventListener() {},
        visibilityState: 'visible',
        hasFocus() { return true; }
      };
    }
    global.document = createDocumentStub();
    global.window = {
      location: { search: '' },
      setTimeout,
      clearTimeout,
      requestAnimationFrame() {},
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {}
    };
    global.history = { replaceState() {} };
    origStage = Lemmings.Stage;
    origKeyboard = Lemmings.KeyboardShortcuts;
    origFactory = Lemmings.GameFactory;
    Lemmings.Stage = StageMock;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsMock;
    Lemmings.GameFactory = GameFactoryMock;
    Lemmings.GameTypes = { toString: () => '' };
    Lemmings.GameStateTypes = { toString: () => '' };
    Lemmings.TriggerTypes = { DROWN: 0, FRYING: 1, KILL: 2, TRAP: 3 };
    Lemmings.Lemming = { LEM_MAX_FALLING: 59 };
    global.lemmings = { game: { showDebug: false } };
  });
  beforeEach(function(){ clock = fakeTimers.withGlobal(globalThis).install({ now:0 }); });
  afterEach(function(){ clock.uninstall(); });
  after(function(){
    delete global.window;
    delete global.document;
    delete global.history;
    Lemmings.Stage = origStage;
    Lemmings.KeyboardShortcuts = origKeyboard;
    Lemmings.GameFactory = origFactory;
  });

  it('pauses and logs before restarting', async function() {
    const { GameView } = await import('../js/GameView.js');
    const view = new GameView();
    view.gameCanvas = {};
    view.elementSelectGameType = { options: [], remove() {}, appendChild() {}, selectedIndex: 0 };
    view.elementSelectLevelGroup = { options: [], remove() {}, appendChild() {}, selectedIndex: 0 };
    view.elementSelectLevel = { options: [], remove() {}, appendChild() {}, selectedIndex: 0 };
    view.benchSequence = false;
    await view.setup();

    view.game = new GameMock();
    view.game.stop = function() {};
    view.loadLevel = async () => { view.game = new GameMock(); };
    view.benchSequence = true;
    view._benchCounts = [50, 25];
    view._benchIndex = 0;
    await view.benchStart(50);

    const timer = view.game.getGameTimer();
    timer.suspend();
    let suspended = 0;
    timer.suspend = () => { suspended++; };

    let nextCount;
    view.benchStart = async cnt => { nextCount = cnt; };

    const id = setInterval(() => timer.eachGameSecond.trigger(), 1000);

    timer.speedFactor = 8;
    clock.tick(1000);
    expect(view._benchMaxSpeed).to.equal(8);

    timer.speedFactor = 0.9;
    clock.tick(1000);

    clearInterval(id);

    expect(suspended).to.equal(1);
    expect(nextCount).to.equal(25);
  });
});
