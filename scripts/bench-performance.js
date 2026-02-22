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

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.get('url') || process.env.LEMMINGS_BENCH_URL || 'https://localhost:8080/?e2e=1';
const requestedProfile = (args.get('profile') || process.env.BENCH_PROFILE || 'default').toLowerCase();
const headless = (args.get('headless') || process.env.BENCH_HEADLESS || 'true') !== 'false';

const BENCH_PROFILES = {
  default: {
    mode: 'sequence',
    durationMs: 60000,
    sampleMs: 1000,
    entrances: 50,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true' }
  },
  stress: {
    mode: 'bench',
    durationMs: 90000,
    sampleMs: 500,
    entrances: 180,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true', bench2: 'true' }
  },
  reverse: {
    mode: 'reverse',
    durationMs: 90000,
    sampleMs: 500,
    entrances: 160,
    query: { profile: 'perf', performanceAPI: 'true', perfOverlay: 'true', benchReverse: 'true' }
  }
};

const profile = BENCH_PROFILES[requestedProfile] || BENCH_PROFILES.default;
const durationMs = Number(args.get('duration') || process.env.BENCH_DURATION_MS || profile.durationMs);
const sampleMs = Number(args.get('sample') || process.env.BENCH_SAMPLE_MS || profile.sampleMs);
const warmupMs = Number(args.get('warmup') || process.env.BENCH_WARMUP_MS || Math.max(5000, sampleMs * 4));
const mode = (args.get('mode') || process.env.BENCH_MODE || profile.mode).toLowerCase();
const entrances = Number(args.get('entrances') || process.env.BENCH_ENTRANCES || profile.entrances);

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
  const browser = await chromium.launch({
    headless,
    args: ['--allow-insecure-localhost', '--ignore-certificate-errors']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__E2E__?.getState?.().ready === true);

  await page.evaluate(() => window.__E2E__.pause());
  const capabilities = await page.evaluate(() => ({
    startBenchSequence: typeof window.__E2E__?.startBenchSequence === 'function',
    startBench: typeof window.__E2E__?.startBench === 'function',
    startReverse: typeof window.__E2E__?.startReverse === 'function'
  }));

  if (mode === 'sequence' && capabilities.startBenchSequence) {
    await page.evaluate(() => window.__E2E__.startBenchSequence());
  } else if (mode === 'reverse') {
    if (capabilities.startBench) {
      await page.evaluate((count) => window.__E2E__.startBench(count), entrances);
    }
    if (capabilities.startReverse) {
      await page.evaluate(() => window.__E2E__.startReverse());
    }
  } else if (capabilities.startBench) {
    await page.evaluate((count) => window.__E2E__.startBench(count), entrances);
  }
  await page.evaluate(() => window.__E2E__.resume());

  const samples = [];
  const warmupSamples = [];
  let maxTps = 0;
  let maxSpeed = 0;
  let maxFrameMs = 0;
  const start = Date.now();
  const totalWindowMs = warmupMs + durationMs;
  while (Date.now() - start < totalWindowMs) {
    const evalStart = Date.now();
    const bench = await page.evaluate(() => {
      const metrics = window.__E2E__.getBenchMetrics?.() || {};
      const state = window.__E2E__.getState?.() || {};
      const timer = state?.game?.timer || {};
      return {
        ...metrics,
        reverse: !!state?.game?.timeTravel?.isReversing,
        frameMs: Number(timer.frameTime || 0)
      };
    });
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

  await page.evaluate(() => window.__E2E__.pause());
  await browser.close();
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
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
