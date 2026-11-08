import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createKeyedControlTree } from '../js/app/controls/KeyedControlTree.js';

describe('keyed field identity and external editing conflicts', () => {
  let dom, document, tree, root, host, calls, statuses;
  beforeEach(() => {
    dom = new JSDOM('<body><button id="fallback">Lane inspector</button><div id="conflicts"></div><div id="fields"></div></body>');
    document = dom.window.document; root = document.getElementById('fields'); host = document.getElementById('conflicts'); calls = []; statuses = [];
    tree = createKeyedControlTree({ document, conflictHost: host, onStatus: text => statuses.push(text), focusFallback: () => document.getElementById('fallback') });
  });
  afterEach(() => { tree.dispose(); dom.window.close(); });
  const field = (id, value, changed) => {
    const label = document.createElement('label'); label.dataset.fieldKey = id; const input = document.createElement('input'); input.type = 'text'; input.dataset.fieldKey = id; input.value = value;
    label.append(input); tree.bind(input, { change: event => (changed || (value => calls.push(value)))(event.currentTarget.value) }); return label;
  };
  const render = (entries, identity = 'lane-1') => { const next = document.createElement('div'); next.append(...entries); tree.reconcile(root, next, identity); };
  const edit = (input, value) => { input.focus(); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  it('keeps the exact field, caret and updated callback through keyed reordering and unrelated patches', () => {
    render([field('name', 'Original'), field('other', 'Other')]); const input = root.querySelector('input'); edit(input, '-0.25'); input.setSelectionRange(2, 3);
    render([field('other', 'Changed'), field('name', 'Original', value => calls.push('new:' + value))]);
    expect(root.querySelector('[data-field-key="name"] input')).to.equal(input); expect(document.activeElement).to.equal(input); expect(input.value).to.equal('-0.25'); expect(input.selectionStart).to.equal(2);
    input.dispatchEvent(new dom.window.Event('change')); expect(calls).to.deep.equal(['new:-0.25']);
  });
  it('retains a complete composition session and commits exactly once after reconciliation', () => {
    render([field('name', 'Original')]); const input = root.querySelector('input'); input.focus();
    input.dispatchEvent(new dom.window.CompositionEvent('compositionstart')); edit(input, 'Compose'); render([field('name', 'Original')]);
    input.dispatchEvent(new dom.window.Event('change')); expect(calls).to.have.length(0);
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend')); input.dispatchEvent(new dom.window.Event('change')); input.dispatchEvent(new dom.window.Event('change'));
    expect(calls).to.deep.equal(['Compose']); expect(document.activeElement).to.equal(input);
  });
  it('refuses an implicit overwrite and explicitly resolves a changed canonical value', () => {
    render([field('name', 'Original')]); const input = root.querySelector('input'); edit(input, 'My draft'); render([field('name', 'External')]);
    expect(input.value).to.equal('My draft'); expect(input.dataset.editConflict).to.equal('true'); expect(host.textContent).to.include('Keep my edit');
    const dismiss = [...host.querySelectorAll('button')].find(button => button.textContent === 'Use current value');
    input.dispatchEvent(new dom.window.Event('change')); expect(calls).to.have.length(0);
    expect(host.contains(dismiss)).to.equal(true); dismiss.click();
    expect(input.value).to.equal('External'); expect(input.hasAttribute('data-edit-conflict')).to.equal(false); expect(document.activeElement).to.equal(input);
    edit(input, 'Intended'); render([field('name', 'Later', value => calls.push('current:' + value))]);
    [...host.querySelectorAll('button')].find(button => button.textContent === 'Keep my edit').click(); expect(calls).to.deep.equal(['current:Intended']);
  });
  it('fences old conflict buttons, removed controls and document replacement even with reused field names', () => {
    render([field('name', 'Original')]); const input = root.querySelector('input'); edit(input, 'Draft'); render([field('name', 'External')]); const old = host.querySelector('button');
    render([field('name', 'Later')]); old.click(); expect(calls).to.have.length(0);
    render([field('name', 'New document')], 'document-2'); input.dispatchEvent(new dom.window.Event('change')); old.click(); expect(calls).to.have.length(0);
    expect(root.querySelector('input')).not.to.equal(input); expect(document.activeElement.id).to.equal('fallback'); expect(statuses.at(-1)).to.include('no longer available');
  });
  it('preserves controls in multiple keyed roots without invalidating unrelated global buttons', () => {
    const other = document.createElement('div'), global = document.createElement('button'); document.body.append(other, global); tree.bind(global, { click: () => calls.push('global') });
    render([field('name', 'Original')]); const next = document.createElement('div'), button = document.createElement('button'); button.dataset.controlKey = 'tab'; tree.bind(button, { click: () => calls.push('tab') }); next.append(button);
    tree.reconcile(other, next, 'tabs'); root.querySelector('input').value = 'Valid'; root.querySelector('input').dispatchEvent(new dom.window.Event('change')); global.click(); button.click();
    expect(calls).to.deep.equal(['Valid', 'global', 'tab']);
  });
  it('keeps opaque owned controls mounted and restores an untouched select from the new option schema', () => {
    const widget = document.createElement('div'); widget.dataset.controlKey = 'owned'; widget.__ownedControl = true; render([widget]); const next = document.createElement('div'); next.append(tree.retain(widget)); tree.reconcile(root, next, 'lane-1'); expect(root.firstChild).to.equal(widget);
    const select = value => { const el = document.createElement('select'); el.dataset.fieldKey = 'choice'; for (const item of ['one', 'two']) { const option = document.createElement('option'); option.value = option.textContent = item; el.append(option); } el.value = value; tree.bind(el, { change: event => calls.push(event.currentTarget.value) }); return el; };
    render([select('one')]); const original = root.firstChild; render([select('two')]); expect(root.firstChild).to.equal(original); expect(original.value).to.equal('two');
  });
  it('projects global live values without losing a draft and fences a changed document before its next paint', () => {
    let documentId = 'one'; const input = document.createElement('input'); input.type = 'text'; input.value = '120'; root.append(input);
    tree.bind(input, { getIdentity: () => documentId, change: event => calls.push(event.currentTarget.value) });
    tree.update(input, '120', { identity: documentId }); edit(input, '123.45'); tree.update(input, '120', { identity: documentId }); expect(input.value).to.equal('123.45');
    tree.update(input, '180', { identity: documentId }); expect(input.dataset.editConflict).to.equal('true');
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })); expect(calls).to.have.length(0);
    host.querySelector('[data-resolution=current]').click(); expect(input.value).to.equal('180');
    edit(input, '200'); documentId = 'two'; input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })); expect(calls).to.have.length(0);
    tree.update(input, '240', { identity: documentId }); expect(input.value).to.equal('240'); expect(input.dataset.editConflict).to.equal(undefined);
  });
  it('keeps native projected checkbox values and disables rejected authority without blocking discard', () => {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; root.append(checkbox); tree.bind(checkbox, { change: event => calls.push(event.currentTarget.checked) });
    tree.update(checkbox, false); checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change')); expect(calls).to.deep.equal([true]);
    render([field('tempo', '120')]); const input = root.querySelector('input'); edit(input, '180'); input.disabled = true; tree.update(input, '120');
    expect(host.querySelector('[data-resolution=keep]').disabled).to.equal(true); host.querySelector('[data-resolution=current]').click(); expect(input.value).to.equal('120');
  });
  it('commits Enter once, keeps rejected drafts editable and restores the accepted value on Escape', () => {
    render([field('tempo', '120', value => { calls.push(value); return value !== ''; })]); const input = root.querySelector('input'); edit(input, '');
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })); tree.update(input, '120'); expect(input.value).to.equal('');
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); expect(input.value).to.equal('120');
    edit(input, '180'); input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })); input.dispatchEvent(new dom.window.Event('change')); expect(calls).to.deep.equal(['', '180']);
  });
  it('retires all callbacks and resolutions idempotently', () => {
    render([field('name', 'Original')]); const input = root.querySelector('input'); edit(input, 'Draft'); render([field('name', 'External')]); const keep = host.querySelector('button');
    tree.dispose(); tree.dispose(); input.dispatchEvent(new dom.window.Event('change')); keep.click(); expect(calls).to.have.length(0);
  });
});
