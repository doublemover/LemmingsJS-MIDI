import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createCausalVisualView } from '../js/app/procgen/workstation/CausalVisualView.js';
import { createProcgenPresentationSnapshot } from '../js/app/procgen/ProcgenPresentationSnapshot.js';

describe('frozen causal view selection', () => {
  it('shows the selected transferred intent target and mix without rebinding its physical actor or changing the frozen explanation', () => {
    const dom = new JSDOM('<body><main><div id="stage"></div><div id="actions"></div></main></body>'), document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    const source = { eventId: 'source', recorded: true, tick: 10, actorId: 7, actorState: 'terminated', laneIndex: 1, kind: 'LaneCrossed', point: { x: 100, y: 120, evidence: 'observed-endpoint' } };
    const event = { sourceKey: 'binding', worldId: 'world', generation: 1, tick: 10, batchId: 'batch', actorId: 7, voiceId: 'voice', kind: 'begin', receipts: [], omittedSources: 0, omittedReceipts: 0, sources: [source] };
    let identity = 'binding', values = [{ mix: { mute: true, soloSuppressed: false, revision: 9 }, evidence: { history: [{ ...event, intentId: 'transferred', laneId: 'target', laneIndex: 0, sources: [{ ...source, recorded: false, tick: null, actorId: null, point: null, laneIndex: null }] }] } },
      { mix: { mute: false, soloSuppressed: false, revision: 8 }, evidence: { history: [{ ...event, intentId: 'original', laneId: 'origin', laneIndex: 1 }] } }];
    const snapshot = createProcgenPresentationSnapshot({ worldId: 'world', generation: 1, tick: 11, terrainRevision: 0, revision: 1, projectionRevision: 1, layoutKey: 'strip', rect: { left: 0, top: 0, width: 800, height: 400 }, backingSize: { width: 800, height: 400 }, logicalSize: { width: 400, height: 200 }, originX: 0, viewWidth: 200, laneHeight: 100, rows: [{ lane: 1, sourceY: 100, sourceHeight: 100, destinationY: 0, destinationHeight: 180 }] });
    const view = createCausalVisualView({ document, stage: document.querySelector('#stage'), actions: document.querySelector('#actions'), parent: document.querySelector('main'), getDocumentIdentity: () => identity, read: () => values, invalidate() {} });
    try {
      view.bind({ presentation: { getSnapshot: () => snapshot, valid: value => value === snapshot, subscribe: () => () => {} } }); view.render(values);
      const mark = view.layer.querySelector('button'), details = view.dialog.querySelector('pre'), select = view.dialog.querySelector('[aria-label="Owned intent for this cause"]'); expect(mark.style.clipPath).not.to.equal(''); mark.click();
      expect(details.textContent).to.include('actor 7 (terminated)').and.include('target lane target').and.include('Current lane mix: muted; target target; mix revision 9');
      select.value = 'original'; select.dispatchEvent(new dom.window.Event('change')); expect(details.textContent).to.include('target lane origin').and.include('Current lane mix: not suppressed; target origin; mix revision 8');
      const frozen = details.textContent; values = []; view.render(values); expect(details.textContent).to.equal(frozen); expect(view.dialog.textContent).to.include('left the retained window');
      view.dialog.querySelectorAll('button')[0].click(); expect(details.textContent).to.equal(frozen); expect(view.dialog.textContent).to.include('previous frozen explanation is preserved');
      values = [{ evidence: { history: [{ ...event, intentId: 'recovery', kind: 'end', terminationReason: 'incomplete-source', sources: [] }] } }]; view.render(values); view.historyButton.click(); expect(view.layer.querySelector('.studio-causal-mark')).to.equal(null); expect(view.dialog.querySelector('select').textContent).to.include('Unrooted intent'); expect(details.textContent).to.include('no physical event is invented'); expect(view.dialog.querySelector('h2').textContent).to.equal('Intent without a retained physical source');
      identity = 'replacement'; view.render([]); expect(view.dialog.open).to.equal(false); mark.click(); expect(view.dialog.open).to.equal(false); expect(details.textContent).to.equal('');
    } finally { view.dispose(); dom.window.close(); }
  });
});
