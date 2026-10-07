import { refineCharacterPresentation } from '../js/lemmings/CharacterPresentation.js';
import { expect } from 'chai';
import fs from 'node:fs';
import { CharacterSpriteSet, getCharacterPreference, setCharacterPreference, recolorManifest } from '../js/lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../js/lemmings/characterColors.js';
import { composeCharacterAccessories } from '../js/lemmings/CharacterAccessories.js';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { GameResources } from '../js/game/GameResources.js';
import { ColorPalette } from '../js/render/ColorPalette.js';

const text = path => fs.readFileSync(path, 'utf8');
const read = path => JSON.parse(text(path));
const catalog = read('assets/characters/catalog.json');
const hydro = read('assets/hydro/hydro-skin.json');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const setup = (initial = { shape: 'heart' }) => {
  let preference = initial;
  const base = new PixelSpriteSkin(hydro);
  const sprites = new CharacterSpriteSet(base, catalog, text, () => preference);
  return { sprites, base, update: next => { preference = { ...preference, ...next }; } };
};
const walkFrame = (sprites, actor, tick = 0) => sprites.getActorAnimation(SpriteTypes.WALKING, true, actor).getFrame(tick);

describe('atomic character edits and stable named random palettes', function() {
  it('keeps every old actor appearance through slow loads, before prepare and at every pending tick', async function() {
    const { sprites, base, update } = setup();
    await sprites.prepare();
    const actors = Array.from({ length: 40 }, (_, id) => ({ id }));
    const ready = actors.map(actor => sprites.skinForActor(actor));
    const gate = deferred(); sprites.loadText = async path => { await gate.promise; return text(path); };
    update({ shape: 'donut', accessory: 'crown', bodyColor: '#fa70ab', eyewear: 'monocle' });
    expect(sprites.skinForActor(actors[0])).to.equal(ready[0]);
    const preparing = sprites.prepare();
    for (let tick = 0; tick < 20; tick++) {
      await Promise.resolve();
      actors.forEach((actor, index) => {
        expect(sprites.skinForActor(actor)).to.equal(ready[index]).and.not.equal(base);
        expect(walkFrame(sprites, actor, tick)).to.equal(ready[index].getAnimation(SpriteTypes.WALKING, true).getFrame(tick));
      });
    }
    gate.resolve(); expect(await preparing).to.equal(true);
    for (const actor of actors) expect(sprites.appearanceForActor(actor).shape).to.equal('donut');
    expect(sprites.skinForActor(actors[0])).not.to.equal(ready[0]).and.not.equal(base);
  });

  it('retains ready art through malformed or missing art and retries the same requested edit', async function() {
    const { sprites, base, update } = setup(); await sprites.prepare();
    const actor = { id: 7 }, ready = sprites.skinForActor(actor);
    update({ shape: 'donut' }); sprites.loadText = () => '{"format":"broken"}';
    expect(await sprites.prepare()).to.equal(false);
    expect(sprites.error).to.include('Invalid sprite skin');
    expect(sprites.skinForActor(actor)).to.equal(ready).and.not.equal(base);
    expect(sprites.appearanceForActor(actor).shape).to.equal('heart');
    sprites.loadText = text;
    expect(await sprites.prepare()).to.equal(true);
    expect(sprites.skinForActor(actor)).not.to.equal(ready).and.not.equal(base);
  });

  for (const fail of [false, true]) it(`ignores a stale ${fail ? 'failure' : 'success'} after a newer edit commits`, async function() {
    const { sprites, update } = setup(); await sprites.prepare();
    const gate = deferred();
    sprites.loadText = path => path === 'assets/characters/donut.json' ? gate.promise : text(path);
    update({ shape: 'donut' }); const older = sprites.prepare();
    await Promise.resolve(); update({ shape: 'circle', bodyColor: '#ffcc38' });
    expect(await sprites.prepare()).to.equal(true);
    const ready = sprites.skinForActor({ id: 2 });
    if (fail) gate.reject(new Error('Late missing shape'));
    else gate.resolve(text('assets/characters/donut.json'));
    await older;
    expect(sprites.skinForActor({ id: 2 })).to.equal(ready);
    expect(sprites.appearanceForId(2).shape).to.equal('circle');
    expect(sprites.error).to.equal(null);
  });

  it('does not flash an obsolete explicit classic selection during a rapid sequence', async function() {
    const { sprites, base, update } = setup(); await sprites.prepare();
    const old = sprites.skinForActor({ id: 3 });
    update({ shape: 'classic' }); const classic = sprites.prepare();
    update({ shape: 'circle' }); const latest = sprites.prepare();
    expect(sprites.skinForActor({ id: 3 })).to.equal(old).and.not.equal(base);
    await Promise.all([classic, latest]);
    expect(sprites.appearanceForId(3).shape).to.equal('circle');
    update({ shape: 'classic' }); await sprites.prepare();
    expect(sprites.skinForActor({ id: 3 })).to.equal(base);
  });

  it('prepares all mixed shapes before returning initial game sprites', async function() {
    const saved = getCharacterPreference();
    try {
      setCharacterPreference({ shape: 'mixed', seed: 75, bodyColor: '#4778ff', propColor: '#ff8066' });
      const gate = deferred(); let returned = false;
      const resources = new GameResources({ loadString: async path => {
        if (path === catalog.shapes[11].path) await gate.promise;
        return text(path);
      } }, { spriteSkin: 'assets/hydro/hydro-skin.json', characterCatalog: 'assets/characters/catalog.json' });
      const ready = resources.getLemmingsSprite(new ColorPalette()).then(sprites => { returned = true; return sprites; });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(returned).to.equal(false);
      gate.resolve(); const sprites = await ready;
      expect(sprites.activeSkins).to.have.length(12);
      for (let id = 0; id < 80; id++) expect(sprites.skinForActor({ id })).not.to.equal(sprites.base);
    } finally { setCharacterPreference(saved); }
  });

  it('surfaces a missing catalog without rendering classic unless explicitly selected', async function() {
    const saved = getCharacterPreference();
    try {
      setCharacterPreference({ shape: 'mixed' });
      const resources = new GameResources({ loadString: async path => {
        if (path.endsWith('catalog.json')) throw new Error('Offline catalog');
        return text(path);
      } }, { spriteSkin: 'assets/hydro/hydro-skin.json', characterCatalog: 'assets/characters/catalog.json' });
      const sprites = await resources.getLemmingsSprite(new ColorPalette());
      expect(resources.characterSprites).to.equal(sprites);
      expect(sprites.error).to.include('Offline catalog');
      expect([...walkFrame(sprites, { id: 1 }).mask]).to.deep.equal([0]);
      expect(await sprites.prepare()).to.equal(false);
      expect(sprites.error).to.include('Offline catalog');
      setCharacterPreference({ shape: 'classic' });
      expect(await sprites.prepare()).to.equal(true);
      expect(sprites.skinForActor({ id: 1 })).to.equal(sprites.base);
    } finally { setCharacterPreference(saved); }
  });

  it('accepts only allowed named palette hex values or random and preserves the persisted seed', function() {
    const saved = getCharacterPreference();
    try {
      expect(setCharacterPreference({ bodyColor: '#123456', propColor: '#abcdef', eyewearColor: '#000000', seed: 28 }))
        .to.deep.equal({ shape: 'mixed', seed: 28, bodyColor: null, propColor: null });
      expect(setCharacterPreference({ shape: 'mixed', bodyColor: 'random', propColor: '#FFCC38', eyewearColor: 'random' }))
        .to.deep.equal({ shape: 'mixed', seed: 28, bodyColor: 'random', propColor: '#ffcc38', eyewearColor: 'random' });
    } finally { setCharacterPreference(saved); }
  });

  it('keeps every random part stable across rewind, pooling, re-creation and mode changes', async function() {
    const preference = { shape: 'mixed', seed: 857, bodyColor: 'random', propColor: 'random', eyewearColor: 'random', accessory: 'headphones', eyewear: 'monocle' };
    const { sprites, update } = setup(preference); await sprites.prepare();
    expect(sprites.paletteSkins.size).to.equal(0);
    expect(sprites.skins.size).to.be.at.most(24);
    const actors = Array.from({ length: 100 }, (_, id) => ({ id, x: 15, y: 20, frameIndex: 0 }));
    const originalActors = JSON.stringify(actors);
    const appearances = actors.map(actor => sprites.appearanceForActor(actor));
    const frames = actors.map(actor => walkFrame(sprites, actor, 3));
    sprites.loadText = () => { throw new Error('Render must not fetch'); };
    sprites.templateForAppearance = () => { throw new Error('Render must not decode'); };
    for (let pass = 0; pass < 4; pass++) actors.forEach((actor, index) => {
      expect(walkFrame(sprites, actor, 3)).to.equal(frames[index]);
      expect(sprites.appearanceForActor({ ...actor })).to.deep.equal(appearances[index]);
    });
    for (const part of ['body', 'prop', 'eyewear']) {
      const allowed = CHARACTER_COLORS[part === 'body' ? 'body' : 'prop'].map(color => color.hex);
      expect(new Set(appearances.map(value => value[`${part}Color`])).size).to.equal(allowed.length);
      for (const value of appearances) expect(allowed).to.include(value[`${part}Color`]);
    }
    const pooled = actors[0]; pooled.id = 903;
    expect(sprites.appearanceForActor(pooled)).not.to.deep.equal(appearances[0]);
    pooled.id = 0;
    expect(walkFrame(sprites, pooled, 3)).to.equal(frames[0]);
    expect(JSON.stringify(actors)).to.equal(originalActors);
    delete sprites.templateForAppearance;
    update({ shape: 'heart' }); await sprites.prepare();
    update({ shape: 'mixed' }); await sprites.prepare();
    expect(actors.map(actor => sprites.appearanceForActor(actor))).to.deep.equal(appearances);
    expect(actors.map(actor => [...walkFrame(sprites, actor, 3).data])).to.deep.equal(frames.map(frame => [...frame.data]));
  });

  it('balances indexed lanes over all shapes and each random palette, including 1024 stable live actors', async function() {
    const { sprites } = setup({ shape: 'mixed', seed: 321, bodyColor: 'random', propColor: 'random', eyewearColor: 'random', accessory: 'crown', eyewear: 'monocle' });
    await sprites.prepare();
    const actors = Array.from({ length: 1024 }, (_, id) => ({ id, appearanceIndex: id }));
    for (const count of [1, 9, 12, 50, 1024]) {
      const appearances = actors.slice(0, count).map(actor => sprites.appearanceForActor(actor));
      for (const [key, values] of [['shape', catalog.shapes.map(shape => shape.id)], ['bodyColor', CHARACTER_COLORS.body.map(color => color.hex)],
        ['propColor', CHARACTER_COLORS.prop.map(color => color.hex)], ['eyewearColor', CHARACTER_COLORS.prop.map(color => color.hex)]]) {
        const counts = values.map(value => appearances.filter(appearance => appearance[key] === value).length);
        expect(Math.max(...counts) - Math.min(...counts)).to.be.at.most(1);
      }
    }
    const frames = actors.map(actor => walkFrame(sprites, actor));
    for (let i = 0; i < actors.length; i++) expect(walkFrame(sprites, actors[i])).to.equal(frames[i]);
    expect(sprites.paletteSkins.size).to.be.at.most(256);
  });

  it('preserves exact accessory composition and materials with independent random color remaps', async function() {
    const { sprites } = setup({ shape: 'donut', seed: 32, bodyColor: 'random', propColor: 'random', eyewearColor: 'random', accessory: 'headphones', eyewear: 'monocle' });
    await sprites.prepare();
    const actor = { id: 80 }, appearance = sprites.appearanceForActor(actor);
    const pack = read(catalog.shapes.find(shape => shape.id === 'donut').headwearPath);
    const source = read(catalog.shapes.find(shape => shape.id === 'donut').path);
    const composed = composeCharacterAccessories(recolorManifest(pack.bare, appearance), pack, appearance);
    const expected = new PixelSpriteSkin(refineCharacterPresentation(composed, source, 'donut', pack, appearance));
    const actual = sprites.skinForActor(actor);
    expect([...actual.colorPalette.data]).to.deep.equal([...expected.colorPalette.data]);
    for (const record of pack.bare.animations) {
      const animation = actual.getAnimation(SpriteTypes[record.state], record.direction >= 0);
      const original = expected.getAnimation(SpriteTypes[record.state], record.direction >= 0);
      record.frames.forEach((_, index) => {
        expect([...animation.getFrame(index).data]).to.deep.equal([...original.getFrame(index).data]);
        expect([...animation.getFrame(index).mask]).to.deep.equal([...original.getFrame(index).mask]);
      });
    }
  });
});
