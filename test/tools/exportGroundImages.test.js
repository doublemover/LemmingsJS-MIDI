import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { Lemmings } from '../../js/LemmingsNamespace.js';
import '../../js/BinaryReader.js';
import '../../js/Frame.js';
import '../../js/ColorPalette.js';
import '../../js/PaletteImage.js';
import '../../js/FileContainer.js';
import '../../js/GroundReader.js';
import '../../js/BitReader.js';
import '../../js/BitWriter.js';
import '../../js/UnpackFilePart.js';

globalThis.lemmings = Lemmings;
globalThis.lemmings.game = { showDebug: false };

let orig;
function setupStubs() {
  orig = {
    Frame: Lemmings.Frame,
    ColorPalette: Lemmings.ColorPalette,
    GroundReader: Lemmings.GroundReader,
    FileContainer: Lemmings.FileContainer,
    loadSteelSprites: Lemmings.loadSteelSprites,
    resetSteelSprites: Lemmings.resetSteelSprites,
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
    setColorRGB() {}
    getColor() { return 0; }
  }
  class GroundReader {
    constructor() {}
    getTerrainImages() {
      return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }];
    }
    getObjectImages() {
      return [{ width: 1, height: 1, frameCount: 1, frames: [new Uint8Array(1)], palette: new ColorPalette() }];
    }
  }
  class FileContainer { getPart() { return {}; } }

  Object.assign(Lemmings, {
    Frame,
    ColorPalette,
    GroundReader,
    FileContainer,
    loadSteelSprites: async () => {},
    resetSteelSprites: () => {},
  });
}

function restoreStubs() {
  Object.assign(Lemmings, orig);
}

