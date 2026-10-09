import { expect } from 'chai';
import fs from 'node:fs';
import { load } from 'cheerio';

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


});
