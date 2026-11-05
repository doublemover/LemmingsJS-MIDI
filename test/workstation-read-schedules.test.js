import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { deferredRead, replayListingSchedule } from './support/workstation-read-schedules.js';

describe('project read publication and terminal ownership', function() {
  this.timeout(15000);
  for (const seed of [1, 17, 101, 997]) for (const failCurrent of [false, true]) for (const interruption of ['none', 'cancel', 'new', 'dispose']) it(`keeps only the current listing seed=${seed} failed=${failCurrent} interruption=${interruption}`, async () => {
    try { await replayListingSchedule({ seed, failCurrent, interruption }); }
    catch (error) { error.message += '\nReplay: ' + JSON.stringify(error.listingSchedule); throw error; }
  });
  it('retires an initially failed picker presentation and admits a later retry', async () => {
    const f = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, close() {} } }); f.studio.bindRuntime();
    try {
      f.view.showProjectPage = () => { throw new Error('Picker presentation failed'); };
      expect(await f.studio.handlers.load()).to.equal(false); expect(f.studio.getOperationState()).to.equal(null);
      expect(f.statuses.at(-1)).to.equal('Picker presentation failed'); f.view.showProjectPage = () => {};
      expect(await f.studio.handlers.load()).to.equal(true); expect(f.studio.getOperationState().kind).to.equal('select-session');
    } finally { await f.studio.dispose().completion; }
  });
  for (const failed of [false, true]) it(`retires canceled pagination without late errors failed=${failed}`, async () => {
    const gate = deferredRead(), f = setup({ storageOverride: { async listDocumentPage(options) { return options.cursor ? gate.promise : { items: [], nextCursor: 'next' }; }, close() {} } });
    f.studio.bindRuntime(); f.view.showProjectPage = (_page, _load, more) => { f.more = more; };
    try {
      await f.studio.handlers.load(); const reading = f.more('next', ''); f.studio.handlers.cancelProjectPicker();
      if (failed) gate.reject(new Error('Obsolete continuation failed')); else gate.resolve({ items: [], nextCursor: null });
      expect(await reading).to.equal(null); expect(f.studio.getOperationState()).to.equal(null);
    } finally { gate.resolve({ items: [] }); await f.studio.dispose().completion; }
  });
  it('keeps a current pagination failure retryable under the same picker owner', async () => {
    let fail = true;
    const f = setup({ storageOverride: { async listDocumentPage(options) { if (options.cursor && fail) throw new Error('Current continuation failed'); return { items: [], nextCursor: 'next' }; }, close() {} } });
    f.studio.bindRuntime(); f.view.showProjectPage = (_page, _load, more) => { f.more = more; };
    try {
      await f.studio.handlers.load(); let failure; try { await f.more('next', ''); } catch (error) { failure = error; }
      expect(failure?.message).to.equal('Current continuation failed'); expect(f.studio.getOperationState().kind).to.equal('select-session');
      fail = false; expect((await f.more('next', '')).items).to.deep.equal([]);
    } finally { await f.studio.dispose().completion; }
  });
  for (const failed of [false, true]) for (const cleanupFailure of failed ? [false] : [false, true]) it(`retires an obsolete selected source failed=${failed} cleanupFailure=${cleanupFailure}`, async () => {
    const gate = deferredRead(); let released = 0, chosen;
    const f = setup({ storageOverride: { async listDocumentPage() { return { items: [], nextCursor: null }; }, loadDocumentOwned: () => gate.promise, close() {} } });
    f.studio.bindRuntime(); f.view.showProjectPage = (_page, load) => { chosen = load; };
    try {
      await f.studio.handlers.load(); const reading = chosen('old'); f.studio.handlers.cancelProjectPicker();
      if (failed) gate.reject(new Error('Old selected source failed'));
      else gate.resolve({ get session() { throw new Error('Obsolete source must not be inspected'); }, release() { released++; if (cleanupFailure) throw new Error('Old source retirement unacknowledged'); } });
      if (cleanupFailure) { let failure; try { await reading; } catch (error) { failure = error; } expect(failure?.message).to.equal('Old source retirement unacknowledged'); }
      else expect(await reading).to.equal(false);
      expect(released).to.equal(Number(!failed));
    } finally { gate.resolve(null); await f.studio.dispose().completion; }
  });
  for (const failed of [false, true]) it(`does not inspect or report an obsolete import result failed=${failed}`, async () => {
    const gate = deferredRead(), entered = deferredRead(), jobs = createTestBackgroundJobs(); let first = true, released = 0;
    const f = setup({ backgroundJobs: { compute(options) { if (!first) return jobs.compute(options); first = false; entered.resolve(); return gate.promise; } } });
    f.studio.bindRuntime();
    try {
      const saved = f.studio.capture(); saved.project.procgen.lanes[0].patterns[0].steps[0].note = 81;
      const old = f.studio.handlers.import({ text: async () => '{}', size: 0 }); await entered.promise;
      expect(await f.studio.handlers.import({ text: async () => JSON.stringify(saved), size: 0 })).to.equal(true);
      const project = f.studio.getProject(), world = f.runtime.world, statuses = f.statuses.length;
      if (failed) gate.reject(new Error('Obsolete import failed'));
      else gate.resolve({ get value() { throw new Error('Obsolete result must not be read'); }, release() { released++; } });
      expect(await old).to.equal(false); expect(f.statuses).to.have.length(statuses); expect(released).to.equal(Number(!failed));
      expect(f.studio.getProject()).to.equal(project); expect(f.runtime.world).to.equal(world); expect(project.procgen.lanes[0].patterns[0].steps[0].note).to.equal(81);
      expect(f.studio.getOperationState()).to.equal(null);
    } finally { gate.resolve(null); await f.studio.dispose().completion; jobs.dispose(); }
  });
  it('reports a current import presentation failure after its authoritative world has committed', async () => {
    const jobs = createTestBackgroundJobs(), f = setup({ backgroundJobs: jobs }); f.studio.bindRuntime();
    try {
      const session = f.studio.capture(), previous = f.runtime; f.failCamera();
      expect(await f.studio.handlers.import({ size: 0, text: async () => JSON.stringify(session) })).to.equal(false);
      expect(f.runtime).not.to.equal(previous); expect(f.studio.transport.getState().playing).to.equal(false);
      expect(f.statuses.at(-1)).to.equal('Camera unavailable'); expect(f.studio.getOperationState()).to.equal(null);
    } finally { await f.studio.dispose().completion; jobs.dispose(); }
  });
});
