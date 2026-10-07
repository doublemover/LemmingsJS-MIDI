import { expect } from 'chai';
import fs from 'node:fs';
import { classifyClassicHazard } from '../js/lemmings/CharacterHazardTypes.js';
import { CharacterHazardPresentation } from '../js/lemmings/CharacterHazardPresentation.js';
import { refineCharacterPresentation } from '../js/lemmings/CharacterPresentation.js';
import { GroundReader } from '../js/level/GroundReader.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { Level } from '../js/level/Level.js';
import { TriggerManager } from '../js/level/TriggerManager.js';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { CharacterParticles } from '../js/lemmings/CharacterParticles.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { lemmingManagerInteractionMethods } from '../js/lemmings/lemming-manager/LemmingManagerInteraction.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { ActionDrowningSystem } from '../js/actions/ActionDrowningSystem.js';
import { ActionFryingSystem } from '../js/actions/ActionFryingSystem.js';
import { ActionSplatterSystem } from '../js/actions/ActionSplatterSystem.js';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const fixtures = read('tools/character-sprites/hazard-proof-fixtures.json');
const catalog = read('assets/characters/catalog.json');
const assets = new Map(), files = new NodeFileProvider();
async function load(pack, ground) {
  const key = `${pack}/${ground}`;
  if (!assets.has(key)) {
    const vga = new FileContainer(await files.loadBinary(pack, `VGAGR${ground}.DAT`));
    const data = new GroundReader(await files.loadBinary(pack, `GROUND${ground}O.DAT`), vga.getPart(0), vga.getPart(1));
    assets.set(key, data.getObjectImages());
  }
  return assets.get(key);
}
async function enter(sprites, fixture) {
  const images = await load(fixture.pack, fixture.ground), info = images[fixture.object];
  const level = new Level(192, 160), pool = new CharacterParticles();
  const ob = { id: fixture.object, x: 80 - info.trigger_left, y: 80 - info.trigger_top, drawProperties: 0 };
  level.setMapObjects([ob], images);
  const triggerManager = new TriggerManager({ getGameTicks: () => 0 }, 192, 160);
  triggerManager.addRange(level.triggers);
  const actor = new Lemming(80, 80, 42), walk = new ActionWalkSystem(sprites);
  walk.characterParticles = pool; actor.setAction(walk);
  const state = lemmingManagerInteractionMethods.runTrigger.call({ triggerManager }, actor);
  const Action = state === LemmingStateType.DROWNING ? ActionDrowningSystem
    : state === LemmingStateType.FRYING ? ActionFryingSystem : ActionSplatterSystem;
  const action = new Action(sprites); action.characterParticles = pool; actor.setAction(action);
  return { level, pool, actor, action, state };
}
const fields = actor => [actor.x, actor.y, actor.frameIndex, actor.state, actor.lookRight, actor.disabled];

