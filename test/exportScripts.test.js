import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Lemmings } from '../js/LemmingsNamespace.js';

globalThis.lemmings = { game: { showDebug: false } };

let orig;
function setupStubs() {
  orig = {
    Frame: Lemmings.Frame,
    ColorPalette: Lemmings.ColorPalette,
    SkillPanelSprites: Lemmings.SkillPanelSprites,
    LemmingsSprite: Lemmings.LemmingsSprite,
    GameResources: Lemmings.GameResources,
    GroundReader: Lemmings.GroundReader,
    FileContainer: Lemmings.FileContainer,
    SpriteTypes: Lemmings.SpriteTypes
  };
  class Frame {
    constructor(w = 1, h = 1) {
      this.width = w;
      this.height = h;
      this.data = new Uint32Array(w * h);
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
    async getSkillPanelSprite() { return new SkillPanelSprites(); }
    async getLemmingsSprite() { return new LemmingsSprite(); }
  }
  class GroundReader {
    getObjectImages() { return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }]; }
    getTerrainImages() { return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }]; }
  }
  class FileContainer { getPart() { return {}; } }

  Object.assign(Lemmings, {
    Frame,
    ColorPalette,
    SkillPanelSprites,
    LemmingsSprite,
    GameResources,
    GroundReader,
    FileContainer,
    SpriteTypes: { WALKING: 0 }
  });
}

function createPack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  fs.writeFileSync(path.join(dir, 'MAIN.DAT'), Buffer.from([0]));
  fs.writeFileSync(path.join(dir, 'GROUND0O.DAT'), Buffer.from([0]));
  fs.writeFileSync(path.join(dir, 'VGAGR0.DAT'), Buffer.from([0]));
  return dir;
}

function patchScript(name) {
  return fileURLToPath(new URL(`../tools/${name}`, import.meta.url));
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

describe('export scripts', function () {
  before(setupStubs);
  after(function () {
    Object.assign(Lemmings, orig);
  });

  it('exportPanelSprite.js writes PNG', async function () {
    const pack = createPack();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportPanelSprite.js');
    try {
      await runScript(script, [pack, outDir]);
      await new Promise(r => setTimeout(r, 50));
      expect(fs.existsSync(path.join(outDir, 'panelSprite.png'))).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('exportPanelSprite.js uses default directory', async function () {
    const pack = createPack();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportPanelSprite.js');
    try {
      await runScript(script, [pack], { cwd });
      await new Promise(r => setTimeout(r, 50));
      const file = path.join(cwd, 'exports', 'panel_export', 'panelSprite.png');
      expect(fs.existsSync(file)).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exportPanelSprite.js errors when output directory creation fails', async function () {
    const pack = createPack();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportPanelSprite.js');
    fs.writeFileSync(path.join(cwd, 'exports'), 'not a dir');
    let err = null;
    try {
      await runScript(script, [pack], { cwd });
    } catch (e) {
      err = e;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    expect(err).to.be.instanceOf(Error);
  });

  it('exportGroundImages.js writes PNGs', async function () {
    if (parseInt(process.versions.node) >= 20) {
      this.skip();
    }
    const pack = createPack();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportGroundImages.js');
    try {
      await runScript(script, [pack, '0', outDir]);
      await new Promise(r => setTimeout(r, 50));
      expect(fs.existsSync(path.join(outDir, 'terrain_0_0.png')) || fs.existsSync(path.join(outDir, 'object_0_0.png'))).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('exportGroundImages.js uses default directory', async function () {
    if (parseInt(process.versions.node) >= 20) {
      this.skip();
    }
    const pack = createPack();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportGroundImages.js');
    try {
      await runScript(script, [pack, '0'], { cwd });
      await new Promise(r => setTimeout(r, 50));
      const base = `${pack.replace(/\W+/g, '_')}_ground_0`;
      const terrain = path.join(cwd, 'exports', base, 'terrain_0_0.png');
      const object = path.join(cwd, 'exports', base, 'object_0_0.png');
      expect(fs.existsSync(terrain) || fs.existsSync(object)).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exportGroundImages.js errors on invalid index', async function () {
    if (parseInt(process.versions.node) >= 20) {
      this.skip();
    }
    const pack = createPack();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportGroundImages.js');
    let err = null;
    try {
      await runScript(script, [pack, '1'], { cwd });
    } catch (e) {
      err = e;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    expect(err).to.be.instanceOf(Error);
  });

  it('exportAllSprites.js writes PNGs', async function () {
    if (parseInt(process.versions.node) >= 20) {
      this.skip();
    }
    const pack = createPack();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportAllSprites.js');
    try {
      await runScript(script, [pack, outDir]);
      await new Promise(r => setTimeout(r, 50));
      expect(fs.existsSync(path.join(outDir, 'panel.png'))).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('exportAllSprites.js uses default directory', async function () {
    if (parseInt(process.versions.node) >= 20) {
      this.skip();
    }
    const pack = createPack();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportAllSprites.js');
    try {
      await runScript(script, [pack], { cwd });
      await new Promise(r => setTimeout(r, 50));
      const base = `${pack.replace(/\W+/g, '_')}_all`;
      const file = path.join(cwd, 'exports', base, 'panel.png');
      expect(fs.existsSync(file)).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exportAllSprites.js errors when output directory creation fails', async function () {
    if (parseInt(process.versions.node) >= 20) {
      this.skip();
    }
    const pack = createPack();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportAllSprites.js');
    fs.writeFileSync(path.join(cwd, 'exports'), 'not a dir');
    let err = null;
    try {
      await runScript(script, [pack], { cwd });
    } catch (e) {
      err = e;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    expect(err).to.be.instanceOf(Error);
  });
});