function patchScript() {
  const origPath = new URL('../../tools/exportGroundImages.js', import.meta.url);
  const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  const patched = code
    .replace('import \'../js/LemmingsBootstrap.js\';', '')
    .replace(
      'import { NodeFileProvider } from \'./NodeFileProvider.js\';',
      'import { NodeFileProvider as RealNodeFileProvider } from \'./NodeFileProvider.js\';\nconst NodeFileProvider = globalThis.MockNodeFileProvider || RealNodeFileProvider;'
    );
  const dir = path.dirname(fileURLToPath(origPath));
  const temp = path.join(dir, 'exportGroundImages.test-run.js');
  fs.writeFileSync(temp, patched);
  return temp;
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

describe('tools/exportGroundImages.js', function () {
  describe('with mock NodeFileProvider', function () {
    before(setupStubs);
    after(restoreStubs);

    it('writes PNGs using a mock NodeFileProvider', async function () {
      const files = {
        'pack/GROUND0O.DAT': new Uint8Array([0]),
        'pack/VGAGR0.DAT': new Uint8Array([0])
      };
      class MockProvider {
        async loadBinary(dir, file) {
          const key = `${dir}/${file}`;
          const arr = files[key];
          if (!arr) throw new Error('missing ' + key);
          return new Lemmings.BinaryReader(arr, 0, arr.length, file, dir);
        }
      }
      globalThis.MockNodeFileProvider = MockProvider;

      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
      const script = patchScript();
      try {
        await runScript(script, ['pack', '0', outDir]);
        await new Promise(r => setTimeout(r, 50));
        const hasTerrain = fs.existsSync(path.join(outDir, 'terrain_0_0.png'));
        const hasObject = fs.existsSync(path.join(outDir, 'object_0_0.png'));
        expect(hasTerrain || hasObject).to.be.true;

      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.unlinkSync(script);
        delete globalThis.MockNodeFileProvider;
      }
    });

    it('uses config.json when run without arguments', async function () {
      const files = {
        'lemmings/GROUND0O.DAT': new Uint8Array([0]),
        'lemmings/VGAGR0.DAT': new Uint8Array([0])
      };
      class MockProvider {
        async loadBinary(dir, file) {
          const key = `${dir}/${file}`;
          const arr = files[key];
          if (!arr) throw new Error('missing ' + key);
          return new Lemmings.BinaryReader(arr, 0, arr.length, file, dir);
        }
      }
      globalThis.MockNodeFileProvider = MockProvider;

      const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
      const script = patchScript();
      try {
        await runScript(script, [], { cwd: tmpdir });
        await new Promise(r => setTimeout(r, 50));
        const base = path.join(tmpdir, 'exports', 'lemmings_ground_0');
        const pngs = fs.existsSync(base) ? fs.readdirSync(base).filter(f => f.endsWith('.png')) : [];
        expect(pngs.length).to.be.greaterThan(0);
      } finally {
        fs.rmSync(tmpdir, { recursive: true, force: true });
        fs.unlinkSync(script);
        delete globalThis.MockNodeFileProvider;
      }
    });

    it('fails for an out-of-range index', async function () {
      const files = {
        'lemmings/GROUND0O.DAT': new Uint8Array([0]),
        'lemmings/VGAGR0.DAT': new Uint8Array([0])
      };
      class MockProvider {
        async loadBinary(dir, file) {
          const key = `${dir}/${file}`;
          const arr = files[key];
          if (!arr) throw new Error('missing ' + key);
          return new Lemmings.BinaryReader(arr, 0, arr.length, file, dir);
        }
      }
      globalThis.MockNodeFileProvider = MockProvider;

      const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
      const script = patchScript();
      let err = null;
      try {
        await runScript(script, ['lemmings', '99'], { cwd: tmpdir });
      } catch (e) {
        err = e;
      } finally {
        fs.rmSync(tmpdir, { recursive: true, force: true });
        fs.unlinkSync(script);
        delete globalThis.MockNodeFileProvider;
      }
      expect(err).to.be.instanceOf(Error);
    });

    it('defaults to lemmings when config.json is unreadable', async function () {
      const files = {
        'lemmings/GROUND0O.DAT': new Uint8Array([0]),
        'lemmings/VGAGR0.DAT': new Uint8Array([0])
      };
      class MockProvider {
        async loadBinary(dir, file) {
          const key = `${dir}/${file}`;
          const arr = files[key];
          if (!arr) throw new Error('missing ' + key);
          return new Lemmings.BinaryReader(arr, 0, arr.length, file, dir);
        }
      }
      globalThis.MockNodeFileProvider = MockProvider;

      const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
      const script = patchScript();
      const cfg = fileURLToPath(new URL('../../config.json', import.meta.url));
      const cfgBak = `${cfg}.bak`;
      fs.renameSync(cfg, cfgBak);
      try {
        await runScript(script, [], { cwd: tmpdir });
        await new Promise(r => setTimeout(r, 150));
        const base = path.join(tmpdir, 'exports', 'lemmings_ground_0');
        const pngs = fs.existsSync(base) ? fs.readdirSync(base).filter(f => f.endsWith('.png')) : [];
        expect(pngs.length).to.be.greaterThan(0);
      } finally {
        fs.renameSync(cfgBak, cfg);
        fs.rmSync(tmpdir, { recursive: true, force: true });
        fs.unlinkSync(script);
        delete globalThis.MockNodeFileProvider;
      }
    });

    it('handles missing files without output', async function () {
      class RejectProvider { async loadBinary() { throw new Error('missing'); } }
      globalThis.MockNodeFileProvider = RejectProvider;

      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
      const script = patchScript();
      let err = null;
      try {
        await runScript(script, ['lemmings', '99', outDir]);
      } catch (e) {
        err = e;
      } finally {
        const pngs = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(f => f.endsWith('.png')) : [];
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.unlinkSync(script);
        delete globalThis.MockNodeFileProvider;
        expect(pngs.length).to.equal(0);
      }
      expect(err).to.be.instanceOf(Error);
    });
  });

  it('exports a real ground file', async function () {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const script = patchScript();
    try {
      await runScript(script, ['lemmings', '0', outDir]);
      await new Promise(r => setTimeout(r, 50));
      const pngs = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
      expect(pngs.length).to.be.greaterThan(0);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.unlinkSync(script);
    }
  });
});
