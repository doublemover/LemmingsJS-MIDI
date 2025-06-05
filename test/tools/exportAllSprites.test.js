import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';
import { Lemmings } from '../../js/LemmingsNamespace.js';

let orig;
let lastInitPath;

async function setupStubs() {
  await import('../../js/LemmingsBootstrap.js');
  orig = {
    Frame: Lemmings.Frame,
    ColorPalette: Lemmings.ColorPalette,
    SkillPanelSprites: Lemmings.SkillPanelSprites,
    LemmingsSprite: Lemmings.LemmingsSprite,
    GameResources: Lemmings.GameResources,
    GroundReader: Lemmings.GroundReader,
    FileContainer: Lemmings.FileContainer,
    SpriteTypes: Lemmings.SpriteTypes,
    loadSteelSprites: Lemmings.loadSteelSprites,
  };

  class Frame {
    constructor(w = 1, h = 1, color = 0xff0000ff) {
      this.width = w;
      this.height = h;
      this.data = new Uint32Array(w * h).fill(color);
    }
    drawPaletteImage() {}
  }

  class ColorPalette {
    getColor() { return 0; }
    setColorRGB() {}
  }

  class SkillPanelSprites {
    getPanelSprite() { return new Frame(); }
    getLetterSprite() { return new Frame(); }
    getNumberSpriteLeft() { return new Frame(); }
    getNumberSpriteRight() { return new Frame(); }
  }

  class SpriteAnim {
    constructor() { this.frames = [new Frame()]; }
    getFrame(i) { return this.frames[i]; }
  }

  class LemmingsSprite {
    getAnimation() { return new SpriteAnim(); }
  }

  class GameResources {
    constructor(provider, opts) { lastInitPath = opts.path; }
    async getSkillPanelSprite() { return new SkillPanelSprites(); }
    async getLemmingsSprite() { return new LemmingsSprite(); }
  }

  class GroundReader {
    getObjectImages() { return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }]; }
    getTerrainImages() { return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }]; }
  }

  class FileContainer { getPart() { return {}; } }

  async function loadSteelSprites() {}

  Object.assign(Lemmings, {
    Frame,
    ColorPalette,
    SkillPanelSprites,
    LemmingsSprite,
    GameResources,
    GroundReader,
    FileContainer,
    SpriteTypes: { WALKING: 0 },
    loadSteelSprites,
  });
}

function restoreStubs() {
  Object.assign(Lemmings, orig);
}

function createPack(name = 'pack') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.writeFileSync(path.join(dir, 'MAIN.DAT'), Buffer.from([0]));
  return dir;
}

function patchScript(name) {
  return fileURLToPath(new URL(`../../tools/${name}`, import.meta.url));
}

async function runScript(script, args) {
  const origArgv = process.argv;
  process.argv = ['node', script, ...args];
  await import(pathToFileURL(script).href + `?t=${Date.now()}`);
  process.argv = origArgv;
}

function readPNG(p) {
  const buf = fs.readFileSync(p);
  return PNG.sync.read(buf);
}

describe('exportAllSprites tool', function () {
  describe('using stubs', function () {
    before(setupStubs);
    after(restoreStubs);

    it('uses defaults when no arguments provided', async function () {
      const script = patchScript('exportAllSprites.js');
      const defaultOut = path.join('exports', 'lemmings_all');
      fs.rmSync(defaultOut, { recursive: true, force: true });
      await runScript(script, []);
      await new Promise(r => setTimeout(r, 200));
      const png = readPNG(path.join(defaultOut, 'panel.png'));
      expect(png.width).to.equal(1);
      expect(png.height).to.equal(1);
      expect(lastInitPath).to.equal('lemmings');
      fs.rmSync(defaultOut, { recursive: true, force: true });
    });

    it('accepts pack path and output dir arguments', async function () {
      const pack = createPack('myPack');
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
      const script = patchScript('exportAllSprites.js');
      try {
        await runScript(script, [pack, outDir]);
        await new Promise(r => setTimeout(r, 200));
        const png = readPNG(path.join(outDir, 'panel.png'));
        expect(png.width).to.equal(1);
        expect(png.height).to.equal(1);
        expect(lastInitPath).to.equal(pack);
      } finally {
        fs.rmSync(pack, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });

  describe('with real pack data', function () {
    before(async function () {
      globalThis.lemmings = { game: { showDebug: false } };
      await import('../../js/LemmingsBootstrap.js');
    });

    it('loads panel sprite with expected dimensions and colors', async function () {
      const { NodeFileProvider } = await import('../../tools/NodeFileProvider.js');
      const provider = new NodeFileProvider('.');
      const groundBuf = await provider.loadBinary('lemmings', 'GROUND0O.DAT');
      const vgaBuf = await provider.loadBinary('lemmings', 'VGAGR0.DAT');
      const groundFile = new Lemmings.BinaryReader(groundBuf);
      const vgaContainer = new Lemmings.FileContainer(vgaBuf);
      const ground = new Lemmings.GroundReader(groundFile, vgaContainer.getPart(0), vgaContainer.getPart(1));
      const palette = ground.colorPalette;
      const res = new Lemmings.GameResources(provider, { path: 'lemmings', level: { groups: [] } });
      const sprites = await res.getSkillPanelSprite(palette);
      const panel = sprites.getPanelSprite();
      const colors = new Set(panel.data);
      expect(panel.width).to.equal(320);
      expect(panel.height).to.equal(40);
      expect(colors.size).to.be.above(1);
    });

    it('reads walking animation frame from pack', async function () {
      const { NodeFileProvider } = await import('../../tools/NodeFileProvider.js');
      const provider = new NodeFileProvider('.');
      const groundBuf = await provider.loadBinary('lemmings', 'GROUND0O.DAT');
      const vgaBuf = await provider.loadBinary('lemmings', 'VGAGR0.DAT');
      const groundFile = new Lemmings.BinaryReader(groundBuf);
      const vgaContainer = new Lemmings.FileContainer(vgaBuf);
      const ground = new Lemmings.GroundReader(groundFile, vgaContainer.getPart(0), vgaContainer.getPart(1));
      const palette = ground.colorPalette;
      const res = new Lemmings.GameResources(provider, { path: 'lemmings', level: { groups: [] } });
      const sprite = await res.getLemmingsSprite(palette);
      const anim = sprite.getAnimation(Lemmings.SpriteTypes.WALKING, true);
      const frame = anim.getFrame(0);
      const colors = new Set(frame.data);
      expect(frame.width).to.equal(16);
      expect(frame.height).to.equal(10);
      expect(colors.size).to.be.above(1);
    });
  });
});
