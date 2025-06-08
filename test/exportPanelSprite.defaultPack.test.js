import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Lemmings } from '../js/LemmingsNamespace.js';

// reuse stubs from exportScripts.test.js
let orig;
function setupStubs() {
  orig = {
    Frame: Lemmings.Frame,
    ColorPalette: Lemmings.ColorPalette,
    SkillPanelSprites: Lemmings.SkillPanelSprites,
    LemmingsSprite: Lemmings.LemmingsSprite,
    GameResources: Lemmings.GameResources
  };
  class Frame { constructor(w=1,h=1){ this.width=w; this.height=h; this.data=new Uint32Array(w*h); } drawPaletteImage(){} }
  class ColorPalette { getColor(){return 0;} setColorRGB(){} }
  class SkillPanelSprites { getPanelSprite(){ return new Frame(); } }
  class LemmingsSprite {}
  class GameResources { async getSkillPanelSprite(){ return new SkillPanelSprites(); } }
  Object.assign(Lemmings, { Frame, ColorPalette, SkillPanelSprites, LemmingsSprite, GameResources });
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

afterEach(function(){ fs.rmSync(path.join('exports'), { recursive: true, force: true }); });

describe('exportPanelSprite.js default pack', function(){
  before(setupStubs);
  after(function(){ Object.assign(Lemmings, orig); });

  it('creates output when run without arguments', async function(){
    const script = fileURLToPath(new URL('../tools/exportPanelSprite.js', import.meta.url));
    await runScript(script, []);
    const out = path.join('exports','panel_export','panelSprite.png');
    expect(fs.existsSync(out)).to.be.true;
  });
});
