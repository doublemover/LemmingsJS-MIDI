import { getOwnedSourceBankIdentity } from './OwnedSourceBank.js';

export function ownedSourceBankIds(profile, parameters = {}) {
  const extra = profile.auxiliaryBankIds?.(parameters) ?? [];
  if (!Array.isArray(extra) || extra.length > 1 || extra.some(id => typeof id !== 'string')) throw new TypeError('A source supports at most one explicit auxiliary fixed bank.');
  const ids = [...(profile.bankId ? [profile.bankId] : []), ...extra];
  if (new Set(ids).size !== ids.length || ids.length > 2 || extra.length && !profile.bankId) throw new TypeError('Source bank dependencies require distinct primary and auxiliary identities.');
  for (const id of ids) getOwnedSourceBankIdentity(id);
  return Object.freeze(ids);
}
