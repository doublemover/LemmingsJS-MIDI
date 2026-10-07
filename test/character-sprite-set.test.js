import { expect } from 'chai';
import fs from 'node:fs';
import { CharacterSpriteSet, stableCharacterIndex, recolorManifest } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin, validateSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { ActionFloatingSystem } from '../js/actions/ActionFloatingSystem.js';
import { Lemming } from '../js/lemmings/Lemming.js';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const manifest = read('assets/hydro/hydro-skin.json');
const setup = (shape = 'mixed') => {
  let preference = { shape, bodyColor: null, propColor: null };
  const base = new PixelSpriteSkin(manifest);
  const set = new CharacterSpriteSet(base, catalog, path => fs.readFileSync(path, 'utf8'), () => preference);
  return { set, base, update: next => { preference = { ...preference, ...next }; } };
};

describe('stable-ID character appearance', function() {
  it('validates every recovered 337-frame body against the unchanged sprite contract', function() {
    expect(catalog.shapes).to.have.length(11);
    for (const shape of catalog.shapes) {
      const data = read(shape.path);
      expect(validateSkin(data)).to.equal(data);
      expect(data.animations.reduce((sum, animation) => sum + animation.frames.length, 0)).to.equal(337);
    }
  });

  it('uses the original provider without loading any alternate art in classic mode', async function() {
    const { set, base } = setup('classic');
    let loads = 0; set.loadText = () => { loads += 1; throw new Error('Unexpected load'); };
    expect(await set.prepare()).to.equal(true);
    expect(loads).to.equal(0);
    expect(set.getActorAnimation(SpriteTypes.WALKING, true, { id: 8 })).to.equal(base.getAnimation(SpriteTypes.WALKING, true));
  });

  it('selects one body for all actors and shares decoded frames', async function() {
    const { set } = setup('heart');
    expect(await set.prepare()).to.equal(true);
    const animation = set.getActorAnimation(SpriteTypes.WALKING, true, { id: 1 });
    for (let id = 0; id < 100; id += 1) expect(set.getActorAnimation(SpriteTypes.WALKING, true, { id })).to.equal(animation);
    expect(set.manifests.size).to.equal(1);
  });

  it('keeps mixed bodies stable through actor recreation, pooling and replay with no actor fields', async function() {
    const { set } = setup(); await set.prepare();
    const choices = new Set();
    for (let id = 0; id < 256; id += 1) {
      const actor = { id, x: 10, y: 20, frameIndex: 3, lookRight: true };
      const before = JSON.stringify(actor);
      const first = set.getActorAnimation(SpriteTypes.WALKING, true, actor);
      expect(set.getActorAnimation(SpriteTypes.WALKING, true, { ...actor })).to.equal(first);
      choices.add(set.appearanceForId(id).shape);
      actor.id = id + 1000; set.getActorAnimation(SpriteTypes.WALKING, true, actor);
      actor.id = id;
      expect(set.getActorAnimation(SpriteTypes.WALKING, true, actor)).to.equal(first);
      expect(JSON.stringify(actor)).to.equal(before);
    }
    expect(choices.size).to.equal(11);
    expect(stableCharacterIndex(4294967297, 11)).to.be.within(0, 10);
  });

  it('bounds palette variants and preserves shape, alpha, eyes and tool colors', async function() {
    const changed = recolorManifest(manifest, { bodyColor: '#f08030', propColor: '#6080a0' });
    expect(changed.animations).to.equal(manifest.animations);
    for (const index of [0, 1, 5, 9, 10]) expect(changed.palette[index]).to.deep.equal(manifest.palette[index]);
    expect(changed.palette.map(color => color[3])).to.deep.equal(manifest.palette.map(color => color[3]));
    expect(changed.palette[3]).to.deep.equal([240, 128, 48, 255]);
    const { set, update } = setup('heart');
    for (let index = 0; index < 40; index += 1) { update({ bodyColor: `#${(index * 1024).toString(16).padStart(6, '0')}` }); await set.prepare(); }
    expect(set.skins.size).to.be.at.most(32);
  });

  it('retries a missing manifest while preserving classic fallback', async function() {
    const { set, base } = setup('heart'); const load = set.loadText; let failures = 1;
    set.loadText = path => { if (failures--) throw new Error('Missing art'); return load(path); };
    expect(await set.prepare()).to.equal(false);
    expect(set.error).to.equal('Missing art');
    expect(set.skinForActor({ id: 1 })).to.equal(base);
    expect(await set.prepare()).to.equal(true);
    expect(set.skinForActor({ id: 1 })).not.to.equal(base);
  });

  it('routes the actual walking and floating draw paths without changing actor physics', async function() {
    const { set } = setup('heart'); await set.prepare();
    const actor = new Lemming(20, 30, 7);
    const walking = new ActionWalkSystem(set), floating = new ActionFloatingSystem(set);
    const calls = []; const display = { drawFrame: (...args) => calls.push(args) };
    actor.setAction(walking); actor.frameIndex = 3;
    const before = { x: actor.x, y: actor.y, frameIndex: actor.frameIndex, id: actor.id };
    walking.draw(display, actor);
    expect(calls[0][0]).to.equal(set.skinForActor(actor).getAnimation(SpriteTypes.WALKING, true).getFrame(3));
    expect({ x: actor.x, y: actor.y, frameIndex: actor.frameIndex, id: actor.id }).to.deep.equal(before);
    actor.setAction(floating); actor.frameIndex = 3; floating.draw(display, actor);
    expect(calls[1][0]).to.equal(set.skinForActor(actor).getAnimation(SpriteTypes.UMBRELLA, true).getFrame(5));
  });
});
