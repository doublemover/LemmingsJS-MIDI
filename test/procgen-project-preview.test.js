import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createProcgenProjectSummary, readProcgenProjectSummary } from '../js/app/procgen/workstation/ProcgenProjectSummary.js';
import { createProcgenProjectPreview } from '../js/app/procgen/workstation/ProcgenProjectPreview.js';
import { setup } from './helpers/workstation-fixture.js';
const snapshot = () => ({ name: 'Retained source', savedAt: '2026-11-04T12:00:00.000Z', version: 1, project: { procgen: { version: 2 } }, world: { version: 2, laneCount: 2, seed: 42 }, recoverySource: { documentId: 'doc:original', storedRevision: 3, editRevision: 9 },
  recoveryJournal: { sequence: 12, initial: { tick: 8, generation: 1 }, final: { tick: 20, generation: 2 } } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const retire = async fixture => { await fixture.studio.dispose().completion; };

describe('bounded project metadata and candidate previews', () => {
  it('projects only bounded immutable metadata and never retains a checkpoint graph or capability', () => {
    const session = snapshot(); session.world.graph = { payload: new Uint8Array(1024) }; session.callback = () => {};
    const value = createProcgenProjectSummary(session, { id: 'recovery:checkpoint', kind: 'recovery-checkpoint', recoveryGeneration: 4, verification: 'checksum-verified', checksum: 'a'.repeat(64), documentRevision: 999, sourceDocumentId: 'doc:forged' });
    assert.deepEqual(value.range, { firstSequence: 1, lastSequence: 12, initial: { tick: 8, generation: 1 }, final: { tick: 20, generation: 2 }, verified: true });
    assert.equal(value.documentRevision, 9); assert.equal(value.sourceDocumentId, 'doc:original'); assert.equal(value.sourceStoredRevision, 3); assert.equal(value.tick, 20); assert.equal(value.generation, 2);
    assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.range.final)); assert.equal(JSON.stringify(value).includes('payload'), false); assert.equal(JSON.stringify(value).includes('callback'), false); assert.ok(JSON.stringify(value).length < 2048);
    session.recoveryJournal.final.tick = 99; assert.equal(value.range.final.tick, 20);
  });
  for (const input of [null, undefined, '', 7, [], { name: 'x'.repeat(121), id: 'x'.repeat(513), laneCount: 1025, seed: Infinity, revision: -1, checksum: 'x'.repeat(129) }]) it('keeps malformed or absent metadata unknown: ' + String(JSON.stringify(input)).slice(0, 32), () => {
    const value = readProcgenProjectSummary(input); assert.equal(value.verification, 'unverified'); assert.ok(value.name.length <= 120); assert.ok(value.id == null || value.id.length <= 512); assert.ok(value.laneCount == null || value.laneCount <= 1024); assert.ok(value.seed == null || Number.isFinite(value.seed));
  });
  it('never promotes a persisted verified flag or an incomplete range', () => {
    const value = readProcgenProjectSummary({ verification: 'checksum-verified', range: { lastSequence: 12, initial: { tick: 1, generation: 1 }, final: { tick: 2, generation: 1 } } }); assert.equal(value.verification, 'unverified'); assert.equal(value.range.verified, false);
    for (const range of [{ lastSequence: Infinity }, { lastSequence: 1, initial: { tick: -1, generation: 1 }, final: { tick: 2, generation: 1 } }]) assert.equal(readProcgenProjectSummary({ range }).range, null);
    const empty = createProcgenProjectSummary({ ...snapshot(), recoveryJournal: { sequence: 0, initial: { tick: 8, generation: 1 }, final: { tick: 8, generation: 1 } } }, { verification: 'checksum-verified' }); assert.equal(empty.range.firstSequence, null); assert.equal(empty.range.lastSequence, 0);
  });
  for (const [sessionVersion, projectVersion, compatibility] of [[1, 2, 'supported-header'], [2, 2, 'unsupported-header'], [1, 3, 'unsupported-header'], [1, 1, 'check-on-open'], [null, null, 'check-on-open']]) it('describes compatibility without asserting a successful Open: ' + sessionVersion + '/' + projectVersion, () => {
    assert.equal(readProcgenProjectSummary({ sessionVersion, projectVersion }).compatibility, compatibility);
  });
  it('requires explicit Open and verification, consumes current selection and retires listeners', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document, calls = []; let state = { selection: createProcgenProjectSummary(snapshot(), { id: 'recovery:checkpoint', kind: 'recovery-checkpoint' }), busy: false };
    const preview = createProcgenProjectPreview({ document, readState: () => state, open: () => calls.push(state.selection.id), verify: () => calls.push('verify'), compare: () => calls.push('compare') }); document.body.append(preview.element); preview.render();
    const open = preview.element.querySelector('[data-project-action=open]'), verify = preview.element.querySelector('[data-project-action=verify]');
    assert.equal(open.disabled, true); assert.equal(verify.hidden, false); assert.match(preview.element.textContent, /Not verified/); verify.click(); assert.deepEqual(calls, ['verify']);
    state = { ...state, selection: createProcgenProjectSummary(snapshot(), { id: 'recovery:checkpoint', kind: 'recovery-checkpoint', verification: 'checksum-verified' }) }; preview.render(); assert.equal(open.disabled, false); assert.match(preview.element.textContent, /records 1–12/);
    state.busy = true; preview.render(); assert.equal(open.disabled, true); state.busy = false; preview.render(); open.click(); assert.deepEqual(calls, ['verify', 'recovery:checkpoint']); preview.dispose(); open.click(); assert.equal(calls.length, 2); dom.window.close();
  });
  it('keeps legacy and unsupported sources distinct and compares named metadata without opening either source', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document; let state = { selection: readProcgenProjectSummary({ id: 'recovery:legacy', kind: 'legacy-recovery' }), busy: false };
    const preview = createProcgenProjectPreview({ document, readState: () => state, open() {}, verify() {}, compare() {} }); preview.render(); assert.match(preview.element.textContent, /Open unverified legacy recovery/); assert.match(preview.element.textContent, /No verified durable range/);
    state = { ...state, selection: readProcgenProjectSummary({ id: 'doc:new', sessionVersion: 3 }), comparison: null }; preview.render(); assert.equal(preview.element.querySelector('[data-project-action=open]').disabled, true); assert.match(preview.element.textContent, /no longer available/);
    state.comparison = readProcgenProjectSummary({ id: 'doc:original', name: 'Original named project', revision: 8 }); preview.render(); assert.match(preview.element.textContent, /Original named project · revision 8/); preview.dispose(); dom.window.close();
  });
});

