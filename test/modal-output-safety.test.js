import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createModalOutputSafety } from '../js/app/controls/ModalOutputSafety.js';
import { getPointerGestureArbiter } from '../js/app/controls/PointerGestureArbiter.js';

describe('native dialog output safety ownership', () => {
  let dom, document, safety, calls, statuses;
  const opening = dialog => { const event = new dom.window.Event('beforetoggle'); Object.defineProperty(event, 'newState', { value: 'open' }); dialog.dispatchEvent(event); dialog.open = true; };
  const dialog = () => { const value = document.createElement('dialog'); document.body.append(value); opening(value); return value; };
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>'); document = dom.window.document; calls = []; statuses = [];
    safety = createModalOutputSafety({ document, stop: () => calls.push('stop'), panic: () => calls.push('panic'), onStatus: message => statuses.push(message) });
  });
  afterEach(() => { safety.dispose(); dom.window.close(); });
  it('mounts once in each native dialog and invokes the existing output owners without submitting or closing', () => {
    const value = dialog(); opening(value); const buttons = value.querySelectorAll('button'); expect(buttons).to.have.length(2);
    buttons[0].click(); buttons[1].click(); expect(calls).to.deep.equal(['stop', 'panic']); expect(value.open).to.equal(true);
    expect([...buttons].every(button => button.type === 'button')).to.equal(true);
    const event = new dom.window.MouseEvent('pointerdown', { button: 0, cancelable: true }); buttons[1].dispatchEvent(event); expect(event.defaultPrevented).to.equal(true);
  });
  it('cancels the captured edit without publication and continues safety release when cancellation throws', () => {
    const value = dialog(), arbiter = getPointerGestureArbiter(document); let cancelled = 0;
    arbiter.acquire({ pointerId: 1, targetKey: 'knob', identity: 'one', getIdentity: () => 'one', onCancel: reason => { expect(reason).to.equal('output-panic'); cancelled++; throw new Error('retirement'); } });
    value.querySelector('[data-output-safety-action=output-panic]').click(); expect(cancelled).to.equal(1); expect(calls).to.deep.equal(['panic']); expect(arbiter.inspect()).to.equal(null); expect(statuses[0]).to.include('cancellation failed');
  });
  it('fences detached and retired callbacks and transfers the document lease without removing the new owner', () => {
    const value = dialog(), retired = value.querySelector('button'); value.remove(); retired.click(); expect(calls).to.have.length(0);
    expect(safety.inspect().dialogs).to.equal(0); document.body.append(value); opening(value);
    const previous = value.querySelector('button'); const replacement = createModalOutputSafety({ document, stop: () => calls.push('replacement'), panic: () => {} });
    try { safety.dispose(); previous.click(); expect(calls).to.have.length(0); value.querySelector('button').click(); expect(calls).to.deep.equal(['replacement']); }
    finally { replacement.dispose(); }
  });
  it('reclaims removed dialog controls through repeated modal lifetimes with bounded retention', () => {
    for (let index = 0; index < 100; index++) { const value = dialog(); expect(safety.inspect().dialogs).to.equal(1); value.remove(); }
    expect(safety.inspect().dialogs).to.equal(0); expect(document.querySelectorAll('.studio-modal-output-safety')).to.have.length(0);
  });
  it('keeps every nested dialog reachable and still releases output if status reporting throws', () => {
    safety.dispose(); let released = 0;
    safety = createModalOutputSafety({ document, panic: () => released++, onStatus: () => { throw new Error('status unavailable'); } });
    const values = Array.from({ length: 20 }, dialog); expect(safety.inspect().dialogs).to.equal(20);
    getPointerGestureArbiter(document).acquire({ targetKey: 'draft', identity: 'one', getIdentity: () => 'one', onCancel: () => { throw new Error('retirement'); } });
    values.at(-1).querySelector('[data-output-safety-action=output-panic]').click(); expect(released).to.equal(1);
    safety.dispose(); expect(document.querySelectorAll('.studio-modal-output-safety')).to.have.length(0);
  });
});
