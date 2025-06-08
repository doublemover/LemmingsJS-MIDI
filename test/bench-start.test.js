import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/MapObject.js';
import '../js/Animation.js';
import '../js/Lemming.js';
import '../js/TriggerTypes.js';
import '../js/ObjectImageInfo.js';
import '../js/ColorPalette.js';

// simple level stub
class LevelStub {
  constructor() {
    this.width = 100;
    this.height = 50;
    this.objects = [];
    this.entrances = [{ x: 10, y: 10 }];
    this.triggers = [];
  }
  getGroundMaskLayer() { return { hasGroundAt() { return false; } }; }
  render() {}
}

// lemming manager stub
class LMStub {
  constructor() { this.spawnCount = 0; }
}

before(function() {
  global.window = globalThis.window = {
    location: { search: '' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame() {},
    cancelAnimationFrame() {}
  };
  global.document = globalThis.document = {
    visibilityState: 'visible',
    hasFocus() { return true; },
    createElement() { return { appendChild() {}, options: [], remove() {} }; },
    addEventListener() {},
    removeEventListener() {}
  };
  Lemmings.Stage = class { constructor() {} getGameDisplay() { return {}; } getGuiDisplay() { return {}; } updateStageSize() {} setCursorSprite() {} clear() {} startFadeOut() {} startOverlayFade() {} };
  Lemmings.KeyboardShortcuts = class { constructor() {} dispose() {} };
});

describe('benchStart basics', function() {
  it('adds entrance objects and configures timer', async function() {
    const { GameView } = await import('../js/GameView.js');
    Lemmings.Stage = class { constructor(){} getGameDisplay(){return{};} getGuiDisplay(){return{};} updateStageSize(){} setCursorSprite(){} clear(){} startFadeOut(){} startOverlayFade(){} };
    Lemmings.KeyboardShortcuts = class { constructor(){} dispose(){} };
    const level = new LevelStub();
    const objInfo = new Lemmings.ObjectImageInfo();
    objInfo.frames = [new Uint8Array(1)];
    objInfo.width = 1; objInfo.height = 1; objInfo.palette = new Lemmings.ColorPalette();
    level.objects.push(new Lemmings.MapObject({ id: 1, x: 10, y: 10, drawProperties: 0 }, objInfo, new Lemmings.Animation(), 0));
    const timer = { speedFactor: 1, benchStartupFrames: 0, benchStableFactor: 1, getGameTime() { return 0; } };
    const lm = new LMStub();
    const view = new GameView();
    view._benchEntrancePool = [ { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 } ];
    view._benchBaseEntrances = level.entrances.slice();
    view.gameResources = { getLevelGroups() { return ['grp']; } };
    view.configs = [{ gametype: view.gameType, name: 'test' }];
    view.levelGroupIndex = 0;
    view.loadLevel = async () => { view.game = { level, getLemmingManager: () => lm, getGameTimer: () => timer }; };
    await view.benchStart(3);
    expect(level.entrances.length).to.equal(3);
    expect(lm.spawnCount).to.equal(3);
    expect(timer.speedFactor).to.equal(6);
    expect(timer.benchStartupFrames).to.equal(120);
    expect(timer.benchStableFactor).to.equal(8);
  });
});

after(function() {
  delete global.window;
  delete global.document;
  delete Lemmings.Stage;
  delete Lemmings.KeyboardShortcuts;
});
