import { chromium } from '@playwright/test';

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

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
};

const closeQuietly = async (target, label) => {
  if (!target || typeof target.close !== 'function') return;
  try {
    await withTimeout(target.close(), 5000, label);
  } catch {
    // best-effort shutdown
  }
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.get('url') || process.env.LEMMINGS_BENCH_URL || 'https://localhost:8080/?e2e=1';
const smokeRequested = args.has('smoke') || process.env.BENCH_SMOKE === '1';
const soakRequested = args.has('soak') || process.env.BENCH_SOAK === '1';
const requestedProfile = (
  args.get('profile') ||
  process.env.BENCH_PROFILE ||
  (soakRequested ? 'soak' : smokeRequested ? 'smoke' : 'smoke')
).toLowerCase();
const profileExplicit = args.has('profile')
  || !!process.env.BENCH_PROFILE
  || smokeRequested
  || soakRequested;
const headless = (args.get('headless') || process.env.BENCH_HEADLESS || 'true') !== 'false';

const BENCH_PROFILES = {
  default: {
    mode: 'sequence',
    durationMs: 60000,
    sampleMs: 1000,
    entrances: 50,
    warmupMs: 5000,
    maxRuntimeMs: 150000,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true' }
  },
  stress: {
    mode: 'bench',
    durationMs: 90000,
    sampleMs: 500,
    entrances: 180,
    warmupMs: 10000,
    maxRuntimeMs: 220000,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true', bench2: 'true' }
  },
  reverse: {
    mode: 'reverse',
    durationMs: 90000,
    sampleMs: 500,
    entrances: 160,
    warmupMs: 10000,
    maxRuntimeMs: 220000,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true', benchReverse: 'true' }
  },
  smoke: {
    mode: 'sequence',
    durationMs: 6000,
    sampleMs: 500,
    entrances: 30,
    warmupMs: 1500,
    maxRuntimeMs: 25000,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'false' }
  },
  soak: {
    mode: 'bench',
    durationMs: 180000,
    sampleMs: 500,
    entrances: 220,
    warmupMs: 10000,
    maxRuntimeMs: 300000,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true', bench2: 'true' }
  }
};

const profile = BENCH_PROFILES[requestedProfile] || BENCH_PROFILES.default;
if (!profileExplicit) {
  console.warn('[bench-performance] No explicit profile selected; defaulting to smoke. Use --profile=default for longer runs.');
}
const durationMs = toPositiveNumber(args.get('duration') || process.env.BENCH_DURATION_MS, profile.durationMs);
const sampleMs = toPositiveNumber(args.get('sample') || process.env.BENCH_SAMPLE_MS, profile.sampleMs);
const warmupMs = toPositiveNumber(
  args.get('warmup') || process.env.BENCH_WARMUP_MS,
  profile.warmupMs ?? Math.max(5000, sampleMs * 4)
);
const mode = (args.get('mode') || process.env.BENCH_MODE || profile.mode).toLowerCase();
const entrances = toPositiveNumber(args.get('entrances') || process.env.BENCH_ENTRANCES, profile.entrances);
const opTimeoutMs = toPositiveNumber(args.get('opTimeout') || process.env.BENCH_OP_TIMEOUT_MS, 30000);
const maxRuntimeMs = toPositiveNumber(
  args.get('maxRuntime') || process.env.BENCH_MAX_RUNTIME_MS,
  profile.maxRuntimeMs ?? (warmupMs + durationMs + Math.max(60000, sampleMs * 20))
);

const buildUrl = (raw) => {
  const url = new URL(raw);
  url.searchParams.set('e2e', '1');
  for (const [key, value] of Object.entries(profile.query || {})) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const median = (values) => {
  if (!values.length) return 0;
  const copy = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  if ((copy.length % 2) === 0) {
    return (copy[mid - 1] + copy[mid]) / 2;
  }
  return copy[mid];
};

const summarize = (samples, key) => {
  const values = samples
    .map(sample => Number(sample?.[key] || 0))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!values.length) return { min: 0, max: 0, p50: 0, p95: 0, avg: 0 };
  const pick = (ratio) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))];
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    min: values[0],
    max: values[values.length - 1],
    p50: pick(0.5),
    p95: pick(0.95),
    avg: sum / values.length
  };
};

