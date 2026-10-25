import { expect } from 'chai';
import { createResourceBudget, ResourceBudgetError } from '../js/app/resources/ResourceBudget.js';

describe('shared resource budget', () => {
  it('reserves replacement peaks before allocation and evicts only through an owner callback', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), canvas = {}, cold = {}, candidate = {};
    budget.reserve({ token: canvas, owner: 'renderer', kind: 'canvas', bytes: 1600, previousBytes: 0 });
    budget.reserve({ token: cold, owner: 'assets', kind: 'asset', bytes: 900, cache: true });
    expect(budget.diagnostics()).to.include({ residentBytes: 2500, accountedBytes: 3300,
      estimatedOverheadBytes: 800 });
    expect(() => budget.reserve({ token: candidate, owner: 'world', kind: 'candidate', bytes: 1000 }))
      .to.throw(ResourceBudgetError);
    expect(budget.diagnostics().residentBytes).to.equal(2500);
    budget.registerEvictor('assets', () => budget.release({ token: cold, owner: 'assets' }));
    budget.reserve({ token: candidate, owner: 'world', kind: 'candidate', bytes: 1000 });
    expect(budget.diagnostics()).to.include({ evictions: 1, denials: 1 });
    expect(budget.release({ token: cold, owner: 'assets' })).to.equal(false);
    expect(() => budget.reserve({ token: canvas, owner: 'renderer', kind: 'canvas', bytes: 2000,
      previousBytes: 1200 })).to.throw('Stale resource replacement');
    expect(budget.diagnostics().residentBytes).to.equal(2600);
  });

  it('transfers pinned ownership without duplicating bytes and retains release after retirement', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), bytes = {};
    budget.reserve({ token: bytes, owner: 'candidate', generation: 3, category: 'checkpoint', bytes: 2048 });
    budget.transfer({ token: bytes, owner: 'candidate', generation: 3, toOwner: 'active', toGeneration: 4 });
    expect(budget.release({ token: bytes, owner: 'candidate' })).to.equal(false);
    expect(budget.diagnostics().accountedBytes).to.equal(2048);
    expect(budget.retire().categories.checkpoint.pinned).to.equal(1);
    expect(() => budget.reserve({ token: {}, owner: 'new', bytes: 1 })).to.throw('retired');
    expect(budget.release({ token: bytes, owner: 'active' })).to.equal(true);
    expect(budget.diagnostics().accountedBytes).to.equal(0);
  });

  it('keeps failed native retirement visible as estimated pressure', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), canvas = {};
    budget.reserve({ token: canvas, owner: 'renderer', kind: 'canvas', bytes: 1024 });
    budget.reserve({ token: canvas, owner: 'renderer', kind: 'canvas', bytes: 1024,
      previousBytes: 1024, unreleased: true });
    expect(budget.diagnostics()).to.include({ accountedBytes: 1536, unreleasedEstimatedBytes: 1536 });
    expect(budget.diagnostics().categories.canvas.pinned).to.equal(1);
  });
});


describe('resource reservation eviction reentrancy', () => {
  for (const mutation of ['transfer', 'resize', 'retire']) it('rechecks ' + mutation + ' before replacement publication', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), token = {}, occupied = {};
    budget.reserve({ token, owner: 'a', bytes: 2000 }); budget.reserve({ token: occupied, owner: 'b', bytes: 2000 });
    budget.registerEvictor('racer', () => {
      if (mutation === 'transfer') budget.transfer({ token, owner: 'a', generation: 0, toOwner: 'other' });
      else if (mutation === 'resize') budget.reserve({ token, owner: 'a', bytes: 1000 }); else budget.retire();
      budget.release({ token: occupied, owner: 'b' });
    });
    expect(() => budget.reserve({ token, owner: 'a', bytes: 3000, previousBytes: 2000 })).to.throw();
    expect(budget.diagnostics().residentBytes).to.be.at.most(2000);
  });
});

