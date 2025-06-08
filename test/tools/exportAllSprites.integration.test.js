import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';

import { Lemmings } from '../../js/LemmingsNamespace.js';

let orig;
let providerModule;
let origLoadBinary;
let lastInitPath;

async function setupStubs() {
  globalThis.lemmings = { game: { showDebug: false } };
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
    loadSteelSprites: Lemmings.loadSteelSprites
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
    getObjectImages() {
      return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }];
    }
    getTerrainImages() { return []; }
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
    loadSteelSprites
  });
}

function restoreStubs() {
  Object.assign(Lemmings, orig);
  if (providerModule) {
    providerModule.NodeFileProvider.prototype.loadBinary = origLoadBinary;
  }
}

function patchScript() {
  return fileURLToPath(new URL('../../tools/exportAllSprites.js', import.meta.url));
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

describe('exportAllSprites integration', function () {
  before(setupStubs);
  after(restoreStubs);

  it('uses default output path and writes sprites', async function () {
    const script = patchScript();
    const outDir = path.join('exports', 'lemmings_all');
    fs.rmSync(outDir, { recursive: true, force: true });
    await runScript(script, []);
    await new Promise(r => setTimeout(r, 200));

    expect(fs.existsSync(path.join(outDir, 'panel.png'))).to.be.true;
    expect(fs.existsSync(path.join(outDir, 'letter_A.png'))).to.be.true;
    expect(fs.existsSync(path.join(outDir, 'num_left_0.png'))).to.be.true;
    expect(fs.existsSync(path.join(outDir, 'WALKING_right_sheet.png'))).to.be.true;
    expect(fs.existsSync(path.join(outDir, 'ground0', 'object_0_0.png'))).to.be.true;
    expect(lastInitPath).to.equal('lemmings');
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('accepts custom paths', async function () {
    const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    fs.writeFileSync(path.join(pack, 'MAIN.DAT'), Buffer.from([0]));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript();
    try {
      await runScript(script, [pack, outDir]);
      await new Promise(r => setTimeout(r, 200));
      expect(fs.existsSync(path.join(outDir, 'panel.png'))).to.be.true;
      expect(lastInitPath).to.equal(pack);
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
