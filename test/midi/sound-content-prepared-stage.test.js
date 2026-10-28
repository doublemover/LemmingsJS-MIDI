import { expect } from 'chai';
import { soundFixture } from '../helpers/sound-content.js';
import { createSoundContentReader, borrowSoundContentStage } from '../../js/app/midi-ui/SoundContentReader.js';
import { createSoundContentArchiver } from '../../js/app/midi-ui/SoundContentArchive.js';
import { stagePreparedSoundContent } from '../../js/app/midi-ui/SoundContentPreparedStage.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

describe('canonical prepared definition staging', () => {
  it('roundtrips exact definitions through real archive and verified reader ownership, retaining no export artifact', async () => {
    const fixture = await soundFixture(), budget = createResourceBudget(), admission = createBackgroundWorkerAdmission();
    const jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} });
    const reader = createSoundContentReader({ resourceBudget: budget, jobs }), archiver = createSoundContentArchiver({ resourceBudget: budget, jobs }); let stage, preparing = true;
    try {
      stage = await stagePreparedSoundContent({ prepared: fixture.prepared, reader, archiver, engineDescriptors: [fixture.engine], isCurrent: () => preparing, stageIsCurrent: () => true });
      preparing = false;
      const loan = borrowSoundContentStage(stage); expect(loan.prepared.contentHash).to.equal(fixture.prepared.contentHash); expect(loan.prepared.pack).to.deep.equal(fixture.prepared.pack); loan.release();
      expect(stage.metadata().activeLeases).to.equal(0); stage.discard(); expect(budget.diagnostics().accountedBytes).to.equal(0);
    } finally { stage?.discard(); await archiver.dispose()?.completion; await reader.dispose()?.completion; await jobs.dispose(); admission.dispose(); }
  });
  it('rejects stale source before creating any export and reports unresolved archive retirement', async () => {
    let calls = 0; const prepared = { patches: [{ identity: 'x@1' }] };
    let error; try { await stagePreparedSoundContent({ prepared, isCurrent: () => false, archiver: { prepareExport() { calls++; } } }); } catch (caught) { error = caught; }
    expect(error.message).to.include('changed'); expect(calls).to.equal(0);
    const stage = { discarded: false, discard() { this.discarded = true; } };
    try { await stagePreparedSoundContent({ prepared, reader: { stageArchive: async () => stage }, archiver: { prepareExport: async () => ({ artifact: {
      borrow: () => ({ blob: new Blob(), release() {} }), discard() { throw new Error('Unknown native release'); }, digest: async () => {}
    } }) } }); } catch (caught) { error = caught; }
    expect(error.message).to.include('retirement'); expect(stage.discarded).to.equal(true); expect(error.retirement.outcome).to.equal('partial');
  });
});
