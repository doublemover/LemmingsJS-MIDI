import { expect } from 'chai';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { recolorManifest, getCharacterPreference, setCharacterPreference, CHARACTER_STORAGE_KEY } from '../js/lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../js/lemmings/characterColors.js';
import { createCharacterUiController } from '../js/app/characterUiController.js';
import { TestDocument, createTestWindow } from './helpers/test-dom.js';
import { registerElement } from './support/dom-fixtures.js';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const donut = read('assets/characters/donut.json');
const transparentInterior = rows => {
  const width = rows[0].length, height = rows.length, exterior = new Set(), queue = [];
  const visit = (x, y) => {
    const key = y * width + x;
    if (x < 0 || x >= width || y < 0 || y >= height || rows[y][x] !== '0' || exterior.has(key)) return;
    exterior.add(key); queue.push([x, y]);
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]; visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  return rows.flatMap((row, y) => [...row].map((symbol, x) => symbol === '0' && !exterior.has(y * width + x))).filter(Boolean).length;
};

describe('donut body and native named colors', function() {
  it('preserves all twelve explicitly reviewed beret fits byte-for-byte', function() {
    for (const entry of read('tools/character-sprites/approved-beret-baseline.json').assets) {
      expect(createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex'), entry.id).to.equal(entry.sha256);
    }
  });
  it('fits a colored beret and completes every landing at the matching walking pose', function() {
    const catalog = read('assets/characters/catalog.json');
    for (const shape of catalog.shapes) {
      const manifest = read(shape.path);
      const landing = manifest.cosmetics.beretLanding;
      for (const variant of landing.variants) {
        const walk = manifest.animations.find(a => a.state === 'WALKING' && a.direction === variant.direction);
        expect(variant.frames[6].slice(6), shape.id).to.deep.equal(walk.frames[6]);
        if (shape.id === 'donut') for (const rows of variant.frames) expect(transparentInterior(rows)).to.be.greaterThan(0);
      }
      for (const animation of manifest.animations.filter(a => ['WALKING', 'CLIMBING', 'POSTCLIMBING', 'UMBRELLA'].includes(a.state))) {
        for (const rows of animation.frames) expect(rows.join(''), `${shape.id}/${animation.state}`).to.match(/[678]/);
      }
    }
  });

  it('keeps an enclosed alpha hole in every normal body pose and both directions', function() {
    const terminalStart = { DROWNING: 8, SPLATTING: 3, EXITING: 6, FRYING: 9, EXPLODING: 0 };
    for (const animation of donut.animations) {
      animation.frames.forEach((rows, index) => {
        if (index >= (terminalStart[animation.state] ?? Infinity)) return;
        expect(transparentInterior(rows), `${animation.state}/${animation.direction}/${index}`).to.be.greaterThan(0);
      });
    }
  });

  it('retains tools, brick placement, canopy, frame counts and pivots', function() {
    const circle = read('assets/characters/circle.json');
    for (const [index, animation] of donut.animations.entries()) {
      const source = circle.animations[index];
      for (const key of ['state', 'direction', 'frameCount', 'width', 'height', 'offsetX', 'offsetY']) expect(animation[key]).to.equal(source[key]);
      animation.frames.forEach((rows, frame) => rows.forEach((row, y) => [...row].forEach((symbol, x) => {
        if (['6', '7', '8', 'A'].includes(source.frames[frame][y][x])) expect(symbol).to.equal(source.frames[frame][y][x]);
      })));
    }
    const building = donut.animations.find(a => a.state === 'BUILDING' && a.direction === 1);
    expect(building.frames[9][12 + (donut.renderPaddingTop || 0)].slice(8, 14)).to.equal('877777');
  });

  it('matches all colors to the recovered native catalog, preserving alpha and eyes', function() {
    const native = read('tools/character-sprites/native-color-catalog.json');
    for (const [part, entries] of [['body', native.colors], ['prop', native.accessoryColors]]) {
      expect(CHARACTER_COLORS[part].map(color => color.id)).to.deep.equal(entries.map(color => color.id));
      for (const color of CHARACTER_COLORS[part]) {
        const entry = entries.find(item => item.id === color.id);
        expect(color.hex).to.equal(`#${['red', 'green', 'blue'].map(key => Math.round(entry[key] * 255).toString(16).padStart(2, '0')).join('')}`);
        const manifest = recolorManifest(donut, { [`${part}Color`]: color.hex });
        expect(manifest.palette[0]).to.deep.equal([0, 0, 0, 0]);
        expect(manifest.palette[5]).to.deep.equal(donut.palette[5]);
        expect(() => new PixelSpriteSkin(manifest)).not.to.throw();
      }
    }
  });

  it('selects and persists named colors without changing the chosen body', async function() {
    const document = new TestDocument(), window = createTestWindow(document);
    for (const id of ['characterShape', 'characterBodyPalette', 'characterPropPalette']) {
      const element = registerElement(document, 'select', id);
      element.replaceChildren = () => { while (element.firstChild) element.removeChild(element.firstChild); };
    }
    for (const id of ['characterCustomColors', 'characterBodyColor', 'characterPropColor']) registerElement(document, 'input', id);
    registerElement(document, 'span', 'characterStatus');
    setCharacterPreference({ shape: 'donut', bodyColor: '#fa70ab', propColor: '#8c4a2b' });
    const sprites = { shapes: [{ id: 'donut', label: 'Donut' }], prepare: async () => true };
    const controller = createCharacterUiController({ document, window, getView: () => ({ game: { gameResources: { characterSprites: sprites }, render() {} } }) });
    controller.bind(); await controller.sync();
    expect(document.getElementById('characterBodyPalette').children.length).to.equal(10);
    expect(document.getElementById('characterPropPalette').children.length).to.equal(12);
    const select = document.getElementById('characterBodyPalette'); select.value = '#04bb9f';
    select.dispatchEvent({ type: 'change', target: select });
    expect(getCharacterPreference()).to.deep.equal({ shape: 'donut', seed: 0, bodyColor: '#04bb9f', propColor: '#8c4a2b', eyewearColor: '#1f1f1f' });
    expect(JSON.parse(window.localStorage.getItem(CHARACTER_STORAGE_KEY))).to.deep.equal(getCharacterPreference());
    setCharacterPreference({ shape: 'classic' });
  });
});