describe('source-bound project candidate orchestration', () => {
  it('offers metadata-only recovery verification and source comparison without replacing or cleaning the current document', async () => {
    let released = 0, reads = 0, options; const summary = createProcgenProjectSummary(snapshot(), { id: 'recovery:checkpoint', kind: 'recovery-checkpoint', recoveryGeneration: 2, checksum: 'complete', verification: 'checksum-verified' });
    const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async getRecoverySummary() { return { ...summary, recoveryGeneration: 3, verification: 'unverified' }; }, async loadRecoveryOwned() { reads++; return { verification: 'checksum-verified-recovery', summary, release() { released++; } }; }, async getDocumentSummary(id) { return { id, name: 'Named source', revision: 4 }; }, close() {} } }); fixture.studio.bindRuntime(); fixture.view.showProjectPage = (_page, _load, _fetch, value) => { options = value; };
    try { const world = fixture.runtime.world, project = fixture.studio.getProject(), document = fixture.studio.getDocumentState(); await fixture.studio.handlers.load(); assert.equal(reads, 0); assert.equal(options.recovery.recoveryGeneration, 3); assert.equal((await options.verifyRecovery(options.recovery)).recoveryGeneration, 2); assert.equal((await options.readNamedSummary('doc:original')).revision, 4); assert.equal(released, 1); assert.equal(fixture.runtime.world, world); assert.equal(fixture.studio.getProject(), project); assert.deepEqual(fixture.studio.getDocumentState(), document); } finally { await retire(fixture); }
  });
  it('retains ownership and releases an obsolete verification result without inspecting its summary', async () => {
    const result = deferred(); let entered = false, options, inspected = 0, releases = 0;
    const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async getRecoverySummary() { return null; }, loadRecoveryOwned() { entered = true; return result.promise; }, close() {} } }); fixture.studio.bindRuntime(); fixture.view.showProjectPage = (_page, _load, _fetch, value) => { options = value; };
    try { await fixture.studio.handlers.load(); const verifying = options.verifyRecovery(); while (!entered) await Promise.resolve(); const id = fixture.studio.getOperationalSnapshot().operations[0].id; assert.equal(fixture.studio.handlers.cancelOperation(id), true); result.resolve({ get summary() { inspected++; throw new Error('Obsolete summary read'); }, release() { releases++; } }); assert.equal(await verifying, null); assert.equal(inspected, 0); assert.equal(releases, 1); assert.equal(fixture.studio.getOperationState(), null); } finally { await retire(fixture); }
  });
  it('pins explicit Open to the selected named revision and keeps the old world after a conflict', async () => {
    let select; const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [{ id: 'doc:source', revision: 1 }], nextCursor: null }; }, async loadDocument() { return { id: 'doc:source', revision: 2, session: fixture.studio.capture() }; }, close() {} } }); fixture.studio.bindRuntime(); fixture.view.showProjectPage = (_page, load) => { select = load; };
    try { await fixture.studio.handlers.load(); const world = fixture.runtime.world; await assert.rejects(select('doc:source', { revision: 1 }), /changed after selection/); assert.equal(fixture.runtime.world, world); assert.equal(fixture.studio.getOperationState().kind, 'select-session'); } finally { await retire(fixture); }
  });
  it('retains a failed selected Open in bounded operation history after picker cancellation', async () => {
    let select; const notices = [], fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async loadDocumentOwned() { throw Object.assign(new Error('Selected source checksum refused'), { code: 'source-checksum' }); }, close() {} } }); fixture.studio.bindRuntime(); fixture.view.showProjectPage = (_page, load) => { select = load; }; fixture.view.status = (message, options) => { if (options?.code === 'project-open-refused') notices.push({ message, ...options }); };
    try { await fixture.studio.handlers.load(); const source = fixture.studio.getOperationalSnapshot().documentIdentity; await assert.rejects(select('doc:refused', { revision: 2 }), /checksum refused/); fixture.studio.handlers.cancelProjectPicker(); assert.equal(notices.length, 1); assert.match(notices[0].message, /checksum refused/); assert.equal(notices[0].target, source); assert.equal(notices[0].scope, 'operation'); assert.equal(notices[0].present, false); assert.match(notices[0].operationId, /^document-operation:/); assert.equal(JSON.parse(notices[0].detail).selectedRevision, 2); assert.equal(fixture.studio.getOperationState(), null); } finally { await retire(fixture); }
  });
  it('opens a verified recovery dirty and paused, then saves a recovered copy under a new document ID', async () => {
    let select, options, source, saved; const summary = createProcgenProjectSummary(snapshot(), { id: 'recovery:checkpoint', kind: 'recovery-checkpoint', recoveryGeneration: 2, checksum: 'complete', verification: 'checksum-verified' });
    const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async loadRecoveryOwned(value) { options = value; return { verification: 'checksum-verified-recovery', summary, session: source, release() {} }; }, async saveDocument(id, revision, session) { saved = { id, revision, session }; return { id, revision: 1 }; }, close() {} } }); fixture.studio.bindRuntime(); source = fixture.studio.capture('Recovered source'); fixture.view.showProjectPage = (_page, load) => { select = load; };
    try { await fixture.studio.handlers.load(); assert.equal(await select('recovery:checkpoint', summary), true); assert.equal(options.expectedGeneration, 2); assert.equal(options.expectedChecksum, 'complete'); assert.equal(fixture.studio.getDocumentState().dirty, true); assert.equal(fixture.studio.getDocumentState().id, null); assert.equal(fixture.studio.getDocumentStatus().recovered.recoveryGeneration, 2); assert.equal(fixture.studio.transport.getState().playing, false); assert.equal(await fixture.studio.handlers.saveRecoveredCopy(), true); assert.match(saved.id, /^doc:/); assert.notEqual(saved.id, 'doc:original'); assert.equal(saved.revision, 0); assert.equal(fixture.studio.getDocumentState().revision, 1); assert.equal(fixture.studio.getDocumentStatus().recovered, null); } finally { await retire(fixture); }
  });
});

