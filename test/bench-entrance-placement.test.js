import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/EventHandler.js';
import '../js/Level.js';
import '../js/TriggerTypes.js';
import '../js/MapObject.js';
import '../js/Animation.js';
import '../js/ObjectImageInfo.js';
import '../js/ColorPalette.js';
import '../js/Frame.js';

globalThis.lemmings = { game: { showDebug: false } };

class GameFactoryStub { async getGame() { return {}; } async getGameResources() { return {}; } get configReader() { return { configs: Promise.resolve([]) }; } }
class StageStub { constructor() {} getGameDisplay() { return {}; } getGuiDisplay() { return {}; } updateStageSize() {} setCursorSprite() {} clear() {} startFadeOut() {} startOverlayFade() {} }
class KeyboardShortcutsStub { constructor() {} dispose() {} }

describe('bench entrance placement', function() {
  before(function() {
    global.window = { location: { search: '' }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, requestAnimationFrame() {}, cancelAnimationFrame() {} };
    global.document = { visibilityState: 'visible', hasFocus() { return true; }, createElement() { return { appendChild() {}, options: [], remove() {} }; }, addEventListener() {}, removeEventListener() {} };
    Lemmings.GameFactory = GameFactoryStub;
    Lemmings.Stage = StageStub;
    Lemmings.KeyboardShortcuts = KeyboardShortcutsStub;
    Lemmings.GameTypes = { toString: () => '' };
  });

  after(function() {
    delete global.window;
    delete global.document;
  });

  it('retains original entrance and adds objects for new ones', async function() {
    const { GameView } = await import('../js/GameView.js');
    const level = new Lemmings.Level(100, 50);
    const ground = level.getGroundMaskLayer();
    for (let x = 0; x < 100; x++) ground.setGroundAt(x, 40);
    const objInfo = new Lemmings.ObjectImageInfo();
    objInfo.frames = [new Uint8Array(1)];
    objInfo.width = 1; objInfo.height = 1; objInfo.palette = new Lemmings.ColorPalette();
    const entranceObj = new Lemmings.MapObject({ id: 1, x: 10, y: 10, drawProperties: 0 }, objInfo, new Lemmings.Animation(), 0);
    level.objects.push(entranceObj);
    level.entrances.push({ x: 10, y: 10 });

    const timer = { speedFactor: 1, benchStartupFrames: 0, benchStableFactor: 1, getGameTime(){return 0;} };
    const lm = { spawnCount: 0 };
    const view = new GameView();
    view.loadLevel = async () => {
      view.game = { level, getLemmingManager: () => lm, getGameTimer: () => timer };
    };
    view.gameResources = { getLevelGroups() { return ['grp']; } };
    view.configs = [{ gametype: view.gameType, name: 'test' }];
    view.levelGroupIndex = 0;
    const count = 3;
    await view.benchStart(count);

    expect(level.entrances.length).to.equal(count);
    expect(level.entrances).to.deep.include({ x: 10, y: 10 });
    for (const ent of level.entrances) {
      if (!ent) continue;
      const found = level.objects.some(o => o.x === ent.x && o.y === ent.y);
      expect(found).to.be.true;
    }
  });
});