describe('source-identified hazard presentation', function() {
  this.timeout(15000);

  it('classifies real assets in all six packs without treating decoration or green tentacles as acid', async function() {
    let count = 0;
    for (const pack of read('config.json')) {
      for (const filename of fs.readdirSync(pack.path).filter(name => /^GROUND\d+O\.DAT$/i.test(name))) {
        const ground = Number(/^GROUND(\d+)O/i.exec(filename)[1]);
        const images = await load(pack.path, ground);
        for (const info of images.filter(Boolean)) {
          if ([4, 5, 6].includes(info.trigger_effect_id)) { expect(info.characterHazard, `${pack.path}/${filename}`).to.be.a('string'); count++; }
          else expect(info.characterHazard).to.equal(null);
        }
      }
    }
    expect(count).to.be.above(30);
    expect(classifyClassicHazard('lemmings', 'GROUND2O.DAT', 5)).to.equal('acid');
    expect(classifyClassicHazard('lemmings_ohNo', 'GROUND1O.DAT', 5)).to.equal('water');
    expect(classifyClassicHazard('holiday94', 'GROUND1O.DAT', 5)).to.equal('water');
    expect(classifyClassicHazard('lemmings_ohNo', 'GROUND0O.DAT', 7)).to.equal('crush');
    expect(classifyClassicHazard('lemmings_ohNo', 'GROUND3O.DAT', 9)).to.equal('suction');
    expect(classifyClassicHazard('unrecognized-pack', 'GROUND2O.DAT', 5)).to.equal(null);
    expect(classifyClassicHazard('downloads/lemmings', 'GROUND2O.DAT', 5)).to.equal(null);
  });

  it('routes all 12 shapes through actual source triggers without changing actor timelines or cooldowns', async function() {
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path));
    let preference = { shape: 'circle', accessory: 'crown', eyewear: 'classic_sunglasses', bodyColor: '#4778ff', propColor: '#ff8066' };
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    for (const shape of catalog.shapes) {
      preference = { ...preference, shape: shape.id }; expect(await sprites.prepare()).to.equal(true);
      for (const fixture of fixtures) {
        const decorated = await enter(sprites, fixture), plain = await enter(base, fixture);
        expect(decorated.state).to.equal(plain.state);
        expect(sprites.getActorHazardKind(decorated.actor)).to.equal(fixture.kind);
        expect(decorated.level.triggers[0].disabledUntilTick).to.equal(plain.level.triggers[0].disabledUntilTick);
        let tick = 0, state;
        do {
          const before = fields(decorated.actor);
          const animation = sprites.getActorAnimation(decorated.action.spriteType, true, decorated.actor);
          const frame = animation.getFrame(decorated.actor.frameIndex);
          expect(frame.width).to.equal(16);
          expect(animation.getFrame(decorated.actor.frameIndex)).to.equal(frame);
          expect(fields(decorated.actor)).to.deep.equal(before);
          decorated.pool.tick(); plain.pool.tick();
          state = decorated.action.process(decorated.level, decorated.actor);
          expect(state).to.equal(plain.action.process(plain.level, plain.actor));
          expect(fields(decorated.actor), `${shape.id}/${fixture.kind}/${tick}`).to.deep.equal(fields(plain.actor));
          tick++;
        } while (state !== LemmingStateType.OUT_OF_LEVEL && tick < 20);
        expect(tick).to.equal(fixture.kind === 'fire' ? 14 : 16);
      }
    }
  });

  it('clears cosmetic causes on pool reset, actor reuse, action change and classic selection', async function() {
    let preference = { shape: 'circle' };
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path));
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    const fixture = fixtures.find(entry => entry.kind === 'acid');
    const scene = await enter(sprites, fixture);
    expect(sprites.getActorHazardKind(scene.actor)).to.equal('acid');
    scene.pool.clear(); expect(sprites.getActorHazardKind(scene.actor)).to.equal(null);
    scene.actor.reset(40, 40, 99); expect(sprites.getActorHazardKind(scene.actor)).to.equal(null);
    const next = await enter(sprites, fixture);
    next.actor.setAction(new ActionWalkSystem(sprites)); expect(sprites.getActorHazardKind(next.actor)).to.equal(null);
    preference = { shape: 'classic' }; await sprites.prepare();
    const classic = await enter(sprites, fixture);
    expect(sprites.getActorHazardKind(classic.actor)).to.equal(null);
    expect(sprites.getActorAnimation(SpriteTypes.DROWNING, true, classic.actor)).to.equal(base.getAnimation(SpriteTypes.DROWNING, true));
  });

  it('keeps both contact-frame directions independent when actors share a skin', function() {
    const source = read(catalog.shapes[0].path), manifest = refineCharacterPresentation(source, source, catalog.shapes[0].id);
    const template = new PixelSpriteSkin(manifest), hazards = new CharacterHazardPresentation();
    const rightContact = { direction: 'right' }, leftContact = { direction: 'left' };
    const skin = { colorPalette: template.colorPalette,
      getAnimation: (_state, right) => ({ getFrame: () => right ? rightContact : leftContact }) };
    const right = hazards.animation(skin, template, source, manifest, SpriteTypes.FRYING, true, 'fire');
    const left = hazards.animation(skin, template, source, manifest, SpriteTypes.FRYING, false, 'fire');
    expect(right).not.to.equal(left);
    expect(right.getFrame(0)).to.equal(rightContact); expect(left.getFrame(0)).to.equal(leftContact);
    expect(hazards.animation(skin, template, source, manifest, SpriteTypes.FRYING, true, 'fire')).to.equal(right);
    expect(hazards.animation(skin, template, source, manifest, SpriteTypes.FRYING, false, 'fire')).to.equal(left);
    expect(hazards.geometry.get(template).size).to.equal(1);
  });

  it('world-anchors liquid and fire art while the original simulation keeps its horizontal motion', async function() {
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path));
    const preference = { shape: 'circle', accessory: 'crown', eyewear: 'classic_sunglasses' };
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    for (const kind of ['water', 'acid', 'lava', 'fire']) {
      const scene = await enter(sprites, fixtures.find(entry => entry.kind === kind));
      const origin = sprites.getActorDrawPosition(scene.actor), startX = scene.actor.x;
      expect(origin.x).to.equal(startX);
      if (kind !== 'fire') expect(origin.y).to.equal(scene.level.objects[0].liquidSurface(startX, 1) + 1);
      for (let tick = 0; tick < 12; tick++) {
        scene.pool.tick(); scene.action.process(scene.level, scene.actor);
        let drawn;
        scene.action.draw({ drawFrame: (frame, x, y) => { drawn = { frame, x, y }; } }, scene.actor);
        expect(drawn.x).to.equal(origin.x); expect(drawn.y).to.equal(origin.y);
      }
      expect(scene.actor.x).to.equal(startX + 12);
      expect(sprites.getActorDrawPosition(scene.actor)).to.equal(origin);
    }
  });

  it('draws a dark submerged silhouette and lets intact props settle on the actual animated surface', async function() {
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path));
    const preference = { shape: 'circle', accessory: 'crown', eyewear: 'classic_sunglasses' };
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    const scene = await enter(sprites, fixtures.find(entry => entry.kind === 'water'));
    const origin = sprites.getActorDrawPosition(scene.actor);
    for (let tick = 0; tick < 14; tick++) { scene.pool.tick(); scene.action.process(scene.level, scene.actor); }
    const frame = sprites.getActorAnimation(SpriteTypes.DROWNING, true, scene.actor).getFrame(14);
    const surfaceRow = origin.surfaceY - origin.y - frame.offsetY;
    const submerged = [...frame.data].filter((color, index) => frame.mask[index] && Math.floor(index / frame.width) > surfaceRow);
    expect(submerged.length).to.be.greaterThan(4);
    expect(submerged.every(color => color === 0xff352110)).to.equal(true);
    for (const particle of scene.pool.particles.filter(p => p.life)) {
      expect(particle.mode).to.equal('leaf'); expect(particle.floating).to.equal(true);
      const surface = origin.surfaceOwner.liquidSurface(particle.x, origin.surfaceTick + particle.age);
      expect(particle.y + (particle.height - 1) / 2).to.equal(surface);
    }
    for (let tick = 0; tick < 16; tick++) scene.pool.tick();
    expect(scene.pool.particles.filter(p => p.life).every(p => p.floating)).to.equal(true);
  });

  it('registers crushing against the source victim support plane without moving its actor', async function() {
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path)), preference = { shape: 'circle' };
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    for (const [pack, ground, object] of [['lemmings', 0, 8], ['lemmings', 0, 10], ['lemmings', 2, 8], ['lemmings_ohNo', 0, 6], ['lemmings_ohNo', 0, 7]]) {
      const scene = await enter(sprites, { pack, ground, object }), mapObject = scene.level.objects[0];
      const info = mapObject.animation.objectImg;
      let support = 0;
      info.frames[1].forEach((symbol, index) => { if (symbol === 1 || symbol === 2) support = Math.max(support, Math.floor(index / info.width) + 2); });
      expect(sprites.getActorDrawPosition(scene.actor).y).to.equal(mapObject.y + support);
      expect(scene.actor.y).to.equal(80);
    }
  });

  it('supports an explicit custom smoke hazard without fire colors or burst particles', async function() {
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path)), preference = { shape: 'circle', accessory: 'crown' };
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    const scene = await enter(sprites, fixtures.find(entry => entry.kind === 'fire'));
    sprites.recordHazardContact(scene.actor, 'smoke'); scene.actor.setAction(scene.action);
    expect(sprites.getActorHazardKind(scene.actor)).to.equal('smoke');
    scene.action.process(scene.level, scene.actor);
    const particles = scene.pool.particles.filter(p => p.life);
    expect(particles).to.have.length(1); expect(particles[0].mode).to.equal('swallow');
    const animation = sprites.getActorAnimation(SpriteTypes.FRYING, true, scene.actor), frame = animation.getFrame(6);
    expect([...frame.data]).to.include(0xff898382);
    expect([...frame.data]).not.to.include(0xff2864ff);
    expect(animation.frameCount).to.equal(14);
  });

  it('keeps an anchored water frame visible when physics has drifted beyond the camera cull margin', async function() {
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path));
    let preference = { shape: 'circle' };
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    const scene = await enter(sprites, fixtures.find(entry => entry.kind === 'water'));
    for (let tick = 0; tick < 14; tick++) scene.action.process({ hasGroundAt: () => false }, scene.actor);
    expect(scene.actor.x).to.equal(94);
    const frame = sprites.getActorAnimation(SpriteTypes.DROWNING, true, scene.actor).getFrame(14);
    const origin = sprites.getActorDrawPosition(scene.actor), view = { x: 0, y: 0, w: 77, h: 160 };
    expect([...frame.mask].some((pixel, index) => pixel && origin.x + frame.offsetX + index % frame.width < view.w)).to.equal(true);
    let drawn = 0;
    const display = { stage: { getGameViewRect: () => view }, drawFrame() { drawn++; } };
    const manager = { activeLemmings: [scene.actor] };
    const before = fields(scene.actor);
    lemmingManagerInteractionMethods.render.call(manager, display);
    expect(drawn).to.equal(1); expect(fields(scene.actor)).to.deep.equal(before);
    preference = { shape: 'classic' }; await sprites.prepare();
    expect(sprites.getActorDrawBounds(scene.actor)).to.equal(null);
    lemmingManagerInteractionMethods.render.call(manager, display);
    expect(drawn).to.equal(1);
  });

  it('removes duplicate baked-in classic victims only for custom contacts while preserving the source trap', async function() {
    let preference = { shape: 'circle' };
    const base = new PixelSpriteSkin(read(catalog.shapes[0].path));
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
    for (const kind of ['crush', 'slice', 'bite', 'tentacle', 'suction', 'electric']) {
      const scene = await enter(sprites, fixtures.find(entry => entry.kind === kind));
      const object = scene.level.objects[0], original = object.animation.getFrame(1);
      const before = original.data.slice(), beforeMask = original.mask.slice();
      const frame = object.getFrame(1);
      expect(frame).not.to.equal(original);
      expect(frame.mask.reduce((a, b) => a + b, 0)).to.be.below(original.mask.reduce((a, b) => a + b, 0));
      expect(object.getFrame(1)).to.equal(frame);
      expect(original.data).to.deep.equal(before); expect(original.mask).to.deep.equal(beforeMask);
      const neutral = object.animation.objectImg.frames[0], source = object.animation.objectImg.frames[1];
      for (let i = 0; i < source.length; i++) if (source[i] === neutral[i]) expect(frame.mask[i]).to.equal(original.mask[i]);
      scene.pool.clear(); expect(object.getFrame(1)).to.equal(original);
    }
    preference = { shape: 'classic' }; await sprites.prepare();
    const scene = await enter(sprites, fixtures.find(entry => entry.kind === 'crush'));
    expect(scene.level.objects[0].getFrame(1)).to.equal(scene.level.objects[0].animation.getFrame(1));
  });
});
