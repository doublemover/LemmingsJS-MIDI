import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingsBootstrap.js';
import { NodeFileProvider } from './NodeFileProvider.js';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

function loadDefaultPack() {
  try {
    const cfgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config.json');
    const txt = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(txt);
    return cfg[0]?.path || 'lemmings';
  } catch {
    return 'lemmings';
  }
}

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

function readPNG(file) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(new PNG())
      .on('parsed', function() { resolve(this); })
      .on('error', reject);
  });
}

(async () => {
  const pack = process.argv[2] || loadDefaultPack();
  const spriteDir = process.argv[3];
  const outFile = process.argv[4];
  if (!spriteDir || !outFile) {
    console.log('Usage: node tools/patchSprites.js <pack> <spritesDir> <outDat>');
    process.exit(1);
  }

  const provider = new NodeFileProvider('.');
  const pal = await loadPalette(provider, pack);
  const res = new Lemmings.GameResources(provider, { path: pack, level: { groups: [] }});
  const spriteSet = await res.getLemmingsSprite(pal);

  let ok = true;
  for (const [name, id] of Object.entries(Lemmings.SpriteTypes)) {
    for (const dir of ['right', 'left']) {
      const anim = spriteSet.getAnimation(id, dir === 'right');
      if (!anim) continue;
      const targetDir = path.join(spriteDir, 'lemmings', name, dir);
      if (!fs.existsSync(targetDir)) continue;
      const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.png')).sort();
      if (!files.length) continue;
      if (files.length !== anim.frames.length) {
        console.error(`${name}/${dir}: frame count mismatch`);
        ok = false;
        continue;
      }
      for (let i = 0; i < files.length; i++) {
        const png = await readPNG(path.join(targetDir, files[i]));
        if (png.width !== anim.frames[i].width || png.height !== anim.frames[i].height) {
          console.error(`${name}/${dir} frame ${i}: size mismatch`);
          ok = false;
        }
      }
    }
  }

  if (!ok) {
    console.error('Verification failed. Aborting patch.');
    process.exit(1);
  }

  console.log('All sprites verified. Patching not implemented yet.');
})();
