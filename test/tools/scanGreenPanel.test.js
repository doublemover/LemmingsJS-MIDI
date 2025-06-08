import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';
import { Lemmings } from '../../js/LemmingsNamespace.js';
import '../../js/LemmingsBootstrap.js';
import { NodeFileProvider } from '../../tools/NodeFileProvider.js';

globalThis.lemmings = { game: { showDebug: false } };

async function loadPalette(provider, dataPath) {
  await Lemmings.loadSteelSprites();
  for (let g = 0; g < 5; g++) {
    try {
      const groundBuf = await provider.loadBinary(dataPath, `GROUND${g}O.DAT`);
      const vgaBuf = await provider.loadBinary(dataPath, `VGAGR${g}.DAT`);
      const vgaContainer = new Lemmings.FileContainer(vgaBuf);
      const gr = new Lemmings.GroundReader(
        groundBuf,
        vgaContainer.getPart(0),
        vgaContainer.getPart(1)
      );
      return gr.colorPalette;
    } catch {
      /* try next */
    }
  }
  return new Lemmings.ColorPalette();
}

async function loadPanelFrame() {
  const provider = new NodeFileProvider('.');
  const pal = await loadPalette(provider, 'lemmings');
  const res = new Lemmings.GameResources(provider, { path: 'lemmings', level: { groups: [] } });
  const sprites = await res.getSkillPanelSprite(pal);
  return sprites.getPanelSprite();
}

describe('tools/scanGreenPanel.js', function () {
  let origGR, origSP;
  const scriptPath = fileURLToPath(new URL('../../tools/scanGreenPanel.js', import.meta.url));
  const code = fs.readFileSync(scriptPath, 'utf8').replace('import \'../js/LemmingsBootstrap.js\';', '');
  const tempScript = path.join(os.tmpdir(), 'scanGreenPanel.test-run.js');
  fs.writeFileSync(tempScript, code);

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

  before(function () {
    origGR = Lemmings.GameResources;
    origSP = Lemmings.SkillPanelSprites;
  });

  after(function () {
    Lemmings.GameResources = origGR;
    Lemmings.SkillPanelSprites = origSP;
    fs.unlinkSync(tempScript);
  });

  it('marks green pixels blue', async function () {
    const frame = await loadPanelFrame();
    const w = Math.min(40, frame.width);
    const h = Math.min(40, frame.height);
    let gx = -1, gy = -1;
    for (let y = 0; y < h && gy === -1; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * frame.width + x;
        const col = frame.data[idx];
        const r = col & 0xFF;
        const g = (col >> 8) & 0xFF;
        const b = (col >> 16) & 0xFF;
        if (g > r && g > b) { gx = x; gy = y; break; }
      }
    }
    expect(gx).to.not.equal(-1);
    class PanelSprites { getPanelSprite() { return frame; } }
    class GameResources { async getSkillPanelSprite() { return new PanelSprites(); } }
    Lemmings.GameResources = GameResources;
    Lemmings.SkillPanelSprites = PanelSprites;

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-'));
    await runScript(tempScript, ['pack', outDir]);

    const out = PNG.sync.read(fs.readFileSync(path.join(outDir, 'green_map.png')));
    expect(out.width).to.equal(w);
    expect(out.height).to.equal(h);
    const idx = (gy * w + gx) * 4;
    expect(out.data[idx]).to.equal(0);
    expect(out.data[idx + 1]).to.equal(0);
    expect(out.data[idx + 2]).to.equal(255);
    expect(out.data[idx + 3]).to.equal(255);

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('handles missing panel sprite', async function () {
    class EmptySprites { getPanelSprite() { return { width: 0, height: 0, data: new Uint32Array(0) }; } }
    class GameResources { async getSkillPanelSprite() { return new EmptySprites(); } }
    Lemmings.GameResources = GameResources;
    Lemmings.SkillPanelSprites = EmptySprites;

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-'));
    await runScript(tempScript, ['pack', outDir]);

    const buf = fs.readFileSync(path.join(outDir, 'green_map.png'));
    expect(buf.length).to.be.greaterThan(0);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
