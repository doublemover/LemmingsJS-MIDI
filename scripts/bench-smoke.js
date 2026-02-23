#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const parseArgs = (argv) => {
  const out = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=', 2);
    out.set(key, value ?? 'true');
  }
  return out;
};

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
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

const evaluateSmokeResults = ({ performance, history, hotpaths }, thresholds) => {
  const failures = [];

  const perfP95Frame = Number(performance?.filteredFrameStats?.p95 ?? performance?.frameStats?.p95 ?? 0);
  const perfP50Tps = Number(performance?.filteredTpsStats?.p50 ?? performance?.tpsStats?.p50 ?? 0);
  if (perfP95Frame > thresholds.perfP95FrameMsMax) {
    failures.push(`perf frame p95 ${perfP95Frame.toFixed(2)}ms > ${thresholds.perfP95FrameMsMax.toFixed(2)}ms`);
  }
  if (perfP50Tps < thresholds.perfP50TpsMin) {
    failures.push(`perf TPS p50 ${perfP50Tps.toFixed(2)} < ${thresholds.perfP50TpsMin.toFixed(2)}`);
  }

  const historyResults = Array.isArray(history?.results) ? history.results : [];
  const historyRatio = historyResults.length
    ? historyResults.reduce((acc, item) => {
      const target = Number(item?.targetSpanTicks || 0);
      const span = Number(item?.maxSpanTicks || 0);
      if (!Number.isFinite(target) || target <= 0) return acc;
      return Math.max(acc, span / target);
    }, 0)
    : 0;
  if (historyRatio < thresholds.historySpanRatioMin) {
    failures.push(`history span ratio ${historyRatio.toFixed(3)} < ${thresholds.historySpanRatioMin.toFixed(3)}`);
  }

  const antsAvgMs = Number(hotpaths?.marchingAnts?.avgMs ?? 0);
  if (antsAvgMs > thresholds.antsAvgMsMax) {
    failures.push(`marching ants avg ${antsAvgMs.toFixed(2)}ms > ${thresholds.antsAvgMsMax.toFixed(2)}ms`);
  }
  const tileCompositionAvgMs = Number(hotpaths?.tileComposition?.avgMs ?? 0);
  if (tileCompositionAvgMs > thresholds.tileCompositionAvgMsMax) {
    failures.push(`tile composition avg ${tileCompositionAvgMs.toFixed(2)}ms > ${thresholds.tileCompositionAvgMsMax.toFixed(2)}ms`);
  }

  const overlayPlaneAvgMs = Number(hotpaths?.overlayPlane?.avgMs ?? 0);
  if (overlayPlaneAvgMs > thresholds.overlayPlaneAvgMsMax) {
    failures.push(`overlay plane avg ${overlayPlaneAvgMs.toFixed(2)}ms > ${thresholds.overlayPlaneAvgMsMax.toFixed(2)}ms`);
  }

  const scaledBlitAvgMs = Number(hotpaths?.scaledBlit?.avgMs ?? 0);
  if (scaledBlitAvgMs > thresholds.scaledBlitAvgMsMax) {
    failures.push(`scaled blit avg ${scaledBlitAvgMs.toFixed(2)}ms > ${thresholds.scaledBlitAvgMsMax.toFixed(2)}ms`);
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      perfP95Frame,
      perfP50Tps,
      historyRatio,
      antsAvgMs,
      tileCompositionAvgMs,
      overlayPlaneAvgMs,
      scaledBlitAvgMs
    }
  };
};

const main = (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const soakRequested = args.has('soak') || process.env.BENCH_SOAK === '1';
  const timeoutMs = toPositiveNumber(
    args.get('timeoutMs') || process.env.BENCH_SMOKE_TIMEOUT_MS,
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
  const perfArgs = soakRequested
    ? ['--soak', '--profile=soak', '--maxRuntime=300000']
    : ['--smoke', '--profile=smoke', '--duration=6000', '--warmup=1500', '--sample=500', '--maxRuntime=25000'];
  const historyArgs = soakRequested
    ? ['--soak', '--profile=soak', '--maxRuntime=300000']
    : ['--smoke', '--profile=smoke', '--duration=6000', '--sample=500', '--speeds=30,60', '--target=12000', '--maxRuntime=25000'];
  const performance = runNodeScript(perfScript, [
    ...perfArgs,
    ...commonArgs
  ], timeoutMs, 'bench-performance');

  const history = runNodeScript(historyScript, [
    ...historyArgs,
    ...commonArgs
  ], timeoutMs, 'bench-history-stress');

  const hotpaths = runNodeScript(hotpathsScript, [
    '--smoke'
  ], Math.min(timeoutMs, 30000), 'bench-hotpaths');

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
  }, thresholds);

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
    failures: gate.failures
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

export { evaluateSmokeResults };
