import fs from 'node:fs';
import { recolorManifest } from '../js/lemmings/CharacterSpriteSet.js';
import { composeCharacterAccessories, CHARACTER_ACCESSORY_CHOICES, CHARACTER_ACCESSORIES } from '../js/lemmings/CharacterAccessories.js';
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const directory = 'assets/characters/previews';
fs.mkdirSync(directory, { recursive: true });
const write = (name, manifest) => {
  const frame = manifest.animations.find(record => record.state === 'WALKING' && record.direction === 1);
  const rows = frame.frames[0];
  const pixels = rows.flatMap((row, y) => [...row].map((symbol, x) => {
    const rgba = manifest.palette[manifest.symbols.indexOf(symbol)];
    return rgba[3] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${rgba.slice(0, 3).join(',')})"/>` : '';
  })).join('');
  fs.writeFileSync(`${directory}/${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.width} ${frame.height}" shape-rendering="crispEdges">${pixels}</svg>\n`);
};
const colors = { bodyColor: '#4778ff', propColor: '#ff8066', eyewearColor: '#1f1f1f' };
for (const shape of catalog.shapes) write(`body-${shape.id}`, recolorManifest(read(shape.path), colors));
const shape = catalog.shapes.find(item => item.id === 'circle');
const base = read(shape.path), bare = read(shape.headwearPath), accessories = read(shape.accessoriesPath);
for (const item of CHARACTER_ACCESSORY_CHOICES) {
  const custom = item.id !== 'beret';
  const manifest = recolorManifest(custom ? bare.bare : base, colors);
  write(`accessory-${item.id}`, composeCharacterAccessories(manifest, custom ? bare : accessories, { ...colors, accessory: item.id }));
}
for (const item of [{ id: 'none' }, ...CHARACTER_ACCESSORIES.eyewear]) {
  write(`eyewear-${item.id}`, composeCharacterAccessories(recolorManifest(bare.bare, colors), bare, { ...colors, accessory: 'none', eyewear: item.id }));
}
