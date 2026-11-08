#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { admitSmokeMeasurements } from './BenchmarkReceipt.js';
import { createHistoryBenchConfig } from './bench-history-stress.js';

const createSmokeRunPlan = ({ soakRequested = false, timeoutMs = null, env = process.env } = {}) => {
  if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new RangeError('Benchmark timeout must be positive and finite.');
  const perfArgs = soakRequested
    ? ['--soak', '--profile=soak', '--maxRuntime=300000']
    : ['--smoke', '--profile=smoke', '--duration=6000', '--warmup=1500', '--sample=500', '--maxRuntime=25000'];
  const historyArgs = soakRequested
    ? ['--soak', '--profile=soak']
    : ['--smoke', '--profile=smoke', '--duration=7000', '--sample=500', '--speeds=30,60', '--maxRuntime=25000'];
  const history = createHistoryBenchConfig({ argv: historyArgs, env, log: { warn() {} } });
  return { perfArgs, historyArgs, performanceTimeoutMs: timeoutMs ?? (soakRequested ? 330000 : 70000),
    historyTimeoutMs: timeoutMs ?? (soakRequested ? history.maxRuntimeMs + 30000 : 70000),
    hotpathsTimeoutMs: Math.min(timeoutMs ?? 60000, 60000) };
};

const parseArgs = (argv) => {
  const out = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=', 2);
    out.set(key, value ?? 'true');
  }
  return out;
};

const toNumberOrNaN = (value) => {
  try {
    return Number(value);
  } catch {
    return Number.NaN;
  }
};

