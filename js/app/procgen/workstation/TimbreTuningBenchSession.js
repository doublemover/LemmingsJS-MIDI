import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { validateTimbreTuningSet, createTimbreTuningRecipe, timbreSpectrumData, timbreTuningData } from '../../../midi/content/TimbreTuningSet.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createTimbreTuningBenchSession({ jobs, resourceBudget, getSource, prepareRenderer, publishPair, reviewExternal, onChange = () => {} } = {}) {
  if (!jobs?.compute || [getSource, prepareRenderer, publishPair, reviewExternal].some(value => typeof value !== 'function')) throw new TypeError('The bench requires shared compiler, renderer, capability review and project publication owners.');
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'timbre-tuning-bench', kind: 'bounded-local-draft-and-receipts', category: 'candidate', bytes: 1048576 }), retirement = createProcgenRetirementScope(), cleanups = new Set();
  let disposed = false, draft = null, baseline = null, sourceIdentity = null, serial = 0, draftRevision = 0, operation = null, analysis = null, analysisRevision = null, prepared = null, error = null, committed = false;
  const stale = () => sourceIdentity != null && getSource().identity !== sourceIdentity;
  const state = () => Object.freeze({ schema: 'lemmings-spectrum-tuning-bench-session/v1', draft, baseline, draftRevision, sourceIdentity, stale: stale(), busy: !!operation, error, committed,
    analysis: analysis?.value || null, analysisStale: !!analysis && (analysisRevision !== draftRevision || stale()), prepared: prepared ? { set: prepared.compiled.value.set, setHash: prepared.compiled.value.setHash, admission: prepared.compiled.value.admission, renderer: prepared.compiled.value.renderer, externalReview: prepared.externalReview } : null,
    canCommit: !disposed && !!prepared && !operation && !stale() && !committed && prepared.revision === draftRevision });
  const notify = () => { if (!disposed) { try { onChange(state()); } catch {} } };
  const retireCandidate = candidate => {
    if (!candidate) return null;
    let rendering = null;
    const receipt = createProcgenRetirementScope().retire([{ name: 'paired-renderer', run: () => rendering = candidate.renderer?.release() }, { name: 'paired-compiled-inputs', run: async () => { await rendering?.completion; if (rendering?.outcome && rendering.outcome !== 'complete') throw new Error('The paired renderer retains unresolved ownership.'); candidate.compiled?.release(); } }]);
    cleanups.add(receipt); receipt.completion.then(result => { if (result.outcome === 'complete') cleanups.delete(receipt); }); return receipt;
  };
  const clearPrepared = () => { const previous = prepared; prepared = null; return retireCandidate(previous); };
  const check = token => { token.controller.signal.throwIfAborted(); if (disposed || operation !== token || stale() || token.revision !== draftRevision) throw new Error('The bench draft or selected source changed.'); };
  const run = (phase, work) => {
    if (disposed || operation) return Promise.reject(new Error('Finish or cancel the current bench operation first.'));
    const token = { phase, revision: draftRevision, controller: new AbortController(), completion: null }; operation = token; error = null; notify();
    token.completion = Promise.resolve().then(() => work(token)).catch(caught => { error = caught.message; throw caught; }).finally(() => { if (operation === token) operation = null; notify(); }); return token.completion;
  };
  const edit = raw => {
    if (disposed || !draft) throw new Error('Open a bench draft first.');
    const changed = project => canonicalDataText(project(raw)).text !== canonicalDataText(project(draft)).text;
    const next = validateTimbreTuningSet({ ...raw, revision: draft.revision + 1, spectrumRef: { ...raw.spectrumRef, revision: draft.spectrumRef.revision + Number(changed(timbreSpectrumData)) }, tuningRef: { ...raw.tuningRef, revision: draft.tuningRef.revision + Number(changed(timbreTuningData)) }, analysisReceipt: null }); operation?.controller.abort(new Error('The bench draft changed.')); clearPrepared();
    draft = next; draftRevision++; committed = false; error = null; notify(); return draft;
  };
  return Object.freeze({ state, edit,
    async open(recipe = null) {
      if (disposed || operation) throw new Error('Finish the current bench operation before opening a source.');
      const epoch = ++serial, source = getSource(); if (!source.lane) throw new Error('Select a physical voice first.');
      clearPrepared(); analysis?.release(); analysis = null; analysisRevision = null; error = null; committed = false; sourceIdentity = source.identity; baseline = source.lane.timbreTuningSet || null;
      const next = recipe ? await createTimbreTuningRecipe(recipe) : baseline || await createTimbreTuningRecipe('harmonic');
      if (disposed || serial !== epoch || sourceIdentity !== getSource().identity) throw new Error('The selected voice changed while opening its bench.');
      draft = validateTimbreTuningSet(next); draftRevision++; notify(); return draft;
    },
    invalidateAnalysis() { operation?.controller.abort(new Error('The requested analysis window/grid changed.')); clearPrepared(); analysisRevision = null; notify(); },
    offerFit(fit, options = {}) { return run('offering-reviewed-fit', async token => {
      const source = getSource(), workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'paired-spectrum-fit-offer', kind: 'bounded-fit-selection-hash-and-conversion', category: 'candidate', bytes: 16 * 1048576 });
      try {
        const { createTimbreTuningFromModalFit } = await import('../../../midi/content/TimbreTuningModalFit.js'), candidate = await createTimbreTuningFromModalFit({ fit, ...options });
        token.controller.signal.throwIfAborted();
        if (disposed || operation !== token || token.revision !== draftRevision || source.identity !== getSource().identity) throw new Error('The target voice changed before the reviewed fit could be offered.');
        clearPrepared(); analysis?.release(); analysis = null; analysisRevision = null; baseline = source.lane.timbreTuningSet || null; sourceIdentity = source.identity; draft = candidate; draftRevision++; committed = false; error = null; notify(); return draft;
      } finally { workspace.release(); }
    }); },
    restoreBaseline() { if (!baseline) throw new Error('This voice has no saved paired baseline.'); return edit(baseline); },
    analyze(options) { return run('analyzing-offline', async token => {
      if (!draft || stale()) throw new Error('Reopen the current voice before analyzing.');
      const input = { ...options, set: { ...draft, analysisReceipt: null } }; let candidate = null;
      try { candidate = await jobs.compute({ kind: 'analyze-timbre-tuning-set', ownerId: 'spectrum-tuning-bench', ownerEpoch: ++serial, sourceRevision: sourceIdentity,
        inputBytes: canonicalDataText(input, { maxBytes: 262144, maxNodes: 16384 }).bytes.length, estimatedPeakBytes: 64 * 1048576, maxBytes: 2 * 1048576, deadlineMs: 60000,
        signal: token.controller.signal, budgetAdapter: resourceBudget, isCurrent: () => !disposed && operation === token && !stale() && token.revision === draftRevision, prepareInput: () => input });
      check(token); analysis?.release(); analysis = candidate; candidate = null; analysisRevision = draftRevision; return analysis.value;
      } finally { candidate?.release(); }
    }); },
    prepare({ externalPolicy = 'local-only' } = {}) { return run('preparing-atomic-pair', async token => {
      if (!draft || stale()) throw new Error('Reopen the unchanged voice before preparing the pair.');
      if (analysis && analysisRevision !== draftRevision) throw new Error('The retained model is stale. Analyze the current pair or record an explicit model bypass before Prepare.');
      const retired = clearPrepared(); await retired?.completion; if (retired && retired.outcome !== 'complete') throw new Error('The previous pair retains unresolved resources.');
      if (cleanups.size) throw new Error('Wait for the previous paired renderer retirement before preparing another.');
      const source = getSource(), externalReview = reviewExternal(source, externalPolicy);
      if (!externalReview || externalReview.status !== 'reviewed') throw new Error(externalReview?.reason || 'Review the output capability before committing a pair.');
      check(token); const candidate = { compiled: null, renderer: null, revision: draftRevision, externalReview };
      try {
        const input = { set: { ...draft, analysisReceipt: analysis && analysisRevision === draftRevision ? analysis.value.receipt : null }, sampleRate: source.sampleRate };
        candidate.compiled = await jobs.compute({ kind: 'compile-timbre-tuning-set', ownerId: 'spectrum-tuning-prepare', ownerEpoch: ++serial, sourceRevision: sourceIdentity,
          inputBytes: canonicalDataText(input, { maxBytes: 262144, maxNodes: 16384 }).bytes.length, estimatedPeakBytes: 64 * 1048576, maxBytes: 4 * 1048576, deadlineMs: 30000,
          signal: token.controller.signal, budgetAdapter: resourceBudget, isCurrent: () => !disposed && operation === token && !stale() && token.revision === draftRevision, prepareInput: () => input });
        check(token); candidate.renderer = await prepareRenderer(source.lane.id, candidate.compiled.value.reference, { signal: token.controller.signal, retainPrevious: true, switchLane: { ...source.lane, soundChangePolicy: 'new-notes-only', soundChangeBoundary: 'immediate' } }); check(token);
        candidate.renderer.validateCommit?.(); prepared = candidate; return state();
      } catch (caught) { const cleanup = retireCandidate(candidate); await cleanup?.completion; throw caught; }
    }); },
    commit() {
      if (!state().canCommit) throw new Error('Prepare both exact revisions against the unchanged source before committing.');
      const candidate = prepared, source = getSource(); candidate.renderer.validateCommit?.();
      let published = false, accepting = false;
      try {
        candidate.renderer.commit(); const result = publishPair(source, candidate.compiled.value, candidate.externalReview);
        if (result === false) throw new Error('The paired sound/tuning edit was not admitted.');
        published = true; accepting = true; candidate.renderer.accept(); committed = true; baseline = candidate.compiled.value.set; draft = baseline; sourceIdentity = getSource().identity; error = null;
        return Object.freeze({ status: 'committed-atomic-pair', setHash: candidate.compiled.value.setHash, externalReview: candidate.externalReview });
      } catch (caught) {
        const current = getSource();
        if (!accepting && current.lane?.instrumentRef?.definitionHash === candidate.compiled.value.reference.definitionHash && current.lane.timbreTuningSet?.revision === candidate.compiled.value.set.revision && current.field?.tuning.id === candidate.compiled.value.physicalTuning.id) {
          published = true; accepting = true; candidate.renderer.accept(); committed = true; baseline = candidate.compiled.value.set; draft = baseline; sourceIdentity = current.identity; error = caught.message;
          return Object.freeze({ status: 'committed-presentation-fault', setHash: candidate.compiled.value.setHash, reason: caught.message });
        }
        throw caught;
      } finally { prepared = null; retireCandidate(candidate); if (published) committed = true; notify(); }
    },
    cancel() { if (operation) operation.controller.abort(new Error('Bench operation canceled; draft retained.')); clearPrepared(); notify(); return !!operation; },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; operation?.controller.abort(new Error('Bench closed.'));
      return retirement.retire([{ name: 'bench-job', run: () => operation?.completion.catch(() => {}) }, { name: 'bench-pair', run: () => clearPrepared() }, { name: 'bench-reports', run: async () => { await Promise.all([...cleanups].map(receipt => receipt.completion)); if ([...cleanups].some(receipt => receipt.outcome !== 'complete')) throw new Error('Bench renderer retirement remains unresolved.'); analysis?.release(); storage.release(); draft = baseline = null; } }]); }
  });
}
