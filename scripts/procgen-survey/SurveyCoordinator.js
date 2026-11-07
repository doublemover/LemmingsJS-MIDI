import { performance as clock } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { runSurveyJobs } from './SurveyWorkerPool.js';
import { createSurveyTrialId } from '../../js/app/procgen/survey/ProcgenSurveyCore.js';
import { normalizeSurveyScenario, normalizeSurveyCandidate } from '../../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { hashSurveyValue, canonicalSurveyJson, SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA } from '../../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { compareSurveyReplay } from '../../js/app/procgen/survey/ProcgenSurveyReplay.js';
import { analyzeProcgenSurveyPairs, selectProcgenSurveyExemplars, createProcgenSuccessQualification, summarizeProcgenSuccessQualification } from '../../js/app/procgen/survey/ProcgenSurveyAnalysis.js';

class SurveyExperimentIdentityError extends Error {
  constructor(message) { super(message); this.name = 'SurveyExperimentIdentityError'; this.kind = 'experiment-identity'; }
}

const runSurveyExperiment = async (manifest, store, { signal, onTelemetry = () => {}, onResult = () => {}, onState = () => {}, onControlReady = () => {}, runJobs = runSurveyJobs } = {}) => {
  const declared = await store.read('manifest.json');
  if (!declared || canonicalSurveyJson(declared) !== canonicalSurveyJson(manifest)) throw new SurveyExperimentIdentityError('Survey execution must use the evidence owner\'s original manifest');
  if (!Array.isArray(manifest.scenarios) || !manifest.sourceManifest || typeof manifest.sourceManifest !== 'object') throw new SurveyExperimentIdentityError('Survey execution requires a declared scenario set and source manifest');
  if (manifest.scenarios.some(scenario => scenario?.stateSchema !== SURVEY_STATE_SCHEMA) ||
      manifest.sourceManifest.canonicalStateVersion !== undefined && manifest.sourceManifest.canonicalStateVersion !== SURVEY_STATE_SCHEMA ||
      manifest.sourceManifest.canonicalEncodingVersion !== undefined && manifest.sourceManifest.canonicalEncodingVersion !== SURVEY_CANONICAL_SCHEMA)
    throw new SurveyExperimentIdentityError('Legacy survey state or canonical encoding requires a separately declared experiment');
  const prior = await store.read('report.json');
  const started = clock.now(), results = [], telemetry = new Map(prior?.telemetry || []), performance = [...(prior?.performance || [])], attempts = [...(prior?.attempts || [])], verification = [], successQualification = [],
    persistenceReceipts = [...(prior?.persistenceReceipts || [])], admissions = [...(prior?.admissions || [])], controlReceipts = [...(prior?.controlReceipts || [])].slice(-128),
    recoveryReceipts = [...(prior?.recoveryReceipts || [])];
  let stage = 'queued', activeControls = null, paused = false, cancelled = false, pendingStep = false, controlState = {}, currentExecution = null, executedTicks = 0,
    discardedControlReceipts = (prior?.discardedControlReceipts || 0) + Math.max(0, (prior?.controlReceipts?.length || 0) - 128);
  const jobsFor = (scenarios, candidates) => scenarios.flatMap(scenario => candidates.map(candidate => ({ scenario, candidate,
    trialId: createSurveyTrialId(scenario, candidate), attemptId: randomUUID() })));
  const development = manifest.scenarios.filter(scene => manifest.developmentScenarioIds.includes(scene.id));
  const holdout = manifest.scenarios.filter(scene => manifest.holdoutScenarioIds.includes(scene.id));
  const shortlist = manifest.candidates.filter(candidate => manifest.budgetPolicy.frozenFinalistIds.includes(candidate.id));
  const allJobs = [...jobsFor(development, manifest.candidates), ...jobsFor(holdout, shortlist)];
  const initialTicks = allJobs.reduce((sum, job) => sum + job.scenario.horizonTicks, 0);
  if (initialTicks > manifest.budgetPolicy.maxTotalTicks) throw new Error('Declared survey exceeds total tick budget');
  const publicState = () => ({ schemaVersion: 1, manifest, status: stage, controlState, rankingsTrusted: false, storage: store.snapshot(), telemetry: [...telemetry],
    results: allJobs.map(job => results.find(result => result.trialId === job.trialId) || { trialId: job.trialId, scenarioId: job.scenario.id, candidateId: job.candidate.id,
      scenario: job.scenario, candidate: job.candidate, policySeed: job.candidate.configuration.policySeed, status: telemetry.has(job.trialId) ? 'running' : 'queued',
      lastTick: telemetry.get(job.trialId)?.tick || 0, accounting: telemetry.get(job.trialId)?.accounting, telemetry: telemetry.get(job.trialId) }), verification });
  const present = () => { try { onState(publicState); } catch { /* Presentation cannot mutate or cancel physics. */ } };
  onControlReady({
    pause: () => { pendingStep = false; paused = true; return activeControls?.pause() || { paused }; },
    resume: () => { pendingStep = false; paused = false; return activeControls?.resume() || { paused }; },
    step: () => { paused = true; if (activeControls) return activeControls.step(); pendingStep = true; return { paused, queued: true, stepPending: true, reachedCheckpoint: null }; },
    cancel: () => { pendingStep = false; cancelled = true; return activeControls?.cancel() || { cancelled }; }
  });
  const remainingMs = () => Math.floor(manifest.budgetPolicy.maxTotalMs - (clock.now() - started));
  const execute = async (jobs, label, accept) => {
    stage = label; present();
    if (signal?.aborted || cancelled || remainingMs() < 100) return { cancelled: true, reason: cancelled || signal?.aborted ? 'cancelled' : 'experiment-wall-time-safety' };
    const ticks = jobs.reduce((sum, job) => sum + job.scenario.horizonTicks, 0);
    if (executedTicks + ticks > manifest.budgetPolicy.maxTotalTicks) return { cancelled: true, reason: 'experiment-tick-budget' };
    executedTicks += ticks;
    currentExecution = await runJobs(jobs, { ...manifest.budgetPolicy, maxTotalMs: remainingMs(), signal, paused,
      onControlReady: controls => { activeControls = controls; if (pendingStep) { pendingStep = false; controls.step(); } },
      onControlState: state => {
        const receipt = state.stepReceipt && (state.stepReceipt.controlId === state.controlId || state.stepReceipt.status === 'timed-out') ? state.stepReceipt : null;
        controlState = { ...state, stepStatus: receipt?.status ?? state.stepStatus ?? null,
          reachedCheckpoint: receipt?.reachedCheckpoint ?? null, selected: receipt?.selected ?? state.selected ?? [] };
        present();
      },
      onTelemetry: (id, value) => { telemetry.set(id, value); onTelemetry(id, value, label); present(); }, onResult: accept });
    persistenceReceipts.push(...(currentExecution.persistence || []).map(receipt => ({ ...receipt, stage: label })));
    admissions.push(...(currentExecution.admissions || []).map(receipt => ({ ...receipt, stage: label })));
    controlReceipts.push(...(currentExecution.controlReceipts || []).map(receipt => ({ ...receipt, stage: label })));
    discardedControlReceipts += (currentExecution.discardedControlReceipts || 0) + Math.max(0, controlReceipts.length - 128);
    if (controlReceipts.length > 128) controlReceipts.splice(0, controlReceipts.length - 128);
    activeControls = null; return currentExecution;
  };
  const incomplete = () => allJobs.filter(job => !results.some(result => result.trialId === job.trialId && result.episodeComplete)).map(job => ({ trialId: job.trialId, scenarioId: job.scenario.id,
    candidateId: job.candidate.id, status: results.find(result => result.trialId === job.trialId)?.status || 'not-run' }));
  const interrupted = reason => ({ ...publicState(), results, performance, attempts, verification, successQualification, status: 'interrupted', reason,
    incompleteTrials: incomplete(), storage: store.snapshot(), persistenceReceipts, admissions, controlReceipts, discardedControlReceipts, recoveryReceipts, presentationErrors: currentExecution?.presentationErrors || [] });
  const retain = (result, job) => ({ ...result, ...result.provenance, sourceHash: hashSurveyValue({ core: result.provenance?.sourceHash || null, codeDigest: manifest.sourceManifest.codeDigest || null }), environmentSeed: job.scenario.environmentSeed, clusterId: 'world-' + job.scenario.environmentSeed,
    replayManifest: { schemaVersion: 1, scenario: job.scenario, candidate: job.candidate, sourceManifest: { engineCommit: manifest.sourceManifest.engineCommit ?? null,
      codeDigest: manifest.sourceManifest.codeDigest ?? null, assetHashes: manifest.sourceManifest.assetHashes ?? null, harnessVersion: manifest.sourceManifest.harnessVersion ?? null, manifestReference: 'manifest.json' },
    budgetPolicy: manifest.budgetPolicy, experimentId: manifest.experimentId } });
  const publishWorkerEvidence = async (reference, value, delivery) => {
    await store.writeImmutable(reference, value, delivery); delivery.signal.throwIfAborted();
    return { publication: { schemaVersion: 1, status: 'immutable-published', reference,
      checksum: createHash('sha256').update(JSON.stringify(value)).digest('hex'), durability: store.snapshot().durability } };
  };
  for (const block of [{ name: 'development', jobs: allJobs.slice(0, development.length * manifest.candidates.length) }, { name: 'held-out', jobs: allJobs.slice(development.length * manifest.candidates.length) }]) {
    const pending = [];
    for (const job of block.jobs) {
      let saved = await store.completed(job.trialId);
      if (!saved && !signal?.aborted && !cancelled) {
        const recovery = await store.recoverCompleted(job.trialId, { signal }); saved = recovery.result;
        if (recovery.status === 'recovered-from-complete-attempt') {
          const { result, attempt, ...receipt } = recovery; recoveryReceipts.push({ ...receipt, trialId: job.trialId, stage: block.name });
          if (attempt && !attempts.some(previous => previous.id === attempt.id)) { attempts.push(attempt); if (attempt.performance) performance.push(attempt.performance); }
        }
      }
      if (saved) results.push(saved); else pending.push(job);
    }
    const execution = await execute(pending, block.name, async (result, attempt, delivery) => {
      const job = pending.find(value => value.trialId === result.trialId), retained = retain(result, job);
      const publication = await store.commitResult(retained, attempt, { ...delivery, withReceipt: true }); delivery.signal.throwIfAborted();
      results.push(retained); attempts.push(attempt); if (attempt.performance) performance.push(attempt.performance);
      try { onResult(retained, block.name); } catch { /* Read-only display callback. */ } present(); return { publication: publication.publication };
    });
    if (execution.cancelled || execution.error) return interrupted(execution.error || execution.reason);
    if (pending.some(job => !results.find(result => result.trialId === job.trialId)?.episodeComplete)) return interrupted('incomplete-episode');
  }
  const replayJobs = allJobs.filter(job => manifest.budgetPolicy.frozenFinalistIds.includes(job.candidate.id) && results.some(result => result.trialId === job.trialId && result.episodeComplete)).slice(0, manifest.budgetPolicy.maxExemplarVerificationTrials);
  const promote = (original, receipt) => { if (receipt.matched) { original.validity = { ...original.validity, deterministic: true }; original.evidence = { ...original.evidence, exactReplayVerified: true }; } };
  const pendingVerification = [];
  for (const job of replayJobs) {
    const saved = await store.read('verification/' + job.trialId + '-exact.json'), original = results.find(result => result.trialId === job.trialId);
    if (saved) { const receipt = compareSurveyReplay(original, saved.replay); verification.push(receipt); promote(original, receipt); } else pendingVerification.push(job);
  }
  const exact = await execute(pendingVerification.map(job => ({ ...job, attemptId: randomUUID() })), 'exact-verification', async (replay, attempt, delivery) => {
    const original = results.find(result => result.trialId === replay.trialId), receipt = compareSurveyReplay(original, replay);
    const publication = await publishWorkerEvidence('verification/' + replay.trialId + '-exact.json', { ...receipt, replay, attempt }, delivery); verification.push(receipt); promote(original, receipt); return publication;
  });
  if (exact.error || exact.cancelled) return interrupted(exact.error || exact.reason);
  if (verification.some(receipt => receipt.validity === 'invalid-or-incomplete')) return interrupted('replay-evidence-invalid-or-incomplete');
  if (verification.some(receipt => !receipt.matched)) return interrupted('determinism-defect');
  const baseline = manifest.candidates.find(candidate => candidate.kind === 'baseline'), baselineId = baseline.id;
  const selected = selectProcgenSurveyExemplars(results, { baselineId, capacities: { success: 4, failure: 4, normal: 2, context: 2 } });
  // Qualification conditions are declared before execution. Whole comparison blocks
  // and every negative result are retained; exact repeats are never independent samples.
  const protocol = manifest.budgetPolicy.successQualification;
  for (const selection of selected.selected.filter(item => item.kind === 'success').slice(0, protocol?.maxOriginals || 0)) {
    const original = results.find(result => result.trialId === selection.trialId), scenario = original.scenario, candidate = original.candidate;
    const summaryFile = 'verification/' + original.trialId + '-qualification-summary.json';
    const summaryGeneration = await store.derivativeGeneration(summaryFile);
    const competitors = [manifest.candidates.find(policy => ![candidate.id, baselineId].includes(policy.id))].filter(Boolean);
    const nearbyScenarios = scenario.mode === 'controlled' ? protocol.nearbyAdmissionOffsets.map(offset => normalizeSurveyScenario({ ...scenario, id: scenario.id + '-admission-' + offset,
      admissions: scenario.admissions.map(actor => ({ ...actor, x: Math.max(8, actor.x + offset) })) })) : [];
    // Selection from the observed holdout consumes its independence for this
    // original. Retain its reproducibility/sensitivity evidence, but do not
    // relabel observed worlds or start an undeclared replacement campaign.
    const selectedFromHoldout = manifest.holdoutScenarioIds.includes(scenario.id);
    const plan = createProcgenSuccessQualification({ original, scenario, candidate, baseline, competitors, nearbyScenarios,
      holdoutScenarios: selectedFromHoldout ? [] : holdout,
      holdoutUnavailableReason: selectedFromHoldout ? 'original-selected-from-holdout' : 'no-independent-holdout-declared',
      policySeeds: protocol.policySeeds, policyRandomnessRelevant: candidate.configuration.randomMode === 'semantic', maxTrials: protocol.maxTrials });
    await store.writeImmutable('verification/' + original.trialId + '-qualification-plan.json', plan);
    const records = [], pending = [];
    for (const job of plan.jobs) {
      const saved = await store.read('verification/' + job.id + '.json');
      if (saved) records.push(saved); else pending.push({ ...job, candidate: normalizeSurveyCandidate({ ...job.candidate, configuration: { ...job.candidate.configuration, policySeed: job.policySeed } }) });
    }
    if (pending.length * 2 > protocol.maxPhysicalTrials) { successQualification.push({ originalTrialId: original.trialId, plan, status: 'deferred', reason: 'qualification-physical-trial-cap' }); continue; }
    const first = new Map(), jobs = pending.map(job => ({ ...job, trialId: createSurveyTrialId(job.scenario, job.candidate), attemptId: randomUUID() }));
    const firstPending = [];
    for (const job of jobs) { const saved = await store.read('verification/' + job.id + '-original.json'); if (saved) first.set(job.trialId, saved); else firstPending.push(job); }
    const firstRun = await execute(firstPending, 'success-qualification', async (result, attempt, delivery) => {
      const job = jobs.find(item => item.trialId === result.trialId), retained = retain(result, job);
      const publication = await publishWorkerEvidence('verification/' + job.id + '-original.json', { jobId: job.id, result: retained, attempt }, delivery); first.set(result.trialId, { result: retained, attempt }); return publication;
    });
    if (!firstRun.error && !firstRun.cancelled) {
      const secondRun = await execute(jobs.map(job => ({ ...job, attemptId: randomUUID() })), 'success-qualification-replay', async (replay, attempt, delivery) => {
        const job = jobs.find(item => item.trialId === replay.trialId), originalRecord = first.get(replay.trialId), receipt = compareSurveyReplay(originalRecord.result, replay);
        const derived = { ...originalRecord.result, validity: { ...originalRecord.result.validity, deterministic: receipt.matched } };
        const record = { jobId: job.id, result: derived, originalReference: job.id + '-original.json', replay, receipt, attempt };
        const publication = await publishWorkerEvidence('verification/' + job.id + '.json', record, delivery); records.push(record); return publication;
      });
      if (secondRun.error || secondRun.cancelled) return interrupted(secondRun.error || secondRun.reason);
    }
    const summary = summarizeProcgenSuccessQualification(plan, original, records); successQualification.push({ originalTrialId: original.trialId, plan, summary });
    await store.writeDerivative(summaryFile, summary, { expectedGeneration: summaryGeneration });
    if (firstRun.error || firstRun.cancelled) return interrupted(firstRun.error || firstRun.reason);
  }
  const analyze = ids => analyzeProcgenSurveyPairs(results.filter(result => ids.includes(result.scenarioId)), { baselineId,
    candidateIds: manifest.candidates.filter(candidate => candidate.id !== baselineId).map(candidate => candidate.id),
    expectedBlocks: ids.map(scenarioId => ({ scenarioId, policySeed: 1 })), minimumClusters: manifest.criteria.minimumIndependentClusters || 8, samplingSeed: manifest.criteria.samplingSeed || 1 });
  const analysis = { development: analyze(manifest.developmentScenarioIds), holdout: analyze(manifest.holdoutScenarioIds), claim: 'bounded smoke comparison; no policy winner or general reliability claim' };
  const archiveSelections = [];
  for (const selection of selected.selected) {
    const result = results.find(value => value.trialId === selection.trialId);
    const context = results.filter(value => selection.contextTrialIds.includes(value.trialId)).map(value => ({ trialId: value.trialId, candidateId: value.candidateId, status: value.status,
      accounting: value.accounting, metrics: value.metrics, finalStateHash: value.finalStateHash, eventHash: value.eventHash, resultReference: 'results/' + value.trialId + '.json' }));
    const original = await store.completed(result.trialId), descriptor = { ...selection }; delete descriptor.originalResult;
    const qualification = { validity: result.validity, exactReplay: verification.find(receipt => receipt.originalTrialId === result.trialId) || null };
    await store.exemplar(descriptor, original || result, result.replayManifest, context, qualification);
    archiveSelections.push({ ...descriptor, qualification, originalReference: 'results/' + result.trialId + '.json' });
  }
  stage = 'complete'; present();
  return { schemaVersion: 1, manifest, results, telemetry: [...telemetry], performance, attempts, analysis, exemplars: { ...selected, selected: archiveSelections }, successQualification,
    status: incomplete().length ? 'interrupted' : 'complete', incompleteTrials: incomplete(), verification, persistenceReceipts, admissions, controlReceipts, discardedControlReceipts, recoveryReceipts, storage: store.snapshot(), rankingsTrusted: false,
    priorExecution: prior?.execution || null, execution: { elapsedMs: clock.now() - started, admittedTicks: executedTicks, memoryScope: 'Worker V8 old heap capped; reported RSS covers the whole Node process.' } };
};
export { runSurveyExperiment, SurveyExperimentIdentityError };
