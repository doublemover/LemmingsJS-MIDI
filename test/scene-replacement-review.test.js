import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPerformanceSceneBrowser } from '../js/app/procgen/workstation/PerformanceSceneBrowser.js';
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(onApply, getDocumentIdentity = () => null) {
  const dom = new JSDOM('<body><button id="opener">Scenes</button></body>'), document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  const scene = { id: 'scene', version: 1, title: 'Scene', description: 'Bounded fixture', cost: { lanes: 1, maximumVoices: 4 }, expectedLandmarks: [], physicalControls: [], requirements: { required: [] }, credits: [], sourceVersion: { id: 'source', revision: 1, hash: 'a'.repeat(64) } }, row = { ...scene, supported: true, hash: 'b'.repeat(64) };
  let active = true; const loader = { state: () => ({ prepared: active ? {} : null, phase: active ? 'ready' : 'active', canApply: active }), select() {}, async cancel() { active = false; }, async stopPreview() {} };
  const browser = createPerformanceSceneBrowser({ document, window: dom.window, registry: { page: () => ({ rows: [row], total: 1, nextOffset: null }), resolve: () => scene }, loader, onApply: async options => { const result = await onApply(options); if (result.status === 'committed') active = false; return result; }, getDocumentIdentity }); browser.open();
  const button = name => [...document.querySelectorAll('button')].find(value => value.textContent === name); return { browser, document, dom, button, dialog: document.querySelector('dialog') };
}
describe('hosted prepared scene replacement', () => {
  for (const outcome of ['canceled', 'committed']) it('parks one host for naming then restores the current scene after ' + outcome, async () => {
    const gate = deferred(); let options; const f = fixture(value => { options = value; value.parkHost(); return gate.promise; });
    f.button('Load fresh · stopped replacement').click(); await turn(); assert.equal(f.dialog.open, false); assert.equal(options.isCurrent(), true); gate.resolve({ status: outcome }); await turn();
    assert.equal(f.dialog.open, true); assert.equal(f.document.activeElement, f.button(outcome === 'committed' ? 'Close' : 'Load fresh · stopped replacement')); assert.equal(f.document.querySelectorAll('dialog').length, 1); await f.browser.dispose().completion; f.dom.window.close();
  });
  for (const superseded of [false, true]) it('binds a parked success to its acknowledged document, superseded=' + superseded, async () => {
    const gate = deferred(); let documentIdentity = '1'; const f = fixture(value => { value.parkHost(); return gate.promise; }, () => documentIdentity); f.button('Load fresh · stopped replacement').click(); await turn(); documentIdentity = superseded ? '3' : '2'; gate.resolve({ status: 'committed', documentIdentity: '2' }); await turn();
    assert.equal(f.dialog.open, !superseded); assert.equal(f.document.body.textContent.includes('Scene loaded paused.'), !superseded); await f.browser.dispose().completion; f.dom.window.close();
  });
  it('keeps a canceled prior document from reopening or reporting into the replacement', async () => {
    const gate = deferred(); let documentIdentity = '1'; const f = fixture(value => { value.parkHost(); return gate.promise; }, () => documentIdentity); f.button('Load fresh · stopped replacement').click(); await turn(); documentIdentity = '2'; gate.resolve({ status: 'canceled' }); await turn();
    assert.equal(f.dialog.open, false); assert.equal(f.document.body.textContent.includes('Scene replacement canceled.'), false); await f.browser.dispose().completion; f.dom.window.close();
  });
  for (const interruption of ['close', 'dispose', 'reopen']) it('does not reopen an obsolete parked host after ' + interruption, async () => {
    const gate = deferred(); let options; const f = fixture(value => { options = value; value.parkHost(); return gate.promise; }); f.button('Load fresh · stopped replacement').click(); await turn();
    if (interruption === 'dispose') await f.browser.dispose().completion; else if (interruption === 'close') f.button('Close').click(); else f.browser.open();
    await turn(); assert.equal(options.isCurrent(), false); gate.resolve({ status: 'canceled' }); await turn();
    assert.equal(f.document.querySelector('dialog')?.open || false, interruption === 'reopen'); await f.browser.dispose().completion; f.dom.window.close();
  });
});