describe('generation and revision resource leases', () => {
  for (const mutation of ['transfer-back', 'release-recreate', 'same-size-replace']) it(`refuses ${mutation} ABA during eviction`, () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), token = {}, cold = {};
    budget.reserve({ token, owner: 'active', bytes: 2000 }); budget.reserve({ token: cold, owner: 'cold', bytes: 2000 });
    budget.registerEvictor('racer', () => {
      if (mutation === 'transfer-back') {
        budget.transfer({ token, owner: 'active', generation: 0, toOwner: 'temporary' });
        budget.transfer({ token, owner: 'temporary', generation: 0, toOwner: 'active' });
      } else {
        if (mutation === 'release-recreate') budget.release({ token, owner: 'active' });
        budget.reserve({ token, owner: 'active', bytes: 2000 });
      }
      budget.release({ token: cold, owner: 'cold' });
    });
    expect(() => budget.reserve({ token, owner: 'active', bytes: 3000 })).to.throw('lease changed');
    expect(budget.diagnostics().residentBytes).to.equal(2000);
  });
  it('requires an explicit generation transfer and rejects stale revision release', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), token = {};
    const first = budget.reserve({ token, owner: 'active', generation: 7, bytes: 2000 });
    expect(() => budget.reserve({ token, owner: 'active', generation: 8, bytes: 2000 })).to.throw('generation');
    const second = budget.transfer({ ...first, toOwner: 'active', toGeneration: 8 });
    expect(budget.release({ ...second, revision: first.revision })).to.equal(false);
    expect(budget.release(second)).to.equal(true);
  });
  it('serves earlier eviction priorities first and rotates equal-priority owners', () => {
    let time = 0; const budget = createResourceBudget({ limitBytes: 4096, now: () => ++time }), calls = [], active = {}, a = {}, b = {};
    budget.reserve({ token: active, owner: 'active', bytes: 2000 });
    const fill = () => { budget.reserve({ token: a, owner: 'a', bytes: 900 }); budget.reserve({ token: b, owner: 'b', bytes: 900 }); };
    fill();
    budget.registerEvictor('expensive', () => calls.push('expensive'), { priority: 1 });
    budget.registerEvictor('a', () => { calls.push('a'); budget.release({ token: a, owner: 'a' }); });
    budget.registerEvictor('b', () => { calls.push('b'); budget.release({ token: b, owner: 'b' }); });
    budget.reserve({ token: active, owner: 'active', bytes: 2400 });
    budget.reserve({ token: active, owner: 'active', bytes: 2000 }); fill();
    budget.reserve({ token: active, owner: 'active', bytes: 2400 });
    expect(calls).to.deep.equal(['a', 'b']);
    expect(budget.diagnostics()).to.include({ queueWaitMs: 0, admissionPolicy: 'synchronous-reject-or-admit' });
    expect(budget.diagnostics().admissionDurationMs).to.be.greaterThan(0);
    expect(budget.diagnostics().categoryPeaks.other).to.equal(3800);
  });
  it('keeps hostile category names own data and telemetry clock failures nonauthoritative', () => {
    const budget = createResourceBudget({ limitBytes: 4096, now() { throw new Error('clock unavailable'); } });
    budget.reserve({ token: {}, owner: 'active', category: '__proto__', bytes: 400 });
    expect(budget.diagnostics().categories.__proto__.residentBytes).to.equal(400);
    expect(() => budget.reserve({ token: {}, owner: 'active', category: 'canvas', bytes: Number.MAX_SAFE_INTEGER })).to.throw('exact accounting');
  });
});

describe('bounded shared resource owner inspection', () => {
  it('reports actual generation groups without exposing tokens or silently dropping omitted cost', () => {
    const budget = createResourceBudget();
    for (let index = 0; index < 4; index++) budget.reserve({ token: {}, owner: 'owner-' + index, generation: index, bytes: 100, category: 'other' });
    const limited = budget.inspectOwners({ maximum: 2 }); expect(limited.status).to.equal('truncated'); expect(limited.owners).to.have.length(2); expect(limited.omittedEntries).to.equal(2); expect(limited.omittedAccountedBytes).to.equal(200);
    const complete = budget.inspectOwners(); expect(complete.status).to.equal('complete'); expect(complete.owners.reduce((sum, owner) => sum + owner.accountedBytes, 0)).to.equal(budget.diagnostics().accountedBytes); expect(complete.owners[0]).not.to.have.property('token');
  });
});
