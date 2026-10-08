import { expect } from 'chai';
import fs from 'node:fs';
import { load } from 'cheerio';

const luminance = hex => {
  const linear = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

describe('high-contrast integrated modulation fields', () => {
  it('keeps all global field names attached to their inputs and preserves their labels and input behavior', () => {
    const $ = load(fs.readFileSync('index.html', 'utf8'));
    const fields = $('#midiModulationInspector .midi-field');
    expect(fields.length).to.be.greaterThan(20);
    for (const field of fields.toArray()) {
      expect($(field).is('label')).to.equal(true);
      expect($(field).children('span').text().trim()).not.to.equal('');
      expect($(field).children('input,select').length).to.equal(1);
    }
    expect($('.character-controls .character-control-content').text().trim()).to.equal('');
  });
  it('uses contrast-safe text in field boxes, section copy and modulation actions', () => {
    expect(contrast('#415641', '#fcfbf5')).to.be.greaterThan(7);
    expect(contrast('#182d20', '#fcfbf5')).to.be.greaterThan(10);
    expect(contrast('#415641', '#e7eddd')).to.be.greaterThan(6);
    expect(contrast('#1d3a27', '#cfe5b5')).to.be.greaterThan(8);
    expect(contrast('#613323', '#f5ddd1')).to.be.greaterThan(7);
  });
  it('scopes compact integrated labels and two-column modulation cards to the requested inspector', () => {
    const css = fs.readFileSync('css/midi-instrument.css', 'utf8');
    expect(css).to.match(/#midiModulationInspector \.midi-field \{[^}]*gap: 0;[^}]*padding: 4px 6px;[^}]*background: #fcfbf5;/);
    expect(css).to.match(/#midiModulationInspector \.midi-field > span \{[^}]*color: #415641;[^}]*font-weight: 700;/);
    expect(css).to.match(/#midiModulationInspector \.midi-automation-row \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*padding: 7px;/);
  });
});
