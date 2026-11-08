import { expect } from 'chai';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createSceneCatalogStorage } from '../js/app/procgen/workstation/SceneCatalogStorage.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

describe('scene catalog auxiliary ownership (functional campaign deferred)', () => {
  it('charges retained buffers before publication and preserves the old entry on refusal', async () => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), storage = createSceneCatalogStorage({ resourceBudget: budget }), map = storage.makeMap();
    storage.finishConstruction(); const original = Object.freeze({ id: 'first' }); map.set('score', original);
    const before = budget.diagnostics().accountedBytes, blocker = {};
    budget.reserve({ token: blocker, owner: 'other-active-state', category: 'checkpoint', bytes: 64 * 1048576 - before - 8192, pinned: true });
    expect(() => map.set('score', { bytes: new Uint8Array(16384) })).to.throw('accounted bytes');
    expect(map.get('score')).to.equal(original); expect(map.size).to.equal(1);
    budget.release({ token: blocker, owner: 'other-active-state' }); expect(budget.diagnostics().accountedBytes).to.equal(before);
    await storage.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('prepays a publication once and releases unused credits without dropping retained storage', async () => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), storage = createSceneCatalogStorage({ resourceBudget: budget }), map = storage.makeMap(); storage.finishConstruction();
    const value = Object.freeze({ recipe: 'exact-source', bytes: new Uint8Array(4096) }), funding = storage.prepay([[map, 'one', value], [map, 'unused', value]]);
    const prepaid = budget.diagnostics().accountedBytes; map.set('one', value); expect(budget.diagnostics().accountedBytes).to.equal(prepaid);
    funding.release(); expect(storage.diagnostics().prepaidBytes).to.equal(0); expect(budget.diagnostics().accountedBytes).to.be.lessThan(prepaid);
    expect(map.get('one')).to.equal(value); map.delete('one'); expect(storage.diagnostics().residentBytes).to.equal(4096);
    await storage.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('joins factory workspace before disposal completes and refuses its late publication', async () => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), storage = createSceneCatalogStorage({ resourceBudget: budget }), map = storage.makeMap(), entered = deferred(), finish = deferred(); storage.finishConstruction();
    const build = storage.trackFactory(async workspace => { workspace.resize(16 * 1048576); entered.resolve(); await finish.promise; map.set('late', { id: 'late' }); });
    const operation = build(); await entered.promise; let retired = false; const completion = storage.dispose().then(() => { retired = true; });
    expect(storage.diagnostics().pendingFactories).to.equal(1); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(16 * 1048576); expect(retired).to.equal(false);
    const outcome = Promise.allSettled([operation]); finish.resolve(); expect((await outcome)[0].status).to.equal('rejected'); await completion;
    expect(storage.diagnostics().pendingFactories).to.equal(0); expect(map.size).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
    expect(storage.dispose()).to.equal(storage.dispose());
  });
  it('retains conservative ownership when a factory workspace has unknown retirement', async () => {
    const actual = createResourceBudget({ limitBytes: 64 * 1048576 }); let refuse = false;
    const storage = createSceneCatalogStorage({ resourceBudget: { reserve: actual.reserve, release: request => refuse ? false : actual.release(request) } }); storage.finishConstruction(); refuse = true;
    const operation = storage.trackFactory(async () => 'prepared'), outcome = await Promise.allSettled([operation()]); expect(outcome[0].status).to.equal('rejected');
    expect(storage.diagnostics().unknownWorkspaces).to.equal(1); const remaining = actual.diagnostics().accountedBytes;
    expect(remaining).to.be.greaterThan(1048576); expect((await Promise.allSettled([storage.dispose()]))[0].status).to.equal('rejected'); expect(actual.diagnostics().accountedBytes).to.equal(remaining);
  });
});
