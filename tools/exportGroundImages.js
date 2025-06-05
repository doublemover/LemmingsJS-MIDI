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

function bufToFrame(buf, width, height, palette) {
  const frame = new Lemmings.Frame(width, height);
  frame.drawPaletteImage(buf, width, height, palette, 0, 0);
  return frame;
}

function frameToPNG(frame) {
  const png = new PNG({ width: frame.width, height: frame.height });
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const idx = y * frame.width + x;
      const rgba = frame.data[idx];
      const p = (y * frame.width + x) * 4;
      png.data[p    ] = rgba & 0xFF;
      png.data[p + 1] = (rgba >> 8) & 0xFF;
      png.data[p + 2] = (rgba >> 16) & 0xFF;
      png.data[p + 3] = (rgba >> 24) & 0xFF;
    }
  }
  return png;
}

(async () => {
  const dataPath = process.argv[2] || loadDefaultPack();
  const index = parseInt(process.argv[3] || '0', 10);
  const outDir = process.argv[4] || path.join('exports', `${dataPath.replace(/\W+/g, '_')}_ground_${index}`);
  fs.mkdirSync(outDir, { recursive: true });

  const provider = new NodeFileProvider('.');
  await Lemmings.loadSteelSprites();
  const groundBuf = await provider.loadBinary(dataPath, `GROUND${index}O.DAT`);
  const vgagrBuf = await provider.loadBinary(dataPath, `VGAGR${index}.DAT`);
  const vgaContainer = new Lemmings.FileContainer(vgagrBuf);
  const groundReader = new Lemmings.GroundReader(
    groundBuf,
    vgaContainer.getPart(0),
    vgaContainer.getPart(1)
  );

  const terrains = groundReader.getTerrainImages();
  const objects  = groundReader.getObjectImages();

  for (let i = 0; i < terrains.length; i++) {
    const img = terrains[i];
    if (!img) continue;
    for (let f = 0; f < img.frameCount; f++) {
      const frame = bufToFrame(img.frames[f], img.width, img.height, img.palette);
      const png = frameToPNG(frame);
      const file = `${outDir}/terrain_${i}_${f}.png`;
      await new Promise(res => png.pack().pipe(fs.createWriteStream(file)).on('finish', res));
    }
  }

  for (let i = 0; i < objects.length; i++) {
    const img = objects[i];
    if (!img) continue;
    for (let f = 0; f < img.frameCount; f++) {
      const frame = bufToFrame(img.frames[f], img.width, img.height, img.palette);
      const png = frameToPNG(frame);
      const file = `${outDir}/object_${i}_${f}.png`;
      await new Promise(res => png.pack().pipe(fs.createWriteStream(file)).on('finish', res));
    }
  }
})();
