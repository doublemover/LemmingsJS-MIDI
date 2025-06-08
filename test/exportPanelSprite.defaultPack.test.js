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

afterEach(function(){ fs.rmSync(path.join('exports'), { recursive: true, force: true }); });

describe('exportPanelSprite.js default pack', function(){
  before(setupStubs);
  after(function(){ Object.assign(Lemmings, orig); });

  it('creates output when run without arguments', async function(){
    const script = fileURLToPath(new URL('../tools/exportPanelSprite.js', import.meta.url));
    const origArgv = process.argv;
    process.argv = ['node', script];
    await import(pathToFileURL(script).href + `?t=${Date.now()}`);
    process.argv = origArgv;
    const out = path.join('exports','panel_export','panelSprite.png');
    expect(fs.existsSync(out)).to.be.true;
  });
});
