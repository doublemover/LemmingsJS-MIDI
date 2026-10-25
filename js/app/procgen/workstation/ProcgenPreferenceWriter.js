export function createProcgenPreferenceWriter({ jobs, resourceBudget, storage, key, getGeneration, onState = () => {} }) {
  let pending = null, active = null, sequence = 0, disposed = false, closing = false, durableRevision = -1, completion = Promise.resolve();
  const report = state => { try { onState(state); } catch { /* Presentation cannot take ownership of a pending write. */ } };
  const drain = () => {
    if (active || !pending || disposed) return completion;
    const request = pending; pending = null; const controller = new AbortController(); active = { request, controller };
    report({ state: 'saving', revision: request.revision, durableRevision });
    completion = (async () => {
      let computed;
      try {
        computed = await jobs.compute({ kind: 'encode-json', ownerId: 'procgen-preferences', ownerEpoch: request.generation,
          sourceRevision: `preferences:${request.sequence}`, inputBytes: 0,
          estimatedPeakBytes: Math.min(512 * 1048576, 8 * 1048576 + request.value.project.procgen.lanes.length * 262144),
          priority: 'recovery', budgetAdapter: resourceBudget, signal: controller.signal,
          isCurrent: () => !disposed && request.generation === getGeneration(), prepareInput: () => request.value,
          releasePreparedInput: () => { request.value = null; } });
        if (controller.signal.aborted || request.generation !== getGeneration() || disposed) return;
        storage?.setItem(key, computed.value); durableRevision = request.revision;
        report({ state: pending ? 'pending' : 'saved', revision: pending?.revision ?? request.revision, durableRevision });
      } catch (error) {
        if (!controller.signal.aborted && !disposed) report({ state: 'unavailable', revision: request.revision, durableRevision, error });
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
      pending = { value, revision, generation: getGeneration(), sequence: ++sequence }; void drain(); return true;
    },
    state: () => ({ pendingRevision: pending?.revision ?? active?.request.revision ?? null, durableRevision, active: !!active }),
    dispose({ flush = true } = {}) {
      if (disposed) return completion;
      closing = true;
      if (!flush) { disposed = true; pending = null; active?.controller.abort(); }
      else if (pending) void drain(); else if (!active) disposed = true;
      return completion;
    }
  };
}
