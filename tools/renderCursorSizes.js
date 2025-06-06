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
  const sizes = [10, 11, 12, 13, 18, 19, 20, 21, 22, 23, 24];
  for (const size of sizes) {
    const pimg = new Lemmings.PaletteImage(size, size);
    pimg.processImage(fr, 1);
    pimg.processTransparentByColorIndex(0);
    const pal = new Lemmings.ColorPalette();
    pal.setColorRGB(1, 255, 255, 255);
    const frame = pimg.createFrame(pal);
    const png = frameToPNG(frame);
    await new Promise(res => png.pack().pipe(fs.createWriteStream(`${outDir}/cursor_${size}.png`)).on('finish', res));
  }
})();
