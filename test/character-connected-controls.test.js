import { expect } from 'chai';
import fs from 'node:fs';
import { load } from 'cheerio';
import { mountCharacterControls } from '../js/app/characterUiController.js';
import { TestDocument } from './helpers/test-dom.js';

const pairs = [
  ['characterShapeChoices', 'characterBodyPaletteChoices'],
  ['characterAccessoryChoices', 'characterPropPaletteChoices'],
  ['characterEyewearChoices', 'characterEyewearPaletteChoices']
];

describe('label-free connected character controls', () => {
  it('keeps the main studio entirely visual with accessible names and three connected choice/color containers', () => {
    const $ = load(fs.readFileSync('index.html', 'utf8'));
    const controls = $('.character-controls');
    expect(controls.find('summary').text()).to.equal('');
    expect(controls.find('summary').attr('aria-label')).to.equal('Character appearance controls');
    expect(controls.find('.character-control-content').text().trim()).to.equal('');
    expect(controls.find('small').length).to.equal(0);
    expect(controls.find('.character-composite').length).to.equal(3);
    for (const [choices, colors] of pairs) {
      const group = $(`#${choices}`).closest('.character-composite');
      expect(group.find(`#${colors}`).length).to.equal(1);
      expect(group.find('.character-field').length).to.equal(2);
      expect($(`#${choices}`).attr('aria-label')).to.be.a('string').and.not.equal('');
      expect($(`#${colors}`).attr('aria-label')).to.be.a('string').and.not.equal('');
    }
    expect($('#characterStatus').hasClass('visually-hidden')).to.equal(true);
  });
  it('mounts the same label-free three connected controls in procgen', () => {
    const document = new TestDocument(), host = document.createElement('div');
    mountCharacterControls(document, host);
    const composites = host.children.filter(child => child.className === 'character-composite');
    expect(composites).to.have.length(3);
    const visibleText = element => element.className === 'visually-hidden' ? '' : element.textContent + element.children.map(visibleText).join('');
    expect(visibleText(host)).to.equal('');
    for (const [index, ids] of pairs.entries()) {
      const groups = composites[index].children.map(field => field.children.find(child => child.getAttribute('role') === 'radiogroup'));
      expect(groups.map(group => group.id)).to.deep.equal(ids);
      expect(groups.every(group => group.getAttribute('aria-label'))).to.equal(true);
    }
    expect(host.children.at(-1).className).to.equal('visually-hidden');
  });
  it('joins swatches edge-to-edge with square interiors and rounded outer ends', () => {
    const css = fs.readFileSync('css/character-controls.css', 'utf8');
    expect(css).to.match(/\.character-composite \.palette-choices \{[^}]*flex-wrap: nowrap;[^}]*gap: 0;[^}]*padding: 0;/);
    expect(css).to.match(/\.character-composite \.palette-choices button \{[^}]*border: 0;[^}]*border-radius: 0;/);
    expect(css).to.include('button:first-child { border-radius: 0 0 0 6px; }');
    expect(css).to.include('button:last-child { border-radius: 0 0 6px 0; }');
    expect(css).to.match(/\.character-composite \.palette-choices \.character-swatch \{[^}]*width: 100%; height: 100%;/);
    expect(fs.readFileSync('css/procgen.css', 'utf8')).to.include('#procgenDrawer .character-field { gap: 0; }');
  });
});
