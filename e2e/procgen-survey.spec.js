import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { generateProcgenSurveyCandidates } from '../js/app/procgen/survey/ProcgenSurveyCandidates.js';
import { createSurveyTrialId } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { createSurveyServer } from '../scripts/procgen-survey/SurveyServer.js';
import { runSurveyJobs } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyScenario.js';

test.use({ permissions: [] });
test.describe('procgen survey native boundary', () => {
  test('matches real controlled and source replay, keeps tile focus, and renders 64 queued logical candidates @boundary', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const filename = process.env.LEMMINGS_SURVEY_REPORT; if (!filename) throw new Error('Set LEMMINGS_SURVEY_REPORT to the completed bounded qualification report');
    const report = JSON.parse(await fs.readFile(filename, 'utf8')).value, errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.__surveyOutputRequests = { midi: 0, audio: 0 }; navigator.requestMIDIAccess = () => { window.__surveyOutputRequests.midi++; throw new Error('Survey must stay muted'); }; window.AudioContext = class { constructor() { window.__surveyOutputRequests.audio++; throw new Error('Survey must stay muted'); } }; });
    await page.goto('/procgen-survey.html'); await page.locator('#surveyFile').setInputFiles(filename);
    await expect(page.locator('.survey-tile:visible')).toHaveCount(16);
    const first = page.locator('.survey-tile:visible').first(); await first.focus(); const identity = await first.getAttribute('data-trial-id');
    await page.evaluate(() => { const dashboard = window.__procgenSurveyDashboard; dashboard.load(dashboard.getReport()); dashboard.render(); });
    expect(await page.evaluate(() => document.activeElement.dataset.trialId)).toBe(identity);
    const replays = [];
    for (const scene of ['flat-ordinary-eight', 'heldout-source-902']) {
      await page.locator('#surveyScene').selectOption(scene);
      const original = report.results.find(result => result.scenarioId === scene && result.candidate.kind === 'baseline');
      await page.evaluate(id => { delete window.__procgenSurveyReplayReceipt; window.__procgenSurveyDashboard.select(id); }, original.trialId);
      await page.locator('#surveyReplay').click(); await expect.poll(() => page.evaluate(() => window.__procgenSurveyReplayReceipt), { timeout: 30000 }).toBeTruthy();
      const receipt = await page.evaluate(() => window.__procgenSurveyReplayReceipt); expect(receipt.matched).toBe(true); expect(receipt.independentSample).toBe(false); replays.push(receipt);
    }
    await expect(page.locator('.survey-tile:visible')).toHaveCount(2);
    const candidates = generateProcgenSurveyCandidates({ count: 64 }), scenario = report.manifest.scenarios[0];
    const queued = candidates.map(candidate => ({ trialId: createSurveyTrialId(scenario, candidate), scenarioId: scenario.id, candidateId: candidate.id, scenario, candidate, policySeed: 1, status: 'queued', lastTick: 0 }));
    await page.evaluate(value => window.__procgenSurveyDashboard.load(value), { ...report, manifest: { ...report.manifest, experimentId: 'native64-layout-only', candidates }, results: queued, telemetry: [], status: 'queued-layout-only', exemplars: null, verification: [] });
    await expect(page.locator('.survey-tile:visible')).toHaveCount(64); await expect(page.locator('#surveyMosaic')).toHaveClass('dense'); await expect(page.locator('#surveyReplay')).toBeDisabled();
    expect(await page.locator('#surveyMosaic').evaluate(element => window.getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(8);
    const outputRequests = await page.evaluate(() => window.__surveyOutputRequests); expect(outputRequests).toEqual({ midi: 0, audio: 0 }); expect(errors).toEqual([]);
    await testInfo.attach('survey-native-parity.json', { body: JSON.stringify({ sourceDigest: report.manifest.sourceManifest.codeDigest, replays, outputRequests, errors, layout64Only: true }), contentType: 'application/json' });
  });
  test('routes visible pause/step/cancel controls to bounded resident worlds without changing their clock @boundary', async ({ page }, testInfo) => {
    test.setTimeout(30000);
    const candidates = generateProcgenSurveyCandidates({ count: 16 }), scenario = normalizeSurveyScenario({ id: 'native-controls', horizonTicks: 4096, cohort: { size: 8 }, goal: { x: 80, y: 64, width: 512, height: 16 } });
    const manifest = { experimentId: 'native-control-only', scenarios: [scenario], developmentScenarioIds: [scenario.id], candidates, budgetPolicy: { executionWorkers: 1, residentWorlds: 16 } };
    const jobs = candidates.map(candidate => ({ scenario, candidate, trialId: createSurveyTrialId(scenario, candidate), attemptId: 'native-control-' + candidate.id })), telemetry = new Map(), results = [], states = [];
    let controls, lastState = {}, pool;
    const snapshot = () => ({ schemaVersion: 1, manifest, status: 'control-qualification', results: jobs.map(job => results.find(result => result.trialId === job.trialId) || { ...job, scenarioId: scenario.id, candidateId: job.candidate.id, status: telemetry.has(job.trialId) ? 'running' : 'queued', lastTick: telemetry.get(job.trialId)?.tick || 0, accounting: telemetry.get(job.trialId)?.accounting, telemetry: telemetry.get(job.trialId) }), telemetry: [...telemetry], controlState: lastState });
    const server = await createSurveyServer({ getState: snapshot, onControl: command => { states.push(command); return controls[command](); } });
    try {
      pool = runSurveyJobs(jobs, { paused: true, residentWorlds: 16, maxTotalTicks: 100000, maxTotalMs: 20000, checkpointTicks: 64, sliceTicks: 1,
        onControlReady: value => { controls = value; }, onControlState: state => { lastState = state; }, onTelemetry: (id, value) => { telemetry.set(id, value); }, onResult: result => { results.push(result); } });
      await page.goto(server.url + '#token=' + server.token); await expect(page.locator('.survey-tile:visible')).toHaveCount(16);
      // Pool began paused before admissions. Resume through the same native control.
      await expect(page.locator('#surveyPause')).toHaveText('Resume all'); await page.locator('#surveyPause').click();
      await expect.poll(() => telemetry.size).toBeGreaterThan(0); await page.locator('#surveyPause').click();
      await expect.poll(() => lastState.paused).toBe(true); await page.locator('#surveyStep').click();
      await expect.poll(() => lastState.reachedCheckpoint).toBeTruthy();
      expect(lastState.ticks.every(record => record.tick === lastState.reachedCheckpoint)).toBe(true);
      await page.locator('#surveyCancel').click(); const outcome = await pool; expect(outcome.cancelled).toBe(true); expect(outcome.results).toHaveLength(16);
      expect(outcome.results.every(result => !result.episodeComplete)).toBe(true); expect(states).toEqual(['resume', 'pause', 'step', 'cancel']);
      await testInfo.attach('survey-native-controls.json', { body: JSON.stringify({ states, lastState, statuses: outcome.results.map(result => ({ trialId: result.trialId, status: result.status, lastTick: result.lastTick })) }), contentType: 'application/json' });
    } finally { controls?.cancel(); await pool; await server.close(); }
  });
});