const run = async () => {
  let browser = null;
  let context = null;
  let page = null;
  const runStart = Date.now();

  const assertRuntimeBudget = (phase) => {
    const elapsed = Date.now() - runStart;
    if (elapsed > maxRuntimeMs) {
      throw new Error(`Benchmark exceeded max runtime (${maxRuntimeMs}ms) during ${phase}.`);
    }
  };

  try {
    browser = await withTimeout(chromium.launch({
      headless,
      args: ['--allow-insecure-localhost', '--ignore-certificate-errors']
    }), opTimeoutMs, 'chromium.launch');

    context = await withTimeout(
      browser.newContext({ ignoreHTTPSErrors: true }),
      opTimeoutMs,
      'browser.newContext'
    );
    page = await withTimeout(context.newPage(), opTimeoutMs, 'context.newPage');
    page.setDefaultTimeout(opTimeoutMs);

    await withTimeout(
      page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' }),
      opTimeoutMs,
      'page.goto'
    );
    await withTimeout(
      page.waitForFunction(() => window.__E2E__?.getState?.().ready === true),
      opTimeoutMs,
      'waitForGameReady'
    );

    await withTimeout(page.evaluate(() => window.__E2E__.pause()), opTimeoutMs, 'e2e.pause');
    const capabilities = await withTimeout(page.evaluate(() => ({
      startBenchSequence: typeof window.__E2E__?.startBenchSequence === 'function',
      startBench: typeof window.__E2E__?.startBench === 'function',
      startReverse: typeof window.__E2E__?.startReverse === 'function'
    })), opTimeoutMs, 'readCapabilities');

    if (mode === 'sequence' && capabilities.startBenchSequence) {
      await withTimeout(page.evaluate(() => window.__E2E__.startBenchSequence()), opTimeoutMs, 'startBenchSequence');
    } else if (mode === 'reverse') {
      if (capabilities.startBench) {
        await withTimeout(
          page.evaluate((count) => window.__E2E__.startBench(count), entrances),
          opTimeoutMs,
          'startBench'
        );
      }
      if (capabilities.startReverse) {
        await withTimeout(page.evaluate(() => window.__E2E__.startReverse()), opTimeoutMs, 'startReverse');
      }
    } else if (capabilities.startBench) {
      await withTimeout(
        page.evaluate((count) => window.__E2E__.startBench(count), entrances),
        opTimeoutMs,
        'startBench'
      );
    }
    await withTimeout(page.evaluate(() => window.__E2E__.resume()), opTimeoutMs, 'e2e.resume');

    const samples = [];
    const warmupSamples = [];
    let maxTps = 0;
    let maxSpeed = 0;
    let maxFrameMs = 0;
    const start = Date.now();
    const totalWindowMs = warmupMs + durationMs;
    while (Date.now() - start < totalWindowMs) {
      assertRuntimeBudget('sampling');
      const evalStart = Date.now();
      const bench = await withTimeout(page.evaluate(() => {
        const metrics = window.__E2E__.getBenchMetrics?.() || {};
        const state = window.__E2E__.getState?.() || {};
        const timer = state?.game?.timer || {};
        return {
          ...metrics,
          reverse: !!state?.game?.timeTravel?.isReversing,
          frameMs: Number(timer.frameTime || 0)
        };
      }), opTimeoutMs, 'sampleBenchMetrics');

      const evalMs = Date.now() - evalStart;
      const tps = Number(bench?.tps || 0);
      const speed = Number(bench?.speedFactor || 0);
      const frameMs = Number(bench?.frameMs || 0);
      if (tps > maxTps) maxTps = tps;
      if (speed > maxSpeed) maxSpeed = speed;
      if (frameMs > maxFrameMs) maxFrameMs = frameMs;
      const elapsedMs = Date.now() - start;
      const sample = {
        elapsedMs,
        tps,
        speedFactor: speed,
        frameMs,
        evalMs,
        reverse: !!bench?.reverse,
        benchMaxSpeed: bench?.benchMaxSpeed ?? null
      };
      if (elapsedMs < warmupMs) {
        warmupSamples.push(sample);
      } else {
        samples.push({
          ...sample,
          elapsedMs: elapsedMs - warmupMs
        });
      }
      await sleep(sampleMs);
    }

    try {
      await withTimeout(page.evaluate(() => window.__E2E__.pause()), opTimeoutMs, 'finalPause');
    } catch (error) {
      // Some bench modes can saturate the game loop near teardown; keep the
      // collected metrics and continue shutdown instead of failing the run.
      console.warn(error?.message || String(error));
    }

    const frameSeries = samples
      .map(sample => Number(sample.frameMs || 0))
      .filter(value => Number.isFinite(value) && value > 0);
    const medianFrame = median(frameSeries);
    const frameOutlierThreshold = Math.max(120, medianFrame * 3);
    const evalOutlierThreshold = Math.max(1000, sampleMs * 2);
    const flaggedSamples = samples.map(sample => {
      const frameOutlier = sample.frameMs > frameOutlierThreshold;
      const evalOutlier = sample.evalMs > evalOutlierThreshold;
      return {
        ...sample,
        outlier: frameOutlier || evalOutlier,
        outlierReason: frameOutlier
          ? `frameMs>${frameOutlierThreshold.toFixed(1)}`
          : evalOutlier ? `evalMs>${evalOutlierThreshold.toFixed(1)}` : null
      };
    });
    const filteredSamples = flaggedSamples.filter(sample => !sample.outlier);

    const summary = {
      profile: requestedProfile,
      mode,
      durationMs,
      warmupMs,
      sampleMs,
      entrances,
      url: buildUrl(baseUrl),
      maxTps,
      maxSpeed,
      maxFrameMs,
      frameOutlierThreshold,
      evalOutlierThreshold,
      warmupSampleCount: warmupSamples.length,
      sampleCount: flaggedSamples.length,
      filteredSampleCount: filteredSamples.length,
      outlierCount: flaggedSamples.length - filteredSamples.length,
      tpsStats: summarize(flaggedSamples, 'tps'),
      speedStats: summarize(flaggedSamples, 'speedFactor'),
      frameStats: summarize(flaggedSamples, 'frameMs'),
      evalStats: summarize(flaggedSamples, 'evalMs'),
      filteredTpsStats: summarize(filteredSamples, 'tps'),
      filteredSpeedStats: summarize(filteredSamples, 'speedFactor'),
      filteredFrameStats: summarize(filteredSamples, 'frameMs'),
      samples: flaggedSamples
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closeQuietly(page, 'page.close');
    await closeQuietly(context, 'context.close');
    await closeQuietly(browser, 'browser.close');
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
