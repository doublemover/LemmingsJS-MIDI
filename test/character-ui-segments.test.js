import { expect } from 'chai';
import fs from 'node:fs';
import { createCharacterUiController } from '../js/app/characterUiController.js';
import { getCharacterPreference, setCharacterPreference, CHARACTER_STORAGE_KEY } from '../js/lemmings/CharacterSpriteSet.js';
import { CHARACTER_COLORS } from '../js/lemmings/characterColors.js';
import { TestDocument, createTestWindow } from './helpers/test-dom.js';
import { registerElement } from './support/dom-fixtures.js';
const catalog = JSON.parse(fs.readFileSync('assets/characters/catalog.json', 'utf8'));
const fixture = (prepare = async () => true) => {
  const document = new TestDocument(), window = createTestWindow(document);
  for (const id of ['characterShape', 'characterBodyPalette', 'characterAccessory', 'characterPropPalette', 'characterEyewear', 'characterEyewearPalette']) {
    registerElement(document, 'select', id); registerElement(document, 'div', `${id}Choices`);
  }
  registerElement(document, 'span', 'characterStatus');
  const sprites = { shapes: catalog.shapes, prepare, activePreference: { shape: 'mixed' }, error: 'Test missing asset' };
  const controller = createCharacterUiController({ document, window, getView: () => ({ game: { gameResources: { characterSprites: sprites }, render() {} } }) });
  const choices = id => document.getElementById(`${id}Choices`).children;
  const click = (id, value) => choices(id).find(button => button.dataset.value === value).dispatchEvent({ type: 'click' });
  return { document, window, controller, choices, click };
};

describe('visual character segments', function() {
  afterEach(() => setCharacterPreference({ shape: 'classic', seed: 0 }));
  it('offers every body and only native colors plus stable random, with complete accessible visual choices', async function() {
    setCharacterPreference({ shape: 'mixed', seed: 42 });
    const f = fixture(); f.controller.bind(); await f.controller.sync();
    expect(f.choices('characterShape').map(button => button.dataset.value)).to.deep.equal(['mixed', ...catalog.shapes.map(shape => shape.id), 'classic']);
    for (const [id, part] of [['characterBodyPalette', 'body'], ['characterPropPalette', 'prop'], ['characterEyewearPalette', 'prop']]) {
      expect(f.choices(id).map(button => button.dataset.value)).to.deep.equal(['random', ...CHARACTER_COLORS[part].map(color => color.hex)]);
    }
    for (const id of ['characterShape', 'characterAccessory', 'characterEyewear']) for (const button of f.choices(id)) {
      expect(button.getAttribute('aria-label')).to.be.a('string').and.not.equal('');
      expect(button.title).to.equal(button.getAttribute('aria-label'));
      expect(button.getAttribute('role')).to.equal('radio');
      const img = button.children.find(child => child.tagName === 'IMG');
      if (img) expect(fs.existsSync(img.src), img.src).to.equal(true);
    }
    expect(f.choices('characterShape').filter(button => button.tabIndex === 0)).to.have.length(1);
    expect(f.document.getElementById('characterStatus').textContent).to.equal('');
  });
  it('persists independent random palettes, accessory and eyewear without rerolling the seed', async function() {
    setCharacterPreference({ shape: 'mixed', seed: 42 });
    const f = fixture(); f.controller.bind(); await f.controller.sync();
    f.click('characterBodyPalette', 'random'); f.click('characterPropPalette', 'random');
    f.click('characterAccessory', 'crown'); f.click('characterEyewear', 'monocle'); f.click('characterEyewearPalette', '#04bb9f');
    expect(getCharacterPreference()).to.include({ shape: 'mixed', seed: 42, bodyColor: 'random', propColor: 'random', accessory: 'crown', eyewear: 'monocle', eyewearColor: '#04bb9f' });
    expect(JSON.parse(f.window.localStorage.getItem(CHARACTER_STORAGE_KEY))).to.deep.equal(getCharacterPreference());
  });
  it('supports arrow, Home and End roving radio focus and disables decoration in explicit classic mode', async function() {
    setCharacterPreference({ shape: 'mixed', seed: 0 });
    const f = fixture(); f.controller.bind(); await f.controller.sync();
    const first = f.choices('characterShape')[0];
    first.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
    expect(getCharacterPreference().shape).to.equal(catalog.shapes[0].id);
    expect(f.document.activeElement).to.equal(f.choices('characterShape')[1]);
    f.choices('characterShape')[1].dispatchEvent({ type: 'keydown', key: 'End', preventDefault() {}, stopPropagation() {} });
    expect(getCharacterPreference().shape).to.equal('classic');
    expect(f.choices('characterAccessory').every(button => button.disabled)).to.equal(true);
    f.choices('characterShape').at(-1).dispatchEvent({ type: 'keydown', key: 'Home', preventDefault() {}, stopPropagation() {} });
    expect(getCharacterPreference().shape).to.equal('mixed');
    expect(f.choices('characterAccessory').every(button => !button.disabled)).to.equal(true);
  });
  it('reports failed appearance loads without claiming the pending selection is ready', async function() {
    setCharacterPreference({ shape: 'mixed' });
    const f = fixture(async () => false); f.controller.bind(); await f.controller.sync();
    expect(f.document.getElementById('characterStatus').textContent).to.include('Keeping the previous look');
    expect(f.document.getElementById('characterStatus').textContent).to.include('Test missing asset');
  });
});
