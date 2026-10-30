import { journalError } from './CausalJournalCanonical.js';

const legacyLease = value => {
  let released = false;
  return Object.freeze({ get value() { if (released) throw journalError('source-retired', 'Causal read lease has retired.'); return value; },
    release() { if (released) return false; released = true; value = null; return true; } });
};
export const borrowCausalCheckpoint = async (journal, ref, options) => typeof journal.readCheckpointOwned === 'function'
  ? journal.readCheckpointOwned(ref, options) : legacyLease(await journal.readCheckpoint(ref));
export const borrowCausalPage = async (journal, options) => typeof journal.queryOwned === 'function'
  ? journal.queryOwned(options) : legacyLease(await journal.query(options));
export const borrowCausalTake = async (journal, takeId, options) => typeof journal.openTakeOwned === 'function'
  ? journal.openTakeOwned(takeId, options) : legacyLease(await journal.openTake(takeId, options));

export const retireCausalRead = source => {
  if (!source) return;
  const result = source.release(), state = source.retirementState?.();
  if (result === true || ['released', 'canceled'].includes(state?.phase) || state?.state === 'retired' && state.outcome === 'complete') return;
  if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
  throw journalError('source-retirement-unknown', 'Causal read retirement was not synchronously acknowledged.');
};
