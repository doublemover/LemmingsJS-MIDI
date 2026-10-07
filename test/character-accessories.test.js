import { expect } from 'chai';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CharacterSpriteSet, getCharacterPreference, setCharacterPreference } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin, validateSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { CHARACTER_ACCESSORIES, validateAccessoryLayers, composeCharacterAccessories } from '../js/lemmings/CharacterAccessories.js';
import { createCharacterUiController } from '../js/app/characterUiController.js';
import { TestDocument, createTestWindow } from './helpers/test-dom.js';
import { registerElement } from './support/dom-fixtures.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const hydro = read('assets/hydro/hydro-skin.json');
const selected = { eyewear: 'monocle' };
const largestBodyInterior = rows => {
  const visited = new Set(), components = [];
  const width = rows[0].length, height = rows.length;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rows[y][x] !== '0' || visited.has(`${x}:${y}`)) continue;
    const points = [[x, y]]; visited.add(`${x}:${y}`); let exterior = false, bodyBoundary = true;
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      if (px === 0 || py === 0 || px === width-1 || py === height-1) exterior = true;
      for (const [nx, ny] of [[px-1, py], [px+1, py], [px, py-1], [px, py+1]]) {
        if (rows[ny]?.[nx] && rows[ny][nx] !== '0' && !'2345'.includes(rows[ny][nx])) bodyBoundary = false;
        if (rows[ny]?.[nx] !== '0' || visited.has(`${nx}:${ny}`)) continue;
        visited.add(`${nx}:${ny}`); points.push([nx, ny]);
      }
    }
    if (!exterior && bodyBoundary) components.push(points);
  }
  return components.sort((a, b) => b.length-a.length)[0] || [];
};

