import { MIN_DESKTOP_VIEWPORT } from './helpers/desktopViewports.js';
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { generateProcgenSurveyCandidates } from '../js/app/procgen/survey/ProcgenSurveyCandidates.js';
import { createSurveyTrialId } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { createSurveyServer } from '../scripts/procgen-survey/SurveyServer.js';
import { runSurveyJobs } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { createSurveySourceManifest, createNodeSurveyTrial } from '../scripts/procgen-survey/SurveyNodeWorld.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyScenario.js';
import { createBrowserSurveyFixtureReport } from './helpers/surveyReport.js';

test.use({ permissions: [] });
test.describe('procgen survey native boundary', () => {
  test('matches real controlled and source replay, keeps tile focus, and renders 64 queued logical candidates @boundary', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const filename = process.env.LEMMINGS_SURVEY_REPORT;
    const report = filename ? JSON.parse(await fs.readFile(filename, 'utf8')).value : await createBrowserSurveyFixtureReport(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.__surveyOutputRequests = { midi: 0, audio: 0 }; navigator.requestMIDIAccess = () => { window.__surveyOutputRequests.midi++; throw new Error('Survey must stay muted'); }; window.AudioContext = class { constructor() { window.__surveyOutputRequests.audio++; throw new Error('Survey must stay muted'); } }; });
    await page.goto('/procgen-survey.html'); await page.locator('#surveyFile').setInputFiles({ name: 'browser-survey.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ value: report })) });
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
      const receipt = await page.evaluate(() => window.__procgenSurveyReplayReceipt); expect(receipt.matched).toBe(false); expect(receipt.compatibilityMatch).toBe(true);
      expect(receipt.executionIdentity.status).toBe('unbound'); expect(receipt.independentSample).toBe(false); replays.push(receipt);
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
      await expect.poll(() => lastState.stepReceipt?.status).toBe('reached');
      expect(lastState.stepReceipt.selected.every(record => record.tick === lastState.stepReceipt.reachedCheckpoint)).toBe(true);
      await expect(page.locator('#surveyStepReceipt')).toContainText(`Reached checkpoint tick ${lastState.stepReceipt.reachedCheckpoint}`);
      await expect(page.locator('#surveyStepSelection')).toContainText(jobs[0].trialId);
      await page.locator('#surveyCancel').click(); const outcome = await pool; expect(outcome.cancelled).toBe(true); expect(outcome.results).toHaveLength(16);
      expect(outcome.results.every(result => !result.episodeComplete)).toBe(true); expect(states).toEqual(['resume', 'pause', 'step', 'cancel']);
      await testInfo.attach('survey-native-controls.json', { body: JSON.stringify({ states, lastState, statuses: outcome.results.map(result => ({ trialId: result.trialId, status: result.status, lastTick: result.lastTick })) }), contentType: 'application/json' });
    } finally { controls?.cancel(); await pool; await server.close(); }
  });
});

const reviewFixture = () => {
  const scenario = { id: 'recorded-scene', laneHeight: 144 };
  const candidates = [{ id: 'candidate-a', family: 'Baseline', kind: 'baseline' }, { id: 'candidate-b', family: 'Exploration', kind: 'candidate' }];
  const telemetry = tick => ({ preview: { tick, actors: [{ x: tick, y: 70 }], geometry: { solid: [{ x: 0, y: 72, width: 512, height: 72 }] } } });
  return { schemaVersion: 1, manifest: { experimentId: 'ui-recording-only', scenarios: [scenario], developmentScenarioIds: [scenario.id], candidates, budgetPolicy: { executionWorkers: 1, residentWorlds: 2 } },
    results: candidates.map((candidate, index) => ({ trialId: candidate.id, candidateId: candidate.id, candidate, scenario, scenarioId: scenario.id, policySeed: 1, status: 'completed', episodeComplete: false, lastTick: 64, accounting: { designated: 8, alive: 8, arrived: index ? 8 : 4, deaths: 0 }, milestones: [0, 32, 64].map(tick => ({ tick, telemetry: telemetry(tick) })) })) };
};

