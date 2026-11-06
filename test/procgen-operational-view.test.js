import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createProcgenOperationalSnapshot } from '../js/app/procgen/workstation/ProcgenOperationalState.js';
import { createProcgenOperationView } from '../js/app/procgen/workstation/ProcgenOperationView.js';
import { createProcgenOperationalView } from '../js/app/procgen/workstation/ProcgenOperationalView.js';

describe('owned operational status presentation', () => {
  let dom, document, view, current, calls, statuses;
  beforeEach(() => {
    dom = new JSDOM('<body><div id="original"><button id="procgenListen">Listen locally</button><button id="procgenPanic">Panic</button></div></body>'); document = dom.window.document; calls = []; statuses = [];
    current = createProcgenOperationalSnapshot({ identity: 'one', simulation: { available: true }, transport: { playing: false, clockSource: 'internal' }, output: { enabled: true }, physical: { prepared: true, accepted: 1 }, lanes: [] });
    view = createProcgenOperationalView({ document, readSnapshot: () => current, performAction: (...args) => calls.push(args), onStatus: text => statuses.push(text) }); document.body.append(view.element); view.render(current);
  });
  afterEach(() => { view.dispose(); dom.window.close(); });
  it('borrows existing enable/Panic controls once, keeps live atoms separate and restores their DOM lease', () => {
    expect(document.querySelectorAll('#procgenPanic')).to.have.length(1); expect(view.element.contains(document.getElementById('procgenPanic'))).to.equal(true);
    expect(view.element.textContent).to.include('World running'); expect(view.element.textContent).to.include('Music stopped'); expect(view.element.textContent).to.include('acoustic');
    const listen = document.getElementById('procgenListen'), panic = document.getElementById('procgenPanic'); view.dispose(); view.dispose();
    expect(document.getElementById('original').contains(listen)).to.equal(true); expect(document.getElementById('original').contains(panic)).to.equal(true); expect(listen.getAttribute('aria-describedby')).to.equal(null);
  });
  it('presents a newly selected MIDI destination synchronously and keeps the same label on a scheduled redraw', () => {
    const listen = document.getElementById('procgenListen');
    current = createProcgenOperationalSnapshot({ identity: 'selected', simulation: { available: true }, output: { selectedBackend: 'midi', enabled: false, midiPermission: 'granted', selectedOutputId: 'port' } });
    listen.dataset.outputAction = 'activate';
    expect(view.presentOutputLabel('Activate MIDI output')).to.equal(true); expect(listen.textContent).to.equal('Activate selected output'); expect(listen.dataset.operationalAction).to.equal('activate');
    const observer = new dom.window.MutationObserver(() => {}); observer.observe(listen, { childList: true }); view.render(current);
    expect(observer.takeRecords()).to.have.length(0); observer.disconnect();
    listen.dataset.outputAction = 'stop'; view.presentOutputLabel('Cancel discovery'); view.render(current); expect(listen.textContent).to.equal('Cancel discovery');
    listen.dataset.outputAction = 'takeover'; view.presentOutputLabel('Take over MIDI output'); view.render(current); expect(listen.textContent).to.equal('Take over MIDI output');
  });
  it('uses the current base label when a warning or missing snapshot replaces a native recovery action', () => {
    const listen = document.getElementById('procgenListen');
    current = createProcgenOperationalSnapshot({ output: { selectedBackend: 'midi', selectedOutputId: 'port' } }); view.presentOutputLabel('Activate MIDI output');
    expect(listen.textContent).to.equal('Activate selected output');
    current = createProcgenOperationalSnapshot({ storage: { error: new Error('quota') } }); view.render(current); expect(listen.textContent).to.equal('Activate MIDI output');
    current = null; expect(view.presentOutputLabel('Disable browser output')).to.equal(true); expect(listen.textContent).to.equal('Disable browser output');
    expect(view.presentOutputLabel({})).to.equal(false); expect(view.presentOutputLabel('x'.repeat(241))).to.equal(false); expect(listen.textContent).to.equal('Disable browser output');
  });
  it('hands borrowed controls to a replacement without letting the retired view move or rewrite them', () => {
    const original = document.getElementById('original'), listen = document.getElementById('procgenListen'), panic = document.getElementById('procgenPanic');
    current = createProcgenOperationalSnapshot({ output: { selectedBackend: 'midi', selectedOutputId: 'port' } }); view.presentOutputLabel('Activate MIDI output');
    const replacement = createProcgenOperationalView({ document, readSnapshot: () => current, performAction() {} }); document.body.append(replacement.element);
    try {
      current = createProcgenOperationalSnapshot({ storage: { error: new Error('quota') } }); replacement.render(current); expect(listen.textContent).to.equal('Activate MIDI output');
      expect(view.presentOutputLabel('stale')).to.equal(false); view.render(createProcgenOperationalSnapshot()); view.dispose();
      expect(replacement.element.contains(listen)).to.equal(true); expect(replacement.element.contains(panic)).to.equal(true); expect(listen.textContent).to.equal('Activate MIDI output');
      expect(listen.getAttribute('aria-describedby')).to.equal('procgenOperationalMessage');
    } finally { replacement.dispose(); }
    expect([...original.children]).to.deep.equal([listen, panic]); expect(listen.hasAttribute('aria-describedby')).to.equal(false); expect(listen.dataset.operationalAction).to.equal(undefined);
  });
  it('restores the first owner’s attributes after multiple handoffs and ignores a late old-owner disposal', () => {
    view.dispose(); const listen = document.getElementById('procgenListen'); listen.title = 'Original'; listen.disabled = true; listen.setAttribute('aria-describedby', 'help');
    const first = createProcgenOperationalView({ document, readSnapshot: () => current, performAction() {} }); document.body.append(first.element);
    const last = createProcgenOperationalView({ document, readSnapshot: () => current, performAction() {} }); document.body.append(last.element);
    last.render(current); last.dispose(); first.dispose();
    expect(listen.parentNode.id).to.equal('original'); expect(listen.title).to.equal('Original'); expect(listen.disabled).to.equal(true); expect(listen.getAttribute('aria-describedby')).to.equal('help');
    expect(last.presentOutputLabel('late')).to.equal(false);
  });
  it('rejects a stale recovery target and executes a current action exactly once', async () => {
    const button = view.element.querySelector('[data-operational-action=play]'); current = { ...current, identity: 'two' }; button.click();
    expect(calls).to.have.length(0); expect(statuses.at(-1)).to.include('state changed'); button.click(); await Promise.resolve(); expect(calls).to.deep.equal([['play', 'two']]);
    view.dispose(); button.click(); expect(calls).to.have.length(1);
  });
  it('leaves non-button placeholder nodes in place and exposes a native recovery button', () => {
    view.dispose(); document.getElementById('procgenListen').remove(); const placeholder = document.createElement('span'); placeholder.id = 'procgenListen'; document.getElementById('original').append(placeholder);
    current = createProcgenOperationalSnapshot(); view = createProcgenOperationalView({ document, readSnapshot: () => current, performAction() {} }); document.body.append(view.element); view.render(current);
    expect(placeholder.parentNode.id).to.equal('original'); expect(view.presentOutputLabel('Listen locally')).to.equal(false); expect(view.element.querySelector('button[data-operational-action=listen]').hidden).to.equal(false);
  });
  it('cancels only the current cancelable operation and ignores a removed operation row', () => {
    const canceled = []; view.dispose(); view = createProcgenOperationalView({ document, readSnapshot: () => current, performAction() {}, cancelOperation: id => canceled.push(id) }); document.body.append(view.element);
    const operation = (id, phase = 'reading') => createProcgenOperationView({ id, kind: 'import', phase, cancelable: true });
    current = createProcgenOperationalSnapshot({ operations: [operation('first')] }); view.render(current);
    const old = view.element.querySelector('[data-operation-id="first"] button');
    current = createProcgenOperationalSnapshot({ operations: [operation('second')] }); old.click(); expect(canceled).to.have.length(0); expect(old.isConnected).to.equal(false);
    const active = view.element.querySelector('[data-operation-id="second"] button');
    current = createProcgenOperationalSnapshot({ operations: [operation('second', 'committing')] }); active.click(); expect(canceled).to.have.length(0); expect(active.hidden).to.equal(true);
    current = createProcgenOperationalSnapshot({ operations: [operation('second')] }); view.render(current); active.click(); expect(canceled).to.deep.equal(['second']);
    view.dispose(); active.click(); expect(canceled).to.deep.equal(['second']);
  });
  it('does not publish an asynchronous recovery failure to a replaced or disposed source', async () => {
    let reject; view.dispose(); view = createProcgenOperationalView({ document, readSnapshot: () => current, performAction: () => new Promise((_resolve, fail) => { reject = fail; }), onStatus: text => statuses.push(text) }); document.body.append(view.element); view.render(current);
    const button = view.element.querySelector('[data-operational-action=play]'); button.click(); expect(button.disabled).to.equal(true); button.click();
    current = { ...current, identity: 'replacement' }; reject(new Error('old failure')); await Promise.resolve(); await Promise.resolve(); expect(statuses).to.have.length(0); expect(button.disabled).to.equal(false);
    button.click(); view.dispose(); reject(new Error('retired failure')); await Promise.resolve(); await Promise.resolve(); expect(statuses).to.have.length(0);
  });
  it('retains a critical warning on unavailable refresh and does not create duplicate audio activation controls', () => {
    current = createProcgenOperationalSnapshot({ identity: 'quota', storage: { error: new Error('quota') } }); view.render(current); view.render(null);
    expect(view.element.textContent).to.include('Project save failed'); expect(view.element.textContent).to.include('refresh is unavailable');
    current = createProcgenOperationalSnapshot({ identity: 'off', simulation: { available: true }, output: { enabled: false, selectedBackend: 'synth' } }); view.render(current);
    expect(document.getElementById('procgenListen').textContent).to.equal('Listen locally'); expect(view.element.querySelector('button[data-operational-action=listen]')).to.equal(document.getElementById('procgenListen'));
    expect([...view.element.querySelectorAll('button')].filter(button => !button.hidden && button.textContent === 'Listen locally')).to.have.length(1);
  });
});
