import { expect } from 'chai';
import fs from 'node:fs';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { ActionFloatingSystem } from '../js/actions/ActionFloatingSystem.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';

const read = path => fs.readFileSync(path, 'utf8');
const setup = (initial = {}) => {
  let preference = { shape: 'heart', accessory: 'beret', ...initial };
  const base = new PixelSpriteSkin(JSON.parse(read('assets/hydro/hydro-skin.json')));
  const sprites = new CharacterSpriteSet(base, JSON.parse(read('assets/characters/catalog.json')), read, () => preference);
  return { sprites, base, update: next => { preference = { ...preference, ...next }; } };
};
const land = (sprites, actor) => {
  actor.setAction(new ActionFloatingSystem(sprites)); actor.frameIndex = 10;
  actor.setAction(new ActionWalkSystem(sprites));
};
const drawsTransition = (skin, actor) => skin.drawCosmeticTransition({ drawFrame() {} }, actor);

describe('bounded actor skin ownership', function() {
  it('resets only the owning skin without enumerating any cache', async function() {
    const { sprites, base } = setup(); await sprites.prepare();
    const actor = new Lemming(20, 30, 7), skin = sprites.skinForActor(actor);
    let resets = 0; const reset = skin.resetActor.bind(skin);
    skin.resetActor = lem => { expect(lem).to.equal(actor); resets++; reset(lem); };
    base.resetActor = () => { throw new Error('Unowned base reset'); };
    for (const cache of [sprites.skins, sprites.paletteSkins]) cache.values = () => { throw new Error('Unbounded cache scan'); };
    sprites.activeSkins[Symbol.iterator] = () => { throw new Error('Unbounded active scan'); };
    sprites.resetActor(actor); sprites.resetActor(actor);
    expect(resets).to.equal(2);
    expect(sprites.skinForActor(actor)).to.equal(skin);
    sprites.resetActor({ id: 123 });
    expect(resets).to.equal(2);
  });

  it('retains all 1024 indexed palette owners through repeated offscreen action changes beyond the shared LRU', async function() {
    const { sprites } = setup({ shape: 'mixed', seed: 321, bodyColor: 'random', propColor: 'random', eyewearColor: 'random' });
    await sprites.prepare();
    const actors = Array.from({ length: 1024 }, (_, id) => Object.assign(new Lemming(20, 30, id), { appearanceIndex: id }));
    const floating = new ActionFloatingSystem(sprites), walking = new ActionWalkSystem(sprites);
    const skins = actors.map(actor => sprites.skinForActor(actor));
    expect(new Set(skins).size).to.be.greaterThan(256);
    expect(sprites.paletteSkins.size).to.be.at.most(256);
    sprites.colorSkin = () => { throw new Error('Stable owner must not reallocate a palette on action change'); };
    for (let pass = 0; pass < 3; pass++) actors.forEach((actor, index) => {
      actor.setAction(floating); actor.frameIndex = 10; actor.setAction(walking);
      expect(sprites.skinForActor(actor)).to.equal(skins[index]);
      expect(drawsTransition(sprites, actor)).to.equal(true);
    });
  });

  it('invalidates previous cosmetic ownership atomically and never resurrects it when selecting old art again', async function() {
    const { sprites, update } = setup(); await sprites.prepare();
    const actor = new Lemming(20, 30, 7); land(sprites, actor);
    const previous = sprites.skinForActor(actor);
    expect(drawsTransition(previous, actor)).to.equal(true);
    update({ shape: 'donut' }); await sprites.prepare();
    const next = sprites.skinForActor(actor);
    expect(next).not.to.equal(previous);
    expect(drawsTransition(previous, actor)).to.equal(false);
    expect(drawsTransition(next, actor)).to.equal(false);
    update({ shape: 'heart' }); await sprites.prepare();
    expect(sprites.skinForActor(actor)).to.equal(previous);
    expect(drawsTransition(sprites, actor)).to.equal(false);
    land(sprites, actor);
    expect(drawsTransition(sprites, actor)).to.equal(true);
  });

  it('clears cosmetic state when pooled IDs or lane appearance indices change even if the palette stays identical', async function() {
    const { sprites } = setup(); await sprites.prepare();
    const actor = new Lemming(20, 30, 7);
    for (const change of [() => { actor.id = 8; }, () => { actor.appearanceIndex = 9; }, () => actor.reset(20, 30, 10)]) {
      land(sprites, actor); const skin = sprites.skinForActor(actor);
      expect(drawsTransition(skin, actor)).to.equal(true);
      change();
      expect(sprites.skinForActor(actor)).to.equal(skin);
      expect(drawsTransition(skin, actor)).to.equal(false);
    }
  });

  it('owns classic hooks before preparation and invalidates stale or removed actors without affecting another owner', async function() {
    const { sprites, base, update } = setup({ shape: 'classic' });
    const actor = new Lemming(20, 30, 7), other = new Lemming(25, 30, 8);
    let resets = 0; base.resetActor = () => { resets++; };
    actor.setAction(new ActionWalkSystem(sprites));
    const beforeReset = resets;
    sprites.resetActor(actor); expect(resets).to.equal(beforeReset + 1);
    update({ shape: 'heart' }); await sprites.prepare();
    land(sprites, actor); land(sprites, other);
    expect(resets).to.equal(beforeReset + 3);
    actor.remove();
    expect(drawsTransition(sprites, other)).to.equal(true);
    expect(sprites.getActorAnimation(SpriteTypes.WALKING, true, other)).to.exist;
  });
});
