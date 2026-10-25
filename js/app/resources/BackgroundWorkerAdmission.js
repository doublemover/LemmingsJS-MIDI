import { BACKGROUND_JOB_KINDS } from './BackgroundJobKinds.js';
import { requireSynchronousResourceAcknowledgement } from './ResourceRetirement.js';
import { createResourceBudget } from './ResourceBudget.js';

const priorities = Object.freeze({ interactive: 3, recovery: 2, background: 1 });
const kinds = new Set([...BACKGROUND_JOB_KINDS, 'render-native-source', 'survey-replay', 'physical-search']);
const invalid = message => Object.assign(new Error(message), { name: 'BackgroundJobAdmissionError' });
export function createBackgroundWorkerAdmission({ maxWorkers = 2, maxQueuedJobs = 32, maxQueuedInputBytes = 64 * 1048576,
  resourceBudget = createResourceBudget(), now = () => performance.now() } = {}) {
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 4 || !Number.isSafeInteger(maxQueuedJobs) || maxQueuedJobs < 0 || maxQueuedJobs > 128 ||
      !Number.isSafeInteger(maxQueuedInputBytes) || maxQueuedInputBytes < 0 || maxQueuedInputBytes > 256 * 1048576) throw invalid('Invalid background worker admission limits.');
  const queue = [], active = new Set(), retained = new Set(); let sequence = 0, queuedBytes = 0, retired = false, admitted = 0, denied = 0, peakWorkers = 0, queueWaitMs = 0, peakQueueWaitMs = 0;
  const releaseBudget = record => {
    const errors = [];
    for (const budget of record.reservedBudgets) {
      try { requireSynchronousResourceAcknowledgement(budget.release({ token: record.token, owner: record.owner }), 'Background resource release'); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Background resource retirement is incomplete.');
  };
  const removeQueued = record => {
    const index = queue.indexOf(record); if (index < 0) return false;
    queue.splice(index, 1); queuedBytes -= record.inputBytes; return true;
  };
  const drain = () => {
    if (retired) return;
    while (active.size < maxWorkers && queue.length) {
      const observedAt = now();
      queue.sort((left, right) => (priorities[right.priority] + Math.floor((observedAt - right.queuedAt) / 1000)) -
        (priorities[left.priority] + Math.floor((observedAt - left.queuedAt) / 1000)) || left.sequence - right.sequence);
      const record = queue[0]; removeQueued(record);
      if (record.signal?.aborted) { record.cancel(record.signal.reason || invalid('Background job canceled.')); continue; }
      record.queueWaitMs = Math.max(0, observedAt - record.queuedAt); queueWaitMs += record.queueWaitMs; peakQueueWaitMs = Math.max(peakQueueWaitMs, record.queueWaitMs);
      active.add(record); peakWorkers = Math.max(peakWorkers, active.size); record.phase = 'running'; admitted++;
      record.resolve(record.lease);
    }
  };
  const acquire = ({ kind, ownerId, ownerEpoch, sourceRevision, inputBytes = 0, estimatedPeakBytes,
    priority = 'interactive', signal, budgetAdapter = null, deadlineMs = 180000, onCancel = null } = {}) => {
    signal?.throwIfAborted();
    if (retired || !kinds.has(kind) || typeof ownerId !== 'string' || !ownerId || ownerId.length > 128 ||
        !Number.isSafeInteger(ownerEpoch) || ownerEpoch < 0 || !['string', 'number'].includes(typeof sourceRevision) || String(sourceRevision).length > 256 ||
        typeof sourceRevision === 'number' && !Number.isSafeInteger(sourceRevision) || !Object.hasOwn(priorities, priority) ||
        !Number.isSafeInteger(inputBytes) || inputBytes < 0 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576 ||
        !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 600000 || onCancel != null && typeof onCancel !== 'function' ||
        budgetAdapter != null && (typeof budgetAdapter.reserve !== 'function' || typeof budgetAdapter.release !== 'function')) throw invalid('Invalid background job admission.');
    if (queue.length >= maxQueuedJobs && active.size >= maxWorkers || queuedBytes + inputBytes > maxQueuedInputBytes || sequence === Number.MAX_SAFE_INTEGER) {
      denied++; return Promise.reject(invalid('Background job queue or retained input capacity is occupied.'));
    }
    const record = { kind, owner: 'background:' + ownerId, ownerEpoch, sourceRevision, priority, signal, inputBytes,
      externalBudget: budgetAdapter, reservedBudgets: [], token: {}, estimatedPeakBytes, queuedAt: now(), sequence: ++sequence, phase: 'queued', timer: null };
    try {
      const request = { token: record.token, owner: record.owner, generation: ownerEpoch, category: 'candidate', bytes: estimatedPeakBytes, pinned: true, reloadable: false };
      resourceBudget.reserve(request);
      record.reservedBudgets.push(resourceBudget);
      if (budgetAdapter && budgetAdapter !== resourceBudget) { budgetAdapter.reserve(request); record.reservedBudgets.push(budgetAdapter); }
    } catch (error) {
      denied++; try { releaseBudget(record); } catch (cleanup) { record.phase = 'failed-or-unknown'; record.reason = cleanup.message; active.add(record); }
      return Promise.reject(error);
    }
    if (retired) { try { releaseBudget(record); } catch { record.phase = 'failed-or-unknown'; active.add(record); } return Promise.reject(invalid('Background owner retired during admission.')); }
    const promise = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
    const finish = (status = 'released') => {
      if (['released', 'canceled', 'retiring'].includes(record.phase)) return false;
      if (record.phase === 'failed-or-unknown') return false;
      removeQueued(record); clearTimeout(record.timer); signal?.removeEventListener('abort', abort);
      record.phase = 'retiring';
      try { releaseBudget(record); } catch (error) { unknown(error); return false; }
      active.delete(record); retained.delete(record); record.phase = status; drain(); return true;
    };
    const unknown = reason => {
      if (['released', 'canceled', 'failed-or-unknown'].includes(record.phase)) return;
      removeQueued(record); retained.delete(record); active.add(record); record.phase = 'failed-or-unknown'; record.reason = String(reason?.message || reason).slice(0, 512);
      clearTimeout(record.timer); signal?.removeEventListener('abort', abort);
      const request = { token: record.token, owner: record.owner, generation: ownerEpoch, category: 'candidate', bytes: estimatedPeakBytes, pinned: true, reloadable: false, unreleased: true };
      for (const budget of new Set([resourceBudget, budgetAdapter].filter(Boolean))) {
        try { budget.reserve(request); } catch { /* Failed bookkeeping remains charged and cannot authorize another worker. */ }
      }
    };
    record.cancel = reason => {
      if (record.phase === 'queued') { finish('canceled'); record.reject(reason); return; }
      if (!['running', 'computed'].includes(record.phase)) return;
      record.phase = 'canceling';
      clearTimeout(record.timer); record.timer = setTimeout(() => unknown(invalid('Background cancellation outcome is unknown.')), 5000);
      if (onCancel) { try { Promise.resolve(onCancel(reason, record.lease)).catch(unknown); } catch (error) { unknown(error); } }
      else unknown(reason);
    };
    const abort = () => record.cancel(signal.reason || invalid('Background job canceled.'));
    record.lease = Object.freeze({ jobId: `background-${record.sequence}`, kind, ownerId, ownerEpoch, sourceRevision,
      release: () => finish(), retainUnknown: unknown,
      confirmRetirement() { if (record.phase === 'failed-or-unknown') record.phase = 'canceling'; return finish(); },
      computationFinished({ retainedBytes = estimatedPeakBytes } = {}) {
        if (record.phase !== 'running') return false;
        if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0 || retainedBytes > estimatedPeakBytes) throw invalid('Invalid retained background result estimate.');
        if (!retainedBytes) return finish();
        try {
          for (const budget of record.reservedBudgets) budget.reserve({ token: record.token, owner: record.owner, generation: ownerEpoch,
            category: 'candidate', bytes: retainedBytes, pinned: true, reloadable: false });
        } catch (error) { unknown(error); return false; }
        record.retainedBytes = retainedBytes;
        clearTimeout(record.timer); record.timer = null;
        record.phase = 'computed'; active.delete(record); retained.add(record); drain(); return true;
      },
      getState: () => Object.freeze({ jobId: `background-${record.sequence}`, kind, phase: record.phase, ownerEpoch, sourceRevision,
        queueWaitMs: record.queueWaitMs ?? null, estimatedPeakBytes, retainedBytes: record.retainedBytes ?? null, inputBytes, reason: record.reason || null }) });
    signal?.addEventListener('abort', abort, { once: true });
    record.timer = setTimeout(() => record.cancel(invalid('Background job admission deadline exceeded.')), deadlineMs);
    queue.push(record); queuedBytes += inputBytes; if (signal?.aborted) abort(); else drain();
    return promise;
  };
  return Object.freeze({ acquire,
    diagnostics: () => Object.freeze({ activeWorkers: active.size, retainedResults: retained.size, queuedJobs: queue.length, queuedInputBytes: queuedBytes, maxWorkers, maxQueuedJobs,
      maxQueuedInputBytes, admitted, denied, peakWorkers, queueWaitMs, peakQueueWaitMs, retired, failedOrUnknown: [...active].filter(record => record.phase === 'failed-or-unknown').length,
      memory: resourceBudget.diagnostics() }),
    dispose() {
      if (retired) return; retired = true;
      for (const record of [...queue, ...active, ...retained]) record.cancel?.(invalid('Background worker owner retired.'));
    } });
}

export const backgroundWorkerAdmission = createBackgroundWorkerAdmission();
