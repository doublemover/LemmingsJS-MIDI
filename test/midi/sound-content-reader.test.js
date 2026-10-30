import { expect } from 'chai';
import { soundFixture } from '../helpers/sound-content.js';
import { createSoundContentReader, borrowSoundContentStage } from '../../js/app/midi-ui/SoundContentReader.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const rejects = async (promise, code) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.code).to.equal(code); return error; };
describe('owned sound archive import stages', () => {
  let fixture;
  before(async () => { fixture = await soundFixture(); });
  const setup = extra => {
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} });
    const reader = createSoundContentReader({ resourceBudget: budget, jobs, ...extra });
    return { budget, reader, dispose() { reader.dispose(); jobs.dispose(); admission.dispose(); } };
  };
  it('verifies immutable data, keeps foreign rights untrusted and holds storage while a consumer retires', async () => {
    const owner = setup(), stage = await owner.reader.stageArchive(fixture.archive(), { engineDescriptors: [fixture.engine] }), lease = borrowSoundContentStage(stage);
    expect(stage.metadata()).to.include({ contentHash: fixture.prepared.contentHash, importedReview: 'untrusted-references-only', qualification: 'verified-material-not-render-qualified' });
    expect(lease.prepared.patches[0].state).to.equal('definition-admitted'); expect(lease.assetBlob(fixture.sha256)).to.be.instanceOf(Blob);
    stage.discard(); expect(owner.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    expect(() => lease.prepared).to.throw('discarded'); expect(() => borrowSoundContentStage({ ...stage })).to.throw('owned verified');
    lease.release(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); owner.dispose();
  });
  it('retains recipe-only missing material and unavailable engines as inspectable requirements', async () => {
    const owner = setup(), stage = await owner.reader.stageArchive(fixture.archive({ mode: 'reference-only' })), lease = stage.borrow();
    expect(stage.metadata().missingAssetBytes).to.deep.equal([fixture.sha256]); expect(stage.metadata().unavailableEngines).to.have.length(1);
    expect(lease.assetBlob(fixture.sha256)).to.equal(null); lease.release(); stage.discard(); owner.dispose();
  });
  it('separates a completed preparation fence from the retained stage and its leased data', async () => {
    const owner = setup(); let preparing = true, alive = true;
    try {
      const stage = await owner.reader.stageArchive(fixture.archive(), { engineDescriptors: [fixture.engine], isCurrent: () => preparing, stageIsCurrent: () => alive });
      preparing = false; const lease = stage.borrow(); expect(lease.prepared.contentHash).to.equal(fixture.prepared.contentHash); expect(lease.assetBlob(fixture.sha256)).to.be.instanceOf(Blob);
      alive = false; expect(() => stage.borrow()).to.throw('stage ownership changed'); expect(() => lease.prepared).to.throw('stage ownership changed');
      stage.discard(); expect(owner.budget.diagnostics().accountedBytes).to.be.greaterThan(0); lease.release(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
    } finally { owner.dispose(); }
  });
  it('still refuses stale preparation during verification when a separate stage owner remains alive', async () => {
    const owner = setup(); let preparing = true;
    try {
      await rejects(owner.reader.stageArchive(fixture.archive(), { engineDescriptors: [fixture.engine], isCurrent: () => preparing, stageIsCurrent: () => true, onProgress: () => { preparing = false; } }), 'stale-owner');
      expect(owner.reader.diagnostics().pending).to.equal(0); expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
      await rejects(owner.reader.stageArchive(fixture.archive(), { stageIsCurrent: false }), 'invalid-archive');
    } finally { owner.dispose(); }
  });
  it('rejects changed manifests, payload corruption, noncanonical headers and extra bytes before staging', async () => {
    const owner = setup();
    for (const archive of [fixture.archive({ extra: [new Uint8Array([1])] }), fixture.archive({ payload: new Uint8Array(3) }),
      fixture.archive({ transformHeader: header => ({ ...header, payloads: [] }) }), fixture.archive({ headerText: '{"format":"x","format":"y"}' })])
      await rejects(owner.reader.stageArchive(archive), 'invalid-archive');
    await rejects(owner.reader.stageArchive(fixture.archive({ payload: new Uint8Array(4) })), 'content-mismatch');
    await rejects(owner.reader.stageArchive(fixture.archive({ transformHeader: header => ({ ...header, pack: { ...header.pack, name: 'Changed' } }) })), 'content-mismatch');
    expect(owner.reader.diagnostics().pending).to.equal(0); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); owner.dispose();
  });
  it('holds a canceled native read until actual settlement and blocks new import admission meanwhile', async () => {
    const owner = setup({ timeoutMs: 20, maxPending: 1 }); let finish, started;
    const opened = new Promise(resolve => { started = resolve; });
    class SlowBlob extends Blob { slice() { return { arrayBuffer() { started(); return new Promise(resolve => { finish = resolve; }); } }; } }
    const pending = owner.reader.stageArchive(new SlowBlob([new Uint8Array(20)])); await opened; await rejects(pending, 'deadline');
    expect(owner.reader.diagnostics().unknownRetirement).to.equal(1); await rejects(owner.reader.stageArchive(fixture.archive()), 'archive-capacity');
    finish(new ArrayBuffer(12)); await new Promise(resolve => setTimeout(resolve, 0));
    expect(owner.budget.diagnostics().accountedBytes).to.equal(0); expect(owner.reader.diagnostics().pending).to.equal(0); owner.dispose();
  });
});
