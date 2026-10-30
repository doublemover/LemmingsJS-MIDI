import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createOwnedDataSnapshots } from '../../resources/OwnedDataSnapshot.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { borrowCausalPage, borrowCausalTake, retireCausalRead } from './CausalReadLeases.js';
import { cloneJournalData, journalError } from './CausalJournalCanonical.js';
import { inspectCausalReadOwnership } from './ProcgenCausalJournal.js';

const legacyResult = value => { let released = false; return Object.freeze({ get value() {
  if (released) throw journalError('view-retired', 'Causal view result has retired.'); return value;
}, release() { if (released) return false; released = true; value = null; return true; } }); };
let nextWorkspace = 0;

export function createCausalViewWorkspace({ journal, resourceBudget = null, jobs, ownerId, baseBytes, maxLinks = 524288,
  signal, check = () => {} } = {}) {
  if (!journal || typeof ownerId !== 'string' || !ownerId || !Number.isSafeInteger(baseBytes) || baseBytes < 4096 ||
      !Number.isSafeInteger(maxLinks) || maxLinks < 1 || maxLinks > 1048576 || typeof check !== 'function') throw new TypeError('Invalid causal view workspace.');
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId + '-' + (++nextWorkspace), kind: 'causal-view-workspace', bytes: baseBytes });
  const snapshots = resourceBudget ? createOwnedDataSnapshots({ resourceBudget, jobs, ownerId }) : null;
  const retirement = createProcgenRetirementScope(), held = new Set(), pending = new Set(), controller = new AbortController();
  let closed = false, adoptedBytes = 0, metadataBytes = 0, allocatedLinks = 0, lateFailure = null;
  const cancel = () => controller.abort(signal.reason); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  const guard = () => { controller.signal.throwIfAborted(); check(); if (closed) throw journalError('cancelled', 'Causal view workspace has retired.'); };
  const footprint = loan => {
    const authority = resourceBudget ? inspectCausalReadOwnership(loan, resourceBudget) : loan.receipt;
    const bytes = authority?.retainedDataBytes;
    if (resourceBudget && (!authority?.active || !Number.isSafeInteger(bytes) || bytes < 0))
      throw journalError('unowned-view-source', 'This view requires source readers with admitted retained-data ownership.');
    return bytes || 0;
  };
  const load = factory => {
    guard(); let work;
    work = Promise.resolve().then(() => { guard(); return factory(); }).then(loan => {
      if (closed) {
        try { retireCausalRead(loan); } catch (error) { lateFailure = error; throw error; }
        throw journalError('cancelled', 'Causal view source arrived after retirement.');
      }
      held.add(loan); return loan;
    }).finally(() => pending.delete(work)); pending.add(work); return work;
  };
  const dispose = () => {
    if (retirement.getReceipt()) return retirement.getReceipt(); closed = true;
    controller.abort(journalError('cancelled', 'Causal view operation retired.')); signal?.removeEventListener('abort', cancel);
    return retirement.retire([
      ...[...held].map((loan, index) => ({ name: 'view-source-' + index, run: () => { retireCausalRead(loan); held.delete(loan); } })),
      { name: 'accepted-source-reads', run: async () => { await Promise.allSettled([...pending]); if (lateFailure) throw lateFailure; } },
      { name: 'workspace', run: () => reservation.release() }
    ]);
  };
  return Object.freeze({
    async take(takeId) {
      const loan = await load(() => borrowCausalTake(journal, takeId, { signal: controller.signal })); guard();
      metadataBytes += footprint(loan); return loan.value;
    },
    async page(options) {
      const loan = await load(() => borrowCausalPage(journal, { ...options, signal: controller.signal })); guard();
      const value = loan.value, bytes = footprint(loan), nextBytes = adoptedBytes + bytes;
      if (!Array.isArray(value.records) || resourceBudget && (!Array.isArray(value.recordBytes) || value.recordBytes.length !== value.records.length ||
          value.recordBytes.some(size => !Number.isSafeInteger(size) || size < 1 || size > 64 * 1048576)))
        throw journalError('unowned-view-source', 'Causal query omitted its bounded record inventory.');
      reservation.resize(baseBytes + nextBytes * 2 + allocatedLinks * 256);
      const page = { records: value.records.slice(), recordBytes: value.recordBytes?.slice(), nextSequence: value.nextSequence, takeRevision: value.takeRevision };
      adoptedBytes = nextBytes; retireCausalRead(loan); held.delete(loan); return page;
    },
    reserveLinks(count) {
      guard(); if (!Number.isSafeInteger(count) || count < 0 || count > maxLinks) throw journalError('score-link-capacity', 'Causal join capacity reached; narrow the source window.');
      const wanted = Math.min(maxLinks, Math.ceil(count / 256) * 256);
      if (wanted > allocatedLinks) { reservation.resize(baseBytes + adoptedBytes * 2 + wanted * 256); allocatedLinks = wanted; }
    },
    async publish(value, { sourceRevision, maxBytes = 1048576 } = {}) {
      guard(); let result = null;
      try {
        result = snapshots ? await snapshots.prepare(value, { signal: controller.signal, sourceRevision, maxBytes,
          inputFootprintBytes: reservation.receipt().declaredBytes + metadataBytes,
          isCurrent: () => { try { guard(); return true; } catch { return false; } } }) : legacyResult(cloneJournalData(value, { maxBytes, maxNodes: 1000000 }));
        guard(); const receipt = dispose(); await receipt.completion;
        if (receipt.outcome !== 'complete') throw journalError('view-retirement-unknown', 'Causal view source cleanup is unresolved.', { retirement: receipt });
        signal?.throwIfAborted(); check(); return result;
      } catch (error) {
        if (result) { try { retireCausalRead(result); } catch (retirement) { throw journalError('view-retirement-unknown', 'Causal view result cleanup is unresolved.', { cause: error, retirement }); } }
        throw error;
      }
    }, dispose, diagnostics: () => Object.freeze({ closed, adoptedBytes, metadataBytes, allocatedLinks, pendingSources: pending.size,
      heldSources: held.size, reservation: reservation.receipt() })
  });
}
