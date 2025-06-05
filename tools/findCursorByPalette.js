import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingsBootstrap.js';
import { NodeFileProvider } from './NodeFileProvider.js';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

function loadDefaultPack() {
  try {
    const cfgPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'config.json',
    );
    const txt = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(txt);
    return cfg[0]?.path || 'lemmings';
  } catch {
    return 'lemmings';
  }
}

function loadPalette(samplePath) {
  const data = fs.readFileSync(samplePath);
  const png = PNG.sync.read(data);
  const colors = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    colors.set(`${r},${g},${b}`, { r, g, b });
  }
  return Array.from(colors.values());
}

function frameToPNG(frame) {
  const png = new PNG({ width: frame.width, height: frame.height });
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const idx = y * frame.width + x;
      const rgba = frame.data[idx];
      const p = idx * 4;
      png.data[p] = rgba & 0xff;
      png.data[p + 1] = (rgba >> 8) & 0xff;
      png.data[p + 2] = (rgba >> 16) & 0xff;
      png.data[p + 3] = (rgba >> 24) & 0xff;
    }
  }
  return png;
}

(async () => {
  const sample =
    process.argv[2] ||
    path.join('exports', 'cursor_test', 'cursor_0_16x16.png');
  const pack = process.argv[3] || loadDefaultPack();
  const outDir = process.argv[4] || path.join('exports', 'find_cursor');
  fs.mkdirSync(outDir, { recursive: true });

  const palette = loadPalette(sample);
  if (palette.length < 2) {
    console.error('Sample image palette too small');
    process.exit(1);
  }

  const provider = new NodeFileProvider('.');
  const br = await provider.loadBinary(pack, 'MAIN.DAT');
  const fc = new Lemmings.FileContainer(br);
  const fr = fc.getPart(5);

  const width = 16;
  const height = 16;
  const matches = [];
  for (let off = 0; off <= fr.length - (width * height) / 8; off += 2) {
    fr.setOffset(off);
    const pimg = new Lemmings.PaletteImage(width, height);
    pimg.processImage(fr, 1);
    const buf = pimg.getImageBuffer();
    const colorSet = new Set(buf);
    if (colorSet.size <= palette.length && colorSet.has(0) && colorSet.has(1)) {
      matches.push(off);
      const pal = new Lemmings.ColorPalette();
      pal.setColorRGB(0, palette[0].r, palette[0].g, palette[0].b);
      pal.setColorRGB(1, palette[1].r, palette[1].g, palette[1].b);
      const frame = pimg.createFrame(pal);
      const png = frameToPNG(frame);
      const name = `candidate_${off}.png`;
      await new Promise((res) =>
        png
          .pack()
          .pipe(fs.createWriteStream(path.join(outDir, name)))
          .on('finish', res),
      );
    }
  }
  console.log('Found candidates at offsets:', matches);
})();
