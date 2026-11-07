import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { validatePhysicalMusicGoal } from './PhysicalMusicGoal.js';
import { getActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createPhysicalMusicStudyWorkbench({ jobs, resourceBudget, captureSource, getSourceIdentity, applyContinuation, onChange = () => {} } = {}) {
  if (!jobs?.compute || typeof captureSource !== 'function' || typeof getSourceIdentity !== 'function' || typeof applyContinuation !== 'function') throw new TypeError('Composition requires the owned background service and reversible physical publication.');
  const retirement = createProcgenRetirementScope(), partialStorage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-music-study-progress', kind: 'bounded-completed-sample-receipts', category: 'candidate', bytes: 2 * 1048576 }); let partial = null;
  let serial = 0, disposed = false, operation = null, retained = null, study = null, sensitivity = null, comparison = null, selectedId = null, progress = null, error = null, applied = false, sourceIdentity = null, applying = null;
  const stale = () => sourceIdentity != null && sourceIdentity !== getSourceIdentity();
  const canReview = () => !disposed && !operation && !applying && !applied && !stale(),
    auditionCandidate = () => [study?.selected, study?.reference].find(candidate => candidate?.candidateId === selectedId && candidate.verification?.matched) || null;
  const state = () => Object.freeze({ phase: disposed ? 'closed' : operation ? 'working' : error ? 'failed' : study ? 'ready' : 'idle', busy: !!operation || !!applying, progress, error,
    study, sensitivity, comparison, partial, selectedId, selected: study?.rows.find(row => row.id === selectedId) || null, stale: stale(), applied,
    canAudition: canReview() && !!auditionCandidate(),
    canApply: canReview() && !!study?.selected && study.selected.candidateId === selectedId && study.selected.verification.matched && !!study.selected.reviewedInputs?.length });
  const publish = () => { try { onChange(state()); } catch {} };
  const clearResult = () => { retained?.release(); retained = null; study = null; sensitivity = null; comparison = null; partial = null; selectedId = null; applied = false; };
  const start = async ({ goal: raw, mode = 'search', comparisonPolicy = null } = {}) => {
    if (disposed || operation || applying) throw new Error('Finish or cancel the current composition operation first.');
    const goal = validatePhysicalMusicGoal(raw); clearResult(); error = null; progress = { phase: 'capturing-paused-source' }; sourceIdentity = getSourceIdentity();
    const controller = new AbortController(), ownerEpoch = ++serial, pending = { controller, completion: null }; operation = pending; publish();
    const isCurrent = () => !disposed && operation === pending && !stale();
    pending.completion = (async () => {
      let capsule = null, result = null;
      try {
        capsule = await captureSource({ signal: controller.signal }); controller.signal.throwIfAborted(); if (!isCurrent()) throw new Error('The source changed during composition capture.');
        const input = { ...capsule.input, mode, goal, operationEpoch: ownerEpoch, ...(comparisonPolicy ? { comparisonPolicy } : {}), applicationBuildId: getActiveExecutionIdentity('browser-background-jobs').buildId }, inputBytes = canonicalDataText(input, { maxBytes: 4 * 1048576, maxNodes: 300000 }).bytes.length;
        result = await jobs.compute({ kind: 'physical-music-study', ownerId: 'physical-music-compose', ownerEpoch, sourceRevision: sourceIdentity, inputBytes,
          estimatedPeakBytes: 384 * 1048576, maxBytes: 16 * 1048576, deadlineMs: 180000, signal: controller.signal, budgetAdapter: resourceBudget, isCurrent,
          prepareInput: () => input, onProgress: value => { const { partial: receipt, ...presentation } = value; progress = presentation;
            if (receipt) { try { canonicalDataText(receipt, { maxBytes: 262144, maxNodes: 16384 }); partial = freezeData(receipt); } catch { /* Keep the preceding admitted receipt; oversized progress does not retain uncharged data. */ } } publish(); } });
        controller.signal.throwIfAborted(); if (!isCurrent()) throw new Error('The completed study belongs to a stale source.');
        const value = result.value; retained = result; result = null; study = value.study; sensitivity = value.sensitivity; comparison = value.comparison || null;
        selectedId = study.selected?.candidateId || study.rows[0]?.id || null; progress = null; publish(); return study;
      } catch (caught) { if (!disposed && operation === pending) { error = controller.signal.aborted ? 'Canceled; the goal draft remains available.' : caught.message; progress = null; publish(); } throw caught; }
      finally { result?.release(); await capsule?.release?.(); if (operation === pending) operation = null; publish(); }
    })();
    return pending.completion;
  };
  return Object.freeze({ state, start,
    select(id) { if (!study?.rows.some(row => row.id === id)) throw new Error('Choose a retained candidate.'); selectedId = id; publish(); return state(); },
    report() {
      if (!study && !partial) throw new Error('Complete at least one physical sample before exporting a study report.');
      return { schema: 'lemmings-physical-music-study-report/v1', staleAtExport: stale(), status: study?.status || 'partial', reason: study?.reason || error || null,
        goal: study?.goal || partial?.goal || null, sourceIdentity: study?.sourceIdentity || null, base: study?.base || partial?.base || null, coverage: study?.coverage || null, work: study?.work || null, partial, sensitivity, comparison,
        candidates: (study?.rows || []).map(row => ({ id: row.id, values: row.values, edits: row.edits, patchHash: row.patchHash || null, status: row.status, reason: row.reason || null, completed: row.completed ?? false,
          metrics: row.metrics || null, traceHash: row.traceHash || null, continuationHash: row.continuationHash || null, verification: row.verification || null,
          safetyFailures: row.trace?.safetyFailures || [], rejectedInputs: row.trace?.rejectedInputs || [], discontinuities: row.trace?.discontinuities || [], actualOnsetCount: row.trace?.onsets.length ?? null })) };
    },
    auditionContinuation() {
      if (!state().canAudition) throw new Error('Choose an independently verified original/proposed candidate from the unchanged source before preparing its private audition.');
      return auditionCandidate().auditionContinuation;
    },
    cancel() { if (!operation) return false; operation.controller.abort(new Error('Composition canceled.')); return true; },
    async apply() {
      if (!state().canApply) throw new Error('Apply requires the independently replayed selected candidate and its unchanged paused source.');
      const selected = study.selected, identity = sourceIdentity, receipt = selected.verification;
      if (identity !== getSourceIdentity()) throw new Error('The physical source changed before Apply.');
      applying = Promise.resolve().then(() => applyContinuation(selected.applyContinuation, { studyId: study.goal.id, candidateId: selected.candidateId, sourceIdentity: identity, verification: receipt }, { reviewedInputs: selected.reviewedInputs, expectedFirstBoundary: selected.applyContinuation, base: study.base, source: study.sourceIdentity })); publish();
      try { const published = await applying; if (published) applied = true; return published; } finally { applying = null; publish(); }
    },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; operation?.controller.abort(new Error('Composition closed.')); publish();
      return retirement.retire([{ name: 'composition-job-and-retained-report', run: async () => { await operation?.completion.catch(() => {}); await applying?.catch(() => {}); clearResult(); partialStorage.release(); } }]); }
  });
}
