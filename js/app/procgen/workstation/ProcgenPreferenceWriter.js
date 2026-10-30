import { copyMidiProjectSnapshot } from '../../../midi/project/MidiProjectSnapshot.js';
import { awaitBackgroundFailureRetirement, requireSynchronousResourceAcknowledgement } from '../../resources/ResourceRetirement.js';

export function createProcgenPreferenceWriter({ jobs, resourceBudget, storage, authoredStorage = null, key, getGeneration, onState = () => {} }) {
  let pending = null, active = null, sequence = 0, disposed = false, closing = false, durableRevision = -1, durableGeneration = null, requested = null, lastError = null, retirement = null, retirementFailure = null;
  let closeCompletion = null, finishClose;
  const holds = new Set();
  const report = state => { try { onState(state); } catch { /* Presentation cannot take ownership of a pending write. */ } };
  const ownershipFailure = (error, depth = 0) => error?.name === 'ResourceOwnershipError' || depth < 4 && Array.isArray(error?.errors) && error.errors.slice(0, 16).some(value => ownershipFailure(value, depth + 1));
  const failed = (request, error) => {
    if (ownershipFailure(error)) retirementFailure = error;
    if (!disposed && request.generation === getGeneration() && (!active?.controller.signal.aborted || retirementFailure)) {
      lastError = Object.freeze({ generation: request.generation, revision: request.revision, code: String(error.code || error.name || 'preference-write-failed').slice(0, 128), message: String(error.message || error).slice(0, 512) });
      report({ state: 'unavailable', revision: request.revision, durableRevision: durableGeneration === request.generation ? durableRevision : -1, error });
    }
  };
  const finishClosing = () => {
    if (closing && !active && (!pending || retirementFailure)) { pending = null; disposed = true; holds.clear(); finishClose?.(retirementFailure); }
  };
  const drain = () => {
    if (active) return active.completion;
    if (pending && pending.generation !== getGeneration()) { pending.value = null; pending = null; }
    if (!pending || disposed || holds.size || retirementFailure) { finishClosing(); return Promise.resolve(); }
    const request = pending; pending = null; const controller = new AbortController();
    let settle; const entry = { request, controller, completion: new Promise(resolve => { settle = resolve; }) }; active = entry;
    report({ state: 'saving', revision: request.revision, durableRevision: durableGeneration === request.generation ? durableRevision : -1 });
    void (async () => {
      let computed, committedRetirement = null;
      try {
        controller.signal.throwIfAborted();
        if (authoredStorage) {
          const receipt = await authoredStorage.savePreferences(request.value, { revision: request.revision, signal: controller.signal,
            isCurrent: () => !disposed && !controller.signal.aborted && request.generation === getGeneration() });
          if (receipt?.durable !== true) throw new Error('Project preference commit was not acknowledged.');
          committedRetirement = receipt.retirement || null;
          if (committedRetirement && committedRetirement.state !== 'complete' && committedRetirement.status !== 'complete') retirementFailure = Object.assign(new Error('Committed preference resource retirement is incomplete.'), { name: 'ResourceOwnershipError' });
        } else computed = await jobs.compute({ kind: 'encode-json', ownerId: 'procgen-preferences', ownerEpoch: request.generation,
          sourceRevision: `preferences:${request.sequence}`, inputBytes: 0,
          estimatedPeakBytes: Math.min(512 * 1048576, 8 * 1048576 + request.value.project.procgen.lanes.length * 262144),
          priority: 'recovery', budgetAdapter: resourceBudget, signal: controller.signal,
          isCurrent: () => !disposed && !controller.signal.aborted && request.generation === getGeneration(), prepareInput: () => request.value,
          releasePreparedInput: () => { request.value = null; } });
        if (controller.signal.aborted || request.generation !== getGeneration() || disposed) return;
        if (!authoredStorage) { if (typeof storage?.setItem !== 'function') throw new Error('Project preference storage is unavailable.'); storage.setItem(key, computed.value); }
        durableRevision = request.revision; durableGeneration = request.generation; lastError = null; retirement = committedRetirement;
        report({ state: pending ? 'pending' : retirement ? 'saved-retirement-pending' : 'saved', revision: pending?.revision ?? request.revision, durableRevision, retirement });
      } catch (error) {
        try { await awaitBackgroundFailureRetirement(error); }
        catch (failure) { error = failure; }
        failed(request, error);
      } finally {
        try { requireSynchronousResourceAcknowledgement(computed?.release(), 'Preference result release');
          const state = computed?.retirementState?.();
          if (state && !['released', 'canceled'].includes(state.phase)) throw Object.assign(new Error('Preference result retirement is unresolved.'), { name: 'ResourceOwnershipError' });
        } catch (error) { failed(request, error); }
        request.value = null; active = null;
        settle(); void drain(); finishClosing();
      }
    })();
    return entry.completion;
  };
  return {
    request(value, revision) {
      if (disposed || closing || retirementFailure) return false;
      if (!Number.isSafeInteger(revision) || revision < 0 || sequence === Number.MAX_SAFE_INTEGER) throw new Error('Preference revision exhausted.');
      pending = { value: authoredStorage ? copyMidiProjectSnapshot(value) : value, revision, generation: getGeneration(), sequence: ++sequence }; requested = { revision, generation: pending.generation }; lastError = null; void drain(); return true;
    },
    suspend() {
      const token = {}; if (!disposed) holds.add(token);
      if (active && !active.controller.signal.aborted) {
        if (!pending && !closing) pending = { ...active.request };
        active.controller.abort();
      }
      const completion = (active?.completion || Promise.resolve()).then(() => { if (retirementFailure) throw retirementFailure; });
      return Object.freeze({ completion, release() { if (holds.delete(token)) void drain(); } });
    },
    state: () => { const generation = getGeneration(), currentPending = pending?.generation === generation ? pending : active?.request.generation === generation ? active.request : null; return { pendingRevision: currentPending?.revision ?? null,
      requestedRevision: requested?.generation === generation ? requested.revision : null, durableRevision: durableGeneration === generation ? durableRevision : -1,
      lastError: lastError?.generation === generation ? lastError : null, retirement: durableGeneration === generation ? retirement : null,
      active: !!active, suspended: holds.size > 0, retirementUnknown: !!retirementFailure, storage: authoredStorage?.getPreferenceDiagnostics?.() || null }; },
    dispose({ flush = true } = {}) {
      if (closeCompletion) return closeCompletion;
      closeCompletion = new Promise((resolve, reject) => { finishClose = error => error ? reject(error) : resolve(); }); closing = true;
      if (!flush) { disposed = true; pending = null; active?.controller.abort(); }
      void drain(); finishClosing(); return closeCompletion;
    }
  };
}
