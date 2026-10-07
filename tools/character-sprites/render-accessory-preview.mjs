import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { CharacterSpriteSet } from '../../js/lemmings/CharacterSpriteSet.js';
import { CHARACTER_ACCESSORIES } from '../../js/lemmings/CharacterAccessories.js';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../../js/lemmings/SpriteTypes.js';
import { CHARACTER_COLORS } from '../../js/lemmings/characterColors.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const out = 'temp/live-instrument/accessory-review';
fs.mkdirSync(out, { recursive: true });
const base = new PixelSpriteSkin(read('assets/hydro/hydro-skin.json'));
let preference;
const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
const receipt = { items: Object.entries(CHARACTER_ACCESSORIES).flatMap(([slot, items]) => items.map(item => ({ ...item, slot }))), shapes: catalog.shapes, frames: [], colors: CHARACTER_COLORS.prop };
const save = (frame, filename) => {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data.set(frame.getData());
  fs.writeFileSync(path.join(out, filename), PNG.sync.write(png));
  return filename;
};
for (const shape of catalog.shapes) {
  for (const item of receipt.items) {
    preference = { shape: shape.id, bodyColor: '#4778ff', propColor: '#ff813d',
      accessory: item.slot === 'eyewear' ? 'none' : item.id,
      eyewear: item.slot === 'eyewear' ? item.id : 'none', eyewearColor: '#1f1f1f' };
    if (!await sprites.prepare()) throw new Error(sprites.error);
    const skin = sprites.skinForActor({ id: 1 });
    const motion = [];
    for (const right of [true, false]) {
      for (const [state, count] of [['WALKING', 8], ['CLIMBING', 8], ['UMBRELLA', 8]]) {
        for (let index = 0; index < count; index++) {
          const filename = save(skin.getAnimation(SpriteTypes[state], right).getFrame(index), `${shape.id}-${item.id}-${state}-${right ? 'right' : 'left'}-${index}.png`);
          motion.push({ state, right, index, filename });
        }
      }
      const actor = { action: { getActionName: () => 'walk' }, frameIndex: 0, getDirection: () => right ? 'right' : 'left', x: 0, y: 0 };
      skin.onActionChange(actor, { spriteProvider: skin, getActionName: () => 'floating' }, 10);
      for (let index = 0; index < 7; index++) {
        actor.frameIndex = index;
        const filename = `${shape.id}-${item.id}-LANDING-${right ? 'right' : 'left'}-${index}.png`;
        const drew = skin.drawCosmeticTransition({ drawFrame: frame => motion.push({ state: 'LANDING', right, index,
          filename: save(frame, filename) }) }, actor);
        if (!drew) motion.push({ state: 'RETURN_TO_WALK', right, index,
          filename: save(skin.getAnimation(SpriteTypes.WALKING, right).getFrame(index), filename) });
      }
    }
    receipt.frames.push({ shape: shape.id, item: item.id, motion });
  }
}
for (const item of receipt.items) {
  for (const color of CHARACTER_COLORS.prop) {
    preference = { shape: 'donut', accessory: item.slot === 'eyewear' ? 'none' : item.id,
      eyewear: item.slot === 'eyewear' ? item.id : 'none', propColor: color.hex, eyewearColor: color.hex };
    if (!await sprites.prepare()) throw new Error(sprites.error);
    save(sprites.skinForActor({ id: 1 }).getAnimation(SpriteTypes.WALKING, true).getFrame(3), `color-${item.id}-${color.id}.png`);
  }
}
fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(`Decoded ${receipt.frames.length} body/item selections, walking/turn/climb/float/landing, and every native accessory color.`);
