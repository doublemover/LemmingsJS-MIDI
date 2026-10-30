import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSurveyExperiment, SurveyExperimentIdentityError } from '../scripts/procgen-survey/SurveyCoordinator.js';
import { SurveyEvidenceStore } from '../scripts/procgen-survey/SurveyEvidenceStore.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { generateProcgenSurveyCandidates, createProcgenSurveyExperiment } from '../js/app/procgen/survey/ProcgenSurveyCandidates.js';
import { normalizeSurveyResources } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { createNodeSurveyTrial } from '../scripts/procgen-survey/SurveyNodeWorld.js';
import { createSurveyTrialId } from '../js/app/procgen/survey/ProcgenSurveyCore.js';

describe('real bounded procgen survey coordination', function() {
  this.timeout(15000);
  let directory;
  afterEach(async () => { if (!directory) return; const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lemmings-survey-coordinator-')) throw new Error('Unsafe cleanup'); await fs.rm(resolved, { recursive: true, force: true }); });
  const declaration = () => {
    const candidates = generateProcgenSurveyCandidates({ count: 16 });
    const scenarios = [normalizeSurveyScenario({ id: 'development', environmentSeed: 1, cohort: { size: 1 }, horizonTicks: 96, goal: { x: 56, y: 64, width: 128, height: 16 } }),
      normalizeSurveyScenario({ id: 'holdout', corpus: 'holdout', environmentSeed: 2, cohort: { size: 1 }, horizonTicks: 96, goal: { x: 56, y: 64, width: 128, height: 16 } })];
    return createProcgenSurveyExperiment({ scenarios, candidates, developmentScenarioIds: ['development'], holdoutScenarioIds: ['holdout'], sourceManifest: { engineCommit: 'test-source' },
      budgetPolicy: { ...normalizeSurveyResources({ residentWorlds: 4, maxTotalTicks: 10000, maxTotalMs: 10000 }), frozenFinalistIds: [candidates[0].id, candidates[2].id], maxExemplarVerificationTrials: 4 }, criteria: { samplingSeed: 1 } });
  };
  it('retains raw originals, exactly verifies finalists, and resumes without rerunning finished work', async () => {
    const manifest = declaration(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest), states = [];
    const report = await runSurveyExperiment(manifest, store, { onState: get => states.push(get().status) });
    expect(report.status, JSON.stringify({ reason: report.reason, verification: report.verification })).to.equal('complete'); expect(report.results).to.have.length(18); expect(report.verification).to.have.length(4); expect(report.verification.every(check => check.matched)).to.equal(true);
    const finalist = report.results.find(result => result.validity.deterministic === true); expect((await store.completed(finalist.trialId)).validity.deterministic).to.equal(null);
    expect(report.rankingsTrusted).to.equal(false); expect(states).to.include('held-out');
    expect(report.admissions).to.have.length(report.persistenceReceipts.length);
    expect(report.admissions.every(receipt => receipt.status === 'admitted' && receipt.stage && receipt.workerGeneration && receipt.runGeneration)).to.equal(true);
    expect(report.persistenceReceipts.every(receipt => receipt.workerReceiptStatus === 'acknowledged' && receipt.publicationStatus === 'callback-reported' && receipt.publication?.durability)).to.equal(true);
    await store.writeDerivative('report.json', report);
    const firstBytes = store.snapshot().bytes;
    const resumed = await runSurveyExperiment(manifest, store); expect(resumed.status).to.equal('complete'); expect(resumed.execution.admittedTicks).to.equal(0); expect(store.snapshot().bytes).to.equal(firstBytes); expect(resumed.telemetry).to.deep.equal(report.telemetry); expect(resumed.performance).to.deep.equal(report.performance); expect(resumed.priorExecution).to.deep.equal(report.execution);
    expect(resumed.results.map(result => result.finalStateHash)).to.deep.equal(report.results.map(result => result.finalStateHash));
    expect(resumed.admissions).to.deep.equal(report.admissions); expect(resumed.persistenceReceipts).to.deep.equal(report.persistenceReceipts);
  });
  it('finalizes and resumes a holdout-only success without treating observed worlds as independent', async () => {
    const source = declaration(), scenarios = source.scenarios.map(scenario => normalizeSurveyScenario({ ...scenario,
      goal: { x: 0, y: 0, width: 2048, height: 6144 } }));
    const manifest = createProcgenSurveyExperiment({ ...source, scenarios, budgetPolicy: { ...source.budgetPolicy,
      maxTotalTicks: 50000, maxExemplarVerificationTrials: 18,
      successQualification: { maxOriginals: 1, maxTrials: 12, maxPhysicalTrials: 24, policySeeds: [1, 2, 3], nearbyAdmissionOffsets: [] } } });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest); let dispatched = 0;
    // Exercise the real coordinator, selector, evidence writer and replay checker
    // with controlled worker delivery. Only the irrelevant skill metric is varied
    // to make the holdout the sole selected success; physics and replay evidence
    // come from actual bounded Node trials in this fixture.
    const runJobs = async (jobs, { onResult }) => {
      for (const job of jobs) {
        dispatched++; const trial = await createNodeSurveyTrial(job);
        let result; try { trial.step(job.scenario.horizonTicks); result = trial.result(); } finally { trial.dispose(); }
        result = { ...result, metrics: { ...result.metrics, skillCount: job.scenario.id === 'holdout' && job.candidate.id === manifest.candidates[0].id ? 10 : 0 } };
        await onResult(result, { id: job.attemptId }, { signal: new AbortController().signal });
      }
      return {};
    };
    const report = await runSurveyExperiment(manifest, store, { runJobs });
    expect(report.status, JSON.stringify({ reason: report.reason, verification: report.verification })).to.equal('complete'); expect(report.incompleteTrials).to.deep.equal([]);
    expect(report.results).to.have.length(18);
    const successes = report.exemplars.selected.filter(item => item.kind === 'success'); expect(successes).to.have.length(1);
    const qualification = report.successQualification[0]; expect(qualification.originalTrialId).to.equal(successes[0].trialId);
    expect(qualification.plan.jobs.some(job => job.stage === 'independent-holdout')).to.equal(false);
    expect(qualification.plan.deferred).to.deep.equal([{ stage: 'independent-holdout', reason: 'original-selected-from-holdout' }]);
    expect(qualification.summary.interpretation).not.to.equal('tested-scope-improvement'); expect(qualification.summary.incomplete).to.equal(true);
    const archived = await store.read('exemplars/' + successes[0].trialId + '.json'); expect(archived.original).to.deep.equal(await store.completed(successes[0].trialId));
    await store.writeDerivative('report.json', report); const before = dispatched;
    const resumed = await runSurveyExperiment(manifest, store, { runJobs });
    expect(resumed.status).to.equal('complete'); expect(dispatched).to.equal(before);
    expect(resumed.verification.every(receipt => receipt.matched)).to.equal(true);
    expect(resumed.successQualification).to.deep.equal(report.successQualification);
    expect(resumed.results.map(result => result.trialId)).to.deep.equal(report.results.map(result => result.trialId));
  });
  it('rejects an execution manifest that differs from the evidence owner before worker admission', async () => {
    const manifest = declaration(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest), bytes = store.snapshot().bytes;
    let admitted = 0, rejected;
    try { await runSurveyExperiment({ ...manifest, criteria: { ...manifest.criteria, samplingSeed: 9 } }, store, { onControlReady: () => { admitted++; } }); }
    catch (error) { rejected = error; }
    expect(rejected).to.be.instanceOf(SurveyExperimentIdentityError); expect(admitted).to.equal(0);
    expect(await store.read('manifest.json')).to.deep.equal(manifest); expect(store.snapshot().bytes).to.equal(bytes);
  });
  it('keeps a legacy declared state schema unqualified instead of normalizing it silently', async () => {
    const manifest = declaration(), legacy = { ...manifest, scenarios: manifest.scenarios.map(scenario => ({ ...scenario, stateSchema: 2 })) };
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(legacy); let admitted = 0, rejected;
    try { await runSurveyExperiment(legacy, store, { onControlReady: () => { admitted++; } }); } catch (error) { rejected = error; }
    expect(rejected).to.be.instanceOf(SurveyExperimentIdentityError); expect(rejected.message).to.include('Legacy survey state');
    expect(admitted).to.equal(0); expect(await store.read('manifest.json')).to.deep.equal(legacy);
  });
  it('reports cancellation as incomplete and retains explicit queued identities', async () => {
    const manifest = declaration(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest), controller = new AbortController(); controller.abort();
    const report = await runSurveyExperiment(manifest, store, { signal: controller.signal });
    expect(report.status).to.equal('interrupted'); expect(report.incompleteTrials).to.have.length(18); expect(report.incompleteTrials.every(record => record.status === 'not-run')).to.equal(true);
    expect(report.results).to.have.length(0);
  });
  it('dispatches a Step queued before worker controls exist and presents the aggregate receipt', async () => {
    const manifest = declaration(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest); let controls, queued, observed;
    const report = await runSurveyExperiment(manifest, store, { onControlReady: value => { controls = value; queued = controls.step(); }, onState: get => {
      const state = get(); if (!observed && state.controlState.stepStatus === 'reached') { observed = state.controlState; controls.cancel(); }
    } });
    expect(queued).to.include({ paused: true, queued: true, stepPending: true, reachedCheckpoint: null });
    expect(observed.stepReceipt.status).to.equal('reached'); expect(observed.selected).to.have.length(4);
    expect(observed.selected.every(value => value.tick === 64 && value.attemptId)).to.equal(true); expect(observed.reachedCheckpoint).to.equal(64);
    expect(report.status).to.equal('interrupted'); expect(report.controlReceipts).to.have.length(1);
    expect(report.controlReceipts[0]).to.include({ stage: 'development', status: 'reached', reachedCheckpoint: 64 });
  });
  it('reconciles a complete retained attempt before admitting replacement simulation on resume', async () => {
    const manifest = declaration(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest), scenario = manifest.scenarios[0], candidate = manifest.candidates[0];
    const trialId = createSurveyTrialId(scenario, candidate), trial = await createNodeSurveyTrial({ scenario, candidate, trialId, attemptId: 'crashed' });
    trial.step(scenario.horizonTicks); const original = trial.result(); trial.dispose();
    await store.writeImmutable('attempts/' + trialId + '-crashed.json', { result: original, attempt: { id: 'crashed', performance: { measuredTicks: scenario.horizonTicks } } });
    let controls;
    const report = await runSurveyExperiment(manifest, store, { onControlReady: value => { controls = value; }, onState: get => { if (get().status === 'development') controls.cancel(); } });
    expect(report.status).to.equal('interrupted'); expect(report.admissions).to.deep.equal([]); expect(report.results).to.have.length(1);
    expect(report.results[0]).to.deep.equal(original); expect(await store.completed(trialId)).to.deep.equal(original);
    expect(report.recoveryReceipts[0]).to.include({ status: 'recovered-from-complete-attempt', trialId, stage: 'development', attemptReference: 'attempts/' + trialId + '-crashed.json' });
    expect(report.attempts[0].id).to.equal('crashed'); expect(report.performance[0].measuredTicks).to.equal(scenario.horizonTicks);
  });
});