describe('native character accessory layers', function() {
  it('validates every body and exact approved asset hash, including all 379 attachment frames', function() {
    for (const shape of catalog.shapes) {
      const manifest = read(shape.path), pack = read(shape.accessoriesPath);
      expect(pack.baseSha256).to.equal(createHash('sha256').update(fs.readFileSync(shape.path)).digest('hex'));
      expect(validateAccessoryLayers(pack, manifest, shape.id)).to.equal(pack);
      for (const item of CHARACTER_ACCESSORIES.eyewear) {
        const decorated = composeCharacterAccessories(manifest, pack, { eyewear: item.id });
        expect(validateSkin(decorated)).to.equal(decorated);
        expect(decorated.animations.reduce((sum, record) => sum + record.frameCount, 0)).to.equal(337);
        expect(decorated.cosmetics.beretLanding.variants).to.have.length(6);
        const walk = decorated.animations.find(record => record.state === 'WALKING' && record.direction === 1);
        expect(walk.frames, `${shape.id}/${item.id}`).not.to.deep.equal(manifest.animations[0].frames);
      }
    }
  });

  it('keeps the beret, tools, water, alpha aperture, and original source rows intact', function() {
    for (const shape of catalog.shapes) {
      const manifest = read(shape.path), before = JSON.stringify(manifest), pack = read(shape.accessoriesPath);
      const decorated = composeCharacterAccessories(manifest, pack, selected);
      for (const [index, record] of manifest.animations.entries()) {
        expect(decorated.animations[index].offsetX).to.equal(record.offsetX);
        expect(decorated.animations[index].offsetY).to.equal(record.offsetY);
        record.frames.forEach((rows, frame) => rows.forEach((row, y) => [...row].forEach((symbol, x) => {
          if ('16789A'.includes(symbol)) expect(decorated.animations[index].frames[frame][y][x]).to.equal(symbol);
        })));
        if (shape.id === 'donut') record.frames.forEach((rows, frame) => {
          const aperture = largestBodyInterior(rows);
          if (aperture.length >= 2) for (const [x, y] of aperture) {
            expect(decorated.animations[index].frames[frame][y][x], `${record.state}/${frame}/${x}/${y}`).to.equal('0');
          }
        });
      }
      expect(JSON.stringify(manifest)).to.equal(before);
      for (const variant of decorated.cosmetics.beretLanding.variants) {
        const walk = decorated.animations.find(record => record.state === 'WALKING' && record.direction === variant.direction);
        expect(variant.frames[6].slice(6), shape.id).to.deep.equal(walk.frames[6]);
      }
    }
  });

  it('colors the one accessory and separate eyewear while keeping lens and ear-pad material fixed', function() {
    const shape = catalog.shapes.find(shape => shape.id === 'circle');
    const pack = read(shape.headwearPath), manifest = pack.bare;
    const result = composeCharacterAccessories(manifest, pack, { accessory: 'headphones', eyewear: 'monocle', propColor: '#04bb9f', eyewearColor: '#ffcc38' });
    expect(result.palette.slice(0, 11)).to.deep.equal(manifest.palette);
    expect(result.palette.slice(11)).to.deep.equal([[4,187,159,255], [4,187,159,255], [255,204,56,255], [32,34,40,255], [177,197,211,255]]);
    expect(result.symbols).to.equal('0123456789ABCDEF');
    expect(result.animations[0].frames.join('')).to.match(/B/).and.match(/D/).and.match(/E/);
    expect(result.animations[0].frames.join('')).not.to.match(/[C678]/);
  });

  it('loads no extra pack for an undecorated beret, shares requests, and retries an unavailable pack', async function() {
    let preference = { shape: 'circle' }, fail = false;
    const loads = [], base = new PixelSpriteSkin(hydro);
    const sprites = new CharacterSpriteSet(base, catalog, file => {
      loads.push(file);
      if (fail && file.includes('/accessories/')) throw new Error('Offline accessory pack');
      return fs.readFileSync(file, 'utf8');
    }, () => preference);
    expect(await sprites.prepare()).to.equal(true);
    expect(loads).to.have.length(1);
    const ready = sprites.skinForActor({ id: 3 });
    preference = { shape: 'circle', ...selected }; fail = true;
    expect(await sprites.prepare()).to.equal(false);
    expect(sprites.skinForActor({ id: 3 })).to.equal(ready);
    fail = false;
    expect(await Promise.all([sprites.prepare(), sprites.prepare()])).to.deep.equal([true, true]);
    expect(loads.filter(file => file.includes('/accessories/'))).to.have.length(2);
    const actor = { id: 3, x: 18, y: 30, frameIndex: 4 };
    const before = JSON.stringify(actor);
    expect(sprites.skinForActor(actor).getAnimation(SpriteTypes.WALKING, true)).not.to.equal(base.getAnimation(SpriteTypes.WALKING, true));
    expect(JSON.stringify(actor)).to.equal(before);
  });

  it('keeps mixed-body identity stable and bounds independently colored accessory variants', async function() {
    let preference = { shape: 'mixed', ...selected };
    const sprites = new CharacterSpriteSet(new PixelSpriteSkin(hydro), catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    expect(await sprites.prepare()).to.equal(true);
    const identities = Array.from({ length: 64 }, (_, id) => sprites.appearanceForId(id).shape);
    for (let i = 0; i < 4; i++) {
      preference = { shape: 'mixed', eyewear: i % 2 ? 'round_sunglasses' : 'monocle', eyewearColor: `#${i}1ff22` };
      expect(await sprites.prepare()).to.equal(true);
      expect(identities).to.deep.equal(identities.map((_, id) => sprites.appearanceForId(id).shape));
    }
    expect(sprites.skins.size).to.be.at.most(32);
  });

  it('rejects malformed patches and wrong body/frame identities before rendering', function() {
    const shape = catalog.shapes[0], manifest = read(shape.path);
    for (const mutate of [
      pack => { pack.shapeId = 'wrong'; },
      pack => { pack.patches[1][2][0] = 'INVALID'; },
      pack => { pack.animations[0].items.bow[0] = -1; },
      pack => { pack.animations[0].state = 'UNKNOWN'; },
      pack => { pack.landing[0].direction = 0; },
      pack => { pack.patches[1][0] = 900; }
    ]) {
      const pack = read(shape.accessoriesPath); mutate(pack);
      expect(() => validateAccessoryLayers(pack, manifest, shape.id)).to.throw('Invalid character accessories');
    }
  });

  it('replaces the single accessory, preserves separate eyewear, and disables custom art choices in classic mode', async function() {
    const document = new TestDocument(), window = createTestWindow(document);
    const add = (tag, id) => {
      const element = registerElement(document, tag, id);
      element.replaceChildren = () => { while (element.firstChild) element.removeChild(element.firstChild); };
      return element;
    };
    for (const id of ['characterShape','characterBodyPalette','characterPropPalette']) add('select', id);
    for (const id of ['characterCustomColors','characterBodyColor','characterPropColor']) add('input', id);
    add('span', 'characterStatus');
    add('select', 'characterAccessory'); add('select', 'characterEyewear'); add('select', 'characterEyewearPalette'); add('input', 'characterEyewearColor');
    setCharacterPreference({ shape: 'circle', accessory: 'headphones', ...selected });
    const controller = createCharacterUiController({ document, window,
      getView: () => ({ game: { gameResources: { characterSprites: { shapes: catalog.shapes, prepare: async () => true } }, render() {} } }) });
    controller.bind(); await controller.sync();
    const eyewear = document.getElementById('characterEyewear');
    eyewear.value = 'round_sunglasses'; eyewear.dispatchEvent({ type: 'change', target: eyewear });
    expect(getCharacterPreference().accessory).to.equal('headphones');
    expect(getCharacterPreference().eyewear).to.equal('round_sunglasses');
    const accessory = document.getElementById('characterAccessory'); accessory.value = 'bow'; accessory.dispatchEvent({ type: 'change', target: accessory });
    expect(getCharacterPreference().accessory).to.equal('bow');
    expect(getCharacterPreference().accessories).to.equal(undefined);
    const color = document.getElementById('characterEyewearPalette');
    color.value = '#fa70ab'; color.dispatchEvent({ type: 'change', target: color });
    expect(getCharacterPreference().eyewearColor).to.equal('#fa70ab');
    expect(getCharacterPreference().bodyColor).to.equal(null);
    const shape = document.getElementById('characterShape'); shape.value = 'classic'; shape.dispatchEvent({ type: 'change', target: shape });
    await controller.sync(); expect(eyewear.disabled).to.equal(true);
    expect(getCharacterPreference().accessory).to.equal('bow');
    setCharacterPreference({ shape: 'classic', accessory: ['bow','hat'], accessories: { ears: 'bow', eyewear: 'crown' }, accessoryColors: { ears: 'invalid' } });
    expect(getCharacterPreference().accessories).to.equal(undefined);
    expect(getCharacterPreference().accessory).to.equal(undefined);
  });
});
