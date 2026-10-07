import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { GroundReader } from '../../js/level/GroundReader.js';
import { NodeFileProvider } from '../NodeFileProvider.js';
import { FileContainer } from '../../js/data/FileContainer.js';
import { Level } from '../../js/level/Level.js';
import { TriggerManager } from '../../js/level/TriggerManager.js';
import { CharacterSpriteSet } from '../../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../../js/lemmings/PixelSpriteSkin.js';
import { CharacterParticles } from '../../js/lemmings/CharacterParticles.js';
import { Lemming } from '../../js/lemmings/Lemming.js';
import { LemmingStateType } from '../../js/lemmings/LemmingStateType.js';
import { lemmingManagerInteractionMethods } from '../../js/lemmings/lemming-manager/LemmingManagerInteraction.js';
import { ActionWalkSystem } from '../../js/actions/ActionWalkSystem.js';
import { ActionDrowningSystem } from '../../js/actions/ActionDrowningSystem.js';
import { ActionFryingSystem } from '../../js/actions/ActionFryingSystem.js';
import { ActionSplatterSystem } from '../../js/actions/ActionSplatterSystem.js';
import { DisplayImage } from '../../js/render/DisplayImage.js';

const out = process.argv[2] || 'temp/character-hazards/proof';
fs.mkdirSync(out, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fixtures = read('tools/character-sprites/hazard-proof-fixtures.json');
const catalog = read('assets/characters/catalog.json'), files = new NodeFileProvider();
let preference = { shape: 'circle', accessory: 'crown', eyewear: 'classic_sunglasses', bodyColor: '#4778ff', propColor: '#ff8066', eyewearColor: '#1f1f1f' };
const sprites = new CharacterSpriteSet(new PixelSpriteSkin(read(catalog.shapes[0].path)), catalog,
  file => fs.readFileSync(file, 'utf8'), () => preference);
const display = new DisplayImage({ createImage: (_, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) });
display.initSize(160, 120);
const receipt = { evidence: 'Controlled native hazard fixture with actual GROUND/VGAGR object assets, TriggerManager contact, original action systems, CharacterSpriteSet and DisplayImage. Not browser gameplay.', tickMilliseconds: 60, shapes: catalog.shapes.map(({ id, label }) => ({ id, label })), fixtures, scenes: [] };

for (const fixture of fixtures) {
  const vga = new FileContainer(await files.loadBinary(fixture.pack, `VGAGR${fixture.ground}.DAT`));
  const ground = new GroundReader(await files.loadBinary(fixture.pack, `GROUND${fixture.ground}O.DAT`), vga.getPart(0), vga.getPart(1));
  const images = ground.getObjectImages(), info = images[fixture.object];
  for (const shape of catalog.shapes) {
    preference = { ...preference, shape: shape.id };
    if (!await sprites.prepare()) throw new Error(sprites.error);
    const level = new Level(160, 120), pool = new CharacterParticles();
    const ob = { id: fixture.object, x: 64 - info.trigger_left - Math.floor(info.trigger_width / 2), y: 72 - info.trigger_top, drawProperties: 0 };
    level.setMapObjects([ob], images);
    const triggerManager = new TriggerManager({ getGameTicks: () => 0 }, 160, 120);
    triggerManager.addRange(level.triggers);
    const actor = new Lemming(64, 72, 7), walking = new ActionWalkSystem(sprites);
    walking.characterParticles = pool; actor.setAction(walking);
    const state = lemmingManagerInteractionMethods.runTrigger.call({ triggerManager }, actor);
    const Action = state === LemmingStateType.DROWNING ? ActionDrowningSystem
      : state === LemmingStateType.FRYING ? ActionFryingSystem : ActionSplatterSystem;
    const action = new Action(sprites); action.characterParticles = pool; actor.setAction(action);
    if (sprites.getActorHazardKind(actor) !== fixture.kind) throw new Error(`Wrong hazard: ${fixture.kind}`);
    const timeline = [];
    let alive = true;
    for (let index = 0; index < (fixture.kind === 'water' ? 56 : 32); index++) {
      pool.tick();
      const result = alive ? action.process(level, actor) : LemmingStateType.OUT_OF_LEVEL;
      if (result === LemmingStateType.OUT_OF_LEVEL) alive = false;
      display.clear(0xff261c16);
      const object = level.objects[0];
      display.drawFrameFlags(object.getFrame(index + 1), object.x, object.y, object.drawProperties);
      if (alive) actor.render(display);
      pool.render(display);
      const png = new PNG({ width: 96, height: 72 });
      for (let row = 0; row < 72; row++) {
        const offset = ((row + 24) * 160 + 24) * 4;
        png.data.set(display.imgData.data.subarray(offset, offset + 96 * 4), row * 96 * 4);
      }
      fs.writeFileSync(path.join(out, `${fixture.kind}-${shape.id}-${index}.png`), PNG.sync.write(png));
      timeline.push({ tick: index + 1, frameIndex: actor.frameIndex, rendered: alive, state: result, x: actor.x, y: actor.y,
        drawX: sprites.getActorDrawPosition(actor)?.x ?? actor.x, drawY: sprites.getActorDrawPosition(actor)?.y ?? actor.y,
        particles: pool.activeCount, particleKinds: [...new Set(pool.particles.filter(p => p.life).map(p => p.mode || p.kind))],
        floatingProps: pool.particles.filter(p => p.life && p.floating).length });
    }
    receipt.scenes.push({ kind: fixture.kind, shape: shape.id, originalTrigger: info.trigger_effect_id,
      effectiveTrigger: level.triggers[0].type, actorAction: action.getActionName(), objectFrames: info.frameCount, timeline });
  }
}
fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(`Captured ${fixtures.length} actual hazards across all ${catalog.shapes.length} shapes.`);
