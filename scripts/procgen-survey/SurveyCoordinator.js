import { performance as clock } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { runSurveyJobs } from './SurveyWorkerPool.js';
import { createSurveyTrialId } from '../../js/app/procgen/survey/ProcgenSurveyCore.js';
import { normalizeSurveyScenario, normalizeSurveyCandidate } from '../../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { hashSurveyValue } from '../../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { compareSurveyReplay } from '../../js/app/procgen/survey/ProcgenSurveyReplay.js';
import { analyzeProcgenSurveyPairs, selectProcgenSurveyExemplars, createProcgenSuccessQualification, summarizeProcgenSuccessQualification } from '../../js/app/procgen/survey/ProcgenSurveyAnalysis.js';

const runSurveyExperiment = async (manifest, store, { signal, onTelemetry = () => {}, onResult = () => {}, onState = () => {}, onControlReady = () => {} } = {}) => {
  const prior = await store.read('report.json');
  const started = clock.now(), results = [], telemetry = new Map(prior?.telemetry || []), performance = [...(prior?.performance || [])], attempts = [...(prior?.attempts || [])], verification = [], successQualification = [];
  let stage = 'queued', activeControls = null, paused = false, cancelled = false, controlState = {}, currentExecution = null, executedTicks = 0;
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
    pause: () => { paused = true; return activeControls?.pause() || { paused }; },
    resume: () => { paused = false; return activeControls?.resume() || { paused }; },
    step: () => { paused = true; return activeControls?.step() || { paused, queued: true }; },
    cancel: () => { cancelled = true; return activeControls?.cancel() || { cancelled }; }
  });
  const remainingMs = () => Math.floor(manifest.budgetPolicy.maxTotalMs - (clock.now() - started));
  const execute = async (jobs, label, accept) => {
    stage = label; present();
    if (signal?.aborted || cancelled || remainingMs() < 100) return { cancelled: true, reason: cancelled || signal?.aborted ? 'cancelled' : 'experiment-wall-time-safety' };
    const ticks = jobs.reduce((sum, job) => sum + job.scenario.horizonTicks, 0);
    if (executedTicks + ticks > manifest.budgetPolicy.maxTotalTicks) return { cancelled: true, reason: 'experiment-tick-budget' };
    executedTicks += ticks;
    currentExecution = await runSurveyJobs(jobs, { ...manifest.budgetPolicy, maxTotalMs: remainingMs(), signal, paused,
      onControlReady: controls => { activeControls = controls; },
      onControlState: state => { controlState = { ...controlState, ...state }; present(); },
      onTelemetry: (id, value) => { telemetry.set(id, value); onTelemetry(id, value, label); present(); }, onResult: accept });
    activeControls = null; return currentExecution;
  };
  const incomplete = () => allJobs.filter(job => !results.some(result => result.trialId === job.trialId && result.episodeComplete)).map(job => ({ trialId: job.trialId, scenarioId: job.scenario.id,
    candidateId: job.candidate.id, status: results.find(result => result.trialId === job.trialId)?.status || 'not-run' }));
  const interrupted = reason => ({ ...publicState(), results, performance, attempts, verification, successQualification, status: 'interrupted', reason,
    incompleteTrials: incomplete(), storage: store.snapshot(), presentationErrors: currentExecution?.presentationErrors || [] });
  const retain = (result, job) => ({ ...result, ...result.provenance, sourceHash: hashSurveyValue({ core: result.provenance?.sourceHash || null, codeDigest: manifest.sourceManifest.codeDigest || null }), environmentSeed: job.scenario.environmentSeed, clusterId: 'world-' + job.scenario.environmentSeed,
    replayManifest: { schemaVersion: 1, scenario: job.scenario, candidate: job.candidate, sourceManifest: { engineCommit: manifest.sourceManifest.engineCommit,
      codeDigest: manifest.sourceManifest.codeDigest, assetHashes: manifest.sourceManifest.assetHashes, harnessVersion: manifest.sourceManifest.harnessVersion, manifestReference: 'manifest.json' },
    budgetPolicy: manifest.budgetPolicy, experimentId: manifest.experimentId } });
  for (const block of [{ name: 'development', jobs: allJobs.slice(0, development.length * manifest.candidates.length) }, { name: 'held-out', jobs: allJobs.slice(development.length * manifest.candidates.length) }]) {
    const pending = [];
    for (const job of block.jobs) { const saved = await store.completed(job.trialId); if (saved) results.push(saved); else pending.push(job); }
    const execution = await execute(pending, block.name, async (result, attempt) => {
      const job = pending.find(value => value.trialId === result.trialId), retained = retain(result, job);
      await store.commitResult(retained, attempt); results.push(retained); attempts.push(attempt); if (attempt.performance) performance.push(attempt.performance);
      try { onResult(retained, block.name); } catch { /* Read-only display callback. */ } present();
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
  const exact = await execute(pendingVerification.map(job => ({ ...job, attemptId: randomUUID() })), 'exact-verification', async (replay, attempt) => {
    const original = results.find(result => result.trialId === replay.trialId), receipt = compareSurveyReplay(original, replay);
    await store.writeImmutable('verification/' + replay.trialId + '-exact.json', { ...receipt, replay, attempt }); verification.push(receipt); promote(original, receipt);
  });
  if (exact.error || exact.cancelled) return interrupted(exact.error || exact.reason);
  if (verification.some(receipt => !receipt.matched)) return interrupted('determinism-defect');
  const baseline = manifest.candidates.find(candidate => candidate.kind === 'baseline'), baselineId = baseline.id;
  const selected = selectProcgenSurveyExemplars(results, { baselineId, capacities: { success: 4, failure: 4, normal: 2, context: 2 } });
  // Qualification conditions are declared before execution. Whole comparison blocks
  // and every negative result are retained; exact repeats are never independent samples.
  const protocol = manifest.budgetPolicy.successQualification;
  for (const selection of selected.selected.filter(item => item.kind === 'success').slice(0, protocol?.maxOriginals || 0)) {
    const original = results.find(result => result.trialId === selection.trialId), scenario = original.scenario, candidate = original.candidate;
    const competitors = [manifest.candidates.find(policy => ![candidate.id, baselineId].includes(policy.id))].filter(Boolean);
    const nearbyScenarios = scenario.mode === 'controlled' ? protocol.nearbyAdmissionOffsets.map(offset => normalizeSurveyScenario({ ...scenario, id: scenario.id + '-admission-' + offset,
      admissions: scenario.admissions.map(actor => ({ ...actor, x: Math.max(8, actor.x + offset) })) })) : [];
    const plan = createProcgenSuccessQualification({ original, scenario, candidate, baseline, competitors, nearbyScenarios, holdoutScenarios: holdout,
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
    const firstRun = await execute(firstPending, 'success-qualification', async (result, attempt) => {
      const job = jobs.find(item => item.trialId === result.trialId), retained = retain(result, job); first.set(result.trialId, { result: retained, attempt });
      await store.writeImmutable('verification/' + job.id + '-original.json', { jobId: job.id, result: retained, attempt });
    });
    if (!firstRun.error && !firstRun.cancelled) {
      const secondRun = await execute(jobs.map(job => ({ ...job, attemptId: randomUUID() })), 'success-qualification-replay', async (replay, attempt) => {
        const job = jobs.find(item => item.trialId === replay.trialId), originalRecord = first.get(replay.trialId), receipt = compareSurveyReplay(originalRecord.result, replay);
        const derived = { ...originalRecord.result, validity: { ...originalRecord.result.validity, deterministic: receipt.matched } };
        const record = { jobId: job.id, result: derived, originalReference: job.id + '-original.json', replay, receipt, attempt };
        await store.writeImmutable('verification/' + job.id + '.json', record); records.push(record);
      });
      if (secondRun.error || secondRun.cancelled) return interrupted(secondRun.error || secondRun.reason);
    }
    const summary = summarizeProcgenSuccessQualification(plan, original, records); successQualification.push({ originalTrialId: original.trialId, plan, summary });
    await store.writeDerivative('verification/' + original.trialId + '-qualification-summary.json', summary);
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
    status: incomplete().length ? 'interrupted' : 'complete', incompleteTrials: incomplete(), verification, storage: store.snapshot(), rankingsTrusted: false,
    priorExecution: prior?.execution || null, execution: { elapsedMs: clock.now() - started, admittedTicks: executedTicks, memoryScope: 'Worker V8 old heap capped; reported RSS covers the whole Node process.' } };
};
export { runSurveyExperiment };
