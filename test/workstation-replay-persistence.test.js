import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

describe('workstation replay persistence ownership', () => {
  it('retains an unknown durable-write retirement acknowledged after disposal', async () => {
    const entered = deferred(), written = deferred();
    const f = setup({ windowTimers: { setTimeout() { return 1; }, clearTimeout() {} },
      storageOverride: { supportsRecoveryFactory: true, close() {}, saveRecovery() { entered.resolve(); return written.promise; } }
    });
    f.studio.bindRuntime(); const recovery = f.studio.recover(); await entered.promise;
    const disposal = f.studio.dispose();
    written.resolve({ durable: true, generation: 7, retirement: { status: 'unknown', failureCount: 1, failures: ['Native producer acknowledgment missing'] } });
    await recovery; await disposal.completion;
    expect(disposal.outcome).to.equal('partial');
    expect(disposal.resources.find(resource => resource.name === 'recovery-write').status).to.equal('failed');
    expect(f.studio.getRecoveryState().lastCommit).to.include({ generation: 7, canceledAfterCommit: true });
  });
  for (const first of ['preferences', 'recovery']) for (const fault of ['none', 'preferences', 'recovery', 'both']) {
    it(`waits for ${first} first and ${fault === 'none' ? 'replays after both copies retire' : 'refuses unknown ' + fault + ' retirement'}`, async () => {
      const masks = await loadProcgenMasks(), memory = createMemoryCausalStore(), timers = [];
      const budget = createResourceBudget({ limitBytes: 384 * 1048576 });
      const copies = Object.fromEntries(['preferences', 'recovery'].map(name => [name, { token: {}, entered: deferred(), retired: deferred(), calls: 0 }]));
      let admitted = 0;
      const save = (name, signal) => {
        const copy = copies[name];
        if (copy.calls++) return Promise.resolve({ durable: true, generation: 2 });
        budget.reserve({ token: copy.token, owner: name, category: 'candidate', bytes: (name === 'preferences' ? 32 : 128) * 1048576 });
        copy.entered.resolve();
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Canceled copy'), {
          backgroundRetirementCompletion: copy.retired.promise
        })), { once: true }));
      };
      const storage = { ...memory.storage, supportsRecoveryFactory: true, close() {},
        savePreferences(_value, { signal }) { return save('preferences', signal); },
        saveRecovery(_value, { signal }) { return save('recovery', signal); }
      };
      const f = setup({ storageOverride: storage, resourceBudget: budget, physicalOnly: true,
        worldFactory: () => new ProcgenLaneWorld({ masks, seed: 7, assists: false }),
        windowTimers: { setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout(id) { timers[id - 1] = null; } },
        prepareInspectionWorld() {
          admitted++;
          const token = {}, world = new ProcgenLaneWorld({ masks, seed: 7, assists: false });
          budget.reserve({ token, owner: 'test-inspection', category: 'candidate', bytes: 64 * 1048576 });
          return { world, dispose() { world.dispose(); budget.release({ token, owner: 'test-inspection' }); } };
        }
      });
      try {
        f.studio.bindRuntime(); f.studio.transport.pause();
        f.runtime.lanes.step = () => f.runtime.world.step();
        const takeId = (await f.studio.handlers.startCausalTake()).takeId;
        expect(f.physicalOwner.step()).to.equal(true); await f.studio.stopCausalTake();
        await f.studio.handlers.selectCausalTake(takeId);
        timers.find(timer => timer?.delay === 250).callback(); await copies.preferences.entered.promise;
        const recovery = f.studio.recover(); await copies.recovery.entered.promise;
        const comparison = f.studio.handlers.compareCausalTake();
        const observed = comparison.then(result => ({ result }), error => ({ error }));
        await turn();
        expect(admitted).to.equal(0); expect(f.studio.getPreferenceState().suspended).to.equal(true);
        expect(await f.studio.recover()).to.equal(false); expect(copies.recovery.calls).to.equal(1);
        const retire = name => {
          if (!(fault === name || fault === 'both')) budget.release({ token: copies[name].token, owner: name });
          copies[name].retired.resolve({ phase: fault === name || fault === 'both' ? 'retirement-unknown' : 'canceled' });
        };
        retire(first); await turn(); expect(admitted).to.equal(0);
        retire(first === 'preferences' ? 'recovery' : 'preferences');
        await recovery; const outcome = await observed;
        if (fault !== 'none') {
          expect(outcome.error).to.equal(undefined); expect(outcome.result).to.equal(false); expect(admitted).to.equal(0);
          if (fault === 'recovery' || fault === 'both') {
            expect(f.studio.getRecoveryState().error.name).to.equal('ResourceOwnershipError');
            expect(f.studio.getRecoveryState().retirement.status).to.equal('unknown');
          }
          expect(budget.inspectOwners().owners.some(owner => owner.owner === (fault === 'both' ? 'recovery' : fault))).to.equal(true);
          await f.studio.recover();
          expect(await f.studio.handlers.compareCausalTake()).to.equal(false); expect(admitted).to.equal(0);
        } else {
          expect(outcome.error).to.equal(undefined); expect(outcome.result.receipt.compatibilityMatch).to.equal(true);
          expect(admitted).to.equal(1); expect(budget.diagnostics().denials).to.equal(0);
          expect(budget.inspectOwners().owners.some(owner => ['preferences', 'recovery', 'test-inspection'].includes(owner.owner))).to.equal(false);
        }
        expect(f.studio.getPreferenceState().suspended).to.equal(false);
        expect(f.studio.transport.getState().playing).to.equal(false);
      } finally {
        for (const [name, copy] of Object.entries(copies)) { budget.release({ token: copy.token, owner: name }); copy.retired.resolve({ phase: 'canceled' }); }
        const disposal = await f.studio.dispose().completion;
        if (fault !== 'none') {
          expect(disposal.outcome).to.equal('partial');
          for (const name of ['preferences', 'recovery']) if (fault === name || fault === 'both') {
            expect(disposal.resources.find(resource => resource.name === (name === 'preferences' ? 'preference-writer' : 'recovery-write')).status).to.equal('failed');
          }
        } else expect(disposal.outcome).to.equal('complete');
        f.runtime.world.dispose();
      }
    });
  }
});
