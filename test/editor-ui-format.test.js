import { expect } from 'chai';
import {
  formatRotation,
  formatValue,
  normalizeRotation,
  normalizeText,
  parseNumber,
  sanitizeFileName
} from '../js/app/editor-ui/editorUiFormat.js';

describe('editorUiFormat', function () {
  it('normalizes text and parses nullable numbers', function () {
    expect(normalizeText('  level  ')).to.equal('level');
    expect(parseNumber('42')).to.equal(42);
    expect(parseNumber('')).to.equal(null);
    expect(parseNumber(null)).to.equal(null);
    expect(parseNumber('x')).to.equal(null);
  });

  it('normalizes and formats rotations', function () {
    expect(normalizeRotation('91')).to.equal(90);
    expect(normalizeRotation('-10')).to.equal(0);
    expect(normalizeRotation('181')).to.equal(180);
    expect(normalizeRotation(null)).to.equal(null);
    expect(formatRotation('450')).to.equal('90');
    expect(formatRotation('')).to.equal('');
  });

  it('formats values and sanitizes file names', function () {
    expect(formatValue(null)).to.equal('');
    expect(formatValue(7)).to.equal('7');
    expect(sanitizeFileName('  Hello World!.nxlv  ')).to.equal('Hello_World_nxlv');
    expect(sanitizeFileName('___')).to.equal('level');
  });
});
