import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';
import { deferredRead } from './support/workstation-read-schedules.js';
import { createProcgenOperationReceipt } from '../js/app/procgen/workstation/ProcgenOperationView.js';
import { createProcgenNotices } from '../js/app/procgen/workstation/ProcgenNotices.js';

const source = () => ({ documentIdentity: 'document-one', documentId: null, projectRevision: 1, editRevision: 2, worldId: 'world-one', generation: 1, tick: 8, storedRevision: 0 });
const fixture = options => { const f = setup(options), receipts = []; f.studio.bindRuntime(); f.view.operationReceipt = value => receipts.push(value); return { f, receipts }; };
const until = async predicate => { while (!predicate()) await new Promise(resolve => setImmediate(resolve)); };

describe('immutable finished-operation provenance', () => {
  it('rejects empty, non-finite and falsely accepted unknown boundaries and copies only bounded plain fields', () => {
    const input = source(); input.unused = new Uint8Array(1048576); input.callback = () => {};
    const receipt = createProcgenOperationReceipt({ id: 'one', kind: 'save', outcome: 'unknown', source: input, captured: input }); input.tick = 99;
    expect(receipt.source.tick).to.equal(8); expect(Object.isFrozen(receipt.source)).to.equal(true); expect(receipt.source).not.to.have.property('unused'); expect(receipt.source).not.to.have.property('callback'); expect(receipt.accepted).to.equal(null);
    for (const invalid of [{}, { ...source(), generation: Infinity }, { ...source(), editRevision: -0.5 }]) expect(() => createProcgenOperationReceipt({ id: 'x', kind: 'load', outcome: 'retired', source: invalid })).to.throw();
    expect(() => createProcgenOperationReceipt({ id: 'x', kind: 'save', outcome: 'unknown', source: source(), accepted: source() })).to.throw();
    expect(() => createProcgenOperationReceipt({ id: 'x', kind: 'load', outcome: 'committed', source: source() })).to.throw();
  });
  it('keeps historical operation records out of the current headline without truncating source identities', () => {
    const owner = createProcgenNotices(), boundary = { ...source(), worldId: '\u0001'.repeat(512) };
    owner.publish({ message: 'Current fault', severity: 'error' }); const receipt = createProcgenOperationReceipt({ id: 'prior', kind: 'save', outcome: 'committed', source: boundary, accepted: boundary });
    owner.publish({ scope: 'operation', operationId: receipt.id, message: 'Earlier save committed', present: false, receipt });
    expect(owner.snapshot().headline.message).to.equal('Current fault'); const entry = owner.snapshot().entries[1]; expect(entry.active).to.equal(false); expect(entry.receipt.accepted.worldId).to.equal(boundary.worldId); expect(JSON.parse(JSON.stringify(entry.receipt))).to.deep.equal(receipt);
  });
  it('records explicit picker cancellation once after late listing settlement', async () => {
    const read = deferredRead(), { f, receipts } = fixture({ storageOverride: { listDocumentPage: () => read.promise, close() {} } }); const listing = f.studio.handlers.load();
    try { f.studio.handlers.cancelProjectPicker(); f.studio.handlers.cancelProjectPicker(); read.resolve({ items: [], nextCursor: null }); expect(await listing).to.equal(false); expect(receipts).to.have.length(1); expect(receipts[0]).to.include({ outcome: 'canceled', kind: 'select-session', accepted: null, resourceRetirement: 'reported-separately' }); }
    finally { read.resolve({ items: [] }); await listing; await f.studio.dispose().completion; }
  });
  it('records initial listing failure independently of operation retirement and retry', async () => {
    const { f, receipts } = fixture({ storageOverride: { async listDocumentPage() { throw new Error('List refused'); }, close() {} } });
    try { expect(await f.studio.handlers.load()).to.equal(false); expect(f.studio.getOperationState()).to.equal(null); expect(receipts).to.have.length(1); expect(receipts[0]).to.include({ outcome: 'failed', errorCode: 'Error', accepted: null }); }
    finally { await f.studio.dispose().completion; }
  });
  it('retires a malformed direct load, cancels its input lease and supersedes an older listing', async () => {
    const read = deferredRead(), { f, receipts } = fixture({ storageOverride: { listDocumentPage: () => read.promise, close() {} } }); const old = f.studio.handlers.load(), world = f.runtime.world; f.studio.handlers.learn();
    try {
      let failure; try { await f.studio.loadSession({ invalid: true }); } catch (error) { failure = error; }
      expect(failure).to.be.instanceOf(Error); expect(f.studio.getInputEditLease()).to.equal(null); expect(f.studio.getOperationState()).to.equal(null); expect(f.runtime.world).to.equal(world); expect(f.restarts).to.have.length(0);
      read.resolve({ items: [], nextCursor: null }); expect(await old).to.equal(false);
      expect(receipts.map(value => [value.kind, value.outcome])).to.deep.equal([['load', 'failed'], ['select-session', 'canceled']]); expect(new Set(receipts.map(value => value.id)).size).to.equal(2);
    } finally { read.resolve({ items: [] }); await old; await f.studio.dispose().completion; }
  });
  it('records actual rebuild acceptance and preserves immutable original revision metadata', async () => {
    const { f, receipts } = fixture();
    try { const before = f.studio.getOperationalSnapshot().documentIdentity; expect(await f.studio.handlers.new()).to.equal(true); expect(receipts).to.have.length(1); expect(receipts[0]).to.include({ outcome: 'committed', kind: 'rebuild' }); expect(receipts[0].source.documentIdentity).to.equal(before); expect(receipts[0].accepted.documentIdentity).to.equal(f.studio.getOperationalSnapshot().documentIdentity); expect(Object.isFrozen(f.restarts[0].lease.source)).to.equal(true); }
    finally { await f.studio.dispose().completion; }
  });
  it('records a named load only after the admitted document identity and stored revision are bound', async () => {
    let session, chosen; const { f, receipts } = fixture({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, async loadDocumentOwned() { return { session, id: 'doc:chosen', revision: 7, release() {} }; }, close() {} } }); session = f.studio.capture(); f.view.showProjectPage = (_page, load) => { chosen = load; };
    try { await f.studio.handlers.load(); expect(await chosen('doc:chosen')).to.equal(true); expect(receipts).to.have.length(1); expect(receipts[0]).to.include({ outcome: 'committed', kind: 'select-session' }); expect(receipts[0].accepted).to.include({ documentId: 'doc:chosen', storedRevision: 7 }); }
    finally { await f.studio.dispose().completion; }
  });
  for (const failed of [false, true]) it(`keeps the old Save's actual captured revision and outcome after New failed=${failed}`, async () => {
    const write = deferredRead(); let entered = false;
    const { f, receipts } = fixture({ storageOverride: { saveDocument() { entered = true; return write.promise; }, close() {} } });
    const saving = f.studio.handlers.save();
    try {
      await until(() => entered); const captured = f.studio.getDocumentState().editRevision; expect(await f.studio.handlers.new()).to.equal(true); const current = f.studio.getOperationalSnapshot().documentIdentity, statusCount = f.statuses.length;
      if (failed) write.reject(new Error('Write acknowledgment unavailable')); else write.resolve({ id: 'doc:old-write', revision: 9 });
      expect(await saving).to.equal(!failed); expect(f.statuses).to.have.length(statusCount); const receipt = receipts.find(value => value.kind === 'save');
      expect(receipt.outcome).to.equal(failed ? 'unknown' : 'committed'); expect(receipt.captured.editRevision).to.equal(captured); expect(receipt.source.documentIdentity).not.to.equal(current); expect(receipt.accepted).to.satisfy(value => failed ? value === null : value.storedRevision === 9 && value.editRevision === captured); expect(f.studio.getOperationalSnapshot().documentIdentity).to.equal(current);
    } finally { write.resolve({ id: 'cleanup', revision: 1 }); await saving; await f.studio.dispose().completion; }
  });
  it('retains the captured revision when later edits remain unsaved after storage acknowledgment', async () => {
    const write = deferredRead(); let entered = false; const { f, receipts } = fixture({ storageOverride: { saveDocument() { entered = true; return write.promise; }, close() {} } }); const saving = f.studio.handlers.save();
    try { await until(() => entered); const captured = f.studio.getDocumentState().editRevision; f.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: .5 } }); write.resolve({ id: 'doc:saved', revision: 3 }); expect(await saving).to.equal(true); expect(f.studio.getDocumentState().dirty).to.equal(true); expect(receipts[0].accepted).to.include({ editRevision: captured, storedRevision: 3 }); expect(receipts[0].accepted.editRevision).not.to.equal(f.studio.getDocumentState().editRevision); }
    finally { write.resolve({ id: 'cleanup', revision: 1 }); await saving; await f.studio.dispose().completion; }
  });
  it('does not present a late terminal receipt after disposal', async () => {
    const write = deferredRead(); let entered = false; const { f, receipts } = fixture({ storageOverride: { saveDocument() { entered = true; return write.promise; }, close() {} } }); const saving = f.studio.handlers.save(); await until(() => entered); const disposed = f.studio.dispose(); write.resolve({ id: 'doc:old', revision: 1 }); expect(await saving).to.equal(false); await disposed.completion; expect(receipts).to.have.length(0);
  });
});
