import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSurveyExperiment } from '../scripts/procgen-survey/SurveyCoordinator.js';
import { SurveyEvidenceStore } from '../scripts/procgen-survey/SurveyEvidenceStore.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { generateProcgenSurveyCandidates, createProcgenSurveyExperiment } from '../js/app/procgen/survey/ProcgenSurveyCandidates.js';
import { normalizeSurveyResources } from '../scripts/procgen-survey/SurveyWorkerPool.js';

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
    expect(report.status).to.equal('complete'); expect(report.results).to.have.length(18); expect(report.verification).to.have.length(4); expect(report.verification.every(check => check.matched)).to.equal(true);
    const finalist = report.results.find(result => result.validity.deterministic === true); expect((await store.completed(finalist.trialId)).validity.deterministic).to.equal(null);
    expect(report.rankingsTrusted).to.equal(false); expect(states).to.include('held-out');
    await store.writeDerivative('report.json', report);
    const firstBytes = store.snapshot().bytes;
    const resumed = await runSurveyExperiment(manifest, store); expect(resumed.status).to.equal('complete'); expect(resumed.execution.admittedTicks).to.equal(0); expect(store.snapshot().bytes).to.equal(firstBytes); expect(resumed.telemetry).to.deep.equal(report.telemetry); expect(resumed.performance).to.deep.equal(report.performance); expect(resumed.priorExecution).to.deep.equal(report.execution);
    expect(resumed.results.map(result => result.finalStateHash)).to.deep.equal(report.results.map(result => result.finalStateHash));
  });
  it('reports cancellation as incomplete and retains explicit queued identities', async () => {
    const manifest = declaration(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-coordinator-'));
    const store = await new SurveyEvidenceStore(directory).initialize(manifest), controller = new AbortController(); controller.abort();
    const report = await runSurveyExperiment(manifest, store, { signal: controller.signal });
    expect(report.status).to.equal('interrupted'); expect(report.incompleteTrials).to.have.length(18); expect(report.incompleteTrials.every(record => record.status === 'not-run')).to.equal(true);
    expect(report.results).to.have.length(0);
  });
});
