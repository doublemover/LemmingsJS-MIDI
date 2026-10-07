import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { CharacterSpriteSet } from '../../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { CharacterParticles } from '../../js/lemmings/CharacterParticles.js';
import { ConfigReader } from '../../js/data/ConfigReader.js';
import { GameTypes } from '../../js/game/GameTypes.js';
import { GameResources } from '../../js/game/GameResources.js';
import { Lemming } from '../../js/lemmings/Lemming.js';
import { LemmingStateType } from '../../js/lemmings/LemmingStateType.js';
import { ActionDiggSystem } from '../../js/actions/ActionDiggSystem.js';
import { ActionWalkSystem } from '../../js/actions/ActionWalkSystem.js';
import { ActionOhNoSystem } from '../../js/actions/ActionOhNoSystem.js';
import { ActionBashSystem } from '../../js/actions/ActionBashSystem.js';
import { ActionExplodingSystem } from '../../js/actions/ActionExplodingSystem.js';
import { ActionDrowningSystem } from '../../js/actions/ActionDrowningSystem.js';
import { ActionFryingSystem } from '../../js/actions/ActionFryingSystem.js';
import { ActionSplatterSystem } from '../../js/actions/ActionSplatterSystem.js';
import { DisplayImage } from '../../js/render/DisplayImage.js';
import { NodeFileProvider } from '../NodeFileProvider.js';

const out = process.argv[2] || 'temp/character-motion/proof';
fs.mkdirSync(out, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const config = await new ConfigReader(Promise.resolve(fs.readFileSync('config.json', 'utf8'))).getConfig(GameTypes.LEMMINGS);
const resources = new GameResources(new NodeFileProvider(), config);
const masks = await resources.getMasks();
let preference = { shape: 'mixed', bodyColor: '#4778ff', propColor: '#ff8066', eyewearColor: '#1f1f1f' };
const sprites = new CharacterSpriteSet(new PixelSpriteSkin(read(catalog.shapes[0].path)), catalog,
  file => fs.readFileSync(file, 'utf8'), () => preference);
const stage = { createImage: (_, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) };
const display = new DisplayImage(stage);
display.initSize(1600, 160);
const receipt = { evidence: 'Native Node capture using real CharacterSpriteSet, action systems, Fun 1 LevelLoader terrain and DisplayImage blitter. Not browser gameplay.',
  level: 'Fun 1: Just dig!', tickMilliseconds: 60, oneActorPerScene: true, shapes: [], frames: [], deaths: [] };
function drawGround(level) {
  display.clear(0xff15100e);
  const ground = new Uint32Array(level.groundImage.buffer, level.groundImage.byteOffset, level.width * level.height);
  for (let i = 0; i < ground.length; i++) if (level.groundMask.mask[i]) display.buffer32[i] = ground[i] | 0xff000000;
}
function save(name, x = 716, y = 52, width = 56, height = 44) {
  const png = new PNG({ width, height });
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * display.imgData.width + x) * 4;
    png.data.set(display.imgData.data.subarray(start, start + width * 4), row * width * 4);
  }
  fs.writeFileSync(path.join(out, name), PNG.sync.write(png));
}
for (const shape of catalog.shapes) {
  preference = { ...preference, shape: shape.id, accessory: 'beret', eyewear: 'none' };
  if (!await sprites.prepare()) throw new Error(sprites.error);
  const level = await resources.getLevel(0, 0), pool = new CharacterParticles();
  const actor = new Lemming(744, 72, 7), digging = new ActionDiggSystem(sprites);
  digging.characterParticles = pool; actor.setAction(digging);
  for (let tick = 0; tick < 145; tick++) {
    pool.tick(); digging.process(level, actor);
    if (tick < 129) continue;
    drawGround(level); actor.render(display); pool.render(display);
    save(`${shape.id}-dig-${tick - 129}.png`);
  }
  receipt.shapes.push({ id: shape.id, label: shape.label, digFinal: { x: actor.x, y: actor.y, frameIndex: actor.frameIndex } });
  for (const [name, action, count] of [['walk', new ActionWalkSystem(sprites), 8], ['panic', new ActionOhNoSystem(sprites), 16]]) {
    const actor = new Lemming(744, 71, 7); actor.setAction(action);
    for (let index = 0; index < count; index++) {
      display.clear(0xff261c16);
      display.drawHorizontalLine(716, 71, 772, 101, 127, 114);
      actor.frameIndex = index; actor.render(display);
      save(`${shape.id}-${name}-${index}.png`, 716, 42, 56, 36);
    }
  }
  preference = { ...preference, accessory: 'crown', eyewear: 'classic_sunglasses' };
  if (!await sprites.prepare()) throw new Error(sprites.error);
  for (const [kind, Action] of [['exploding', ActionExplodingSystem], ['splatter', ActionSplatterSystem], ['drowning', ActionDrowningSystem], ['frying', ActionFryingSystem]]) {
    const pool = new CharacterParticles(), level = await resources.getLevel(0, 0);
    const actor = new Lemming(744, 72, 7);
    const action = kind === 'exploding' ? new Action(sprites, masks, { removeByOwner() {} }, { draw() {} }) : new Action(sprites);
    action.characterParticles = pool; actor.setAction(action);
    const timeline = [];
    let alive = true;
    for (let index = 0; index < 22; index++) {
      pool.tick();
      const state = alive ? action.process(level, actor) : LemmingStateType.OUT_OF_LEVEL;
      if (state === LemmingStateType.OUT_OF_LEVEL) alive = false;
      drawGround(level);
      if (alive) actor.render(display);
      pool.render(display);
      save(`${shape.id}-${kind}-${index}.png`, 702, 18, 84, 76);
      timeline.push({ tick: index + 1, frameIndex: actor.frameIndex, rendered: alive, state, x: actor.x, y: actor.y });
    }
    receipt.deaths.push({ shape: shape.id, kind, timeline });
  }
  const bashPool = new CharacterParticles(), bashLevel = await resources.getLevel(0, 0);
  const basher = new Lemming(744, 91, 7), bashing = new ActionBashSystem(sprites, masks);
  basher.setAction(bashing); bashing.characterParticles = bashPool;
  for (let index = 0; index < 16; index++) {
    bashPool.tick(); bashing.process(bashLevel, basher); drawGround(bashLevel); basher.render(display); bashPool.render(display);
    save(`${shape.id}-bash-${index}.png`, 716, 52, 56, 44);
  }
}
preference = { ...preference, shape: 'circle', accessory: 'crown', eyewear: 'classic_sunglasses' };
await sprites.prepare();
const isolated = new CharacterParticles(), fixture = new Lemming(744, 72, 7);
const parts = sprites.getActorParticleParts(fixture);
isolated._eject(parts.accessory, fixture, 137, 'accessory');
isolated._eject(parts.eyewear, fixture, 431, 'eyewear');
for (let index = 0; index < 20; index++) {
  for (let y = 0; y < 160; y++) for (let x = 0; x < 1600; x++) display.buffer32[y * 1600 + x] = ((x >> 2) + (y >> 2)) % 2 ? 0xffdadce0 : 0xfff5f6f8;
  isolated.render(display);
  save(`isolated-wearables-${index}.png`, 716, 28, 56, 48);
  isolated.tick();
}
fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(`Saved real-renderer motion frames for ${catalog.shapes.length} shapes to ${out}`);
