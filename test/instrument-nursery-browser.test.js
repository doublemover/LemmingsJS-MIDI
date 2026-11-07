import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createPerformanceSceneBrowser } from '../js/app/procgen/workstation/PerformanceSceneBrowser.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(create) {
  const dom = new JSDOM('<body></body>'), { document } = dom.window, calls = [], rows = [], scenes = new Map();
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  const add = (id, lanes) => { const cost = { lanes, maximumVoices: lanes * 4, sharedBodies: 0 }, row = { id, version: 1, hash: (lanes === 2 ? 'a' : 'b').repeat(64), title: 'Instrument Nursery · ' + id, supported: true, cost }, scene = { id, version: 1, title: row.title, description: 'Authored Nursery browser fixture', cost, expectedLandmarks: [], physicalControls: [], requirements: { required: [] }, credits: [], sourceVersion: { id: 'source', revision: 1, hash: 'c'.repeat(64) } }; rows.push(row); scenes.set(id, scene); return row; };
  add('original-pair', 2); const registry = { page: () => ({ rows: [...rows], nextOffset: null, total: rows.length }), resolve: row => scenes.get(row.id) }, loader = { state: () => ({ disposed: false, retirementUnknown: false, previewAvailable: false }), select: scene => calls.push(['select', scene.id]), async cancel() { calls.push(['cancel']); }, async prepare() { calls.push(['prepare']); }, async apply() { calls.push(['apply']); }, async stopPreview() {} };
  const browser = createPerformanceSceneBrowser({ document, window: dom.window, registry, loader, onCreateNursery: create ? () => create({ calls, add }) : null }); browser.open();
  return { dom, document, calls, browser, button: () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Nursery · use selected finite body graft') };
}
describe('Nursery browser selection and publication separation (authored unrun)', () => {
  it('selects the prepared strike score while leaving Prepare and Load as separate user actions', async () => {
    let finish; const f = fixture(({ calls, add }) => { calls.push(['assemble']); return new Promise(resolve => { finish = () => resolve(add('prepared-strike', 3)); }); }); f.button().click(); await turn(); expect(f.button().disabled).to.equal(true); expect(f.calls.slice(-2)).to.deep.equal([['cancel'], ['assemble']]); expect(f.calls.some(call => ['prepare', 'apply'].includes(call[0]))).to.equal(false); finish(); await turn(); expect(f.calls.at(-1)).to.deep.equal(['select', 'prepared-strike']); expect(f.document.querySelector('h3').textContent).to.include('prepared-strike'); expect(f.document.body.textContent).to.include('Load fresh remains a separate paused replacement'); expect(f.button().disabled).to.equal(false); await f.browser.dispose().completion; f.dom.window.close();
  });
  it('leaves the original selection unchanged on unavailable or incompatible selected source', async () => {
    const f = fixture(async () => { throw new Error('Choose an installed finite body graft.'); }); f.button().click(); await turn(); expect(f.calls.filter(call => call[0] === 'select')).to.deep.equal([['select', 'original-pair']]); expect(f.document.body.textContent).to.include('Choose an installed finite body graft.'); expect(f.calls.some(call => ['prepare', 'apply'].includes(call[0]))).to.equal(false); await f.browser.dispose().completion; f.dom.window.close();
  });
  it('ignores late assembly after disposal and omits assembly in hosts without that capability', async () => {
    let finish; const f = fixture(({ add }) => new Promise(resolve => { finish = () => resolve(add('late-strike', 3)); })); f.button().click(); await turn(); await f.browser.dispose().completion; finish(); await turn(); expect(f.calls.some(call => call[0] === 'select' && call[1] === 'late-strike')).to.equal(false); expect(f.document.querySelector('dialog')).to.equal(null); f.dom.window.close(); const absent = fixture(null); expect(absent.button()).to.equal(undefined); await absent.browser.dispose().completion; absent.dom.window.close();
  });
});
