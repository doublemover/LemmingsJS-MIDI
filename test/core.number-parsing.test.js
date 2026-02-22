import assert from 'assert';
import {
  clampNumber,
  parseBoundedNumber,
  parseInt10,
  toFiniteNumber
} from '../js/core/numberParsing.js';

describe('numberParsing', function () {
  it('parses explicit base-10 integers', function () {
    assert.strictEqual(parseInt10('08', 0), 8);
    assert.strictEqual(parseInt10(' 42 ', 0), 42);
    assert.strictEqual(parseInt10('nope', 7), 7);
  });

  it('parses and bounds finite numbers', function () {
    assert.strictEqual(
      parseBoundedNumber('2.5', { min: 0, max: 3, multiplier: 2, fallback: -1 }),
      3
    );
    assert.strictEqual(
      parseBoundedNumber('5', { min: 0, max: 10, integer: true, fallback: -1 }),
      5
    );
    assert.strictEqual(
      parseBoundedNumber('invalid', { min: 0, max: 10, fallback: -1 }),
      -1
    );
  });

  it('normalizes finite conversion and clamping', function () {
    assert.strictEqual(toFiniteNumber('3.14', null), 3.14);
    assert.strictEqual(toFiniteNumber('abc', null), null);
    assert.strictEqual(clampNumber(5, 0, 3), 3);
  });
});
