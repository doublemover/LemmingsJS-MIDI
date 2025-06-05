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

function frameToPNG(frame) {
  const png = new PNG({ width: frame.width, height: frame.height });
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const idx = y * frame.width + x;
      const rgba = frame.data[idx];
      const p = idx * 4;
      png.data[p    ] = rgba & 0xFF;
      png.data[p + 1] = (rgba >> 8) & 0xFF;
      png.data[p + 2] = (rgba >> 16) & 0xFF;
      png.data[p + 3] = (rgba >> 24) & 0xFF;
    }
  }
  return png;
}

(async () => {
  const pack = process.argv[2] || loadDefaultPack();
  const outDir = process.argv[3] || path.join('exports', 'cursor_test');
  fs.mkdirSync(outDir, { recursive: true });

  const provider = new NodeFileProvider('.');
  const br = await provider.loadBinary(pack, 'MAIN.DAT');
  const fc = new Lemmings.FileContainer(br);
  const fr = fc.getPart(5);
  const minSize = 4;
  const maxSize = 32;
  for (let width = minSize; width <= maxSize; width++) {
    for (let height = minSize; height <= maxSize; height++) {
      fr.setOffset(0); // reset reader for each run
      const pimg = new Lemmings.PaletteImage(width, height);
      pimg.processImage(fr, 1);
      pimg.processTransparentByColorIndex(0);
      const pal = new Lemmings.ColorPalette();
      pal.setColorRGB(1, 255, 255, 255);
      const frame = pimg.createFrame(pal);
      const png = frameToPNG(frame);
      const name = `cursor_${width}x${height}.png`;
      await new Promise(res =>
        png.pack().pipe(fs.createWriteStream(path.join(outDir, name))).on('finish', res));
    }
  }
})();
