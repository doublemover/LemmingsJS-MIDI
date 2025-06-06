import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';

import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';

let orig;
function setupStubs() {
  orig = {
    Frame: Lemmings.Frame,
    ColorPalette: Lemmings.ColorPalette,
    LemmingsSprite: Lemmings.LemmingsSprite,
    GameResources: Lemmings.GameResources,
    SpriteTypes: Lemmings.SpriteTypes
  };
  class Frame {
    constructor(w = 2, h = 2) {
      this.width = w;
      this.height = h;
      this.data = new Uint32Array([
        0xFF0000FF, // red
        0xFF00FF00, // green
        0xFFFF0000, // blue
        0xFFFFFFFF  // white
      ]);
    }
    drawPaletteImage() {}
  }
  class ColorPalette {}
  class SpriteAnim {
    constructor() { this.frames = [new Frame()]; }
    getFrame(i) { return this.frames[i]; }
  }
  class LemmingsSprite {
    getAnimation() { return new SpriteAnim(); }
  }
  class GameResources {
    async getLemmingsSprite() { return new LemmingsSprite(); }
  }
  Object.assign(Lemmings, {
    Frame,
    ColorPalette,
    LemmingsSprite,
    GameResources,
    SpriteTypes: { WALK: 0, DIG: 1 }
  });
}

function patchScript() {
  const origPath = new URL('../tools/exportLemmingsSprites.js', import.meta.url);
  const code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
  const patched = code
    .replace('import \'../js/LemmingsBootstrap.js\';', '')
    .replace('from \'./NodeFileProvider.js\'', 'from \'./exportLemmingsSprites.stub.js\'')
    .replace('(async () => {', 'export async function main() {')
    .replace('})();', '}');
  const dir = path.dirname(fileURLToPath(origPath));
  const script = path.join(dir, 'exportLemmingsSprites.test-run.js');
  fs.writeFileSync(script, patched);
  const stub = path.join(dir, 'exportLemmingsSprites.stub.js');
  fs.writeFileSync(stub, 'export class NodeFileProvider {}\n');
  return { script, stub };
}

describe('tools/exportLemmingsSprites.js', function () {
  before(setupStubs);
  after(function () {
    Object.assign(Lemmings, orig);
  });

  it('writes separate PNGs for each animation', async function () {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const { script, stub } = patchScript();
    const origArgv = process.argv;
    process.argv = ['node', script, 'dummy', outDir];
    const mod = await import(pathToFileURL(script).href + `?t=${Date.now()}`);
    await mod.main();
    process.argv = origArgv;
    fs.unlinkSync(script);
    fs.unlinkSync(stub);

    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
    const expected = [
      'WALK_right_0.png',
      'WALK_left_0.png',
      'WALK_right_sheet.png',
      'WALK_left_sheet.png',
      'DIG_right_0.png',
      'DIG_left_0.png',
      'DIG_right_sheet.png',
      'DIG_left_sheet.png'
    ];
    expected.forEach(f => expect(files).to.include(f));

    // verify PNG data preserves color
    const buf = fs.readFileSync(path.join(outDir, 'WALK_right_0.png'));
    const png = PNG.sync.read(buf);
    expect(png.width).to.equal(2);
    expect(png.height).to.equal(2);
    const pixels = Array.from(png.data.slice(0, 16));
    const expectedPixels = [
      255, 0, 0, 255, // red
      0, 255, 0, 255, // green
      0, 0, 255, 255, // blue
      255, 255, 255, 255 // white
    ];
    expect(pixels).to.deep.equal(expectedPixels);

    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