test.describe('survey recorded review interactions', () => {
  test('keeps selection, keyboard order and empty comparisons consistent', async ({ page }) => {
    await page.goto('/procgen-survey.html');
    await expect(page.locator('#surveyReplay')).toBeDisabled();
    await expect(page.locator('#surveyPause')).toBeDisabled();
    await page.evaluate(value => window.__procgenSurveyDashboard.load(value), reviewFixture());
    await expect(page.locator('#surveyTick')).toHaveText('Tick 64');
    await expect(page.locator('#surveyStep')).toBeDisabled();
    await expect(page.locator('.survey-tile').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#surveySort').selectOption('completion');
    await expect(page.locator('.survey-tile').first()).toHaveAttribute('data-trial-id', 'candidate-b');
    await page.locator('.survey-tile').first().focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.survey-tile').first()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(page.locator('.survey-tile').nth(1)).toBeFocused();
    await page.locator('#surveyScrub').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#surveyTick')).toHaveText('Tick 0');
    await page.locator('#surveyStep').click();
    await expect(page.locator('#surveyTick')).toHaveText('Tick 32');
    await page.evaluate(() => { const dashboard = window.__procgenSurveyDashboard; dashboard.load(dashboard.getReport()); });
    await expect(page.locator('#surveyTick')).toHaveText('Tick 32');
    await page.locator('#surveyFilter').selectOption('failure');
    await expect(page.locator('.survey-tile:visible')).toHaveCount(0);
    await expect(page.locator('#surveyEmpty')).toBeVisible();
    await expect(page.locator('#surveyFocusTitle')).toHaveText('No trial selected');
    await expect(page.locator('#surveyDetails')).toHaveText('');
    await expect(page.locator('#surveyStep')).toBeDisabled();
    await expect(page.locator('#surveyDivergence')).toBeDisabled();
    await page.locator('#surveyFilter').selectOption('all');
    await expect(page.locator('#surveyTick')).toHaveText('Tick 64');
  });

  test('explains an absent baseline and fits the supported desktop review viewport', async ({ page }) => {
    await page.setViewportSize(MIN_DESKTOP_VIEWPORT);
    await page.goto('/procgen-survey.html');
    const report = reviewFixture(); report.results = report.results.slice(1);
    await page.evaluate(value => window.__procgenSurveyDashboard.load(value), report);
    await expect(page.locator('#surveyBaselineStatus')).toContainText('No paired baseline');
    await expect(page.locator('#surveyDivergence')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('.survey-tile').focus();
    await page.evaluate(() => { const dashboard = window.__procgenSurveyDashboard; dashboard.load(dashboard.getReport()); });
    await expect(page.locator('.survey-tile')).toBeFocused();
  });

  test('keeps the pause label truthful when the server rejects a control', async ({ page }) => {
    await page.route('**/survey-api/report', route => route.fulfill({ json: { ...reviewFixture(), controlState: { paused: false } } }));
    await page.route('**/survey-api/control', route => route.fulfill({ status: 403 }));
    await page.goto('/procgen-survey.html#token=local-test');
    await expect(page.locator('.survey-tile')).toHaveCount(2);
    await page.locator('#surveyPause').click();
    await expect(page.locator('#surveyStatus')).toHaveText('Survey control was rejected');
    await expect(page.locator('#surveyPause')).toHaveText('Pause all');
    await expect(page.locator('#surveyPause')).toBeEnabled();
  });
});


test('offline replay pause follows active playback and resets after completion', async ({ page }) => {
  await page.route('**/ProcgenSurveyBrowserAssets.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const createBrowserSurveyTrial = async () => {
      await new Promise(resolve => { window.__releaseReplaySetup = resolve; });
      const world = { tickIndex: 0 };
      window.__stubReplayWorld = world;
      return { world, get done() { return !!window.__finishStubReplay; },
        step(count) { world.tickIndex += count; }, telemetry() { return {}; }, preview() { return {}; },
        result() { return {}; }, dispose() { window.__stubReplayDisposed = true; } };
    };` }));
  await page.goto('/procgen-survey.html');
  const report = reviewFixture(); report.results[0].episodeComplete = true; report.results[0].scenario.horizonTicks = 100000;
  await page.evaluate(value => window.__procgenSurveyDashboard.load(value), report);
  const pause = page.locator('#surveyPause');
  await expect(pause).toBeDisabled();
  await expect(pause).toHaveText('Pause replay');
  await page.locator('#surveyReplay').click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReplaySetup)).toBe('function');
  await expect(pause).toBeDisabled();
  await page.evaluate(() => window.__releaseReplaySetup());
  await expect(pause).toBeEnabled();
  await pause.click();
  await expect(pause).toHaveText('Resume replay');
  const pausedTick = await page.evaluate(() => window.__stubReplayWorld.tickIndex);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 120)));
  expect(await page.evaluate(() => window.__stubReplayWorld.tickIndex)).toBe(pausedTick);
  await pause.click();
  await expect(pause).toHaveText('Pause replay');
  await expect.poll(() => page.evaluate(() => window.__stubReplayWorld.tickIndex)).toBeGreaterThan(pausedTick);
  await page.evaluate(() => { window.__finishStubReplay = true; });
  await expect(pause).toBeDisabled();
  await expect(page.locator('#surveyReplay')).toBeEnabled();
  expect(await page.evaluate(() => window.__stubReplayDisposed)).toBe(true);
});

test.describe('survey report and replay ownership', () => {
  test('newer files win over delayed files and URL reports; malformed replacement is atomic', async ({ page }) => {
    let releaseUrl;
    await page.route(url => url.pathname === '/temp/procgen-surveys/delayed.json', async route => {
      await new Promise(resolve => { releaseUrl = resolve; });
      await route.fulfill({ json: reviewFixture() });
    });
    await page.goto('/procgen-survey.html?report=/temp/procgen-surveys/delayed.json');
    await expect.poll(() => !!releaseUrl).toBe(true);
    await page.evaluate(() => {
      window.__fileReads = {};
      File.prototype.text = function() { return new Promise(resolve => { window.__fileReads[this.name] = resolve; }); };
    });
    const input = page.locator('#surveyFile');
    await input.setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await input.setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    const latest = reviewFixture(); latest.manifest.experimentId = 'newest-report';
    await page.evaluate(value => window.__fileReads['new.json'](JSON.stringify(value)), latest);
    await expect.poll(() => page.evaluate(() => window.__procgenSurveyDashboard.getReport()?.manifest.experimentId)).toBe('newest-report');
    await page.evaluate(value => window.__fileReads['old.json'](JSON.stringify(value)), reviewFixture());
    releaseUrl();
    await page.waitForResponse('**/temp/procgen-surveys/delayed.json');
    await expect.poll(() => page.evaluate(() => window.__procgenSurveyDashboard.getReport()?.manifest.experimentId)).toBe('newest-report');
    const invalid = { ...latest, results: [...latest.results, latest.results[0]] };
    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.evaluate(value => window.__fileReads['bad.json'](JSON.stringify(value)), invalid);
    await expect(page.locator('#surveyStatus')).toHaveText('Unsupported or oversized survey report');
    await expect(page.locator('.survey-tile')).toHaveCount(2);
    expect(await page.evaluate(() => window.__procgenSurveyDashboard.getReport().manifest.experimentId)).toBe('newest-report');
  });

  test('a changed manifest with the same experiment ID replaces scene and trial identity', async ({ page }) => {
    await page.goto('/procgen-survey.html');
    const original = reviewFixture();
    await page.evaluate(value => window.__procgenSurveyDashboard.load(value), original);
    const changed = reviewFixture(); changed.manifest.scenarios[0].id = 'replacement-scene'; changed.manifest.developmentScenarioIds = ['replacement-scene'];
    changed.results.forEach(result => { result.scenarioId = 'replacement-scene'; });
    await page.evaluate(value => window.__procgenSurveyDashboard.load(value), changed);
    await expect(page.locator('#surveyScene option')).toHaveCount(1);
    await expect(page.locator('#surveyScene')).toHaveValue('replacement-scene');
    await expect(page.locator('#surveyFocusTitle')).toContainText('replacement-scene');
    await expect(page.locator('.survey-tile:visible')).toHaveCount(2);
  });

  test('a saved file detaches live controls and ignores a pending live report', async ({ page }) => {
    let releasePoll;
    await page.route('**/survey-api/report', async route => {
      await new Promise(resolve => { releasePoll = resolve; });
      await route.fulfill({ json: reviewFixture() });
    });
    await page.goto('/procgen-survey.html#token=local-test');
    await expect.poll(() => !!releasePoll).toBe(true);
    const saved = reviewFixture(); saved.manifest.experimentId = 'saved-review';
    await page.locator('#surveyFile').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await expect(page.locator('#surveyMode')).toHaveText('Saved report review');
    await expect(page.locator('#surveyCancel')).toBeDisabled();
    await expect(page.locator('#surveyPause')).toBeDisabled();
    releasePoll(); await page.waitForResponse('**/survey-api/report');
    expect(await page.evaluate(() => window.__procgenSurveyDashboard.getReport().manifest.experimentId)).toBe('saved-review');
  });

  test('obsolete replay setup cannot paint, publish a receipt or dispose a newer replay', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/ProcgenSurveyBrowserAssets.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export const createBrowserSurveyTrial = async ({ candidate }) => {
        window.__setups ||= {}; window.__trials ||= {};
        const trial = { world: { tickIndex: 0 }, done: false, steps: 0, disposals: 0,
          step(count) { this.steps++; this.world.tickIndex += count; }, telemetry() { return {}; }, preview() { return {}; },
          result() { return {}; }, dispose() { this.disposals++; } };
        window.__trials[candidate.id] = trial;
        await new Promise(resolve => { window.__setups[candidate.id] = resolve; }); return trial;
      };` }));
    await page.goto('/procgen-survey.html');
    const report = reviewFixture(); report.results.forEach(result => { result.episodeComplete = true; result.scenario.horizonTicks = 100000; });
    await page.evaluate(value => window.__procgenSurveyDashboard.load(value), report);
    await page.locator('#surveyReplay').click();
    await expect.poll(() => page.evaluate(() => !!window.__setups?.['candidate-a'])).toBe(true);
    await page.locator('[data-trial-id="candidate-b"]').click();
    await expect(page.locator('#surveyReplay')).toBeEnabled();
    await page.locator('#surveyReplay').click();
    await page.evaluate(() => window.__setups['candidate-b']());
    await expect(page.locator('#surveyPause')).toBeEnabled();
    await page.locator('#surveyPause').click();
    await page.evaluate(() => window.__setups['candidate-a']());
    await expect.poll(() => page.evaluate(() => window.__trials['candidate-a'].disposals)).toBe(1);
    expect(await page.evaluate(() => ({ steps: window.__trials['candidate-a'].steps, currentDisposed: window.__trials['candidate-b'].disposals, receipt: !!window.__procgenSurveyReplayReceipt }))).toEqual({ steps: 0, currentDisposed: 0, receipt: false });
    await expect(page.locator('#surveyPause')).toHaveText('Resume replay');
    await expect(page.locator('#surveyReplay')).toBeDisabled();
    await page.evaluate(() => window.__procgenSurveyDashboard.dispose());
    await expect.poll(() => page.evaluate(() => window.__trials['candidate-b'].disposals)).toBe(1);
    expect(await page.evaluate(() => window.__procgenSurveyReplayReceipt)).toBeUndefined();
    expect(errors).toEqual([]);
  });
});