const toPositiveNumber = (value, fallback) => {
  const parsed = toNumberOrNaN(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseJsonOutput = (stdout, label) => {
  const text = String(stdout || '').trim();
  if (!text) {
    throw new Error(`${label} produced no JSON output.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) {
      throw new Error(`${label} did not produce parsable JSON output.`);
    }
    return JSON.parse(text.slice(first, last + 1));
  }
};

const runNodeScript = (scriptPath, scriptArgs, timeoutMs, label) => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status ?? 'null'}.\n${result.stderr || ''}`);
  }
  return {
    durationMs: Date.now() - started,
    data: parseJsonOutput(result.stdout, label)
  };
};

const evaluateSmokeResults = (results, thresholds, options = {}) => {
  const admitted = admitSmokeMeasurements(results, options), diagnostics = [...admitted.diagnostics];
  const compare = (value, threshold, path, minimum = false) => {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) {
      diagnostics.push({ kind: 'invalid-threshold', path, reason: 'expected a finite positive threshold' }); return;
    }
    if (value != null && (minimum ? value < threshold : value > threshold))
      diagnostics.push({ kind: 'performance-regression', path, reason: `${value} ${minimum ? '<' : '>'} ${threshold}` });
  };
  const metrics = admitted.metrics;
  compare(metrics.perfP95Frame, thresholds.perfP95FrameMsMax, 'performance.frameStats.p95');
  compare(metrics.perfP50Tps, thresholds.perfP50TpsMin, 'performance.tpsStats.p50', true);
  for (const scenario of admitted.scenarios) compare(scenario.ratio, thresholds.historySpanRatioMin, `history.speed:${scenario.speed}.spanRatio`, true);
  for (const [metric, threshold] of [['antsAvgMs', 'antsAvgMsMax'], ['tileCompositionAvgMs', 'tileCompositionAvgMsMax'],
    ['overlayPlaneAvgMs', 'overlayPlaneAvgMsMax'], ['scaledBlitAvgMs', 'scaledBlitAvgMsMax']]) compare(metrics[metric], thresholds[threshold], `hotpaths.${metric}`);
  return { ok: diagnostics.length === 0, failures: diagnostics.map(item => `${item.kind}: ${item.path}: ${item.reason}`),
    diagnostics, metrics, measurementValid: admitted.valid, scenarios: admitted.scenarios };
};

const main = (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const soakRequested = args.has('soak') || process.env.BENCH_SOAK === '1';
  const timeoutInput = args.get('timeoutMs') || process.env.BENCH_SMOKE_TIMEOUT_MS;
  const timeoutMs = toPositiveNumber(
    timeoutInput,
    soakRequested ? 300000 : 70000
  );
  const perfP95FrameMsMax = toPositiveNumber(args.get('perfP95FrameMsMax') || process.env.BENCH_SMOKE_PERF_P95_MAX, 250);
  const perfP50TpsMin = toPositiveNumber(args.get('perfP50TpsMin') || process.env.BENCH_SMOKE_PERF_TPS_MIN, 15);
  const historySpanRatioMin = toPositiveNumber(args.get('historySpanRatioMin') || process.env.BENCH_SMOKE_HISTORY_RATIO_MIN, 0.5);
  const antsAvgMsMax = toPositiveNumber(args.get('antsAvgMsMax') || process.env.BENCH_SMOKE_ANTS_MAX_MS, 250);
  const tileCompositionAvgMsMax = toPositiveNumber(args.get('tileCompositionAvgMsMax') || process.env.BENCH_SMOKE_TILE_MAX_MS, 250);
  const overlayPlaneAvgMsMax = toPositiveNumber(args.get('overlayPlaneAvgMsMax') || process.env.BENCH_SMOKE_OVERLAY_MAX_MS, 250);
  const scaledBlitAvgMsMax = toPositiveNumber(args.get('scaledBlitAvgMsMax') || process.env.BENCH_SMOKE_SCALED_MAX_MS, 250);
  const baseUrl = args.get('url') || process.env.LEMMINGS_BENCH_URL || 'https://localhost:8080/?e2e=1';
  const headless = (args.get('headless') || process.env.BENCH_HEADLESS || 'true') !== 'false';

  const commonArgs = [
    `--url=${baseUrl}`,
    `--headless=${headless}`
  ];

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const perfScript = path.join(root, 'scripts', 'bench-performance.js');
  const historyScript = path.join(root, 'scripts', 'bench-history-stress.js');
  const hotpathsScript = path.join(root, 'scripts', 'bench-hotpaths.js');

  const started = Date.now();
  const plan = createSmokeRunPlan({ soakRequested, timeoutMs: timeoutInput == null ? null : timeoutMs });
  const performance = runNodeScript(perfScript, [
    ...plan.perfArgs,
    ...commonArgs
  ], plan.performanceTimeoutMs, 'bench-performance');

  const history = runNodeScript(historyScript, [
    ...plan.historyArgs,
    ...commonArgs
  ], plan.historyTimeoutMs, 'bench-history-stress');

  const hotpaths = runNodeScript(hotpathsScript, [
    '--smoke'
  ], plan.hotpathsTimeoutMs, 'bench-hotpaths');

  const thresholds = {
    perfP95FrameMsMax,
    perfP50TpsMin,
    historySpanRatioMin,
    antsAvgMsMax,
    tileCompositionAvgMsMax,
    overlayPlaneAvgMsMax,
    scaledBlitAvgMsMax
  };
  const gate = evaluateSmokeResults({
    performance: performance.data,
    history: history.data,
    hotpaths: hotpaths.data
  }, thresholds, { profile: soakRequested ? 'soak' : 'smoke' });

  const summary = {
    ok: gate.ok,
    profile: soakRequested ? 'soak' : 'smoke',
    totalDurationMs: Date.now() - started,
    thresholds,
    durationsMs: {
      benchPerformance: performance.durationMs,
      benchHistoryStress: history.durationMs,
      benchHotpaths: hotpaths.durationMs
    },
    metrics: gate.metrics,
    failures: gate.failures,
    diagnostics: gate.diagnostics, measurementValid: gate.measurementValid, scenarios: gate.scenarios
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!gate.ok) {
    process.exitCode = 1;
  }
};

const isMain = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}

export { evaluateSmokeResults, createSmokeRunPlan };
