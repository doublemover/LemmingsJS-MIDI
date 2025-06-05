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

globalThis.lemmings = { game: { showDebug: false } };

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

async function runScript(script, args) {
  const origArgv = process.argv;
  process.argv = ['node', script, ...args];
  await import(pathToFileURL(script).href + `?t=${Date.now()}`);
  process.argv = origArgv;
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
