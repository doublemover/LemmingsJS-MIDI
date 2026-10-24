import { expect } from 'chai';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';
import { validateOwnedSourceBank } from '../../js/app/midi-ui/OwnedSourceBank.js';
import { prepareOwnedSourceBank } from '../../js/app/midi-ui/OwnedSourceBankPreparation.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';

// Authored for the final deferred runtime pass.
describe('fixed source bank worker handoff', () => {
  it('binds the actual Float32 bytes, including worker output and shapes', async () => {
    for (const id of ['choir-v1', 'spectrum-v1', 'grain-window-v1']) {
      const result = await runBackgroundJobKernel('prepare-owned-source-bank', { id }, { estimatedPeakBytes: 16 * 1048576 });
      expect(validateOwnedSourceBank(result.value, id)).to.equal(result.value);
      const changed = { ...result.value, hash: '0'.repeat(64) }; expect(() => validateOwnedSourceBank(changed, id)).to.throw();
    }
  });
  it('joins the consumer reservation and retains unknown worker retirement', async () => {
    const resources = createAudioResourceLeases(); let phase = 'computed';
    const loan = await prepareOwnedSourceBank('choir-v1', { resources, owner: 'source', jobs: { async compute() { return { value: fixedSourceBank('choir-v1'), release() { phase = 'released'; }, retirementState: () => ({ phase }) }; } } });
    const retirement = resources.retireOwner('source'); expect(retirement.outcome).to.equal('pending');
    loan.release(); await retirement.completion; expect(retirement.outcome).to.equal('complete');
    expect(() => loan.payload).to.throw();
    phase = 'computed';
    const bad = await prepareOwnedSourceBank('choir-v1', { resources, jobs: { async compute() { return { value: fixedSourceBank('choir-v1'), release() {}, retirementState: () => ({ phase }) }; } } });
    expect(() => bad.release()).to.throw('retirement'); expect(resources.diagnostics().unreconciledReservations).to.equal(1);
  });
});
