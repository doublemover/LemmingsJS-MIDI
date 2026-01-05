import assert from 'assert';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import '../js/util/LogHandler.js';
import { GameResources } from '../js/game/GameResources.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('GameResources', function () {
  let origFileContainer;
  let origLemmingsSprite;
  let origSkillPanelSprites;
  let origPaletteImage;
  let origColorPalette;
  let origMaskProvider;
  let origFrame;

  let fileProvider;
  let config;
  let loadCount;
  let partIndices;

  beforeEach(function () {
    loadCount = 0;
    partIndices = [];
    config = { path: 'lemmings', level: { groups: [] } };

    origFileContainer = Lemmings.FileContainer;
    class SpyFileContainer extends origFileContainer {
      getPart(i) {
        partIndices.push(i);
        return super.getPart(i);
      }
    }
    setDependency('FileContainer', SpyFileContainer);

    fileProvider = new NodeFileProvider('.');
    const origLoad = fileProvider.loadBinary.bind(fileProvider);
    fileProvider.loadBinary = async (path, file) => {
      assert.strictEqual(file, 'MAIN.DAT');
      assert.strictEqual(path, config.path);
      loadCount++;
      return origLoad(path, file);
    };

    origLemmingsSprite = Lemmings.LemmingsSprite;
    setDependency('LemmingsSprite', class { constructor(part) { this.part = part; } });

    origSkillPanelSprites = Lemmings.SkillPanelSprites;
    setDependency('SkillPanelSprites', class { constructor(a, b) { this.parts = [a, b]; } });

    origPaletteImage = Lemmings.PaletteImage;
    setDependency('PaletteImage', class {
      processImage() {}
      processTransparentByColorIndex() {}
      createFrame() { return 'frame'; }
    });

    origColorPalette = Lemmings.ColorPalette;
    setDependency('ColorPalette', class { setColorRGB() {} });

    origMaskProvider = Lemmings.MaskProvider;
    setDependency('MaskProvider', class { constructor(part) { this.part = part; } });

    origFrame = Lemmings.Frame;
    setDependency('Frame', class {
      constructor(w, h) { this.width = w; this.height = h; this.drawn = []; }
      drawPaletteImage(buf, w, h, pal) { this.drawn.push({ buf, w, h, pal }); }
    });

  });

  afterEach(function () {
    setDependency('FileContainer', origFileContainer);
    setDependency('LemmingsSprite', origLemmingsSprite);
    setDependency('SkillPanelSprites', origSkillPanelSprites);
    setDependency('PaletteImage', origPaletteImage);
    setDependency('ColorPalette', origColorPalette);
    setDependency('MaskProvider', origMaskProvider);
    setDependency('Frame', origFrame);
  });

  it('caches the promise returned by getMainDat()', async function () {
    const gr = new GameResources(fileProvider, config);
    const p1 = gr.getMainDat();
    const p2 = gr.getMainDat();
    assert.strictEqual(p1, p2);

    const container = await p1;
    assert.ok(container instanceof Lemmings.FileContainer);
    assert.strictEqual(loadCount, 1);
  });

  it('sprite helpers request the correct parts', async function () {
    const gr = new GameResources(fileProvider, config);
    await gr.getLemmingsSprite('p');
    await gr.getSkillPanelSprite('p');
    await gr.getCursorSprite();
    await gr.getMasks();
    assert.strictEqual(loadCount, 1);
    assert.deepStrictEqual(partIndices, [0, 2, 6, 5, 1]);
  });

  it('stores mechanics from config', function () {
    const cfg = { path: 'data', mechanics: { speed: 1 }, level: { groups: [] } };
    const gr = new GameResources(fileProvider, cfg);
    assert.deepStrictEqual(gr.mechanics, { speed: 1 });
  });

  it('delegates level loading and exposes group names', async function () {
    const levelResult = { id: 5 };
    const origLevelLoader = Lemmings.LevelLoader;
    class LevelLoaderStub {
      constructor(fp, cfg) { this.fp = fp; this.cfg = cfg; }
      getLevel(mode, index) { this.args = [mode, index]; return Promise.resolve(levelResult); }
    }
    setDependency('LevelLoader', LevelLoaderStub);
    const cfg = { path: 'data', level: { groups: ['A', 'B'] } };
    const gr = new GameResources(fileProvider, cfg);

    const level = await gr.getLevel(2, 3);
    assert.strictEqual(level, levelResult);
    assert.deepStrictEqual(gr.getLevelGroups(), ['A', 'B']);

    setDependency('LevelLoader', origLevelLoader);
  });

  it('resets mainDat when loading fails', async function () {
    const error = new Error('missing');
    const badProvider = { loadBinary: async () => { throw error; } };
    const cfg = { path: 'bad', level: { groups: [] } };
    const gr = new GameResources(badProvider, cfg);

    try {
      await gr.getMainDat();
      assert.fail('expected rejection');
    } catch (err) {
      assert.strictEqual(err, error);
      assert.strictEqual(gr.mainDat, null);
    }
  });
});
