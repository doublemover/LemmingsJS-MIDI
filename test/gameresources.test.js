import assert from 'assert';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { GameResources } from '../js/GameResources.js';
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
    Lemmings.FileContainer = SpyFileContainer;

    fileProvider = new NodeFileProvider('.');
    const origLoad = fileProvider.loadBinary.bind(fileProvider);
    fileProvider.loadBinary = async (path, file) => {
      assert.strictEqual(file, 'MAIN.DAT');
      assert.strictEqual(path, config.path);
      loadCount++;
      return origLoad(path, file);
    };

    origLemmingsSprite = Lemmings.LemmingsSprite;
    Lemmings.LemmingsSprite = class { constructor(part) { this.part = part; } };

    origSkillPanelSprites = Lemmings.SkillPanelSprites;
    Lemmings.SkillPanelSprites = class { constructor(a, b) { this.parts = [a, b]; } };

    origPaletteImage = Lemmings.PaletteImage;
    Lemmings.PaletteImage = class {
      processImage() {}
      processTransparentByColorIndex() {}
      createFrame() { return 'frame'; }
    };

    origColorPalette = Lemmings.ColorPalette;
    Lemmings.ColorPalette = class { setColorRGB() {} };

    origMaskProvider = Lemmings.MaskProvider;
    Lemmings.MaskProvider = class { constructor(part) { this.part = part; } };

    origFrame = Lemmings.Frame;
    Lemmings.Frame = class {
      constructor(w, h) { this.width = w; this.height = h; this.drawn = []; }
      drawPaletteImage(buf, w, h, pal) { this.drawn.push({ buf, w, h, pal }); }
    };

  });

  afterEach(function () {
    Lemmings.FileContainer = origFileContainer;
    Lemmings.LemmingsSprite = origLemmingsSprite;
    Lemmings.SkillPanelSprites = origSkillPanelSprites;
    Lemmings.PaletteImage = origPaletteImage;
    Lemmings.ColorPalette = origColorPalette;
    Lemmings.MaskProvider = origMaskProvider;
    Lemmings.Frame = origFrame;
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
});
