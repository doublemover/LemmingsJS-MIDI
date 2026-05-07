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
      5
    );
    assert.strictEqual(
      parseBoundedNumber('5', { min: 0, max: 10, integer: true, fallback: -1 }),
      5
    );
    assert.strictEqual(
      parseBoundedNumber('invalid', { min: 0, max: 10, fallback: -1 }),
      -1
    );
    assert.strictEqual(
      parseBoundedNumber('20', { min: 1, max: 60, multiplier: 10, fallback: -1 }),
      200
    );
    assert.strictEqual(
      parseBoundedNumber('0', { min: 1, max: 60, multiplier: 10, fallback: -1 }),
      -1
    );
    assert.strictEqual(
      parseBoundedNumber('61', { min: 1, max: 60, multiplier: 10, fallback: -1 }),
      -1
    );
  });

  it('normalizes finite conversion and clamping', function () {
    assert.strictEqual(toFiniteNumber('3.14', null), 3.14);
    assert.strictEqual(toFiniteNumber('abc', null), null);
    assert.strictEqual(clampNumber(5, 0, 3), 3);
  });

  it('returns fallback for non-coercible numeric values', function () {
    const symbolValue = Symbol('value');
    assert.strictEqual(toFiniteNumber(symbolValue, 7), 7);
    assert.strictEqual(
      parseBoundedNumber(symbolValue, { min: 0, max: 10, fallback: -1 }),
      -1
    );
  });
});
