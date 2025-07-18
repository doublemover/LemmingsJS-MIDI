import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';
import { Lemmings } from '../../js/LemmingsNamespace.js';

let orig;
let lastInitPath;
let providerModule;
let origLoadBinary;

async function setupStubs() {
  await import('../../js/LemmingsBootstrap.js');
  providerModule = await import('../../tools/NodeFileProvider.js');
  origLoadBinary = providerModule.NodeFileProvider.prototype.loadBinary;
  providerModule.NodeFileProvider.prototype.loadBinary = async function () {
    return new Lemmings.BinaryReader(new Uint8Array(1), 0, 1, 'stub', 'stub');
  };
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
  if (providerModule) {
    providerModule.NodeFileProvider.prototype.loadBinary = origLoadBinary;
  }
}

function createPack(name = 'pack') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.writeFileSync(path.join(dir, 'MAIN.DAT'), Buffer.from([0]));
  return dir;
}

function patchScript(name) {
  return fileURLToPath(new URL(`../../tools/${name}`, import.meta.url));
}

async function runScript(script, args, options = {}) {
  const origArgv = process.argv;
  const origCwd = process.cwd();
  let error;
  const handler = e => { error = e; };
  if (options.cwd) process.chdir(options.cwd);
  process.argv = ['node', script, ...args];
  process.once('unhandledRejection', handler);
  try {
    const mod = await import(pathToFileURL(script).href + `?t=${Date.now()}`);
    await mod.main?.(args);
    await new Promise(r => setTimeout(r, 20));
  } finally {
    process.off('unhandledRejection', handler);
    process.argv = origArgv;
    if (options.cwd) process.chdir(origCwd);
  }
  if (error) throw error;
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

    it('exports panel letters and numbers', async function () {
      const pack = createPack('letters');
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letters-'));
      const script = patchScript('exportAllSprites.js');
      try {
        await runScript(script, [pack, outDir]);
        await new Promise(r => setTimeout(r, 200));
        expect(fs.existsSync(path.join(outDir, 'letter_A.png'))).to.be.true;
        expect(fs.existsSync(path.join(outDir, 'num_left_0.png'))).to.be.true;
        expect(fs.existsSync(path.join(outDir, 'num_right_0.png'))).to.be.true;
      } finally {
        fs.rmSync(pack, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it('exports lemming sheets and ground objects', async function () {
      const pack = createPack('sprites');
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
      const script = patchScript('exportAllSprites.js');
      try {
        await runScript(script, [pack, outDir]);
        await new Promise(r => setTimeout(r, 200));
        const sheet = path.join(outDir, 'WALKING_right_sheet.png');
        const obj   = path.join(outDir, 'ground0', 'object_0_0.png');
        expect(fs.existsSync(sheet)).to.be.true;
        expect(fs.existsSync(obj)).to.be.true;
      } finally {
        fs.rmSync(pack, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it('skips a ground pair when loadBinary throws', async function () {
      const pack = createPack('missing');
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-'));
      const script = patchScript('exportAllSprites.js');
      const prev = providerModule.NodeFileProvider.prototype.loadBinary;
      providerModule.NodeFileProvider.prototype.loadBinary = async function (dir, file) {
        if (file === 'GROUND2O.DAT' || file === 'VGAGR2.DAT') {
          throw new Error('missing');
        }
        return prev.call(this, dir, file);
      };
      try {
        await runScript(script, [pack, outDir]);
        await new Promise(r => setTimeout(r, 200));
        expect(fs.existsSync(path.join(outDir, 'ground2'))).to.be.false;
        expect(fs.existsSync(path.join(outDir, 'ground3', 'object_0_0.png'))).to.be.true;
        expect(fs.existsSync(path.join(outDir, 'WALKING_right_sheet.png'))).to.be.true;
      } finally {
        providerModule.NodeFileProvider.prototype.loadBinary = prev;
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
