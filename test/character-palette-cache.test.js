import { expect } from 'chai';
import fs from 'node:fs';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { Frame } from '../js/render/Frame.js';
import { Animation } from '../js/render/Animation.js';

const read = path => fs.readFileSync(path, 'utf8');
const catalog = JSON.parse(read('assets/characters/catalog.json'));
const setup = (settings = {}) => {
  let preference = { shape: 'mixed', seed: 42, bodyColor: 'random', propColor: 'random', eyewearColor: 'random',
    accessory: 'crown', eyewear: 'classic_sunglasses', ...settings };
  const base = new PixelSpriteSkin(JSON.parse(read('assets/hydro/hydro-skin.json')));
  const sprites = new CharacterSpriteSet(base, catalog, read, () => preference);
  return { sprites, update: next => { preference = { ...preference, ...next }; } };
};
const animation = skin => skin.getAnimation(SpriteTypes.WALKING, true);

describe('canonical live character palettes', function() {
  this.timeout(10000);

  it('shares exactly one skin per appearance across 16384 live actors beyond the strong cache', async function() {
    const { sprites } = setup(); await sprites.prepare();
    const actors = Array.from({ length: 16384 }, (_, id) => ({ id, appearanceIndex: id % 1024 }));
    const owners = new Map();
    for (const actor of actors) {
      const key = JSON.stringify(sprites.appearanceForActor(actor));
      const skin = sprites.skinForActor(actor);
      if (owners.has(key)) expect(skin).to.equal(owners.get(key));
      else owners.set(key, skin);
    }
    expect(owners.size).to.equal(396);
    expect(sprites.paletteSkins.size).to.equal(256);
    for (const actor of actors.slice(0, 1024)) {
      const skin = owners.get(JSON.stringify(sprites.appearanceForActor(actor)));
      expect(sprites.skinForActor({ ...actor })).to.equal(skin);
      expect(animation(sprites.skinForActor(actor)).getFrame(3)).to.equal(animation(skin).getFrame(3));
    }
  });

  it('reuses live templates and palettes after headwear churn evicts their strong entries', async function() {
    const { sprites, update } = setup(); await sprites.prepare();
    const actors = Array.from({ length: 1024 }, (_, id) => ({ id, appearanceIndex: id }));
    const skins = actors.map(actor => sprites.skinForActor(actor));
    const templates = [...sprites.activeTemplates];
    for (const accessory of ['hat', 'beanie', 'orb']) {
      update({ accessory }); expect(await sprites.prepare()).to.equal(true);
    }
    expect(templates.some(template => [...sprites.skins.values()].includes(template))).to.equal(false);
    update({ accessory: 'crown' }); await sprites.prepare();
    expect(sprites.activeTemplates).to.deep.equal(templates);
    actors.forEach((actor, index) => expect(sprites.skinForActor(actor)).to.equal(skins[index]));
    expect(sprites.skins.size).to.be.at.most(32);
    expect(sprites.paletteSkins.size).to.equal(256);
  });

  it('keeps the strong working set least-recently-used while weak identities survive eviction', async function() {
    const { sprites } = setup(); await sprites.prepare();
    const skins = Array.from({ length: 396 }, (_, id) => sprites.skinForActor({ id, appearanceIndex: id }));
    const first = sprites.skinForActor({ id: 0, appearanceIndex: 0 });
    expect(first).to.equal(skins[0]);
    expect([...sprites.paletteSkins.values()].at(-1).skin).to.equal(first);
    sprites.skinForActor({ id: 1, appearanceIndex: 1 });
    expect([...sprites.paletteSkins.values()].some(entry => entry.skin === first)).to.equal(true);
    expect(sprites.paletteSkins.size).to.equal(256);
  });

  it('keeps shared-skin landing transitions independent across actors and pooled identities', async function() {
    const { sprites } = setup({ shape: 'heart', accessory: 'beret' }); await sprites.prepare();
    const first = Object.assign(new Lemming(20, 30, 1), { appearanceIndex: 7 });
    const second = Object.assign(new Lemming(24, 30, 2), { appearanceIndex: 7 });
    const skin = sprites.skinForActor(first);
    expect(sprites.skinForActor(second)).to.equal(skin);
    first.action = second.action = { getActionName: () => 'walk' };
    skin.onActionChange(first, { spriteProvider: skin, getActionName: () => 'floating' }, 10);
    const display = { drawFrame() {} };
    expect(skin.drawCosmeticTransition(display, first)).to.equal(true);
    expect(skin.drawCosmeticTransition(display, second)).to.equal(false);
    skin.onActionChange(second, { spriteProvider: skin, getActionName: () => 'floating' }, 9);
    first.id = 9;
    expect(sprites.skinForActor(first)).to.equal(skin);
    expect(skin.drawCosmeticTransition(display, first)).to.equal(false);
    expect(skin.drawCosmeticTransition(display, second)).to.equal(true);
    second.frameIndex = 7;
    expect(skin.drawCosmeticTransition(display, second)).to.equal(false);
  });
});

