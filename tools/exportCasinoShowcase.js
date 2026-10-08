import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createNeonCabaretGroundSet } from '../js/decorations/NeonCabaretGroundSet.js';
import { CASINO_SHOWCASE } from '../js/decorations/CasinoShowcase.js';
const theme = createNeonCabaretGroundSet(), scene = CASINO_SHOWCASE;
let image = new PNG({ width: scene.width, height: scene.height });
for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const i = (y * image.width + x) * 4; image.data.set([18 + Math.round(y / 40), 8, 20, 255], i); }
function draw(sprite, x, y, phase = 0) {
  const source = sprite.frames[phase % sprite.frames.length];
  for (let yy = 0; yy < sprite.height; yy++) for (let xx = 0; xx < sprite.width; xx++) {
    const ci = source[yy * sprite.width + xx], tx = x + xx, ty = y + yy;
    if (ci & 128 || tx < 0 || ty < 0 || tx >= image.width || ty >= image.height) continue;
    const color = sprite.palette.getColor(ci), i = (ty * image.width + tx) * 4;
    image.data.set([color & 255, color >>> 8 & 255, color >>> 16 & 255, 255], i);
  }
}
const frameDirectory = process.argv[2];
if (frameDirectory) fs.mkdirSync(frameDirectory, { recursive: true });
for (let phase = 0; phase < (frameDirectory ? 16 : 1); phase++) {
  image = new PNG({ width: scene.width, height: scene.height });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) image.data.set([18 + Math.round(y / 40), 8, 20, 255], (y * image.width + x) * 4);
  for (const p of scene.gadgets) draw(theme.getObjectImages()[p.id], p.x, p.y, phase);
  for (const p of scene.terrain) draw(theme.getTerrainImages()[p.id], p.x, p.y);
  if (!phase) fs.writeFileSync('docs/previews/casino-spectacle.png', PNG.sync.write(image));
  if (frameDirectory) {
    fs.writeFileSync(path.join(frameDirectory, `scene-${phase}.png`), PNG.sync.write(image));
    const smoke = theme.getObjectImages()[11];
    image = new PNG({ width: smoke.width, height: smoke.height });
    draw(smoke, 0, 0, phase);
    fs.writeFileSync(path.join(frameDirectory, `smoke-${phase}.png`), PNG.sync.write(image));
  }
}
const header = 'TITLE hydro - Casino Grand Revue\nAUTHOR hydro\nSTYLE neon-cabaret\nWIDTH 1280\nHEIGHT 320\nLEMMINGS 20\nSAVE_REQUIREMENT 5\nTIME_LIMIT INFINITE\nMAX_SPAWN_INTERVAL 30\nSTART_X 0\nSTART_Y 0\n$SKILLSET\n  SKILL CLIMBER 20\n  SKILL FLOATER 20\n  SKILL BOMBER 5\n  SKILL BLOCKER 5\n  SKILL BUILDER 30\n  SKILL BASHER 20\n  SKILL MINER 20\n  SKILL DIGGER 20\n$END\n';
const block = (kind, p) => `$${kind}\n  STYLE neon-cabaret\n  PIECE ${p.id}\n  X ${p.x}\n  Y ${p.y}\n$END\n`;
fs.writeFileSync('examples/neon-cabaret/grand-revue.nxlv', header + scene.terrain.map(p => block('TERRAIN', p)).join('') + scene.gadgets.map(p => block('GADGET', p)).join(''));
console.log('Exported actual terrain/object render and playable Grand Revue level.');
