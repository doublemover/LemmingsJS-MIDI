import { expect } from 'chai';
import { registerPhysicalGraphAdmission, preparePhysicalGraphAdmission } from '../js/app/procgen/PhysicalGraphAdmission.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createCausalObserverResources } from '../js/app/procgen/workstation/CausalObserverResources.js';

describe('physical graph resource publication preconditions', () => {
  it('cancels earlier resource owners if a later owner refuses preparation', () => {
    const world = { generation: 1 }, calls = [];
    registerPhysicalGraphAdmission(world, () => ({ commit: () => calls.push('commit'), cancel: () => calls.push('cancel') }));
    registerPhysicalGraphAdmission(world, () => { throw new Error('capacity'); });
    expect(() => preparePhysicalGraphAdmission(world, {})).to.throw('capacity'); expect(calls).to.deep.equal(['cancel']);
  });
  for (const mutation of ['unregister', 'generation', 'dispose', 'new-owner']) it(`rejects stale ${mutation} before publication`, () => {
    const world = { generation: 1 }, calls = [], unregister = registerPhysicalGraphAdmission(world, () => ({ commit: () => calls.push('commit'), cancel: () => calls.push('cancel') }));
    const proposal = preparePhysicalGraphAdmission(world, {});
    if (mutation === 'unregister') unregister(); if (mutation === 'generation') world.generation++;
    if (mutation === 'dispose') world._disposed = true; if (mutation === 'new-owner') registerPhysicalGraphAdmission(world, () => ({ commit() {}, cancel() {} }));
    expect(() => proposal.commit()).to.throw('changed'); expect(calls).to.deep.equal(['cancel']);
  });
  it('cancels only uncommitted growth while retaining concurrent accepted high water', () => {
    const budget = createResourceBudget({ limitBytes: 512 * 1048576 }), owner = createCausalObserverResources({ resourceBudget: budget });
    const before = budget.diagnostics().accountedBytes;
    const motif = owner.prepareGraph({ motifs: [{}] }), cargo = owner.prepareGraph({ cargoStations: [{}] });
    const both = budget.diagnostics().accountedBytes; cargo.commit(); motif.cancel();
    expect(budget.diagnostics().accountedBytes).to.be.lessThan(both).and.greaterThan(before);
    expect(owner.diagnostics().features.motifs).to.equal(0); expect(owner.diagnostics().features.cargo).to.be.greaterThan(0);
    expect(owner.diagnostics().pendingGraphProposals).to.equal(0); expect(cargo.cancel()).to.equal(false);
    owner.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('limits outstanding proposals without losing already-owned reservations', () => {
    const owner = createCausalObserverResources(), pending = Array.from({ length: 16 }, () => owner.prepareGraph({}));
    expect(() => owner.prepareGraph({})).to.throw('capacity'); for (const proposal of pending) proposal.cancel(); owner.dispose();
  });
});
