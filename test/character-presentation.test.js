import { expect } from 'chai';
import fs from 'node:fs';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin, validateSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { refineCharacterPresentation, bodyBounds, GAITS, easeInExpo, drowningSink } from '../js/lemmings/CharacterPresentation.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { composeCharacterAccessories } from '../js/lemmings/CharacterAccessories.js';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const catalog = read('assets/characters/catalog.json');
const interior = rows => {
  const width = rows[0].length, height = rows.length, outside = new Set(), queue = [];
  const visit = (x, y) => {
    const key = y * width + x;
    if (x < 0 || x >= width || y < 0 || y >= height || rows[y][x] !== '0' || outside.has(key)) return;
    outside.add(key); queue.push([x, y]);
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]; visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  return rows.flatMap((row, y) => [...row].filter((symbol, x) => symbol === '0' && !outside.has(y * width + x))).length;
};

describe('readable proportional character presentation', function() {
  it('keeps source art and all 337 frame contracts while fitting every digger body within the 9px cut', function() {
    for (const shape of catalog.shapes) {
      const source = read(shape.path), before = JSON.stringify(source);
      const refined = refineCharacterPresentation(source, source, shape.id);
      expect(validateSkin(refined)).to.equal(refined);
      expect(JSON.stringify(source)).to.equal(before);
      expect(refined.presentation.scale).to.be.within(0.63, 1);
      expect(refined.animations.reduce((sum, record) => sum + record.frameCount, 0)).to.equal(337);
      for (const record of refined.animations.filter(record => ['WALKING', 'DIGGING'].includes(record.state))) {
        for (const rows of record.frames) expect(bodyBounds(rows).width, `${shape.id}/${record.state}`).to.be.at.most(7);
      }
      const walk = refined.animations[0];
      expect(bodyBounds(walk.frames[0]).bottom + walk.offsetY, shape.id).to.equal(-1);
      expect(refined.animations.at(-1).frames).to.deep.equal(source.animations.at(-1).frames);
    }
  });

  it('rejects unbounded or malformed optional particle layers before decoding', function() {
    const source = read(catalog.shapes[0].path);
    for (const change of [
      manifest => { manifest.particleParts.push(manifest.particleParts[0]); },
      manifest => { manifest.particleParts[0].width = 1000000; },
      manifest => { manifest.particleParts[0].direction = 1; },
      manifest => { manifest.particleParts[0].eyewear[0] = 'invalid'; }
    ]) {
      const manifest = refineCharacterPresentation(source, source, catalog.shapes[0].id);
      change(manifest);
      expect(() => new PixelSpriteSkin(manifest)).to.throw('Invalid sprite skin: particle');
    }
  });

  it('uses distinct restrained silhouette gaits without stretching or repeated squash', function() {
    expect(new Set(Object.values(GAITS).map(profile => JSON.stringify(profile))).size).to.equal(12);
    for (const shape of catalog.shapes) {
      const source = read(shape.path), refined = refineCharacterPresentation(source, source, shape.id);
      const record = refined.animations[0], neutral = bodyBounds(record.frames[0]);
      for (let i = 0; i < record.frames.length; i++) {
        const bounds = bodyBounds(record.frames[i]);
        if (!GAITS[shape.id].roll) {
          expect(bounds.height).to.equal(neutral.height);
          expect(bounds.width).to.equal(neutral.width);
          expect(neutral.bottom - bounds.bottom).to.equal(GAITS[shape.id].hop[i]);
        }
        expect(bounds.bottom + record.offsetY).to.be.at.most(-1);
      }
    }
  });

  it('preserves wall-side and exact world-space builder brick contacts', function() {
    for (const shape of catalog.shapes) {
      const source = read(shape.path), refined = refineCharacterPresentation(source, source, shape.id);
      for (const record of refined.animations.filter(record => record.state === 'CLIMBING')) {
        for (const rows of record.frames) rows.forEach(row => [...row].forEach((symbol, x) => {
          if (symbol !== '0') expect(record.direction === 1 ? x <= 8 : x >= 8, `${shape.id}/${record.direction}/${x}`).to.equal(true);
        }));
      }
      for (const record of refined.animations.filter(record => record.state === 'BUILDING')) {
        const original = source.animations.find(entry => entry.state === record.state && entry.direction === record.direction);
        const y = -record.offsetY - 1;
        for (let x = 0; x < record.width; x++) if ('678'.includes(original.frames[9][y][x])) expect(record.frames[9][y][x]).to.equal(original.frames[9][y][x]);
      }
    }
  });

  it('retains the donut aperture in every active pose, landing and headwear combination', function() {
    const shape = catalog.shapes.find(shape => shape.id === 'donut'), source = read(shape.path), pack = read(shape.headwearPath);
    for (const accessory of ['none', 'crown', 'headphones', 'hat']) {
      const appearance = { accessory, eyewear: 'monocle' };
      const refined = refineCharacterPresentation(composeCharacterAccessories(pack.bare, pack, appearance), source, shape.id, pack, appearance);
      const terminalStart = { DROWNING: 8, SPLATTING: 3, EXITING: 6, FRYING: 9, EXPLODING: 0 };
      for (const record of refined.animations) record.frames.forEach((rows, index) => {
        if (index < (terminalStart[record.state] ?? Infinity)) expect(interior(rows), `${accessory}/${record.state}/${index}`).to.be.greaterThan(0);
      });
    }
    const refined = refineCharacterPresentation(source, source, shape.id);
    for (const variant of refined.cosmetics.beretLanding.variants) for (const rows of variant.frames) expect(interior(rows)).to.be.greaterThan(0);
  });

  it('keeps recolored wearable particle layers separate and stops attached death duplication', async function() {
    const preference = { shape: 'rounded_head_two_ears', accessory: 'headphones', eyewear: 'monocle', bodyColor: '#4778ff', propColor: '#ff8066', eyewearColor: '#1f1f1f' };
    const sprites = new CharacterSpriteSet(new PixelSpriteSkin(read(catalog.shapes[0].path)), catalog, file => fs.readFileSync(file, 'utf8'), () => preference);
    expect(await sprites.prepare()).to.equal(true);
    for (const lookRight of [true, false]) {
      const actor = { id: 73, lookRight }, before = JSON.stringify(actor), parts = sprites.getActorParticleParts(actor);
      for (const key of ['body', 'accessory', 'eyewear']) {
        expect(parts[key]?.getMask().some(Boolean), key).to.equal(true);
        expect(parts[key].offsetX).to.equal(-8);
      }
      for (let i = 0; i < parts.body.mask.length; i++) expect(parts.body.mask[i] + parts.accessory.mask[i] + parts.eyewear.mask[i]).to.be.at.most(1);
      expect(sprites.getActorParticleParts(actor)).to.equal(parts);
      expect(JSON.stringify(actor)).to.equal(before);
      const skin = sprites.skinForActor(actor);
      for (const state of ['DROWNING', 'SPLATTING', 'FRYING']) {
        for (const frame of skin.getAnimation(SpriteTypes[state], lookRight).frames.slice(1)) {
          const colors = new Set(frame.data);
          for (const index of [7, 11, 12, 13, 14, 15]) expect(colors.has(skin.colorPalette.data[index]), `${state}/${index}`).to.equal(false);
        }
      }
    }
  });

  it('uses the official easeInExpo curve after the hands-up contact beat', function() {
    expect(easeInExpo(0)).to.equal(0);
    expect(easeInExpo(0.25)).to.equal(2 ** -7.5);
    expect(easeInExpo(0.5)).to.equal(1 / 32);
    expect(easeInExpo(0.75)).to.equal(2 ** -2.5);
    expect(easeInExpo(1)).to.equal(1);
    const offsets = Array.from({ length: 16 }, (_, index) => drowningSink(index, 9));
    expect(offsets).to.deep.equal([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 3, 5, 9, 9]);
  });

  it('raises little hands and clips every sinking shape at one fixed waterline', function() {
    for (const shape of catalog.shapes) {
      const source = read(shape.path), refined = refineCharacterPresentation(source, source, shape.id);
      const record = refined.animations.find(entry => entry.state === 'DROWNING');
      const walk = refined.animations.find(entry => entry.state === 'WALKING' && entry.direction === 1);
      const bounds = bodyBounds(walk.frames[0]), floor = -record.offsetY - 1;
      for (const index of [1, 2, 3]) {
        const y = bounds.top + (index < 3 ? 2 - index : 0);
        for (const x of [bounds.left - 1, bounds.right + 1]) expect(record.frames[index][y][x], `${shape.id}/${index}`).to.equal('4');
      }
      for (let index = 3; index < 14; index++) {
        const sink = drowningSink(index, bounds.height + 2);
        for (let y = bounds.top; y < floor; y++) for (let x = bounds.left; x <= bounds.right; x++) {
          expect(record.frames[index][y][x], `${shape.id}/${index}/${x}/${y}`).to.equal(record.frames[3][y - sink]?.[x] || '0');
        }
        expect(record.frames[index][floor]).not.to.match(/[2345]/);
      }
      for (const rows of record.frames.slice(14)) expect(rows.join('')).not.to.match(/[2345]/);
    }
  });

  it('uses sustained distressed burn poses, flames and charring without a skillet', function() {
    for (const shape of catalog.shapes) {
      const source = read(shape.path), refined = refineCharacterPresentation(source, source, shape.id);
      const record = refined.animations.find(entry => entry.state === 'FRYING'), floor = -record.offsetY - 1;
      for (const [index, rows] of record.frames.entries()) {
        if (!index) continue;
        expect(rows[floor - 1].slice(12)).not.to.equal('9999');
        expect(rows.join('')).not.to.match(/[678BCDEF]/);
        if (index < 3) expect(rows.join(''), `${shape.id}/${index}`).to.match(/[2345]/);
        if (index < 11) expect(rows.join(''), `${shape.id}/${index}`).to.match(/[9A]/);
      }
      expect(record.frames[10].join('')).to.include('1');
      expect(record.frames[13][floor].slice(5, 11)).to.equal('111111');
    }
  });
});