test('saved reports compare current muted controlled and generated trials with explicit source uncertainty and reject changed assets', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const scenes = [normalizeSurveyScenario({ id: 'saved-controlled', horizonTicks: 64 }),
    normalizeSurveyScenario({ id: 'saved-generated', mode: 'generated', pack: 'lemmings_ohNo', groundSet: 0, horizonTicks: 64, laneHeight: 144 })];
  const sourceManifest = await createSurveySourceManifest(scenes), candidate = generateProcgenSurveyCandidates({ count: 16 })[0], receipts = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__surveyOutputRequests = { midi: 0, audio: 0 };
    navigator.requestMIDIAccess = () => { window.__surveyOutputRequests.midi++; throw new Error('Unexpected MIDI'); };
    window.AudioContext = class { constructor() { window.__surveyOutputRequests.audio++; throw new Error('Unexpected audio'); } };
  });
  await page.goto('/procgen-survey.html');
  for (const raw of scenes) {
    const scenario = normalizeSurveyScenario({ ...raw, engineCommit: sourceManifest.engineCommit, assetHashes: sourceManifest.assetHashes });
    const trial = await createNodeSurveyTrial({ scenario, candidate });
    let result;
    try { trial.step(scenario.horizonTicks); result = trial.result(); } finally { trial.dispose(); }
    expect(result.episodeComplete).toBe(true);
    const report = { schemaVersion: 1, manifest: { experimentId: 'saved-' + scenario.id, sourceManifest, scenarios: [scenario], candidates: [candidate], developmentScenarioIds: [scenario.id], budgetPolicy: { executionWorkers: 1, residentWorlds: 1 } }, results: [result] };
    await page.locator('#surveyFile').setInputFiles({ name: scenario.id + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ value: report })) });
    await page.locator('#surveyReplay').click();
    await expect.poll(() => page.evaluate(() => window.__procgenSurveyReplayReceipt), { timeout: 30000 }).toBeTruthy();
    const receipt = await page.evaluate(() => window.__procgenSurveyReplayReceipt);
    expect(receipt.matched).toBe(false); expect(receipt.compatibilityMatch).toBe(true);
    expect(receipt.executionIdentity.status).toBe('unbound'); expect(receipt.independentSample).toBe(false); receipts.push(receipt);
  }
  await page.route('**/js/app/procgen/survey/ProcgenSurveyCore.js', route => route.fulfill({ contentType: 'text/javascript', body: '// changed source bytes' }));
  await page.evaluate(() => { delete window.__procgenSurveyReplayReceipt; });
  await page.locator('#surveyReplay').click();
  await expect.poll(() => page.evaluate(() => window.__procgenSurveyReplayReceipt), { timeout: 30000 }).toBeTruthy();
  await expect(page.locator('#surveyReplayStatus')).toContainText('The active build is unverified', { timeout: 30000 });
  expect(await page.evaluate(() => window.__procgenSurveyReplayReceipt)).toMatchObject({ matched: false, compatibilityMatch: true, executionIdentity: { status: 'unbound' } });
  const asset = Object.keys(sourceManifest.assetHashes)[0];
  await page.route('**/' + asset, route => route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from([0]) }));
  await page.locator('#surveyReplay').click();
  await expect(page.locator('#surveyReplayStatus')).toContainText('Replay source differs from the saved trial', { timeout: 30000 });
  expect(await page.evaluate(() => window.__procgenSurveyReplayReceipt)).toBeUndefined();
  const outputs = await page.evaluate(() => window.__surveyOutputRequests);
  expect(outputs).toEqual({ midi: 0, audio: 0 }); expect(errors).toEqual([]);
  await testInfo.attach('saved-report-source-replay.json', { body: JSON.stringify({ sourceDigest: sourceManifest.codeDigest, receipts, outputs, errors, activeCodeUnverified: true, changedAssetRejected: true }), contentType: 'application/json' });
});


