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
  const dataPath = process.argv[2] || loadDefaultPack();
  const outDir   = process.argv[3] || `${dataPath.replace(/\W+/g, '_')}_all`;
  fs.mkdirSync(outDir, { recursive: true });

  const provider = new NodeFileProvider('.');
  const res = new Lemmings.GameResources(provider, { path: dataPath, level: { groups: [] }});
  const pal = new Lemmings.ColorPalette();

  // --- Panel background and letters/numbers ---
  const panelSprites = await res.getSkillPanelSprite(pal);

  const panel = panelSprites.getPanelSprite();
  await new Promise(res =>
    frameToPNG(panel)
      .pack()
      .pipe(fs.createWriteStream(`${outDir}/panel.png`))
      .on('finish', res));

  const letters = ['%', '0','1','2','3','4','5','6','7','8','9','-','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',' '];
  for (const letter of letters) {
    const frame = panelSprites.getLetterSprite(letter);
    const safe = encodeURIComponent(letter === ' ' ? 'space' : letter);
    await new Promise(res =>
      frameToPNG(frame)
        .pack()
        .pipe(fs.createWriteStream(`${outDir}/letter_${safe}.png`))
        .on('finish', res));
  }

  for (let i = 0; i < 10; i++) {
    await new Promise(res =>
      frameToPNG(panelSprites.getNumberSpriteLeft(i))
        .pack()
        .pipe(fs.createWriteStream(`${outDir}/num_left_${i}.png`))
        .on('finish', res));
    await new Promise(res =>
      frameToPNG(panelSprites.getNumberSpriteRight(i))
        .pack()
        .pipe(fs.createWriteStream(`${outDir}/num_right_${i}.png`))
        .on('finish', res));
  }

  // --- Lemming sprites ---
  const spriteSet = await res.getLemmingsSprite(pal);
  for (const [name, id] of Object.entries(Lemmings.SpriteTypes)) {
    for (const dir of [true, false]) {
      const anim = spriteSet.getAnimation(id, dir);
      if (!anim || !anim.frames || anim.frames.length === 0) continue;
      const dirName = dir ? 'right' : 'left';
      const sheet = new PNG({ width: anim.frames[0].width * anim.frames.length, height: anim.frames[0].height });
      for (let i = 0; i < anim.frames.length; i++) {
        const frame = anim.getFrame(i);
        const png = frameToPNG(frame);
        await new Promise(res => png.pack().pipe(fs.createWriteStream(`${outDir}/${name}_${dirName}_${i}.png`)).on('finish', res));
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) {
            const idx = (y * frame.width + x) * 4;
            const dest = ((y * sheet.width) + x + i * frame.width) * 4;
            sheet.data[dest    ] = png.data[idx];
            sheet.data[dest + 1] = png.data[idx + 1];
            sheet.data[dest + 2] = png.data[idx + 2];
            sheet.data[dest + 3] = png.data[idx + 3];
          }
        }
      }
      await new Promise(res => sheet.pack().pipe(fs.createWriteStream(`${outDir}/${name}_${dirName}_sheet.png`)).on('finish', res));
    }
  }

  // --- Map object sprites from ground files ---
  await Lemmings.loadSteelSprites();
  for (let g = 0; g < 5; g++) {
    const groundFile = `GROUND${g}O.DAT`;
    const vgaFile    = `VGAGR${g}.DAT`;
    let groundBuf, vgaBuf;
    try {
      groundBuf = await provider.loadBinary(dataPath, groundFile);
      vgaBuf    = await provider.loadBinary(dataPath, vgaFile);
    } catch {
      continue;
    }
    fs.mkdirSync(`${outDir}/ground${g}`, { recursive: true });
    const vgaContainer = new Lemmings.FileContainer(vgaBuf);
    const groundReader = new Lemmings.GroundReader(
      groundBuf,
      vgaContainer.getPart(0),
      vgaContainer.getPart(1)
    );
    const objects = groundReader.getObjectImages();
    for (let i = 0; i < objects.length; i++) {
      const img = objects[i];
      if (!img) continue;
      for (let f = 0; f < img.frameCount; f++) {
        const frameBuf = img.frames[f];
        const frame = new Lemmings.Frame(img.width, img.height);
        frame.drawPaletteImage(frameBuf, img.width, img.height, img.palette, 0, 0);
        const png = frameToPNG(frame);
        await new Promise(res => png.pack().pipe(fs.createWriteStream(`${outDir}/ground${g}/object_${i}_${f}.png`)).on('finish', res));
      }
    }
  }
})();
