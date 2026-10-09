import { expect } from 'chai';
import { runSurveyJobs } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { normalizeSurveyScenario, createSurveyTrialId } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { compareSurveyReplay } from '../js/app/procgen/survey/ProcgenSurveyReplay.js';

const scene = normalizeSurveyScenario({ id: 'worker-order-flat-eight', horizonTicks: 128, cohort: { size: 8, birthInterval: 4 }, goal: { x: 80, y: 64, width: 256, height: 16 } });
const jobs = () => Array.from({ length: 4 }, (_, index) => {
  const candidate = { id: 'baseline-copy-' + index, kind: 'baseline', configuration: {} };
  return { scenario: scene, candidate, trialId: createSurveyTrialId(scene, candidate), attemptId: 'attempt-' + index };
});
describe('real isolated procgen survey workers', function() {
  this.timeout(15000);
  it('matches across CPU worker counts, job order, residency and dashboard polling', async () => {
    const first = await runSurveyJobs(jobs(), { executionWorkers: 1, residentWorlds: 4, checkpointTicks: 32, maxTotalMs: 10000 });
    let reads = 0;
    const second = await runSurveyJobs(jobs().reverse(), { executionWorkers: 2, residentWorlds: 2, checkpointTicks: 64, maxTotalMs: 10000, onTelemetry: () => { reads++; } });
    expect(first.error).to.equal(null); expect(second.error).to.equal(null); expect(reads).to.be.greaterThan(0);
    expect(first.results).to.have.length(4); expect(second.results).to.have.length(4);
    for (const original of first.results) {
      const replay = second.results.find(result => result.trialId === original.trialId);
      expect(compareSurveyReplay(original, replay).matched).to.equal(true); expect(original.accounting).to.include({ designated: 8, admitted: 8, alive: 8, deaths: 0 });
    }
    expect(new Set(first.results.map(result => result.finalPhysicalStateHash)).size).to.equal(1);
  });
  it('cancels queued work explicitly and reproduces the same identities on restart', async () => {
    const controller = new AbortController(); controller.abort();
    const cancelled = await runSurveyJobs(jobs(), { signal: controller.signal, maxTotalMs: 10000 });
    expect(cancelled.results).to.have.length(4); expect(cancelled.results.every(result => ['cancelled', 'interrupted'].includes(result.status))).to.equal(true);
    expect(cancelled.results.every(result => !result.episodeComplete)).to.equal(true);
    const resumed = await runSurveyJobs(jobs(), { maxTotalMs: 10000 }); expect(resumed.results.every(result => result.status === 'completed')).to.equal(true);
    expect(resumed.results.map(result => result.trialId).sort()).to.deep.equal(cancelled.results.map(result => result.trialId).sort());
  });
  it('rejects total simulation over-budget before any worker admission', async () => {
    let updates = 0;
    try { await runSurveyJobs(jobs(), { maxTotalTicks: 127, onTelemetry: () => updates++ }); throw new Error('unexpected admission'); } catch (error) { expect(error.message).to.include('simulation budget'); }
    expect(updates).to.equal(0);
  });
});
