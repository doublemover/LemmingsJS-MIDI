import { copyMidiProjectSnapshot } from '../../../midi/project/MidiProjectSnapshot.js';

export function createProcgenPreferenceWriter({ jobs, resourceBudget, storage, authoredStorage = null, key, getGeneration, onState = () => {} }) {
  let pending = null, active = null, sequence = 0, disposed = false, closing = false, durableRevision = -1, durableGeneration = null, requested = null, lastError = null, retirement = null, completion = Promise.resolve();
  const report = state => { try { onState(state); } catch { /* Presentation cannot take ownership of a pending write. */ } };
  const drain = () => {
    if (active || !pending || disposed) return completion;
    const request = pending; pending = null; const controller = new AbortController(); active = { request, controller };
    report({ state: 'saving', revision: request.revision, durableRevision: durableGeneration === request.generation ? durableRevision : -1 });
    completion = (async () => {
      let computed, committedRetirement = null;
      try {
        if (authoredStorage) {
          const receipt = await authoredStorage.savePreferences(request.value, { revision: request.revision, signal: controller.signal,
            isCurrent: () => !disposed && request.generation === getGeneration() });
          if (receipt?.durable !== true) throw new Error('Project preference commit was not acknowledged.');
          committedRetirement = receipt.retirement || null;
        } else computed = await jobs.compute({ kind: 'encode-json', ownerId: 'procgen-preferences', ownerEpoch: request.generation,
          sourceRevision: `preferences:${request.sequence}`, inputBytes: 0,
          estimatedPeakBytes: Math.min(512 * 1048576, 8 * 1048576 + request.value.project.procgen.lanes.length * 262144),
          priority: 'recovery', budgetAdapter: resourceBudget, signal: controller.signal,
          isCurrent: () => !disposed && request.generation === getGeneration(), prepareInput: () => request.value,
          releasePreparedInput: () => { request.value = null; } });
        if (controller.signal.aborted || request.generation !== getGeneration() || disposed) return;
        if (!authoredStorage) { if (typeof storage?.setItem !== 'function') throw new Error('Project preference storage is unavailable.'); storage.setItem(key, computed.value); }
        durableRevision = request.revision; durableGeneration = request.generation; lastError = null; retirement = committedRetirement;
        report({ state: pending ? 'pending' : retirement ? 'saved-retirement-pending' : 'saved', revision: pending?.revision ?? request.revision, durableRevision, retirement });
      } catch (error) {
        if (!controller.signal.aborted && !disposed && request.generation === getGeneration()) {
          lastError = Object.freeze({ generation: request.generation, revision: request.revision, code: String(error.code || error.name || 'preference-write-failed').slice(0, 128), message: String(error.message || error).slice(0, 512) });
          report({ state: 'unavailable', revision: request.revision, durableRevision: durableGeneration === request.generation ? durableRevision : -1, error });
        }
      } finally {
        computed?.release(); request.value = null; active = null;
        if (pending && !disposed) await drain();
        else if (closing) disposed = true;
      }
    })();
    return completion;
  };
  return {
    request(value, revision) {
      if (disposed || closing) return false;
      if (!Number.isSafeInteger(revision) || revision < 0 || sequence === Number.MAX_SAFE_INTEGER) throw new Error('Preference revision exhausted.');
      pending = { value: authoredStorage ? copyMidiProjectSnapshot(value) : value, revision, generation: getGeneration(), sequence: ++sequence }; requested = { revision, generation: pending.generation }; lastError = null; void drain(); return true;
    },
    state: () => { const generation = getGeneration(), currentPending = pending?.generation === generation ? pending : active?.request.generation === generation ? active.request : null; return { pendingRevision: currentPending?.revision ?? null,
      requestedRevision: requested?.generation === generation ? requested.revision : null, durableRevision: durableGeneration === generation ? durableRevision : -1,
      lastError: lastError?.generation === generation ? lastError : null, retirement: durableGeneration === generation ? retirement : null,
      active: !!active, storage: authoredStorage?.getPreferenceDiagnostics?.() || null }; },
    dispose({ flush = true } = {}) {
      if (disposed) return completion;
      closing = true;
      if (!flush) { disposed = true; pending = null; active?.controller.abort(); }
      else if (pending) void drain(); else if (!active) disposed = true;
      return completion;
    }
  };
}