describe('candidate status and partial metadata availability', () => {
  it('keeps named projects inspectable when recovery metadata is unavailable', async () => {
    let options; const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [{ id: 'doc:named', revision: 1 }], nextCursor: null }; }, async getRecoverySummary() { throw new Error('Recovery metadata unavailable'); }, close() {} } }); fixture.studio.bindRuntime(); fixture.view.showProjectPage = (_page, _load, _fetch, value) => { options = value; };
    try { assert.equal(await fixture.studio.handlers.load(), true); assert.deepEqual(options.recovery, { state: 'unavailable', message: 'Recovery metadata unavailable' }); assert.equal(fixture.studio.getOperationState().kind, 'select-session'); } finally { await retire(fixture); }
  });
  it('reports the current name, dirty and pending Save from canonical ownership', async () => {
    const write = deferred(); let entered = false; const fixture = setup({ storageOverride: { async saveDocument(id) { entered = true; await write.promise; return { id, revision: 1 }; }, close() {} } }); fixture.studio.bindRuntime();
    try { const before = fixture.viewProps.getDocumentStatus(); assert.equal(before.saving, false); assert.equal(before.dirty, true); const saving = fixture.studio.handlers.save(); while (!entered) await Promise.resolve(); assert.equal(fixture.viewProps.getDocumentStatus().saving, true); write.resolve(); assert.equal(await saving, true); assert.equal(fixture.viewProps.getDocumentStatus().name, 'Test song'); assert.equal(fixture.viewProps.getDocumentStatus().saving, false); assert.equal(fixture.viewProps.getDocumentStatus().dirty, false); } finally { write.resolve(); await retire(fixture); }
  });
  it('never accepts an unverified host recovery as a verified preview', async () => {
    let options; const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async loadRecoveryOwned() { return { verification: 'unverified-legacy', session: fixture.studio.capture(), release() {} }; }, close() {} } }); fixture.studio.bindRuntime(); fixture.view.showProjectPage = (_page, _load, _fetch, value) => { options = value; };
    try { await fixture.studio.handlers.load(); await assert.rejects(options.verifyRecovery(), /did not verify/); assert.equal(fixture.studio.getOperationState().kind, 'select-session'); } finally { await retire(fixture); }
  });
});

