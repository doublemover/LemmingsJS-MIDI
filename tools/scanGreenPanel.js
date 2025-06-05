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

(async () => {
  const pack = process.argv[2] || loadDefaultPack();
  const outDir = process.argv[3] || path.join('exports', 'panel_green_map');
  const provider = new NodeFileProvider('.');
  const pal = new Lemmings.ColorPalette();
  const res = new Lemmings.GameResources(provider, { path: pack, level: { groups: [] }});
  const sprites = await res.getSkillPanelSprite(pal);
  const panel = sprites.getPanelSprite();
  const w = Math.min(40, panel.width);
  const h = Math.min(40, panel.height);
  const png = new PNG({ width: w, height: h });

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * panel.width + x;
      const col = panel.data[idx];
      const r = col & 0xFF;
      const g = (col >> 8) & 0xFF;
      const b = (col >> 16) & 0xFF;
      const o = (y * w + x) * 4;
      if (g > r && g > b) {
        // mark green as blue
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 255;
        png.data[o + 3] = 255;
      } else {
        png.data[o] = r;
        png.data[o + 1] = g;
        png.data[o + 2] = b;
        png.data[o + 3] = (col >> 24) & 0xFF;
      }
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'green_map.png');
  png.pack().pipe(fs.createWriteStream(outPath));
})();
