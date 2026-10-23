import { expect } from 'chai';
import { requestBrowserDownload } from '../js/app/export/BrowserDownload.js';
import { downloadBinaryFile, downloadTextFile } from '../js/app/editor-ui/editorUiFiles.js';

const fixture = ({ failAt = null } = {}) => {
  const calls = [], timers = [];
  const link = { click() { calls.push('click'); if (failAt === 'click') throw new Error('click rejected'); },
    remove() { calls.push('remove'); } };
  const document = { createElement() { calls.push('create'); if (failAt === 'create') throw new Error('create rejected'); return link; },
    body: { append() { calls.push('append'); if (failAt === 'append') throw new Error('append rejected'); } } };
  const windowRef = { Blob, URL: { createObjectURL() { calls.push('url'); return 'blob:test'; }, revokeObjectURL() { calls.push('revoke'); } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); } };
  return { document, windowRef, calls, timers };
};

describe('browser download delivery evidence', () => {
  it('returns only an anchor request receipt and releases the URL after a finite delay', () => {
    const f = fixture();
    const receipt = requestBrowserDownload({ document: f.document, windowRef: f.windowRef, bytes: 'abc', filename: 'take.mid' });
    expect(receipt).to.deep.equal({ state: 'delivery-requested', evidence: 'anchor-click-returned', filename: 'take.mid', byteLength: 3 });
    expect(f.calls).to.deep.equal(['url', 'create', 'append', 'click', 'remove']);
    expect(f.timers).to.have.length(1);
    expect(f.timers[0].delay).to.be.greaterThan(0);
    f.timers[0].fn(); expect(f.calls.at(-1)).to.equal('revoke');
  });

  for (const failAt of ['create', 'append', 'click']) it(`releases the URL if ${failAt} fails`, () => {
    const f = fixture({ failAt });
    expect(() => requestBrowserDownload({ document: f.document, windowRef: f.windowRef, bytes: 'abc', filename: 'take.mid' })).to.throw();
    expect(f.calls.at(-1)).to.equal('revoke');
    expect(f.timers).to.have.length(0);
  });

  it('rejects unsafe filenames before allocating a URL', () => {
    const f = fixture();
    expect(() => requestBrowserDownload({ document: f.document, windowRef: f.windowRef, bytes: 'abc', filename: '../take.mid' })).to.throw(TypeError);
    expect(f.calls).to.deep.equal([]);
  });

  it('shares the same request semantics with text and binary editor downloads', () => {
    const text = fixture(), binary = fixture();
    const originalUrl = globalThis.URL;
    try {
      globalThis.URL = text.windowRef.URL;
      expect(downloadTextFile(text.document, 'a', 'a.txt').state).to.equal('delivery-requested');
      globalThis.URL = binary.windowRef.URL;
      expect(downloadBinaryFile(binary.document, Uint8Array.of(1), 'b.bin').state).to.equal('delivery-requested');
    } finally { globalThis.URL = originalUrl; }
    expect(text.calls).to.include('remove'); expect(binary.calls).to.include('remove');
  });
});
