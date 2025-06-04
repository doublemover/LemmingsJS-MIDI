import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingsBootstrap.js';
import { NodeFileProvider } from './NodeFileProvider.js';
import fs from 'fs';
import path from 'path';

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

(async () => {
  const pack = process.argv[2] || loadDefaultPack();
  let outFile = null;
  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    outFile = process.argv[outIdx + 1];
  }

  const provider = new NodeFileProvider('.');
  const pal = await loadPalette(provider, pack);
  const res = new Lemmings.GameResources(provider, { path: pack, level: { groups: [] }});
  const spriteSet = await res.getLemmingsSprite(pal);

  const lines = [];
  for (const [name, id] of Object.entries(Lemmings.SpriteTypes)) {
    const animR = spriteSet.getAnimation(id, true);
    if (!animR) continue;
    const w = animR.frames[0].width;
    const h = animR.frames[0].height;
    const count = animR.frames.length;
    lines.push(`${name} ${w}x${h} frames:${count}`);
  }

  if (outFile) fs.writeFileSync(outFile, lines.join('\n'));
  else console.log(lines.join('\n'));
})();
