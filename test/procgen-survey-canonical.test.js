import { expect } from 'chai';
import { canonicalSurveyJson, hashSurveyValue, SURVEY_CANONICAL_SCHEMA } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { surveyCanonicalVectors } from './helpers/surveyCanonicalVectors.js';

describe('intrinsic survey numeric canonicalization', () => {
  it('preserves the versioned scalar tags and all supported numeric view inventories', () => {
    expect(SURVEY_CANONICAL_SCHEMA).to.equal(3);
    const goldens = [[-0, '["number","-0"]'], [0, '["number",0]'], [NaN, '["number","NaN"]'],
      [Infinity, '["number","Infinity"]'], [-Infinity, '["number","-Infinity"]']];
    for (const [value, text] of goldens) expect(canonicalSurveyJson(value)).to.equal(text);
    const vectors = surveyCanonicalVectors(); expect(new Set(vectors.map(([, value]) => hashSurveyValue(value))).size).to.equal(vectors.length);
    const encoded = JSON.parse(canonicalSurveyJson(vectors[1][1])); expect(encoded.slice(0, 5)).to.deep.equal(['typed-v2', 'Float64Array', 8, 72, 9]);
    expect(encoded[5][0]).to.deep.equal(['number', '-0']); expect(encoded[5][2]).to.deep.equal(['number', 'NaN']);
    expect(hashSurveyValue(new Array(1))).not.to.equal(hashSurveyValue([undefined]));
    expect(hashSurveyValue(new Array(1))).not.to.equal(hashSurveyValue([null]));
  });
  it('never invokes array accessors or overridden collection iterators', () => {
    let touched = 0; const getter = () => { touched++; throw new Error('Getter invoked'); };
    const array = [1]; Object.defineProperty(array, '0', { get: getter }); expect(() => canonicalSurveyJson(array)).to.throw('getters');
    for (const value of [new Map([['a', 1]]), new Set([1])]) {
      const before = canonicalSurveyJson(value); Object.defineProperty(value, Symbol.iterator, { get: getter });
      expect(canonicalSurveyJson(value)).to.equal(before);
    }
    expect(touched).to.equal(0);
  });
  it('reads actual typed-array and DataView slots despite spoofed metadata and iterators', () => {
    let touched = 0; const getter = () => { touched++; throw new Error('Spoofed metadata'); };
    for (const value of [new Float64Array([-0, NaN]), new DataView(Uint8Array.of(1, 2, 3).buffer, 1, 2)]) {
      const before = canonicalSurveyJson(value);
      for (const key of ['constructor', 'length', 'byteLength', 'byteOffset', 'buffer', Symbol.iterator, Symbol.toStringTag]) Object.defineProperty(value, key, { get: getter });
      expect(canonicalSurveyJson(value)).to.equal(before);
    }
    expect(touched).to.equal(0);
  });
  it('rejects unsupported empty-looking objects and cycles while permitting repeated data aliases', () => {
    for (const value of [new Date(0), /empty/, new WeakMap(), Promise.resolve(null), new (class Unsupported {})()]) expect(() => canonicalSurveyJson(value)).to.throw('Unsupported');
    const cycle = {}; cycle.self = cycle; expect(() => canonicalSurveyJson(cycle)).to.throw('cycles');
    const map = new Map(); map.set('self', map); expect(() => canonicalSurveyJson(map)).to.throw('cycles');
    const same = { x: 1 }; expect(canonicalSurveyJson([same, same])).to.equal(canonicalSurveyJson([{ x: 1 }, { x: 1 }]));
  });
});
