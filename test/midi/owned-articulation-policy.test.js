import { expect } from 'chai';
import { resolveOwnedArticulationPolicy } from '../../js/app/midi-ui/OwnedArticulationPolicy.js';
import { createLaneInstrumentPreparation } from '../../js/app/midi-ui/LaneInstrumentPreparation.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

describe('shared owned articulation and large lane preparation', () => {
  it('distinguishes the authored one-shot hold from the ownership release envelope', () => {
    expect(resolveOwnedArticulationPolicy({ parameters: { attackSeconds: 0.008, decaySeconds: 0.05, releaseSeconds: 0.2 } })).to.include({
      policy: 'owned-local-envelope-hold-v1', releaseSeconds: 0.2, oneShotTailSeconds: 0.058, semanticEndsRewritten: false });
    expect(resolveOwnedArticulationPolicy({ parameters: { attackSeconds: 2, decaySeconds: 4 } }).oneShotTailSeconds).to.equal(4);
    expect(() => resolveOwnedArticulationPolicy({ parameters: { releaseSeconds: NaN } })).to.throw('profile');
  });
  it('synchronizes 1024 unpinned lanes without allocating renderers and retires bookkeeping', async () => {
    const budget = createResourceBudget(), unassigned = [], owner = createLaneInstrumentPreparation({ resourceBudget: budget,
      session: { createInstrumentBackend() { throw new Error('No renderer should be created.'); } }, routed: { assign() {}, unassign: lane => unassigned.push(lane) } });
    const lanes = Array.from({ length: 1024 }, (_, index) => ({ id: 'lane-' + index, instrumentRef: null }));
    expect(await owner.synchronize(lanes)).to.deep.equal([]); expect(owner.diagnostics()).to.include({ maxLanes: 1024, pending: 0, queued: 0 });
    expect(owner.diagnostics().metadata.enabled).to.equal(true); await owner.synchronize(lanes.slice(0, 8));
    expect(unassigned).to.have.length.at.least(1016); await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
