import { expect } from 'chai';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CharacterSpriteSet, recolorManifest, setCharacterPreference, getCharacterPreference } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin, validateSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { CHARACTER_HEADWEAR, CHARACTER_ACCESSORIES, validateAccessoryLayers, composeCharacterAccessories } from '../js/lemmings/CharacterAccessories.js';
import { CHARACTER_COLORS } from '../js/lemmings/characterColors.js';
import { createCharacterUiController } from '../js/app/characterUiController.js';
import { TestDocument, createTestWindow } from './helpers/test-dom.js';
import { registerElement } from './support/dom-fixtures.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const actualHats = CHARACTER_HEADWEAR.filter(item => !['beret', 'none'].includes(item.id));
const eyewearChoice = { eyewear: 'monocle' };

describe('native crown headwear replacements', function() {
  it('accounts for all native accessories and eyewear without silently listing unimplemented items', function() {
    const native = read('tools/character-sprites/native-color-catalog.json');
    expect([...CHARACTER_HEADWEAR.filter(item => item.id !== 'none').map(item => item.id), ...CHARACTER_ACCESSORIES.ears.map(item => item.id), ...CHARACTER_ACCESSORIES.neck.map(item => item.id)].sort())
      .to.deep.equal(native.accessories.map(item => item.id).sort());
    expect(CHARACTER_ACCESSORIES.eyewear.map(item => item.id).sort()).to.deep.equal(native.eyewear.filter(item => item.id !== 'none').map(item => item.id).sort());
  });

  it('validates all 12 bare packs against their exact accepted source and unchanged action timing/anchors', function() {
    for (const shape of catalog.shapes) {
      const source = read(shape.path), pack = read(shape.headwearPath);
      expect(pack.baseSha256).to.equal(createHash('sha256').update(fs.readFileSync(shape.path)).digest('hex'));
      expect(validateSkin(pack.bare)).to.equal(pack.bare);
      expect(validateAccessoryLayers(pack, pack.bare, shape.id, true)).to.equal(pack);
      const pad = pack.bare.renderPaddingTop - (source.renderPaddingTop || 0);
      source.animations.forEach((record, index) => {
        const bare = pack.bare.animations[index];
        for (const key of ['state', 'direction', 'width', 'offsetX', 'frameCount']) expect(bare[key], `${shape.id}/${record.state}/${key}`).to.equal(record[key]);
        expect(bare.height).to.equal(record.height + pad);
        expect(bare.offsetY).to.equal(record.offsetY - pad);
        record.frames.forEach((rows, frame) => rows.forEach((row, y) => [...row].forEach((symbol, x) => {
          if ('2345'.includes(symbol)) expect(bare.frames[frame][y + pad][x], `${shape.id}/${record.state}/${frame}/${x}/${y}`).to.equal(symbol);
        })));
      });
    }
  });

  it('draws every crown style at the body contour for both walking directions and each hop/squash frame', function() {
    for (const shape of catalog.shapes) {
      const pack = read(shape.headwearPath);
      for (const item of actualHats) {
        const composed = composeCharacterAccessories(pack.bare, pack, { accessory: item.id });
        expect(validateSkin(composed)).to.equal(composed);
        for (const record of composed.animations.filter(record => record.state === 'WALKING')) {
          const bare = pack.bare.animations.find(source => source.state === record.state && source.direction === record.direction);
          record.frames.forEach((rows, index) => {
            const pixels = rows.flatMap((row, y) => [...row].flatMap((symbol, x) => '678'.includes(symbol) ? [[x, y]] : []));
            expect(pixels.length, `${shape.id}/${item.id}/${record.direction}/${index}`).to.be.greaterThan(0);
            const contact = pixels.some(([x, y]) => [[x, y], [x-1, y], [x+1, y], [x, y-1], [x, y+1]].some(([nx, ny]) => '2345'.includes(bare.frames[index][ny]?.[nx] || '-')));
            expect(contact, `${shape.id}/${item.id}/${record.direction}/${index} floating cap`).to.equal(true);
          });
        }
      }
    }
  });

  it('keeps the literal donut aperture clear under all crowns and eyewear combinations', function() {
    const shape = catalog.shapes.find(shape => shape.id === 'donut'), pack = read(shape.headwearPath);
    for (const hat of actualHats) for (const eyewear of CHARACTER_ACCESSORIES.eyewear) {
      const composed = composeCharacterAccessories(pack.bare, pack, { accessory: hat.id, eyewear: eyewear.id });
      for (const record of composed.animations.filter(record => record.state === 'WALKING')) {
        const bare = pack.bare.animations.find(source => source.state === record.state && source.direction === record.direction);
        record.frames.forEach((rows, index) => {
          const source = bare.frames[index];
          for (let y = 0; y < source.length; y++) {
            // The ring aperture is the transparent span between its two rim eyes.
            const eyes = [...source[y]].flatMap((symbol, x) => symbol === '5' ? [x] : []);
            if (eyes.length === 2) for (let x = eyes[0]+1; x < eyes[1]; x++) {
              expect(rows[y][x], `${hat.id}/${eyewear.id}/${index}/${x}/${y}`).to.equal('0');
            }
          }
        });
      }
    }
  });

  it('keeps non-beret headwear seated while the separate floating canopy is active', function() {
    for (const shape of catalog.shapes) {
      const pack = read(shape.headwearPath);
      for (const hat of actualHats) {
        const composed = composeCharacterAccessories(pack.bare, pack, { accessory: hat.id, ...eyewearChoice });
        expect(composed.cosmetics).to.equal(undefined);
        for (const record of composed.animations.filter(record => record.state === 'UMBRELLA')) {
          expect(record.frames.slice(4).every((rows, offset) => pack.animations.find(source => source.state === record.state && source.direction === record.direction).items[hat.id][offset + 4] > 0), `${shape.id}/${hat.id}`).to.equal(true);
          expect(record.frames[5].slice(0, 9).join(''), `${shape.id}/${hat.id} canopy`).to.match(/[678]/);
        }
        const skin = new PixelSpriteSkin(composed), actor = { action: { getActionName: () => 'walk' }, frameIndex: 0 };
        skin.onActionChange(actor, { spriteProvider: skin, getActionName: () => 'floating' }, 10);
        expect(skin.drawCosmeticTransition({}, actor)).to.equal(false);
      }
    }
  });

  it('uses every native hat palette without recoloring separate eyewear or dark materials', function() {
    const pack = read(catalog.shapes.find(shape => shape.id === 'donut').headwearPath);
    for (const color of CHARACTER_COLORS.prop) {
      const colored = recolorManifest(pack.bare, { propColor: color.hex });
      const composed = composeCharacterAccessories(colored, pack, { accessory: 'crown', ...eyewearChoice,
        propColor: color.hex, eyewearColor: '#ffcc38' });
      expect(composed.palette[7]).to.deep.equal([...[1,3,5].map(index => parseInt(color.hex.slice(index,index+2),16)),255]);
      expect(composed.palette[3]).to.deep.equal(pack.bare.palette[3]);
      expect(composed.palette[13]).to.deep.equal([255,204,56,255]);
      expect(composed.palette.slice(14)).to.deep.equal([[32,34,40,255],[177,197,211,255]]);
    }
  });

  it('never combines two accessories, even if obsolete slot fields are supplied', function() {
    const shape = catalog.shapes.find(shape => shape.id === 'circle'), pack = read(shape.headwearPath);
    for (const accessory of ['headphones', 'bow', 'crown', 'none']) {
      const appearance = { accessory, eyewear: 'monocle', headwear: 'hat',
        accessories: { ears: 'headphones', neck: 'bow' } };
      setCharacterPreference({ shape: 'circle', ...appearance });
      expect(getCharacterPreference()).not.to.have.property('headwear');
      expect(getCharacterPreference()).not.to.have.property('accessories');
      const decorated = composeCharacterAccessories(pack.bare, pack, appearance);
      const walk = decorated.animations[0].frames.join('');
      expect(walk).to.match(/D/);
      if (accessory !== 'headphones') expect(walk).not.to.match(/B/);
      if (accessory !== 'bow') expect(walk).not.to.match(/C/);
      if (accessory !== 'crown') expect(walk).not.to.match(/[678]/);
    }
    expect(() => composeCharacterAccessories(read(shape.path), read(shape.accessoriesPath), { accessory: 'headphones' }))
      .to.throw('requires the bare body pack');
    setCharacterPreference({ shape: 'classic' });
  });

  it('returns exactly to the approved beret after swapping headwear without changing actor state', async function() {
    let preference = { shape: 'mixed' };
    const base = new PixelSpriteSkin(read('assets/hydro/hydro-skin.json'));
    const sprites = new CharacterSpriteSet(base, catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    expect(await sprites.prepare()).to.equal(true);
    const actors = Array.from({ length: 64 }, (_, id) => ({ id, x: 10, y: 20, frameIndex: 3 }));
    const before = JSON.stringify(actors);
    const original = actors.map(actor => [...sprites.skinForActor(actor).getAnimation(SpriteTypes.WALKING, true).getFrame(3).getData()]);
    for (const headwear of ['none','hat','crown']) {
      preference = { shape: 'mixed', accessory: headwear, ...eyewearChoice };
      expect(await sprites.prepare()).to.equal(true);
      expect(sprites.headwearLayers.size).to.equal(12);
      expect(sprites.skins.size).to.be.at.most(32);
    }
    preference = { shape: 'mixed' }; expect(await sprites.prepare()).to.equal(true);
    expect(actors.map(actor => [...sprites.skinForActor(actor).getAnimation(SpriteTypes.WALKING, true).getFrame(3).getData()])).to.deep.equal(original);
    expect(JSON.stringify(actors)).to.equal(before);
  });

  it('replaces the single accessory, persists the choice, and restores None/Beret independently of other slots', async function() {
    const document = new TestDocument(), window = createTestWindow(document);
    const add = (tag, id) => {
      const element = registerElement(document, tag, id);
      element.replaceChildren = () => { while (element.firstChild) element.removeChild(element.firstChild); };
      return element;
    };
    add('select', 'characterShape'); const head = add('select', 'characterAccessory');
    add('span', 'characterStatus');
    setCharacterPreference({ shape: 'circle', ...eyewearChoice });
    const controller = createCharacterUiController({ document, window,
      getView: () => ({ game: { gameResources: { characterSprites: { shapes: catalog.shapes, prepare: async () => true } }, render() {} } }) });
    controller.bind(); await controller.sync();
    expect(head.children).to.have.length(9);
    for (const value of ['hat','crown','none','beret']) {
      head.value = value; head.dispatchEvent({ type: 'change', target: head });
      expect(getCharacterPreference().accessory || 'beret').to.equal(value);
      expect(getCharacterPreference().eyewear).to.equal('monocle');
    }
    setCharacterPreference({ shape: 'classic', accessory: 'unknown' });
    expect(getCharacterPreference().accessory).to.equal(undefined);
  });
});