describe('compact lazy palette frames', function() {
  it('allocates no animation, landing or particle frames until requested', async function() {
    const { sprites } = setup({ shape: 'heart', accessory: 'beret' }); await sprites.prepare();
    const template = sprites.activeTemplates[0];
    const palette = JSON.parse(read('assets/characters/heart.json')).palette;
    // The decorated template has additional material slots.
    const colors = Array.from({ length: 16 }, (_, index) => {
      const value = template.colorPalette.getColor(index);
      return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, index ? 255 : 0];
    });
    let remapped = 0;
    const getSpanCache = Frame.prototype.getSpanCache;
    Frame.prototype.getSpanCache = function() { remapped++; return getSpanCache.call(this); };
    try {
      const skin = template.withPalette(colors);
      expect(remapped).to.equal(0);
      const walk = animation(skin);
      expect(walk.frameCount).to.equal(8);
      expect(remapped).to.equal(0);
      const first = walk.getFrame(0);
      expect(remapped).to.equal(1);
      expect(walk.getFrame(8)).to.equal(first);
      expect(remapped).to.equal(1);
      const right = skin.getParticleParts(true);
      const rightCount = Object.values(right).filter(Boolean).length;
      expect(remapped).to.equal(1 + rightCount);
      expect(skin.getParticleParts(true)).to.equal(right);
      expect(remapped).to.equal(1 + rightCount);
      skin.getParticleParts(false);
      expect(remapped).to.equal(1 + rightCount * 2);
      expect(walk.frames[0]).to.equal(first);
      expect(remapped).to.equal(8 + rightCount * 2);
      expect(skin.getAnimation(SpriteTypes.DIGGING, true)).to.equal(skin.getAnimation(SpriteTypes.DIGGING, false));
      const actor = Object.assign(new Lemming(20, 30, 1), { action: { getActionName: () => 'walk' } });
      skin.onActionChange(actor, { spriteProvider: skin, getActionName: () => 'floating' }, 10);
      const beforeLanding = remapped;
      expect(skin.drawCosmeticTransition({ drawFrame() {} }, actor)).to.equal(true);
      expect(remapped).to.equal(beforeLanding + 1);
      skin.drawCosmeticTransition({ drawFrame() {} }, actor);
      expect(remapped).to.equal(beforeLanding + 1);
      expect(palette.length).to.be.below(colors.length);
    } finally { Frame.prototype.getSpanCache = getSpanCache; }
  });

  it('preserves Animation tick, negative offset, looping and terminal frame semantics', function() {
    const manifest = JSON.parse(read('assets/hydro/hydro-skin.json'));
    const template = new PixelSpriteSkin(manifest), skin = template.withPalette(manifest.palette);
    for (const loop of [true, false]) {
      const actual = animation(skin), expected = new Animation();
      actual.loop = true; actual.restart(0);
      expected.frames = Array.from({ length: 8 }, (_, index) => actual.getFrame(index));
      expected.loop = actual.loop = loop;
      for (const start of [0, 13, -7]) {
        expected.restart(start); actual.restart(start);
        for (const tick of [start - 2, start, start + 1, start + 7, start + 8, start + 17, start + 2]) {
          expect(actual.getFrame(tick)).to.equal(expected.getFrame(tick));
          expect(actual.isFinished).to.equal(expected.isFinished);
        }
      }
    }
  });

  it('recolors an unmaterialized variant directly from source indices and preserves all frame geometry', function() {
    const manifest = JSON.parse(read('assets/hydro/hydro-skin.json'));
    const template = new PixelSpriteSkin(manifest), palette = manifest.palette.map(color => [...color]);
    palette[3] = [13, 120, 217, 255];
    const twice = template.withPalette(manifest.palette).withPalette(palette);
    const direct = template.withPalette(palette);
    for (const record of manifest.animations) {
      const a = twice.getAnimation(SpriteTypes[record.state], record.direction >= 0);
      const b = direct.getAnimation(SpriteTypes[record.state], record.direction >= 0);
      for (let index = 0; index < record.frameCount; index++) {
        const actual = a.getFrame(index), expected = b.getFrame(index);
        expect([...actual.data]).to.deep.equal([...expected.data]);
        expect(actual.mask).to.equal(expected.mask);
        expect([actual.width, actual.height, actual.offsetX, actual.offsetY])
          .to.deep.equal([record.width, record.height, record.offsetX, record.offsetY]);
      }
    }
    expect(twice.lemmingAnimation.length).to.equal(template.lemmingAnimation.length);
  });
});

// Run GC in a separate process so ordinary npm test does not need --expose-gc.
describe('palette ownership garbage collection', function() {
  this.timeout(30000);
  it('releases actors/history and retired preferences while bounding warm cache ownership', async function() {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['--expose-gc', 'scripts/bench-character-palettes.js', '--lifecycle-only'],
      { encoding: 'utf8', timeout: 25000 });
    expect(result.error).to.equal(undefined);
    expect(result.status, result.stderr || result.stdout).to.equal(0);
    const report = JSON.parse(result.stdout).lifecycle;
    expect(report.withActors).to.equal(396);
    expect(report.afterActors).to.equal(256);
    expect(report.afterClassic).to.equal(0);
    expect(report.weakEntriesAfterActors).to.equal(256);
    expect(report.weakEntriesAfterClassic).to.equal(0);
    expect(report.passed).to.equal(true);
  });
});
