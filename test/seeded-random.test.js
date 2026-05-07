import { expect } from 'chai';
import {
  hashString32,
  normalizeSeed,
  deriveSeed,
  createSeededRandom
} from '../js/core/seededRandom.js';

describe('seededRandom', function () {
  it('normalizes numeric and string seeds deterministically', function () {
    expect(normalizeSeed(123.9)).to.equal(123);
    expect(normalizeSeed('123')).to.equal(123);
    expect(normalizeSeed('0x7b')).to.equal(123);
    expect(normalizeSeed('abc')).to.equal(hashString32('abc'));
  });

  it('derives scoped seeds stably from a base seed', function () {
    const a = deriveSeed(1337, 'style');
    const b = deriveSeed(1337, 'controller');
    expect(a).to.not.equal(b);
    expect(deriveSeed(1337, 'style')).to.equal(a);
  });

  it('produces repeatable random streams for a given seed', function () {
    const a = createSeededRandom('procgen-seed');
    const b = createSeededRandom('procgen-seed');
    const samplesA = [a(), a(), a(), a()];
    const samplesB = [b(), b(), b(), b()];
    expect(samplesA).to.deep.equal(samplesB);
    expect(samplesA.every(v => v >= 0 && v < 1)).to.equal(true);
  });
});
