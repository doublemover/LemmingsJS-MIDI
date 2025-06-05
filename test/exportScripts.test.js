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

async function runScript(script, args) {
  const origArgv = process.argv;
  process.argv = ['node', script, ...args];
  await import(pathToFileURL(script).href + `?t=${Date.now()}`);
  process.argv = origArgv;
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
      await new Promise(r => setTimeout(r, 150));
      expect(fs.existsSync(path.join(outDir, 'panelSprite.png'))).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('exportGroundImages.js writes PNGs', async function () {
    const pack = createPack();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportGroundImages.js');
    try {
      await runScript(script, [pack, '0', outDir]);
      await new Promise(r => setTimeout(r, 150));
      expect(fs.existsSync(path.join(outDir, 'terrain_0_0.png')) || fs.existsSync(path.join(outDir, 'object_0_0.png'))).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('exportAllSprites.js writes PNGs', async function () {
    const pack = createPack();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript('exportAllSprites.js');
    try {
      await runScript(script, [pack, outDir]);
      await new Promise(r => setTimeout(r, 150));
      expect(fs.existsSync(path.join(outDir, 'panel.png'))).to.be.true;
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
