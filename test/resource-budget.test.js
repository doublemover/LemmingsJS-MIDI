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
