import { prepareOwnedSourceBank } from '../../js/app/midi-ui/OwnedSourceBankPreparation.js';
import { expect } from 'chai';
import { prepareOwnedSourceBanks, ownedSourceBankIds } from '../../js/app/midi-ui/OwnedSourceBanks.js';
import { getOwnedSourceBankIdentity } from '../../js/app/midi-ui/OwnedSourceBank.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

const profile = { bankId: 'sample-read-v1', auxiliaryBankIds: parameters => parameters.layers ? ['grain-window-v1'] : [] }, deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }, refuse = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); };
const fixture = () => {
  const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), starts = [], releases = [], switches = { hold: null, failPrepare: null, failRelease: null };
  // These identity-shaped zero tables are ownership doubles only. They are not
  // materialized source tables or evidence for their numerical/hash contents.
  const prepareBank = async id => {
    starts.push(id); if (switches.failPrepare === id) throw new Error('Synthetic bank preparation failure.'); const identity = getOwnedSourceBankIdentity(id), lease = resources.reserve({ kind: 'synthetic-source-bank', bytes: identity.bytes, consumerOwned: true }); let payload = { id, hash: identity.hash };
    if (switches.hold && id === 'grain-window-v1') { switches.hold.entered.resolve(); await switches.hold.release.promise; }
    return { get payload() { if (!payload) throw new Error('Synthetic bank retired.'); return payload; }, release() { releases.push(id); if (switches.failRelease === id) throw new Error('Synthetic unknown bank reader.'); lease.release(); payload = null; return true; } };
  };
  return { budget, resources, starts, releases, switches, options: { resources, prepareBank } };
};
describe('complete fixed source bank sets (mechanical ownership fixtures)', () => {
  it('resolves distinct complete bank dependencies before any producer starts', () => {
    expect(ownedSourceBankIds(profile, {})).to.deep.equal(['sample-read-v1']); expect(ownedSourceBankIds(profile, { layers: true })).to.deep.equal(['sample-read-v1', 'grain-window-v1']);
    for (const auxiliaryBankIds of [() => ['sample-read-v1'], () => ['unknown-bank'], () => ['grain-window-v1', 'choir-v1'], () => 'grain-window-v1']) expect(() => ownedSourceBankIds({ ...profile, auxiliaryBankIds }, {})).to.throw();
  });
  it('owns both prepared tables until acknowledged set retirement without changing the primary-bank payload', async () => {
    const f = fixture(), bank = await prepareOwnedSourceBanks(profile, { layers: true }, f.options);
    expect(f.starts).to.deep.equal(['sample-read-v1', 'grain-window-v1']); expect(bank.payload.id).to.equal('sample-read-v1'); expect(bank.auxiliary['grain-window-v1'].hash).to.equal(getOwnedSourceBankIdentity('grain-window-v1').hash); expect(bank.identities.map(value => value.id)).to.deep.equal(f.starts);
    expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(bank.identities.reduce((sum, value) => sum + value.bytes, 0)); const receipt = bank.release(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.releases).to.deep.equal(f.starts); expect(() => bank.payload).to.throw('retired'); expect(bank.release()).to.equal(receipt); await f.resources.dispose().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains canceled preparation until the last accepted table producer settles, then releases both banks', async () => {
    const f = fixture(), gate = { entered: deferred(), release: deferred() }, controller = new AbortController(); f.switches.hold = gate;
    const pending = refuse(prepareOwnedSourceBanks(profile, { layers: true }, { ...f.options, signal: controller.signal })); await gate.entered.promise; controller.abort(new Error('Cancel source bank set.')); expect(f.releases).to.have.length(0); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); gate.release.resolve(); await pending; expect(f.releases).to.deep.equal(['sample-read-v1', 'grain-window-v1']); await f.resources.dispose().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('releases earlier prepared inputs when a later dependency fails before acquiring storage', async () => {
    const f = fixture(); f.switches.failPrepare = 'grain-window-v1'; await refuse(prepareOwnedSourceBanks(profile, { layers: true }, f.options)); expect(f.releases).to.deep.equal(['sample-read-v1']); await f.resources.dispose().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('attempts independent bank releases, preserves unknown ownership and never retries its release blindly', async () => {
    const f = fixture(), bank = await prepareOwnedSourceBanks(profile, { layers: true }, f.options); f.switches.failRelease = 'sample-read-v1'; const receipt = bank.release(); await receipt.completion; expect(receipt.outcome).not.to.equal('complete'); expect(f.releases).to.deep.equal(['sample-read-v1', 'grain-window-v1']); expect(bank.release()).to.equal(receipt); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
  it('preserves a frozen upstream failure and supplies an actual unresolved retirement receipt', async () => {
    const f = fixture(), cause = Object.freeze(Object.assign(new Error('Frozen failed producer.'), { backgroundRetirementCompletion: Promise.resolve(Object.freeze({ phase: 'failed-or-unknown' })) }));
    const error = await refuse(prepareOwnedSourceBank('grain-window-v1', { resources: f.resources, jobs: { compute: async () => { throw cause; } } }));
    expect(error).not.to.equal(cause); expect(error.cause).to.equal(cause); expect(error.retirement.outcome).not.to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
  it('refuses a false individual result acknowledgment and never issues the uncertain release twice', async () => {
    const f = fixture(), identity = getOwnedSourceBankIdentity('grain-window-v1'); let attempts = 0;
    const loan = await prepareOwnedSourceBank('grain-window-v1', { resources: f.resources, jobs: { compute: async () => ({ value: { schema: 'lemmings-owned-source-bank/v1', id: 'grain-window-v1', ...identity, planes: [new Float32Array(identity.lengths[0])] }, release() { attempts++; return false; }, retirementState: () => ({ phase: 'failed-or-unknown' }) }) } });
    let error; try { loan.release(); } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); await error.retirement.completion; expect(error.retirement.outcome).not.to.equal('complete'); expect(() => loan.release()).to.throw(); expect(attempts).to.equal(1); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
  it('propagates an upstream unknown producer while still retiring already prepared sibling readers', async () => {
    const f = fixture(), prepareBank = async (id, options) => {
      if (id !== 'grain-window-v1') return f.options.prepareBank(id, options);
      const lease = f.resources.reserve({ kind: 'synthetic-unknown-bank-producer', bytes: 8196, consumerOwned: true }), scope = createProcgenRetirementScope(), receipt = scope.retire([{ name: 'synthetic-producer', run: () => { lease.retainUnknown(new Error('Unknown producer.')); throw new Error('Unknown producer.'); } }]); await receipt.completion;
      throw Object.assign(new Error('Synthetic upstream retirement failure.'), { retirement: receipt });
    };
    const error = await refuse(prepareOwnedSourceBanks(profile, { layers: true }, { ...f.options, prepareBank })); expect(error.retirement.outcome).not.to.equal('complete'); expect(f.releases).to.deep.equal(['sample-read-v1']); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
});
