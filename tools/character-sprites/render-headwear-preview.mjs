import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { CharacterSpriteSet } from '../../js/lemmings/CharacterSpriteSet.js';
import { CHARACTER_HEADWEAR } from '../../js/lemmings/CharacterAccessories.js';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../../js/lemmings/SpriteTypes.js';
import { CHARACTER_COLORS } from '../../js/lemmings/characterColors.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const out = 'temp/live-instrument/headwear-review';
fs.mkdirSync(out, { recursive: true });
const base = new PixelSpriteSkin(read('assets/hydro/hydro-skin.json'));
let preference;
const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
const receipt = { items: CHARACTER_HEADWEAR, shapes: catalog.shapes, colors: CHARACTER_COLORS.prop };
const save = (frame, filename) => {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data.set(frame.getData());
  fs.writeFileSync(path.join(out, filename), PNG.sync.write(png));
};
for (const shape of catalog.shapes) {
  for (const item of CHARACTER_HEADWEAR) {
    preference = { shape: shape.id, accessory: item.id, bodyColor: '#4778ff', propColor: '#ff813d' };
    if (!await sprites.prepare()) throw new Error(sprites.error);
    const skin = sprites.skinForActor({ id: 1 });
    for (const right of [true, false]) for (const [state, count] of [['WALKING', 8], ['CLIMBING', 8], ['UMBRELLA', 8]]) {
      for (let index = 0; index < count; index++) {
        save(skin.getAnimation(SpriteTypes[state], right).getFrame(index), `${shape.id}-${item.id}-${state}-${right ? 'right' : 'left'}-${index}.png`);
      }
    }
  }
}
for (const item of CHARACTER_HEADWEAR.filter(item => item.id !== 'none')) for (const color of CHARACTER_COLORS.prop) {
  preference = { shape: 'donut', accessory: item.id, propColor: color.hex };
  if (!await sprites.prepare()) throw new Error(sprites.error);
  save(sprites.skinForActor({ id: 1 }).getAnimation(SpriteTypes.WALKING, true).getFrame(3), `color-${item.id}-${color.id}.png`);
}
fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log('Decoded all 12 bodies × seven exclusive headwear choices with motion and eleven colors.');
