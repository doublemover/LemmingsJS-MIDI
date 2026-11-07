import { expect } from 'chai';
import { Worker } from 'node:worker_threads';
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
const controlWorker = mode => (entry, configuration) => {
  const provider = new URL('../tools/NodeFileProvider.js', import.meta.url);
  const source = `import { parentPort } from 'node:worker_threads';
    ${mode === 'delayed-start' ? 'await new Promise(resolve => setTimeout(resolve, 750));' : ''}
    ${mode === 'slow-assets' ? `const { NodeFileProvider } = await import(${JSON.stringify(provider.href)});
      const load = NodeFileProvider.prototype.loadBinary; let held = false;
      NodeFileProvider.prototype.loadBinary = async function(...args) { if (!held) { held = true; await new Promise(resolve => setTimeout(resolve, 250)); } return load.apply(this, args); };` : ''}
    const send = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = message => {
      if (${JSON.stringify(mode)} === 'wrong-selection' && message.type === 'step-ready' && message.selected.length) { send({ ...message, selected: message.selected.map(value => ({ ...value, attemptId: 'wrong-attempt' })) }); return; }
      if (${JSON.stringify(mode)} === 'forged-checkpoint' && message.type === 'control-state' && message.value.stepStatus) { send({ ...message, value: { ...message.value, selected: message.value.selected.map(value => ({ ...value, tick: message.value.targetTick + 1000 })) } }); return; }
      if (${JSON.stringify(mode)} === 'late-ack' && message.type === 'control-state' && message.value.stepStatus) { setTimeout(() => send(message), 350); return; }
      if (${JSON.stringify(mode)} === 'exit-before-ack' && message.type === 'control-state' && message.value.stepStatus) process.exit(23);
      send(message);
    };
    await import(${JSON.stringify(entry.href)});`;
  return new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)), configuration);
};

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
  it('reports empty work explicitly when stepping a run with no queued or resident trials', async () => {
    let controls, receipt;
    const report = await runSurveyJobs([], { paused: true, onControlReady: value => { controls = value; }, onControlState: value => { receipt = value; } });
    const stepped = controls.step(); expect(stepped).to.equal(receipt);
    expect(receipt).to.include({ stepStatus: 'empty', reachedCheckpoint: null, executionWorkers: 0, retired: true });
    expect(receipt.selected).to.deep.equal([]); expect(receipt.runGeneration).to.equal(report.runGeneration);
    expect(report.results).to.deep.equal([]); expect(report.error).to.equal(null);
    const aborted = new AbortController(); aborted.abort();
    expect((await runSurveyJobs([], { signal: aborted.signal })).reason).to.equal('cancelled');
  });
  it('does not admit worlds while initially paused and records every queued cancellation explicitly', async () => {
    let controls, telemetry = 0;
    const execution = runSurveyJobs(jobs(3, 128), { executionWorkers: 1, residentWorlds: 2, paused: true, maxTotalMs: 5000, maxTrialMs: 4000, onControlReady: value => { controls = value; }, onTelemetry: () => { telemetry++; } });
    await until(() => !!controls); await delay(125); expect(telemetry).to.equal(0); controls.cancel();
    const report = await execution; expect(report.cancelled).to.equal(true); expect(report.results).to.have.length(3);
    expect(report.results.every(result => result.status === 'cancelled' && result.lastTick === 0 && result.terminationReason === 'not-admitted')).to.equal(true);
  });
  it('leases bounded queued trials for an initially paused checkpoint and reports their actual ticks', async () => {
    let controls, receipt; const telemetry = [];
    const execution = runSurveyJobs(jobs(3, 64), { executionWorkers: 1, residentWorlds: 2, paused: true, sliceTicks: 2, checkpointTicks: 4,
      maxTotalMs: 5000, maxTrialMs: 4000, onControlReady: value => { controls = value; },
      onControlState: value => { if (value.stepStatus) receipt = value; }, onTelemetry: (id, value) => telemetry.push({ id, tick: value.tick }) });
    try {
      await until(() => !!controls); controls.step(); await until(() => !!receipt);
      expect(receipt.stepStatus).to.equal('reached'); expect(receipt.reachedCheckpoint).to.equal(4);
      expect(receipt.barrierLatencyMs).to.be.at.least(0); expect(receipt.prepareLatencyMs).to.be.at.most(receipt.barrierLatencyMs);
      expect(receipt.selected).to.have.length(2); expect(receipt.selected.every(value => value.tick === 4)).to.equal(true);
      expect(receipt.queued).to.equal(1); expect(telemetry.some(value => value.tick === 4)).to.equal(true);
      const before = telemetry.length; await delay(75); expect(telemetry.length).to.equal(before);
      controls.resume(); const report = await execution; expect(report.results).to.have.length(3);
      expect(report.results.every(result => result.episodeComplete)).to.equal(true);
    } catch (error) { controls?.cancel(); await execution; throw error; }
  });
  it('reports a real terminal tick when a paused trial ends before the checkpoint', async () => {
    let controls, receipt;
    const execution = runSurveyJobs(jobs(1, 32), { paused: true, checkpointTicks: 64, maxTotalMs: 5000,
      onControlReady: value => { controls = value; }, onControlState: value => { if (value.stepStatus) receipt = value; } });
    await until(() => !!controls); controls.step(); await until(() => !!receipt);
    expect(receipt.stepStatus).to.equal('terminal-before-target'); expect(receipt.reachedCheckpoint).to.equal(null);
    expect(receipt.selected[0].tick).to.equal(32);
    const report = await execution; expect(report.results[0].lastTick).to.equal(32);
  });
  it('supersedes startup steps and repeatedly advances one shared boundary across real workers', async () => {
    let controls; const acknowledgements = [];
    const execution = runSurveyJobs(jobs(2, 32), { executionWorkers: 2, residentWorlds: 2, paused: true, checkpointTicks: 4,
      maxTotalMs: 8000, onControlReady: value => { controls = value; value.step(); value.step(); },
      onControlState: value => { if (value.stepStatus) acknowledgements.push(value); } });
    try {
      await until(() => acknowledgements.filter(value => value.controlId === 2).length === 2);
      expect(acknowledgements.some(value => value.controlId === 1)).to.equal(false);
      expect(acknowledgements.every(value => value.reachedCheckpoint === 4 && value.selected.length === 1)).to.equal(true);
      controls.step(); await until(() => acknowledgements.filter(value => value.controlId === 3).length === 2);
      expect(acknowledgements.filter(value => value.controlId === 3).every(value => value.reachedCheckpoint === 8)).to.equal(true);
      controls.resume(); const report = await execution;
      expect(report.error).to.equal(null); expect(report.results.every(result => result.lastTick === 32)).to.equal(true);
    } catch (error) { controls?.cancel(); await execution; throw error; }
  });
  it('retains every worker outcome in one receipt when only part of the selected set reaches the target', async () => {
    const requested = [jobs(1, 32)[0], jobs(2, 64)[1]]; let controls, aggregate;
    const execution = runSurveyJobs(requested, { executionWorkers: 2, residentWorlds: 2, paused: true, checkpointTicks: 48, maxTotalMs: 6000,
      onControlReady: value => { controls = value; value.step(); }, onControlState: value => { if (value.stepReceipt?.status !== 'pending') aggregate = value.stepReceipt; } });
    try {
      await until(() => !!aggregate); expect(aggregate.status).to.equal('terminal-before-target'); expect(aggregate.reachedCheckpoint).to.equal(null);
      expect(aggregate.selected.map(value => value.tick).sort((a,b) => a - b)).to.deep.equal([32, 48]);
      expect(aggregate.workers.map(value => value.status)).to.have.members(['terminal-before-target', 'reached']);
      expect(aggregate.unacknowledgedWorkers).to.deep.equal([]); expect(aggregate.selectionComplete).to.equal(true);
      expect(Object.isFrozen(aggregate.selected[0])).to.equal(true); controls.resume();
      const report = await execution; expect(report.error).to.equal(null); expect(report.controlReceipts).to.have.length(1);
      expect(report.controlReceipts[0]).to.deep.equal(aggregate);
    } catch (error) { controls?.cancel(); await execution; throw error; }
  });
  it('preserves an in-flight asset admission when a newer Step supersedes its lease', async () => {
    const scenario = normalizeSurveyScenario({ id: 'step-during-assets', mode: 'generated', pack: 'lemmings_ohNo', groundSet: 0, horizonTicks: 16, cohort: { size: 1 } }), candidate = { id: 'baseline' };
    const requested = [{ scenario, candidate, trialId: createSurveyTrialId(scenario, candidate), attemptId: 'assets-attempt' }];
    let controls, superseded = false, aggregate;
    const execution = runSurveyJobs(requested, { paused: true, residentWorlds: 1, checkpointTicks: 4, maxTotalMs: 8000, workerFactory: controlWorker('slow-assets'),
      onControlReady: value => { controls = value; value.step(); }, onControlState: value => {
        if (!superseded && value.computation?.preparingTrials) { superseded = true; controls.step(); }
        if (value.stepReceipt?.controlId === 2 && value.stepReceipt.status === 'reached') aggregate = value.stepReceipt;
      } });
    try {
      await until(() => !!aggregate); expect(superseded).to.equal(true); expect(aggregate.selected).to.have.length(1);
      expect(aggregate.selected[0]).to.include({ trialId: requested[0].trialId, attemptId: 'assets-attempt', tick: 4 });
      controls.resume(); const report = await execution; expect(report.error).to.equal(null);
      expect(report.controlReceipts.map(value => value.status)).to.deep.equal(['superseded', 'reached']);
      expect(report.admissions.filter(value => value.status === 'admitted')).to.have.length(1);
    } catch (error) { controls?.cancel(); await execution; throw error; }
  });
  it('bounds a startup Step independently and reports unknown progress without claiming a reached checkpoint', async () => {
    let controls, receipt;
    const execution = runSurveyJobs(jobs(1, 32), { paused: true, maxTotalMs: 5000, maxControlMs: 50, workerFactory: controlWorker('delayed-start'),
      onControlReady: value => { controls = value; value.step(); }, onControlState: value => { if (value.stepReceipt?.status === 'timed-out') receipt = value.stepReceipt; } });
    await until(() => !!receipt); expect(receipt).to.include({ status: 'timed-out', terminationReason: 'control-deadline', reachedCheckpoint: null, selectionComplete: false });
    expect(receipt.unacknowledgedWorkers).to.have.length(1); controls.cancel();
    const report = await execution; expect(report.controlReceipts[0]).to.deep.equal(receipt); expect(report.admissions[0].status).to.equal('not-admitted');
  });
  it('retires a timed-out control generation and ignores its late real-worker checkpoint acknowledgement', async () => {
    let controls, ready = false, receipt; const acknowledgements = [];
    const execution = runSurveyJobs(jobs(1, 32), { paused: true, maxTotalMs: 6000, maxControlMs: 150, checkpointTicks: 4, workerFactory: controlWorker('late-ack'),
      onControlReady: value => { controls = value; }, onControlState: value => { ready ||= value.readyWorkers === 1;
        if (value.stepStatus) acknowledgements.push(value); if (value.stepReceipt?.status === 'timed-out') receipt = value.stepReceipt; } });
    try {
      await until(() => ready); controls.step(); await until(() => !!receipt); await delay(400);
      expect(receipt.reachedCheckpoint).to.equal(null); expect(receipt.selected[0]).to.include({ status: 'unknown-progress', lastVerifiedTick: 4 });
      expect(receipt.selected[0]).not.to.have.property('tick'); expect(acknowledgements).to.deep.equal([]);
      controls.resume(); const report = await execution; expect(report.error).to.equal(null); expect(report.results[0].lastTick).to.equal(32);
    } catch (error) { controls?.cancel(); await execution; throw error; }
  });
  it('rejects selected attempts or actual checkpoint ticks that do not belong to the assigned real trial', async () => {
    for (const mode of ['wrong-selection', 'forged-checkpoint']) {
      const report = await runSurveyJobs(jobs(1, 32), { paused: true, checkpointTicks: 4, maxTotalMs: 5000, workerFactory: controlWorker(mode), onControlReady: value => value.step() });
      expect(report.error).to.equal(mode === 'wrong-selection' ? 'Invalid worker checkpoint selection' : 'Invalid worker checkpoint receipt');
      expect(report.controlReceipts[0].reachedCheckpoint).to.equal(null); expect(report.controlReceipts[0].status).to.equal('cancelled');
    }
  });
  it('retains a bounded control history and records how many superseded receipts were retired', async () => {
    const report = await runSurveyJobs(jobs(1, 32), { paused: true, maxTotalMs: 5000, onControlReady: value => { for (let count = 0; count < 140; count++) value.step(); value.cancel(); } });
    expect(report.controlReceipts).to.have.length(128); expect(report.discardedControlReceipts).to.equal(12);
    expect(report.controlReceipts.at(-1)).to.include({ controlId: 140, status: 'cancelled', reachedCheckpoint: null });
  });
  it('retains an unacknowledged selected set when a worker exits during the barrier', async () => {
    const report = await runSurveyJobs(jobs(1, 32), { paused: true, checkpointTicks: 4, maxTotalMs: 5000, workerFactory: controlWorker('exit-before-ack'), onControlReady: value => value.step() });
    expect(report.error).to.equal('Worker exited unexpectedly: 23'); expect(report.controlReceipts).to.have.length(1);
    const receipt = report.controlReceipts[0]; expect(receipt).to.include({ status: 'cancelled', terminationReason: 'infrastructure-error', reachedCheckpoint: null, unacknowledgedWorkerCount: 1 });
    expect(receipt.selected[0]).to.include({ status: 'unknown-progress', lastVerifiedTick: 4 }); expect(receipt.selected[0]).not.to.have.property('tick');
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
      for (const job of requested) { const trial = await createNodeSurveyTrial(job, masks); trial.step(job.scenario.horizonTicks); const expected = trial.result(); trial.dispose(); const receipt = compareSurveyReplay(expected, report.results.find(result => result.trialId === job.trialId)); expect(receipt.matched, JSON.stringify(receipt)).to.equal(true); }
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
