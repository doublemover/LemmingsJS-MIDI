import { ownedSourceBankIds } from './OwnedSourceBankDependencies.js';
export { ownedSourceBankIds } from './OwnedSourceBankDependencies.js';
import { getOwnedSourceBankIdentity } from './OwnedSourceBank.js';
import { prepareOwnedSourceBank } from './OwnedSourceBankPreparation.js';
import { requireSynchronousResourceAcknowledgement } from '../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export async function prepareOwnedSourceBanks(profile, parameters, { prepareBank = prepareOwnedSourceBank, ...options } = {}) {
  const ids = ownedSourceBankIds(profile, parameters); if (!ids.length) return null;
  const scope = createProcgenRetirementScope(), loans = []; let metadata = null, upstreamFault = null;
  const check = () => { options.signal?.throwIfAborted(); if (options.isCurrent && !options.isCurrent()) throw new Error('Fixed source bank set changed during preparation.'); };
  const release = () => {
    if (scope.getReceipt()) return scope.getReceipt();
    const released = loans.map(loan => Promise.resolve().then(() => { const receipt = loan.release(); requireSynchronousResourceAcknowledgement(receipt, 'Fixed source bank reader release'); if (receipt?.outcome && receipt.outcome !== 'complete') throw new Error('Fixed source bank reader retirement is unresolved.'); }));
    const stopped = Promise.all(released);
    return scope.retire([...released.map((work, index) => ({ name: 'fixed-source-bank-' + ids[index], run: () => work })), { name: 'source-bank-set-metadata', run: async () => { await stopped; if (upstreamFault) throw upstreamFault; if (metadata) requireSynchronousResourceAcknowledgement(metadata.release(), 'Fixed bank set metadata release'); } }]);
  };
  try {
    check(); metadata = options.resources?.reserve({ kind: 'fixed-source-bank-set-metadata', owner: options.owner, generation: options.generation ?? 0, bytes: 16384, consumerOwned: true });
    for (const id of ids) { loans.push(await prepareBank(id, options)); check(); }
    const identities = Object.freeze(ids.map(id => Object.freeze({ id, ...getOwnedSourceBankIdentity(id) })));
    const current = () => { if (scope.getReceipt()) throw new Error('Fixed source bank set retired.'); check(); };
    return Object.freeze({ identities, get payload() { current(); return loans[0].payload; }, get auxiliary() { current(); return Object.freeze(Object.fromEntries(ids.slice(1).map((id, index) => [id, loans[index + 1].payload]))); }, release });
  } catch (error) {
    if (error.retirement && error.retirement.outcome !== 'complete' || error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) upstreamFault = error;
    const receipt = release(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error;
  }
}
