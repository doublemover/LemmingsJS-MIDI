import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { recolorManifest } from '../../js/lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../../js/lemmings/characterColors.js';
import { SpriteTypes } from '../../js/lemmings/SpriteTypes.js';

const out = 'temp/live-instrument/decoded-characters';
fs.mkdirSync(out, { recursive: true });
const catalog = JSON.parse(fs.readFileSync('assets/characters/catalog.json', 'utf8'));
const receipt = { bodyColors: CHARACTER_COLORS.body, propColors: CHARACTER_COLORS.prop, frames: [], hats: [], poses: [], hatMotion: [] };
function saveDecoded(frame, filename) {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data.set(frame.getData());
  fs.writeFileSync(path.join(out, filename), PNG.sync.write(png));
  return { width: frame.width, height: frame.height, filename };
}
function saveFrame(skin, state, index, filename, right = true) {
  return { state, index, ...saveDecoded(skin.getAnimation(SpriteTypes[state], right).getFrame(index), filename) };
}
for (const shape of catalog.shapes) {
  const manifest = JSON.parse(fs.readFileSync(shape.path, 'utf8'));
  for (const color of CHARACTER_COLORS.prop) {
    const skin = new PixelSpriteSkin(recolorManifest(manifest, { propColor: color.hex }));
    receipt.hats.push({ shape: shape.id, label: shape.label, color: color.id,
      ...saveFrame(skin, 'WALKING', 3, `hat-${shape.id}-${color.id}.png`) });
  }
  const skin = new PixelSpriteSkin(manifest);
  const states = new Set();
  for (const record of manifest.animations) {
    if (states.has(record.state)) continue;
    states.add(record.state);
    const index = Math.min(record.state === 'UMBRELLA' ? 5 : 3, record.frameCount - 1);
    receipt.poses.push({ shape: shape.id, label: shape.label, ...saveFrame(skin, record.state, index, `pose-${shape.id}-${record.state}.png`, record.direction >= 0) });
  }
  const motion = [];
  for (let index = 0; index < 8; index++) motion.push(saveFrame(skin, 'WALKING', index, `motion-${shape.id}-walk-${index}.png`));
  for (let index = 0; index < 8; index++) motion.push(saveFrame(skin, 'UMBRELLA', index, `motion-${shape.id}-float-${index}.png`));
  const actor = { action: { getActionName: () => 'walk' }, frameIndex: 0, getDirection: () => 'right', x: 0, y: 0 };
  skin.onActionChange(actor, { spriteProvider: skin, getActionName: () => 'floating' }, 10);
  for (let index = 0; index < 7; index++) {
    actor.frameIndex = index;
    skin.drawCosmeticTransition({ drawFrame: frame => motion.push({ state: 'LANDING', index, ...saveDecoded(frame, `motion-${shape.id}-land-${index}.png`) }) }, actor);
  }
  receipt.hatMotion.push({ shape: shape.id, label: shape.label, motion });
  for (const color of CHARACTER_COLORS.body) {
    const skin = new PixelSpriteSkin(recolorManifest(manifest, { bodyColor: color.hex }));
    receipt.frames.push({ shape: shape.id, label: shape.label, color: color.id,
      ...saveFrame(skin, 'WALKING', 3, `${shape.id}-${color.id}.png`) });
  }
  if (shape.id === 'donut') {
    const skin = new PixelSpriteSkin(manifest);
    const seen = new Set();
    receipt.donutActions = [];
    for (const record of manifest.animations) {
      if (seen.has(record.state)) continue;
      seen.add(record.state);
      const index = Math.min(record.state === 'UMBRELLA' ? 5 : 3, record.frameCount - 1);
      receipt.donutActions.push(saveFrame(skin, record.state, index, `donut-action-${record.state}.png`, record.direction >= 0));
    }
    for (let index = 0; index < 8; index += 1) {
      for (const color of CHARACTER_COLORS.body) saveFrame(new PixelSpriteSkin(recolorManifest(manifest, { bodyColor: color.hex })),
        'WALKING', index, `donut-walk-${color.id}-${index}.png`);
    }
  }
}
fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(`Decoded ${receipt.frames.length} current shape/color combinations and all 18 donut action states.`);
