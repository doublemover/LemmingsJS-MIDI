import { expect } from 'chai';
import { createSurveyServer } from '../scripts/procgen-survey/SurveyServer.js';
import { runSurveyJobs } from '../scripts/procgen-survey/SurveyWorkerPool.js';
import { createNodeSurveyTrial, loadProcgenMasks } from '../scripts/procgen-survey/SurveyNodeWorld.js';
import { createSurveyTrialId, normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { compareSurveyReplay } from '../js/app/procgen/survey/ProcgenSurveyReplay.js';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const until = async predicate => { const deadline = Date.now() + 4000; while (!predicate()) { if (Date.now() >= deadline) throw new Error('Control boundary not reached'); await delay(10); } };
const jobs = (count = 4, horizonTicks = 512) => Array.from({ length: count }, (_, index) => {
  const scenario = normalizeSurveyScenario({ id: `controls-${index}`, environmentSeed: 42, horizonTicks, checkpointEvery: 32, cohort: { size: 8, birthInterval: 4 }, goal: { x: 100, y: 64, width: 48, height: 16 }, geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }] } });
  const candidate = { id: 'baseline' };
  return { scenario, candidate, trialId: createSurveyTrialId(scenario, candidate), attemptId: `control-test-${index}` };
});

describe('local survey server and atomic live controls', function() {
  this.timeout(15000);
  it('serves cached report/static sources only, authenticates fixed commands and closes its owned listener', async () => {
    const state = { schemaVersion: 1, status: 'paused', telemetry: [] }, commands = [];
    const server = await createSurveyServer({ getState: () => state, onControl: command => { commands.push(command); return { paused: command !== 'resume' }; } });
    const control = (body, headers = {}) => fetch(server.origin + '/survey-api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Survey-Token': server.token, Origin: server.origin, ...headers }, body });
    try {
      expect(await (await fetch(server.origin + '/survey-api/report')).json()).to.deep.equal(state);
      const source = await fetch(server.origin + '/js/app/procgen/survey/ProcgenSurveyAnalysis.js'); expect(source.status).to.equal(200); expect(await source.text()).to.include('analyzeProcgenSurveyPairs');
      expect((await fetch(server.origin + '/scripts/procgen-survey/SurveyNodeWorld.js')).status).to.equal(200);
      expect((await fetch(server.origin + '/tools/NodeFileProvider.js')).status).to.equal(200);
      expect((await fetch(server.origin + '/scripts/package.json')).status).to.equal(404);
      for (const pathname of ['/AGENTS.md', '/package.json', '/index-code/data.json', '/index-prose/data.json', '/.git/config', '/js/vendor/webmidi.js', '/js%5c..%5cAGENTS.md']) expect((await fetch(server.origin + pathname)).status).to.equal(404);
      expect((await control(JSON.stringify({ command: 'pause' }), { 'X-Survey-Token': 'wrong' })).status).to.equal(403);
      expect((await control(JSON.stringify({ command: 'pause' }), { Origin: 'https://unrelated.example' })).status).to.equal(403);
      expect((await control(JSON.stringify({ command: 'launch' }))).status).to.equal(400);
      expect((await control(JSON.stringify({ command: 'pause', budget: 123 }))).status).to.equal(400);
      expect((await control('x'.repeat(513))).status).to.equal(413);
      expect((await control('invalid-json')).status).to.equal(400);
      for (const command of ['pause', 'step', 'resume', 'cancel']) expect((await (await control(JSON.stringify({ command }))).json()).accepted).to.equal(command);
      expect(commands).to.deep.equal(['pause', 'step', 'resume', 'cancel']);
    } finally { await server.close(); await server.close(); }
    try { await fetch(server.origin + '/survey-api/report'); expect.fail('Listener should be closed'); } catch (error) { expect(error.message).to.include('fetch failed'); }
  });
  it('reports cached-state failure without dispatching a control and isolates simultaneous owned servers', async () => {
    let calls = 0;
    const one = await createSurveyServer({ getState: () => { throw new Error('cached failure'); }, onControl: () => { calls++; } });
    const two = await createSurveyServer({ getState: () => ({ status: 'independent' }), onControl: () => {} });
    try { expect(one.origin).not.to.equal(two.origin); expect((await fetch(one.origin + '/survey-api/report')).status).to.equal(500); await one.close(); expect((await (await fetch(two.origin + '/survey-api/report')).json()).status).to.equal('independent'); expect(calls).to.equal(0); }
    finally { await one.close(); await two.close(); }
  });
  it('does not admit worlds while initially paused and records every queued cancellation explicitly', async () => {
    let controls, telemetry = 0;
    const execution = runSurveyJobs(jobs(3, 128), { executionWorkers: 1, residentWorlds: 2, paused: true, maxTotalMs: 5000, maxTrialMs: 4000, onControlReady: value => { controls = value; }, onTelemetry: () => { telemetry++; } });
    await until(() => !!controls); await delay(125); expect(telemetry).to.equal(0); controls.cancel();
    const report = await execution; expect(report.cancelled).to.equal(true); expect(report.results).to.have.length(3);
    expect(report.results.every(result => result.status === 'cancelled' && result.lastTick === 0 && result.terminationReason === 'not-admitted')).to.equal(true);
  });
  it('pauses at completed boundaries, advances resident worlds to one shared checkpoint, then resumes the exact real trajectories', async () => {
    const requested = jobs(), pauseAcks = new Map(), reached = new Map(), previews = [], ticks = new Map(); let controls, pauseRequested = false, telemetryCount = 0;
    const execution = runSurveyJobs(requested, { executionWorkers: 2, residentWorlds: 4, sliceTicks: 8, checkpointTicks: 32, maxTotalMs: 8000, maxTrialMs: 7000,
      onControlReady: value => { controls = value; },
      onControlState: value => { if (value.worker != null && value.paused && value.ticks) { if (value.reachedCheckpoint) reached.set(value.worker, value); else pauseAcks.set(value.worker, value); } },
      onTelemetry: (id, value) => { telemetryCount++; ticks.set(id, value.tick); previews.push(value.preview); if (!pauseRequested && value.tick >= 32) { pauseRequested = true; controls.pause(); } }
    });
    try {
      await until(() => pauseAcks.size === 2);
      const maxTick = Math.max(...[...pauseAcks.values()].flatMap(value => value.ticks.map(entry => entry.tick))), target = (Math.floor(maxTick / 32) + 1) * 32;
      controls.step(); await until(() => reached.size === 2);
      for (const value of reached.values()) { expect(value.reachedCheckpoint).to.equal(target); for (const entry of value.ticks) expect(entry.tick).to.equal(target); }
      const stoppedCount = telemetryCount; await delay(75); expect(telemetryCount).to.equal(stoppedCount);
      expect(previews.every(preview => Number.isInteger(preview.tick) && typeof preview.stale === 'boolean' && preview.terrainScope.includes('base collision'))).to.equal(true);
      controls.resume(); const report = await execution; expect(report.cancelled).to.equal(false); expect(report.results).to.have.length(4); expect(report.error).to.equal(null);
      const masks = await loadProcgenMasks();
      for (const job of requested) { const trial = await createNodeSurveyTrial(job, masks); trial.step(job.scenario.horizonTicks); const expected = trial.result(); trial.dispose(); expect(compareSurveyReplay(expected, report.results.find(result => result.trialId === job.trialId)).matched).to.equal(true); }
    } catch (error) { controls?.cancel(); await execution; throw error; }
  });
  it('keeps dashboard callback exceptions separate from simulation results', async () => {
    const report = await runSurveyJobs(jobs(1, 128), { maxTotalMs: 5000, onTelemetry: () => { throw new Error('display fixture'); } });
    expect(report.error).to.equal(null); expect(report.results[0].episodeComplete).to.equal(true); expect(report.presentationErrors).to.include('display fixture');
  });
  it('preserves wall-time safety interruption as an incomplete attempt rather than a routing failure', async () => {
    let controls, residentSeen = false;
    const execution = runSurveyJobs(jobs(1, 512), { maxTotalMs: 5000, maxTrialMs: 50, onControlReady: value => { controls = value; }, onTelemetry: () => { if (!residentSeen) { residentSeen = true; controls.pause(); } } });
    try { await until(() => residentSeen); await delay(100); controls.resume(); const report = await execution; expect(report.results[0].status).to.equal('interrupted'); expect(report.results[0].episodeComplete).to.equal(false); expect(report.results[0].error).to.equal(undefined); }
    catch (error) { controls?.cancel(); await execution; throw error; }
  });
});
