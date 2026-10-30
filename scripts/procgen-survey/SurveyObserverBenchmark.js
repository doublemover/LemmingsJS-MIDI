import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createNodeSurveyTrial, createSurveySourceManifest } from './SurveyNodeWorld.js';

const integer = (value, fallback, minimum, maximum) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError('Invalid survey observer benchmark bound');
  return result;
};
const normalizeObserverBenchmark = (value = {}) => {
  const profile = value.profile || 'smoke';
  if (!['smoke', 'eight-hour'].includes(profile)) throw new Error('Unknown survey observer benchmark profile');
  return { profile, name: String(value.name || 'survey'), ticks: integer(value.ticks, profile === 'eight-hour' ? 480000 : 8192, 1, 1000000),
    liveActors: integer(value.liveActors, 8, 1, 64), windowTicks: integer(value.windowTicks, profile === 'eight-hour' ? 10000 : 1024, 16, 100000),
    telemetryEvery: integer(value.telemetryEvery, 256, 1, 100000), checkpointEvery: integer(value.checkpointEvery, profile === 'eight-hour' ? 60000 : 4096, 1, 1000000),
    maxActorAge: integer(value.maxActorAge, 512, 16, 100000), maxRetainedActors: integer(value.maxRetainedActors, 65536, 64, 65536),
    maxWallMs: integer(value.maxWallMs, profile === 'eight-hour' ? 180000 : 30000, 100, 900000), seed: integer(value.seed, 42, 0, 0xffffffff) };
};
const median = values => { const sorted = values.filter(Number.isFinite).sort((a,b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const summarizeObserverRegression = windows => {
  const stable = windows.slice(2).filter(window => window.ticks >= 16 && window.actorVisits > 0), third = Math.floor(stable.length / 3);
  const basis = { maximumObserverRatio: 1.75, maximumActiveVisitRatio: 1.05, minimumHistoryGrowth: 128,
    method: 'median late-third versus early-third observation time per actor visit; first two windows excluded',
    rationale: '75% timing tolerance identifies large lifetime-dependent regressions while allowing timer, GC and shared-host noise; diagnostic only' };
  if (third < 2) return { ...basis, status: 'inconclusive', reason: 'too-few-steady-windows' };
  const early = stable.slice(0, third), late = stable.slice(-third), cost = list => median(list.map(window => window.observationMs / window.actorVisits));
  const earlyVisits = median(early.map(window => window.actorVisits / window.ticks)), lateVisits = median(late.map(window => window.actorVisits / window.ticks));
  const activeVisitRatio = Math.max(earlyVisits, lateVisits) / Math.max(0.000001, Math.min(earlyVisits, lateVisits));
  const historyGrowth = late.at(-1).retainedActors - early[0].retainedActors, ratio = cost(late) / Math.max(Number.EPSILON, cost(early));
  return { ...basis, status: historyGrowth < basis.minimumHistoryGrowth || activeVisitRatio > basis.maximumActiveVisitRatio ? 'inconclusive' : ratio > basis.maximumObserverRatio ? 'investigate-observer-regression' : 'no-observer-regression-observed',
    earlyMsPerActorVisit: cost(early), lateMsPerActorVisit: cost(late), ratio, activeVisitRatio, historyGrowth };
};
const runSurveyObserverBenchmark = async (options = {}, { signal, onWindow = () => {} } = {}) => {
  const configuration = normalizeObserverBenchmark(options), started = performance.now(), cpuStarted = process.cpuUsage();
  const scenario = { id: 'observer-benchmark-wall-trap', mode: 'controlled', horizonTicks: 100000, environmentSeed: configuration.seed,
    maxActors: Math.max(64, configuration.liveActors * 4), actorRecordLimit: configuration.maxRetainedActors,
    cohort: { size: configuration.liveActors, birthInterval: 0 }, checkpointEvery: 100000,
    goal: { x: 192, y: 0, width: 64, height: 96 },
    geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }, { x: 64, y: 48, width: 16, height: 24 }],
      hazards: [{ x: 112, y: 0, width: 8, height: 96, type: 'KILL' }] },
    worldOptions: { assists: true, workerLimits: { builders: 1, bashers: 1, diggers: 0 } } };
  const harnessDigest = () => fs.readFile(new URL('./SurveyObserverBenchmark.js', import.meta.url)).then(bytes => createHash('sha256').update(bytes).digest('hex'));
  const sourceBefore = await createSurveySourceManifest([scenario]), harnessBefore = await harnessDigest();
  const trial = await createNodeSurveyTrial({ scenario }), world = trial.world;
  world.cohorts = true;
  world._spawnCohort = () => {};
  const startupMs = performance.now() - started, windows = [], checkpoints = [];
  const totals = { admissionMs: 0, physicsMs: 0, observationMs: 0, telemetryMs: 0, checkpointCaptureMs: 0, checkpointEncodeMs: 0, yieldMs: 0 };
  let ticks = 0, forcedRetirements = 0, reason = 'completed', sampledTicks = 0, physicalPeak = world.actors.length, liveMinimum = configuration.liveActors, liveMaximum = configuration.liveActors;
  let windowStart = performance.now(), windowTotals = { ...totals }, priorWork = trial.observationWork(), priorBirths = trial._records.length;
  const sample = () => {
    const work = trial.observationWork(), elapsedMs = performance.now() - windowStart, memory = process.memoryUsage(), count = ticks - sampledTicks;
    if (!count) return;
    const measured = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value - windowTotals[key]]));
    const window = { throughTick: ticks, ticks: count, simulatedHours: ticks * 0.06 / 3600, elapsedMs, ticksPerSecond: count * 1000 / elapsedMs,
      ...measured, actorVisits: work.actorVisits - priorWork.actorVisits, finalizations: work.finalizedActors - priorWork.finalizedActors,
      telemetryProjections: work.telemetryProjections - priorWork.telemetryProjections, births: trial._records.length - priorBirths,
      retainedActors: trial._records.length, activeRecords: work.activeRecords, openLifecycles: work.openLifecycles,
      heapUsedBytes: memory.heapUsed, rssBytes: memory.rss };
    windows.push(window); onWindow(window);
    sampledTicks = ticks; windowStart = performance.now(); windowTotals = { ...totals }; priorWork = work; priorBirths = trial._records.length;
  };
  const capture = () => {
    let at = performance.now(); const snapshot = trial.snapshot(); totals.checkpointCaptureMs += performance.now() - at;
    at = performance.now(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); totals.checkpointEncodeMs += performance.now() - at;
    checkpoints.push({ tick: world.tickIndex, retainedActors: trial._records.length, bytes, stateHash: snapshot.stateHash, physicalStateHash: snapshot.physicalStateHash,
      encoding: 'JSON.stringify size/timing only; not an exact replay artifact' });
  };
  try {
    for (; ticks < configuration.ticks;) {
      if (signal?.aborted) { reason = 'cancelled'; break; }
      if (performance.now() - started >= configuration.maxWallMs) { reason = 'wall-time-limit'; break; }
      if (trial._records.length >= configuration.maxRetainedActors) { reason = 'retained-record-limit'; break; }
      let at = performance.now();
      for (const record of trial._activeRecords) if (world.tickIndex - record.birthTick >= configuration.maxActorAge && !record.actor.failureReason) { record.actor.failureReason = 'benchmark-age-retirement'; forcedRetirements++; }
      while (trial._activeRecords.size < configuration.liveActors && world.actors.length < world.maxActors && trial._records.length < configuration.maxRetainedActors) world._spawn(0);
      totals.admissionMs += performance.now() - at;
      trial._actorSteps += world.actors.length;
      at = performance.now(); world.step(); totals.physicsMs += performance.now() - at;
      at = performance.now(); trial._observe(); totals.observationMs += performance.now() - at; ticks++;
      const active = trial._activeRecords.size; liveMinimum = Math.min(liveMinimum, active); liveMaximum = Math.max(liveMaximum, active); physicalPeak = Math.max(physicalPeak, world.actors.length);
      if (ticks % configuration.telemetryEvery === 0 || ticks === configuration.ticks) { at = performance.now(); trial._refreshTelemetry(); totals.telemetryMs += performance.now() - at; }
      if (ticks % configuration.checkpointEvery === 0 || ticks === configuration.ticks) capture();
      if (ticks % configuration.windowTicks === 0) sample();
      if (ticks % 128 === 0) { at = performance.now(); await yieldTurn(); totals.yieldMs += performance.now() - at; }
    }
    sample();
    const sourceAfter = await createSurveySourceManifest([scenario]), harnessAfter = await harnessDigest();
    const sourceUnchanged = harnessBefore === harnessAfter && sourceBefore.codeDigest === sourceAfter.codeDigest && JSON.stringify(sourceBefore.assetHashes) === JSON.stringify(sourceAfter.assetHashes);
    const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuStarted), work = trial.observationWork();
    return { schemaVersion: 1, benchmark: 'production-survey-observer', configuration, status: reason, requestedTicks: configuration.ticks, measuredTicks: ticks,
      simulatedHours: ticks * 0.06 / 3600, elapsedMs, startupMs, measuredTicksPerSecond: ticks * 1000 / Math.max(1, elapsedMs - startupMs),
      timingScope: 'Node headless production world.step and survey observer at completed boundaries; includes instrumentation and event delivery; no browser rendering or real-time waiting',
      qualification: 'performance evidence only; benchmark drives production world beyond the scored trial horizon and does not issue a replay qualification',
      workload: { liveTarget: configuration.liveActors, liveMinimum, liveMaximum, physicalResidentPeak: physicalPeak,
        admission: 'replace terminal observed actors up to live target before the next tick; physical residents also bounded by world maxActors',
        cohortRuntime: 'native cohort lifecycle and terminal compaction enabled; automatic population admission replaced by this benchmark input policy',
        route: 'ordinary wall assistance and full-height kill trigger; deterministic age retirement bounds actors that avoid the trigger', forcedRetirements,
        logicalTickMs: 60, actorSteps: trial._actorSteps, plannerProbes: world.hazardPlanner.stats.probes, groundQueries: world.stats.groundQueries },
      totals, observationWork: work, finalAccounting: trial._accounting(), windows, checkpoints,
      regression: sourceUnchanged && reason === 'completed' ? summarizeObserverRegression(windows) : { status: 'inconclusive', reason: !sourceUnchanged ? 'source-files-changed-during-measurement' : reason },
      memory: { ...process.memoryUsage(), scope: 'whole Node process; heap deltas are not allocation counts', allocationCounts: 'not-instrumented',
        measuredObjectCounters: 'terminal finalizations and telemetry projections count events, not all JavaScript allocations' },
      environment: { timestamp: new Date().toISOString(), platform: process.platform, release: os.release(), arch: process.arch, node: process.version, v8: process.versions.v8,
        cpuModel: os.cpus()[0]?.model || 'unknown', logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), execArgv: process.execArgv,
        cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, sourceUnchanged, harnessBefore, harnessAfter, sourceBefore, sourceAfter,
        executionIdentity: { status: 'unbound', reason: 'filesystem source hashes do not attest loaded module instances' } } };
  } finally { trial.dispose(); }
};
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const renderObserverBenchmarkSvg = report => {
  const points = report.windows || [], width = 960, panelHeight = 185, left = 85, right = 920;
  const panels = [['Observer µs / tick', point => point.observationMs * 1000 / point.ticks, '#1b699a'],
    ['Production physics µs / tick', point => point.physicsMs * 1000 / point.ticks, '#93631a'],
    ['Checkpoint capture + JSON encode ms / window', point => point.checkpointCaptureMs + point.checkpointEncodeMs, '#80569a']];
  const maximumBirths = Math.max(1, ...points.map(point => point.retainedActors));
  const plots = panels.map(([label, value, color], index) => {
    const top = 85 + index * panelHeight, bottom = top + 125, maximum = Math.max(0.001, ...points.map(value));
    const coordinates = points.map(point => `${left + point.retainedActors / maximumBirths * (right - left)},${bottom - value(point) / maximum * 110}`).join(' ');
    return `<text x="${left}" y="${top - 10}" font-size="15">${xml(label)}</text><path d="M${left},${top}V${bottom}H${right}" fill="none" stroke="#777"/><text x="10" y="${top + 12}" font-size="12">${maximum.toFixed(3)}</text><text x="45" y="${bottom}" font-size="12">0</text><polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="2"/><text x="${left}" y="${bottom + 19}" font-size="12">0 retained births</text><text x="${right}" y="${bottom + 19}" text-anchor="end" font-size="12">${maximumBirths}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="690" viewBox="0 0 ${width} 690"><rect width="100%" height="100%" fill="#fff"/><g font-family="Arial,sans-serif" fill="#222"><text x="30" y="30" font-size="21">Survey observer cost against retained births</text><text x="30" y="54" font-size="13">${xml(report.environment.node)} · ${xml(report.environment.platform)} · ${report.simulatedHours.toFixed(3)} simulated hours · ${xml(report.status)}</text>${plots}<text x="30" y="672" font-size="12">Node instrumentation; checkpoint cost is separate. ${xml(report.regression.status)}. No browser or replay qualification.</text></g></svg>\n`;
};
const main = async argv => {
  const flags = new Map(), allowed = new Set(['profile', 'name', 'ticks', 'live-actors', 'window-ticks', 'telemetry-every', 'checkpoint-every', 'max-actor-age', 'max-retained-actors', 'max-wall-ms', 'seed', 'out', 'svg']);
  for (const argument of argv) { const match = /^--([^=]+)=(.+)$/.exec(argument); if (!match || !allowed.has(match[1])) throw new Error('Unknown observer benchmark argument: ' + argument); flags.set(match[1], match[2]); }
  const options = { profile: flags.get('profile'), name: flags.get('name') };
  for (const [flag, key] of [['ticks', 'ticks'], ['live-actors', 'liveActors'], ['window-ticks', 'windowTicks'], ['telemetry-every', 'telemetryEvery'], ['checkpoint-every', 'checkpointEvery'], ['max-actor-age', 'maxActorAge'], ['max-retained-actors', 'maxRetainedActors'], ['max-wall-ms', 'maxWallMs'], ['seed', 'seed']]) if (flags.has(flag)) options[key] = Number(flags.get(flag));
  const controller = new AbortController(), cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const report = await runSurveyObserverBenchmark(options, { signal: controller.signal });
    if (flags.has('out')) await fs.writeFile(flags.get('out'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (flags.has('svg')) await fs.writeFile(flags.get('svg'), renderObserverBenchmarkSvg(report), { flag: 'wx' });
    if (!flags.has('out')) process.stdout.write(JSON.stringify(report) + '\n');
    else process.stdout.write(JSON.stringify({ status: report.status, measuredTicks: report.measuredTicks, simulatedHours: report.simulatedHours, retainedActors: report.observationWork.retainedRecords, regression: report.regression, out: flags.get('out'), svg: flags.get('svg') }) + '\n');
    if (report.status !== 'completed') process.exitCode = 2; return report;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
};
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });
export { normalizeObserverBenchmark, summarizeObserverRegression, runSurveyObserverBenchmark, renderObserverBenchmarkSvg, main };
