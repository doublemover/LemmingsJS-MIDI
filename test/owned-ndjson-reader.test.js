import { expect } from 'chai';
import { readOwnedNdjsonLines } from '../js/app/resources/OwnedNdjsonReader.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const bytes = text => new TextEncoder().encode(text);
describe('bounded owned NDJSON reading', () => {
  it('preserves split UTF-8 and independent line leases without rescanning prior content', async () => {
    const raw = bytes('{"text":"😀bé"}\n{"n":2}\n'), resourceBudget = createResourceBudget();
    const pieces = [...raw].map(value => new Uint8Array([value]));
    let previous = null; const read = [];
    for await (const line of readOwnedNdjsonLines(pieces, { maxBytes: 1024, maxLineBytes: 512, resourceBudget })) {
      previous?.release();
      expect(resourceBudget.diagnostics().residentBytes).to.be.greaterThan(0);
      read.push(JSON.parse(line.takeText())); previous = line;
    }
    expect(read).to.deep.equal([{ text: '😀bé' }, { n: 2 }]); expect(resourceBudget.diagnostics().residentBytes).to.equal(0);
  });
  it('bounds one line independently of total archive size and retires rejected data', async () => {
    const resourceBudget = createResourceBudget(); let error;
    try { for await (const _ of readOwnedNdjsonLines([bytes('12345\n')], { maxBytes: 100, maxLineBytes: 4, resourceBudget })) { /* Rejected before exposure. */ } }
    catch (failure) { error = failure; }
    expect(error.message).to.include('entry exceeds'); expect(resourceBudget.diagnostics().residentBytes).to.equal(0);
  });
  it('rejects incomplete lines and malformed UTF-8 with independent cleanup', async () => {
    for (const raw of [bytes('{"n":1}'), new Uint8Array([255, 10])]) {
      const resourceBudget = createResourceBudget(); let error;
      try { for await (const line of readOwnedNdjsonLines([raw], { maxBytes: 100, maxLineBytes: 100, resourceBudget })) line.takeText(); }
      catch (failure) { error = failure; }
      expect(error).to.be.instanceOf(Error); expect(resourceBudget.diagnostics().residentBytes).to.equal(0);
    }
  });
  it('holds failed reservation retirement and never retries a failed release', async () => {
    let releases = 0; const resourceBudget = { reserve() {}, release() { releases++; return false; } }; let error;
    try { for await (const line of readOwnedNdjsonLines([bytes('{}\n')], { maxBytes: 100, maxLineBytes: 100, resourceBudget })) line.release(); }
    catch (failure) { error = failure; }
    expect(error.message).to.include('retirement is unresolved'); expect(releases).to.equal(1);
  });
  it('cancels a large unterminated line at a cooperative boundary', async () => {
    const resourceBudget = createResourceBudget(), controller = new AbortController(); let error;
    const raw = bytes('x'.repeat(3 * 1048576));
    try { for await (const _ of readOwnedNdjsonLines([raw], { maxBytes: raw.length, maxLineBytes: raw.length, resourceBudget, signal: controller.signal,
      yieldControl: async () => { controller.abort(new Error('stop-reading')); } })) { /* No complete line. */ } }
    catch (failure) { error = failure; }
    expect(error.message).to.equal('stop-reading'); expect(resourceBudget.diagnostics().residentBytes).to.equal(0);
  });
});
