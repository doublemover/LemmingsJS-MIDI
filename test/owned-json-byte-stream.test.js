import { expect } from 'chai';
import { freezeData } from '../js/core/CanonicalData.js';
import { encodeOwnedJsonLine } from '../js/app/resources/OwnedJsonByteStream.js';

const read = async (value, options = {}) => {
  const parts = []; for await (const bytes of encodeOwnedJsonLine(value, options)) parts.push(bytes);
  const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; for (const part of parts) text += decoder.decode(part, { stream: true }); text += decoder.decode();
  return { parts, text };
};
describe('bounded owned JSON byte streaming', () => {
  it('preserves Unicode boundaries, escaped strings, negative zero and own-data ordering in small chunks', async () => {
    const value = freezeData({ prefix: 'a'.repeat(2047) + '𝄞' + '\ud800' + '\n"\\', body: '\u0001'.repeat(60000), values: [-0, true, null, 3.5] });
    let yields = 0; const encoded = await read(value, { yieldControl: async () => { yields++; } });
    const restored = JSON.parse(encoded.text); expect(restored).to.deep.equal(value); expect(Object.is(restored.values[0], -0)).to.equal(true);
    expect(encoded.parts.every(part => part.byteLength <= 65536)).to.equal(true); expect(encoded.parts.length).to.be.greaterThan(1);
    expect(encoded.text.endsWith('\n')).to.equal(true); expect(yields).to.be.greaterThan(0);
  });
  it('rejects mutable/accessor input and respects the UTF-8 output limit without a whole-document staging copy', async () => {
    let error, accessed = 0;
    try { await read({ mutable: true }); } catch (failure) { error = failure; } expect(error.message).to.include('owned data snapshot');
    const accessor = {}; Object.defineProperty(accessor, 'hidden', { enumerable: true, get() { accessed++; return 1; } }); Object.freeze(accessor);
    try { await read(accessor); } catch (failure) { error = failure; } expect(error.message).to.include('owned data properties'); expect(accessed).to.equal(0);
    try { await read(freezeData({ text: 'é'.repeat(1000) }), { maxBytes: 1500 }); } catch (failure) { error = failure; } expect(error.message).to.include('byte bound');
    try { await read(freezeData(Array(20).fill(null)), { maxNodes: 8 }); } catch (failure) { error = failure; } expect(error.message).to.include('structural bound');
  });
  it('allows cancellation at a chunk boundary without continuing to traverse the immutable source', async () => {
    const controller = new AbortController(), value = freezeData({ body: 'x'.repeat(100000) });
    const iterator = encodeOwnedJsonLine(value, { signal: controller.signal });
    expect((await iterator.next()).done).to.equal(false); controller.abort(); let error;
    try { await iterator.next(); } catch (failure) { error = failure; } expect(error.name).to.equal('AbortError');
  });
});