describe('candidate output and execution boundaries', () => {
  it('shows a recorded asset-set mismatch without claiming dependency preparation has succeeded', () => {
    const dom = new JSDOM('<body></body>'), document = dom.window.document;
    const selection = readProcgenProjectSummary({ id: 'doc:versioned', sessionVersion: 1, projectVersion: 2, assetDigest: 'saved-assets' });
    const preview = createProcgenProjectPreview({ document, readState: () => ({ selection, execution: { assetDigest: 'current-assets' } }), open() {}, verify() {}, compare() {} }); preview.render(); assert.match(preview.element.textContent, /saved asset set differs/); assert.match(preview.element.textContent, /checked during Open before replacement/); preview.dispose(); dom.window.close();
  });
  it('does not revive playback after a Save-before-Open request is canceled during its acknowledged write', async () => {
    const write = deferred(), entered = deferred(); let options, select;
    const fixture = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async saveDocument(id) { entered.resolve(); await write.promise; return { id, revision: 1 }; }, close() {} } }); fixture.studio.bindRuntime();
    fixture.view.showProjectPage = (_page, load, _fetch, value) => { select = load; options = value; }; fixture.view.requestReplacementReview = async ({ readReview }) => ({ action: 'save', identity: readReview().identity }); fixture.view.retireProjectPicker = () => {};
    try { assert.equal(fixture.studio.transport.getState().playing, true); await fixture.studio.handlers.load({ review: true }); const opening = select('doc:later', { revision: 1 }); await entered.promise; const operation = fixture.studio.getOperationalSnapshot().operations.find(value => value.kind === 'select-session'); fixture.studio.handlers.cancelOperation(operation.id); write.resolve(); assert.equal(await opening, false); assert.equal(fixture.studio.transport.getState().playing, false); assert.equal(fixture.studio.getDocumentState().dirty, false); assert.equal(fixture.studio.getDocumentState().revision, 1); assert.ok(options); } finally { write.resolve(); await retire(fixture); }
  });
});