test('a missing early baseline checkpoint never substitutes future final telemetry', async ({ page }) => {
  await page.goto('/procgen-survey.html');
  const report = reviewFixture(), baseline = report.results[0];
  baseline.telemetry = baseline.milestones[2].telemetry; baseline.milestones = [];
  await page.evaluate(value => window.__procgenSurveyDashboard.load(value), report);
  await page.locator('[data-trial-id="candidate-b"]').click();
  await page.locator('#surveyScrub').focus(); await page.keyboard.press('Home');
  await expect(page.locator('#surveyBaselineStatus')).toHaveText('No baseline checkpoint is retained at or before tick 0.');
  expect(await page.locator('#surveyBaseline').evaluate(canvas => [...canvas.getContext('2d').getImageData(20, 200, 1, 1).data])).toEqual([9, 14, 22, 255]);
  await page.keyboard.press('End');
  await expect(page.locator('#surveyBaselineStatus')).toContainText('same scene and policy seed');
  expect(await page.locator('#surveyBaseline').evaluate(canvas => [...canvas.getContext('2d').getImageData(20, 200, 1, 1).data])).toEqual([74, 97, 117, 255]);
});

test('scenario and policy-seed review preserves candidate identity and exposes distinct outcome evidence', async ({ page }) => {
  await page.goto('/procgen-survey.html');
  const report = reviewFixture(), original = report.results;
  report.manifest.scenarios = [101, 202, 303].map((seed, index) => ({ id: 'scene-' + index, environmentSeed: seed, laneHeight: 144, horizonTicks: 64, cohort: { size: 8 }, mode: 'controlled', pack: 'lemmings', corpus: index ? 'holdout' : 'development' }));
  report.manifest.developmentScenarioIds = ['scene-0'];
  report.results = report.manifest.scenarios.flatMap((scenario, sceneIndex) => [1, 2].flatMap(policySeed => original.map((trial, index) => ({
    ...trial, trialId: scenario.id + '-' + trial.candidateId + '-' + policySeed, scenario, scenarioId: scenario.id, policySeed,
    episodeComplete: policySeed === 1, status: index ? 'completed' : 'timeout',
    accounting: { designated: 8, arrived: index ? 8 : 4, qualified: index ? 8 : 4, alive: index && sceneIndex === 1 ? 7 : 8, deaths: index && sceneIndex === 1 ? 1 : 0, unresolved: index ? 0 : 4 },
    validity: { accountingComplete: true, deterministic: true, protectedTerrain: index ? true : null, legitimateActions: true }, evidence: { truncated: !index }
  }))));
  await page.evaluate(value => window.__procgenSurveyDashboard.load(value), report);
  await expect(page.locator('#surveyScenarioContext')).toContainText('Environment seed 101');
  await expect(page.locator('#surveyPreviousScene')).toBeDisabled();
  await page.locator('#surveyPolicySeed').selectOption('1');
  await page.locator('[data-trial-id="scene-0-candidate-b-1"]').click();
  await page.getByRole('button', { name: 'Next scenario', exact: true }).click();
  await expect(page.locator('[data-trial-id="scene-1-candidate-b-1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#surveyScenarioContext')).toContainText('Environment seed 202');
  await expect(page.locator('#surveyNavigationStatus')).toContainText('Kept candidate candidate-b and policy seed 1');
  await expect(page.locator('#surveyOutcomeSummary')).toContainText('Goal met at horizon');
  await expect(page.locator('#surveyOutcomeSummary')).toContainText('Recorded deaths: 1');
  const row = label => page.locator('#surveyOutcomeRows tr').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
  await expect(row('Alive / designated').locator('td').first()).toHaveText('7 / 8');
  await expect(row('Physical arrivals / designated').locator('td').first()).toHaveText('8 / 8');
  await expect(row('Declared outcome').locator('td').nth(1)).toHaveText('Goal not met at horizon');
  await expect(row('Protected terrain').locator('td').nth(1)).toHaveText('Unknown');
  await expect(row('Evidence retention').locator('td').nth(1)).toHaveText('Truncated');
  await page.locator('#surveyFilter').selectOption('casualties');
  await expect(page.locator('.survey-tile:visible')).toHaveCount(1);
  await page.locator('#surveyFilter').selectOption('unknown');
  await expect(page.locator('.survey-tile:visible')).toHaveCount(1);
  await expect(page.locator('#surveyOutcomeSummary')).toContainText('Validity unknown');
  await page.locator('#surveyFilter').selectOption('all');
  await page.locator('#surveyPolicySeed').selectOption('2');
  await expect(page.locator('#surveyOutcomeSummary')).toContainText('Incomplete episode');
  await page.locator('#surveyFilter').selectOption('incomplete');
  await expect(page.locator('.survey-tile:visible')).toHaveCount(2);
  await page.setViewportSize(MIN_DESKTOP_VIEWPORT);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Next scenario', exact: true }).click();
  await expect(page.locator('#surveyNextScene')).toBeDisabled();
});
