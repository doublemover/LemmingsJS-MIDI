import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createProcgenReplacementReview as review } from '../js/app/procgen/workstation/ProcgenReplacementPolicy.js';
import { createProjectReplacementDialog } from '../js/app/controls/ProjectReplacementDialog.js';
import { createKeyedControlTree } from '../js/app/controls/KeyedControlTree.js';
import { createParameterKnob } from '../js/app/controls/ParameterKnob.js';
import { createAutomationCurveEditor } from '../js/app/controls/AutomationCurveEditor.js';
import { createProjectNameDialog } from '../js/app/controls/ProjectNameDialog.js';
import { setup } from './helpers/workstation-fixture.js';

const plan = patch => review({ identity: 'revision:1', documentIdentity: '1', name: 'Source', ...patch });
const tick = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const dirty = f => f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 64 } });
const finish = async f => { const receipt = f.studio.dispose(); await receipt.completion; };
const buttons = document => [...document.querySelectorAll('.studio-replacement-review button')];

describe('source-bound replacement review', () => {
  it('keeps canonical edits, physical checkpoints, text drafts and independent artifacts distinct', () => {
    assert.equal(plan({}).required, false);
    assert.equal(plan({ dirty: true }).canSave, true);
    assert.equal(plan({ physicalProgress: true }).canSave, true);
    const drafts = plan({ dirty: true, drafts: { textDrafts: 2 } }); assert.equal(drafts.canSave, false); assert.equal(drafts.canReplace, true); assert.match(drafts.reasons.join(' '), /2 local text drafts/);
    const retained = plan({ artifact: 3, recording: { retained: 12 } }); assert.equal(retained.canReplace, true); assert.equal(retained.canSave, false); assert.match(retained.reasons.join(' '), /original source/); assert.match(retained.reasons.join(' '), /independent/);
    const curve = plan({ dirty: true, drafts: { curveDrafts: 1 } }); assert.equal(curve.canSave, false); assert.equal(curve.canReplace, true); assert.match(curve.reasons.join(' '), /local curve draft/);
    const take = plan({ take: { recording: true } }); assert.equal(take.finalizeTake, true); assert.equal(take.canSave, false); assert.match(take.replaceLabel, /Finalize/);
    assert.ok(Object.isFrozen(drafts)); assert.ok(Object.isFrozen(drafts.reasons));
  });
  for (const [label, state] of Object.entries({ gesture: { drafts: { gestures: 1 } }, preparing: { capture: { state: 'preparing' } }, capturing: { capture: { state: 'recording' } }, stopping: { capture: { state: 'stopping' } }, unresolved: { capture: { unresolved: true } }, recovering: { take: { recovering: true } }, finalizing: { take: { finalizing: true } }, midi: { recording: { active: true } }, learning: { recording: { learning: true } }, prelisten: { prelisten: { unresolved: true } }, audition: { prelisten: { active: true } }, write: { delivery: true }, save: { saving: true }, file: { preparingFile: true } })) it('refuses unsupported replacement while ' + label + ' owns unfinished work', () => {
    const value = plan({ dirty: true, ...state }); assert.equal(value.required, true); assert.equal(value.canReplace, false); assert.equal(value.canSave, false); assert.ok(value.reasons.length);
  });
  it('bounds metadata and rejects an unbound source without retaining a capability', () => {
    const value = plan({ name: 'n'.repeat(200), artifact: { secret: true }, drafts: { textDrafts: Infinity, gestures: -1 } }); assert.equal(value.name.length, 120); assert.equal(value.textDrafts, 0); assert.equal(value.gestures, 0); assert.equal(JSON.stringify(value).includes('secret'), false);
    for (const patch of [{ identity: '' }, { documentIdentity: '' }, { identity: 'x'.repeat(2049) }]) assert.throws(() => plan(patch), /source/);
  });
  it('restores exact owned text and caret without committing, and fences replaced or disposed fields', () => {
    const dom = new JSDOM('<body><input aria-label="Draft"></body>'), document = dom.window.document, field = document.querySelector('input'), calls = []; let identity = 'one';
    const tree = createKeyedControlTree({ document }); field.value = '120'; tree.bind(field, { getIdentity: () => identity, change: () => calls.push('committed') });
    field.focus(); field.value = '-'; field.dispatchEvent(new dom.window.Event('input')); field.setSelectionRange(1, 1); field.blur();
    assert.deepEqual(tree.draftState(), { count: 1, revision: 1, labels: ['Draft'] }); assert.equal(tree.focusDraft(), true); assert.equal(document.activeElement, field); assert.equal(field.selectionStart, 1); assert.deepEqual(calls, []);
    identity = 'two'; assert.equal(tree.focusDraft(), false); assert.equal(tree.draftState().count, 0); tree.dispose(); assert.equal(tree.focusDraft(), false); dom.window.close();
  });
  it('reports a fresh field revision even when the draft count does not change', () => {
    const dom = new JSDOM('<body><input></body>'), document = dom.window.document, field = document.querySelector('input'), tree = createKeyedControlTree({ document }); field.value = '120'; tree.bind(field, { change: () => false });
    field.value = '-'; field.dispatchEvent(new dom.window.Event('input')); const first = tree.draftState(); field.value = '+'; field.dispatchEvent(new dom.window.Event('input')); const second = tree.draftState(); assert.equal(first.count, second.count); assert.ok(second.revision > first.revision); tree.dispose(); dom.window.close();
  });
  it('restores the exact retained automation draft and never applies it during focus restoration', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document, commits = []; let active = true, changes = 0;
    const editor = createAutomationCurveEditor({ document, window: dom.window, curve: { id: 'cc', length: 4, axis: 'beat', mode: 'linear', points: [{ beat: 0, value: 32 }, { beat: 4, value: 64 }] }, getIdentity: () => active ? 'one' : null, commit: value => commits.push(value), onDraftActivity: () => changes++ }); document.body.append(editor.element);
    const input = editor.element.querySelector('[aria-label="Points"]'); input.focus(); input.value = '0:'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.setSelectionRange(2, 2); input.blur();
    assert.equal(editor.focusDraft(), true); assert.equal(document.activeElement, input); assert.equal(input.value, '0:'); assert.equal(input.selectionStart, 2); assert.equal(changes, 1); assert.deepEqual(commits, []); active = false; assert.equal(editor.focusDraft(), false); editor.dispose(); dom.window.close();
  });
  it('reopens a compact knob draft with its exact selection and refuses disabled ownership', () => {
    const dom = new JSDOM('<body></body>', { pretendToBeVisual: true }), document = dom.window.document, calls = [];
    const knob = createParameterKnob({ document, window: dom.window, compact: true, descriptor: { id: 'gain', name: 'Gain', quantity: 'gain', unit: 'ratio', min: 0, max: 1, step: .1, defaultValue: .5 }, value: .5, getIdentity: () => 'one', commit: value => calls.push(value) });
    document.body.append(knob.element); knob.element.querySelector('.parameter-entry-toggle').click(); const entry = document.querySelector('input'); entry.value = '.'; entry.dispatchEvent(new dom.window.Event('input', { bubbles: true })); entry.setSelectionRange(1, 1);
    assert.equal(knob.focusDraft(), true); assert.equal(entry.value, '.'); assert.equal(entry.selectionStart, 1); assert.deepEqual(calls, []); entry.disabled = true; assert.equal(knob.focusDraft(), false); knob.dispose(); dom.window.close();
  });
  for (const mode of ['cancel', 'escape', 'abort', 'dispose', 'stale', 'read-error']) it('settles ' + mode + ' once and retires its dialog without applying drafts', async () => {
    const dom = new JSDOM('<body><button id="source">Source</button></body>'), document = dom.window.document;
    dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    let current = true, broken = false, restores = 0; const signal = new AbortController(), owner = createProjectReplacementDialog({ document, restoreDraftFocus: () => { restores++; return true; } });
    const pending = owner.request({ readReview: () => { if (broken) throw new Error('obsolete owner'); return plan({ dirty: true }); }, signal: signal.signal, isCurrent: () => current });
    const dialog = document.querySelector('dialog'); assert.equal(owner.owns(dialog), true);
    if (mode === 'cancel') buttons(document)[2].click(); else if (mode === 'escape') dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); else if (mode === 'abort') signal.abort(); else if (mode === 'dispose') owner.dispose(); else if (mode === 'stale') { current = false; owner.refresh(); } else { broken = true; owner.refresh(); }
    assert.equal(await pending, null); await tick(); assert.equal(document.querySelector('dialog'), null); assert.ok(restores <= 1); if (['dispose', 'stale'].includes(mode)) assert.equal(restores, 0); owner.dispose(); dom.window.close();
  });
  it('requires another choice after revision changes and parks only a hosted Save handoff', async () => {
    const dom = new JSDOM('<body><dialog open><div id="items">Project rows</div></dialog></body>'), document = dom.window.document, host = document.querySelector('dialog'); let revision = 1, parks = 0;
    const owner = createProjectReplacementDialog({ document }); const pending = owner.request({ readReview: () => plan({ dirty: true, identity: String(revision) }), isCurrent: () => true, hostDialog: host, parkHost: () => { parks++; } });
    assert.equal(document.querySelector('#items').hidden, true); revision++; owner.refresh(); buttons(document)[0].click(); assert.equal(parks, 0); assert.equal(document.querySelectorAll('dialog').length, 1);
    buttons(document)[0].click(); assert.deepEqual(await pending, { action: 'save', identity: '2', finalizeTake: false }); assert.equal(parks, 1); assert.equal(document.querySelector('#items').hidden, false); owner.dispose(); dom.window.close();
  });
  it('restores the exact hosted action after Cancel while its scene dialog stays open', async () => {
    const dom = new JSDOM('<body><dialog open><button id="apply">Load fresh</button></dialog></body>'), document = dom.window.document, host = document.querySelector('dialog'), original = document.getElementById('apply'); original.focus(); let draftFocus = 0;
    const owner = createProjectReplacementDialog({ document, restoreDraftFocus: () => { draftFocus++; return true; } });
    const pending = owner.request({ readReview: () => plan({ dirty: true }), isCurrent: () => true, hostDialog: host }); buttons(document).at(-1).click(); assert.equal(await pending, null); await tick();
    assert.equal(host.open, true); assert.equal(original.hidden, false); assert.equal(document.activeElement, original); assert.equal(draftFocus, 0); owner.dispose(); dom.window.close();
  });
  it('retires an obsolete name prompt without submitting its source or refocusing a replaced field', async () => {
    const dom = new JSDOM('<body><button id="old">Old source</button><input id="current"></body>'), document = dom.window.document; let current = true; document.getElementById('old').focus();
    dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; }; dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; };
    const owner = createProjectNameDialog({ document, window: dom.window }), pending = owner.request({ isCurrent: () => current }); current = false; const currentField = document.getElementById('current'); currentField.focus(); owner.refresh(); assert.equal(await pending, null); assert.equal(document.activeElement, currentField); assert.equal(document.querySelector('dialog'), null); owner.dispose(); dom.window.close();
  });
  for (const action of ['new', 'import', 'load']) it('Cancel ' + action + ' preserves source, edits and drafts before candidate reads', async () => {
    let reads = 0; const f = setup(); f.studio.bindRuntime(); dirty(f); const source = f.studio.getProject(), world = f.runtime.world;
    f.view.pendingDraftState = () => ({ textDrafts: 1, gestures: 0 }); f.view.requestReplacementReview = async options => { assert.equal(options.readReview().canSave, false); return null; };
    try {
      if (action === 'new') assert.equal(await f.studio.handlers.new({ review: true }), false);
      if (action === 'import') assert.equal(await f.studio.handlers.import({ size: 1, text() { reads++; return '{}'; } }, { review: true }), false);
      if (action === 'load') { f.storage.list = async () => [{ id: 'selected' }]; f.storage.load = async () => { reads++; }; f.view.showProjects = (_rows, select) => { f.selection = select; }; await f.studio.handlers.load({ review: true }); assert.equal(await f.selection('selected'), false); }
      assert.equal(reads, 0); assert.equal(f.studio.getProject(), source); assert.equal(f.runtime.world, world); assert.equal(f.studio.getDocumentState().dirty, true);
    } finally { await finish(f); }
  });
  for (const action of ['new', 'load', 'import']) for (const mode of ['recording', 'learning']) it('keeps active MIDI ' + mode + ' before admitting reviewed ' + action, async () => {
    const f = setup(); f.studio.bindRuntime(); let reviews = 0, reads = 0; f.view.requestReplacementReview = () => { reviews++; return null; };
    try {
      if (mode === 'recording') { f.studio.handlers.record(true); f.studio.ports.receiveMidi([0x90, 67, 97], 0); } else assert.equal(f.studio.handlers.learn(), true);
      const source = f.studio.getProject(), world = f.runtime.world, target = f.studio.getInputEditLease(), operation = f.studio.getOperationState();
      const result = action === 'import' ? await f.studio.handlers.import({ size: 1, text() { reads++; return '{}'; } }, { review: true }) : await f.studio.handlers[action]({ review: true });
      assert.equal(result, false); assert.equal(reviews, 0); assert.equal(reads, 0); assert.equal(f.studio.getProject(), source); assert.equal(f.runtime.world, world); assert.deepEqual(f.studio.getInputEditLease(), target); assert.deepEqual(f.studio.getOperationState(), operation);
      if (mode === 'recording') { assert.equal(f.studio.ports.getState().recording, true); f.time(125); f.studio.ports.receiveMidi([0x80, 67, 0], 125); assert.equal(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].duration, .25); }
      else { assert.equal(f.studio.ports.getState().learning, true); f.studio.ports.receiveMidi([0x90, 81, 100], 0); assert.equal(f.studio.getProject().procgen.lanes[0].patterns[0].steps[0].note, 81); }
    } finally { await finish(f); }
  });
  it('saves the reviewed captured revision before New and reuses its single operation lease', async () => {
    const f = setup(); f.studio.bindRuntime(); dirty(f); let reviews = 0; f.view.requestReplacementReview = async ({ readReview }) => { reviews++; return { action: 'save', identity: readReview().identity }; };
    try { const world = f.runtime.world; assert.equal(await f.studio.handlers.new({ review: true }), true); assert.equal(reviews, 1); assert.equal(f.saveCalls, 1); assert.notEqual(f.runtime.world, world); assert.equal(f.studio.getOperationState(), null); } finally { await finish(f); }
  });
  it('requires a fresh review when newer edits outlive the reviewed durable snapshot', async () => {
    const entered = deferred(), written = deferred(), records = [], f = setup({ storageOverride: { async saveDocument(id, revision, session) { records.push(session); entered.resolve(); await written.promise; return { id, revision: revision + 1 }; }, close() {} } }); f.studio.bindRuntime(); dirty(f); let reviews = 0;
    f.view.requestReplacementReview = async ({ readReview }) => { reviews++; return reviews === 1 ? { action: 'save', identity: readReview().identity } : null; };
    try { const world = f.runtime.world, replacing = f.studio.handlers.new({ review: true }); await entered.promise; f.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: 65 } }); written.resolve(); assert.equal(await replacing, false); assert.equal(reviews, 2); assert.equal(f.runtime.world, world); assert.equal(f.studio.getDocumentState().dirty, true); assert.equal(records[0].project.procgen.lanes[0].patterns[0].steps[0].note, 64); } finally { await finish(f); }
  });
  it('does not invalidate a pending Save or a held gesture just to open replacement review', async () => {
    const entered = deferred(), written = deferred(), f = setup({ storageOverride: { async saveDocument(id) { entered.resolve(); await written.promise; return { id, revision: 1 }; }, close() {} } }); f.studio.bindRuntime(); dirty(f); let reviews = 0; f.view.requestReplacementReview = () => { reviews++; };
    try { const saving = f.studio.handlers.save(); await entered.promise; assert.equal(await f.studio.handlers.new({ review: true }), false); written.resolve(); assert.equal(await saving, true); assert.equal(f.studio.getDocumentState().dirty, false); f.view.pendingDraftState = () => ({ textDrafts: 0, gestures: 1 }); assert.equal(await f.studio.handlers.new({ review: true }), false); assert.equal(reviews, 0); } finally { await finish(f); }
  });
  for (const failure of [false, true]) it('publishes same-document Save ' + (failure ? 'refusal' : 'acknowledgment') + ' after opening a read-only picker', async () => {
    const entered = deferred(), written = deferred(), f = setup({ storageOverride: { async saveDocument(id) { entered.resolve(); await written.promise; if (failure) throw new Error('Same source write refused'); return { id, revision: 1 }; }, async list() { return []; }, close() {} } }); f.studio.bindRuntime(); dirty(f);
    try { const saving = f.studio.handlers.save(); await entered.promise; const identity = f.studio.getOperationalSnapshot().documentIdentity; await f.studio.handlers.load(); written.resolve(); assert.equal(await saving, !failure); assert.equal(f.studio.getOperationalSnapshot().documentIdentity, identity); assert.equal(f.studio.getDocumentState().dirty, failure); if (failure) assert.match(f.statuses.join(' '), /write refused/); else assert.equal(f.studio.getDocumentState().revision, 1); assert.equal(f.studio.transport.getState().playing, false); } finally { await finish(f); }
  });
  it('does not turn a post-acknowledgment presentation exception into a storage fault', async () => {
    const f = setup({ storageOverride: { async saveDocument(id) { return { id, revision: 1 }; }, close() {} } }); f.studio.bindRuntime(); dirty(f); const receipts = []; f.view.operationReceipt = value => receipts.push(value); f.view.storage = () => { throw new Error('Presentation unavailable'); };
    try { assert.equal(await f.studio.handlers.save(), false); assert.equal(f.studio.getDocumentState().revision, 1); assert.equal(f.studio.getDocumentState().dirty, false); assert.equal(f.studio.getOperationalSnapshot().conditions.some(value => value.code === 'storage-error'), false); assert.equal(receipts.find(value => value.kind === 'save').outcome, 'committed-with-error'); } finally { await finish(f); }
  });
  it('rejects a stale review decision after another transaction has replaced its source', async () => {
    const f = setup(); f.studio.bindRuntime(); dirty(f); const decision = deferred(), entered = deferred(); f.view.requestReplacementReview = async ({ readReview }) => { const value = readReview(); entered.resolve(value); return decision.promise; };
    try { const first = f.studio.handlers.new({ review: true }), source = await entered.promise; await f.studio.handlers.new(); const world = f.runtime.world; decision.resolve({ action: 'replace', identity: source.identity }); assert.equal(await first, false); assert.equal(f.runtime.world, world); } finally { await finish(f); }
  });
});
