import { expect } from 'chai';
import { normalizeParameterDescriptor, parameterUnitPosition, parameterValueAt, parseParameterValue } from '../js/app/controls/ParameterDescriptor.js';
import { createParameterKnob } from '../js/app/controls/ParameterKnob.js';
import { getPointerGestureArbiter } from '../js/app/controls/PointerGestureArbiter.js';
import { createProjectNameDialog } from '../js/app/controls/ProjectNameDialog.js';
import { TestDocument } from './helpers/test-dom.js';
const descriptor = { id: 'pitch', name: 'Pitch', quantity: 'pitch-offset', unit: 'cents', min: -1200, max: 1200, step: 10, fineStep: 1, defaultValue: 0, detents: [0] };
const event = (type, extra = {}) => ({ type, preventDefault() {}, stopPropagation() {}, ...extra });
describe('typed parameter control transactions', () => {
  it('round-trips logarithmic positions and refuses empty/nonfinite values without inventing zero', () => {
    const value = normalizeParameterDescriptor({ ...descriptor, min: 20, max: 20000, defaultValue: 440, unit: 'Hz', scale: 'logarithmic', detents: [] });
    for (const fraction of [0, 0.1, 0.5, 1]) expect(parameterUnitPosition(value, parameterValueAt(value, fraction))).to.be.closeTo(fraction, 1e-12);
    for (const text of ['', ' ', 'Infinity', 'NaN', '20001 Hz']) expect(() => parseParameterValue(value, text)).to.throw();
    expect(parseParameterValue(value, '440 Hz')).to.equal(440);
  });
  it('admits one target owner, ignores foreign pointers and cancels on identity replacement', () => {
    const arbiter = getPointerGestureArbiter({}), first = {}, cancelled = []; let identity = first;
    const lease = arbiter.acquire({ pointerId: 1, targetKey: 'gain', identity, getIdentity: () => identity, onCancel: reason => cancelled.push(reason) });
    expect(arbiter.acquire({ targetKey: 'pan', identity, getIdentity: () => identity })).to.equal(null);
    expect(lease.finish({ pointerId: 2 })).to.equal(false); expect(arbiter.inspect().pointerId).to.equal(1);
    identity = {}; expect(lease.owns({ pointerId: 1 })).to.equal(false); expect(cancelled).to.deep.equal(['target-replaced']); expect(arbiter.inspect()).to.equal(null);
  });
  it('previews many pointer samples but commits once, and canceled keyboard repeats commit nothing', () => {
    const document = new TestDocument(), window = {}, commits = [], previews = []; let identity = {};
    const knob = createParameterKnob({ document, window, descriptor, value: 0, getIdentity: () => identity, commit: value => commits.push(value), preview: value => previews.push(value) });
    const cap = knob.element.children[1]; cap.dispatchEvent(event('pointerdown', { pointerId: 7, clientY: 160, button: 0 }));
    for (let y = 159; y >= 80; y--) cap.dispatchEvent(event('pointermove', { pointerId: 7, clientY: y }));
    expect(commits).to.have.length(0); cap.dispatchEvent(event('pointerup', { pointerId: 8 })); expect(commits).to.have.length(0);
    cap.dispatchEvent(event('pointerup', { pointerId: 7 })); expect(commits).to.deep.equal([1200]); expect(previews.length).to.be.greaterThan(1);
    cap.dispatchEvent(event('keydown', { key: 'ArrowDown' })); cap.dispatchEvent(event('keydown', { key: 'ArrowDown', repeat: true }));
    cap.dispatchEvent(event('keydown', { key: 'Escape' })); cap.dispatchEvent(event('keyup', { key: 'ArrowDown' })); expect(commits).to.have.length(1);
    cap.dispatchEvent(event('pointerdown', { pointerId: 1, clientY: 0 })); identity = {}; cap.dispatchEvent(event('pointermove', { pointerId: 1, clientY: 100 }));
    expect(knob.inspect().gestureId).to.equal(null); knob.dispose();
  });
  it('updates pickup observations without overwriting the active drag and restores the accepted value after rejected publication', () => {
    const document = new TestDocument(), commits = [];
    const knob = createParameterKnob({ document, window: {}, descriptor, value: 0, commit: value => { commits.push(value); throw new Error('Publication rejected'); } });
    const cap = knob.element.children[1]; cap.dispatchEvent(event('pointerdown', { pointerId: 1, clientY: 160 }));
    cap.dispatchEvent(event('pointermove', { pointerId: 1, clientY: 120 })); const draft = knob.inspect().draft;
    knob.setObservations({ pickupValue: -600 }); expect(knob.inspect().draft).to.equal(draft);
    cap.dispatchEvent(event('pointerup', { pointerId: 1 })); expect(commits).to.have.length(1);
    expect(knob.inspect()).to.include({ authored: 0, draft: 0, gestureId: null }); knob.dispose();
  });
  it('retains the authored gesture draft across unchanged state patches and cancels a real external change', () => {
    const document = new TestDocument(), commits = [], cancellations = [];
    const knob = createParameterKnob({ document, window: {}, descriptor, value: 0, commit: value => commits.push(value), onCancel: reason => cancellations.push(reason) });
    const cap = knob.element.children[1]; cap.dispatchEvent(event('keydown', { key: 'ArrowUp' })); const before = knob.inspect();
    knob.setState({ value: 0, effectiveValue: 30 }); expect(knob.inspect()).to.deep.equal(before);
    cap.dispatchEvent(event('keyup', { key: 'ArrowUp' })); expect(commits).to.deep.equal([before.draft]);
    cap.dispatchEvent(event('keydown', { key: 'ArrowUp' })); knob.setState({ value: -300 });
    expect(knob.inspect()).to.include({ authored: -300, draft: -300, gestureId: null }); expect(cancellations).to.include('external-edit'); knob.dispose();
  });
  it('preserves a numeric composition buffer and requires explicit conflict resolution', () => {
    const document = new TestDocument(), commits = [];
    const knob = createParameterKnob({ document, window: {}, descriptor, value: 0, commit: value => commits.push(value) });
    const entry = knob.element.children[3]; entry.removeAttribute = name => entry.attributes.delete(name); document.activeElement = entry; entry.value = '-300'; entry.dispatchEvent(event('compositionstart')); entry.dispatchEvent(event('input'));
    entry.dispatchEvent(event('change')); expect(commits).to.have.length(0); knob.setState({ value: 600 });
    expect(entry.value).to.equal('-300'); expect(entry.dataset.editConflict).to.equal('true'); entry.dispatchEvent(event('keydown', { key: 'Enter' })); expect(commits).to.have.length(0);
    entry.dispatchEvent(event('compositionend')); entry.dispatchEvent(event('keydown', { key: 'Escape' })); expect(entry.value).to.equal('600'); expect(entry.dataset.editConflict).to.equal(undefined); knob.dispose();
  });
  it('returns momentary keyboard changes and always releases no-change pointer gestures', () => {
    const document = new TestDocument(), commits = [], previews = [], finishes = [];
    const knob = createParameterKnob({ document, window: {}, descriptor, value: 0, momentary: true,
      commit: value => commits.push(value), preview: (value, meta) => previews.push([value, meta.phase]), onFinish: () => finishes.push(true) });
    const cap = knob.element.children[1]; cap.dispatchEvent(event('keydown', { key: 'ArrowUp' })); cap.dispatchEvent(event('keyup', { key: 'ArrowUp' }));
    expect(knob.inspect().draft).to.equal(0); expect(previews.at(-1)).to.deep.equal([0, 'return']); expect(commits).to.have.length(0);
    cap.dispatchEvent(event('pointerdown', { pointerId: 2, clientY: 160, pointerType: 'pen', pressure: 0.4 })); cap.dispatchEvent(event('pointerup', { pointerId: 2 }));
    expect(finishes).to.have.length(2); knob.dispose();
  });
  it('keeps invalid project names editable inline and resolves explicit cancellation without saving', async () => {
    const document = new TestDocument(), create = document.createElement.bind(document); document.body = create('body');
    document.createElement = tag => { const element = create(tag); if (tag === 'dialog') { element.showModal = () => {}; element.close = () => element.dispatchEvent(event('close')); element.remove = () => document.body.removeChild(element); } return element; };
    const owner = createProjectNameDialog({ document }), pending = owner.request({ value: '' });
    const dialog = document.body.children[0], form = dialog.children[0], input = form.children[0].children[0];
    form.dispatchEvent(event('submit')); expect(form.children[1].textContent).to.include('Enter a project name'); expect(document.body.children).to.have.length(1);
    input.value = '  A named world  '; form.dispatchEvent(event('submit')); expect(await pending).to.equal('A named world');
    const cancelled = owner.request({ value: 'Unsaved' }); owner.dispose(); expect(await cancelled).to.equal(null);
  });
  it('dismisses naming only for one owned backdrop gesture, preserving inside drags and cancelled or foreign pointers', async () => {
    const document = new TestDocument(), create = document.createElement.bind(document);
    document.createElement = tag => { const element = create(tag); if (tag === 'dialog') { element.showModal = () => {}; element.close = () => element.dispatchEvent(event('close')); element.getBoundingClientRect = () => ({ left: 100, right: 300, top: 100, bottom: 200 }); } return element; };
    const owner = createProjectNameDialog({ document }), pending = owner.request({ value: 'Keep this name' });
    const dialog = document.body.children[0], pointer = (type, id, x, y) => dialog.dispatchEvent(event(type, { target: dialog, pointerId: id, clientX: x, clientY: y, button: 0 }));
    pointer('pointerdown', 1, 150, 150); pointer('pointerup', 1, 10, 10); expect(document.body.children).to.have.length(1);
    pointer('pointerdown', 1, 10, 10); pointer('pointercancel', 1, 10, 10); pointer('pointerup', 1, 10, 10); expect(document.body.children).to.have.length(1);
    pointer('pointerdown', 1, 10, 10); pointer('pointerup', 2, 10, 10); expect(document.body.children).to.have.length(1);
    pointer('pointerup', 1, 10, 10); expect(await pending).to.equal(null); expect(document.body.children).to.have.length(0); owner.dispose();
  });
});
