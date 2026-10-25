import { expect } from 'chai';
import { encodeUtf8, encodeUtf8Portable, canonicalDataText } from '../../js/core/CanonicalData.js';

describe('worklet-safe canonical UTF-8', () => {
  it('matches independent native encoding for BMP, supplementary and unpaired UTF-16', () => {
    const cases = ['', 'ascii\u0000', '\u0080\u07ff\u0800\uffff', '\ud83d\ude80', '\ud800x\udfff', '\ud800\ud800\udc00\udfff'];
    for (let index = 0; index < 200; index++) { let text = ''; for (let unit = 0; unit < 33; unit++) text += String.fromCharCode((index * 997 + unit * 8191) & 65535); cases.push(text); }
    for (const text of cases) { expect(encodeUtf8(text)).to.deep.equal(new TextEncoder().encode(text)); expect(encodeUtf8Portable(text)).to.deep.equal(new TextEncoder().encode(text)); }
  });
  it('preserves exact canonical byte budgets for non-ASCII identities', () => {
    const value = { name: '\ud83d\ude80', lone: '\ud800' }, encoded = canonicalDataText(value);
    expect(encoded.bytes).to.deep.equal(new TextEncoder().encode(encoded.text));
    expect(() => canonicalDataText(value, { maxBytes: encoded.bytes.length - 1 })).to.throw();
  });
});
