import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { installProcgenSoakProbe } from './ProcgenSoakProbe.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';

const DEFAULT_BASE_URL = 'https://localhost:8080/dist/browser/procgen.html?e2e=1&workstation=1';

const toNumberOrNaN = (value) => {
  try {
    return Number(value);
  } catch {
    return Number.NaN;
  }
};

/**
 * @param {string[]} argv
 * @returns {Map<string, string>}
 */
const parseArgs = (argv) => {
  const out = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=', 2);
    out.set(key, value ?? 'true');
  }
  return out;
};

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveNumber = (value, fallback) => {
  const parsed = toNumberOrNaN(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
const toBoolean = (value, fallback) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
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
    // best effort shutdown
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {number[]} values
 * @returns {{min: number, max: number, p50: number, p95: number, avg: number}}
 */
const summarize = (values) => {
  const nums = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return { min: 0, max: 0, p50: 0, p95: 0, avg: 0 };
  const pick = (ratio) => nums[Math.min(nums.length - 1, Math.floor((nums.length - 1) * ratio))];
  const sum = nums.reduce((acc, value) => acc + value, 0);
  return {
    min: nums[0],
    max: nums[nums.length - 1],
    p50: pick(0.5),
    p95: pick(0.95),
    avg: sum / nums.length
  };
};

/**
 * @param {string} raw
 * @param {string} [fallback]
 * @returns {string}
 */
const buildUrl = (raw, fallback = DEFAULT_BASE_URL) => {
  let candidate = null;
  try {
    candidate = new URL(raw || fallback);
  } catch {
    candidate = new URL(fallback);
  }
  candidate.searchParams.set('e2e', '1');
  candidate.searchParams.set('workstation', '1');
  return candidate.toString();
};

/**
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv}} [options]
 * @returns {{
 *   baseUrl: string,
 *   durationMs: number,
 *   warmupMs: number,
 *   sampleMs: number,
 *   opTimeoutMs: number,
 *   maxRuntimeMs: number,
 *   heapLimitMb: number,
 *   headless: boolean
 * }}
 */
const createProcgenSoakConfig = ({
  argv = process.argv.slice(2),
  env = process.env
} = {}) => {
  const args = parseArgs(argv);
  const baseUrl = args.get('url') || env.LEMMINGS_PROCGEN_URL || DEFAULT_BASE_URL;
  const durationMs = toPositiveNumber(args.get('duration') || env.PROCGEN_SOAK_DURATION_MS, 60000);
  const warmupMs = toPositiveNumber(args.get('warmup') || env.PROCGEN_SOAK_WARMUP_MS, 5000);
  const sampleMs = toPositiveNumber(args.get('sample') || env.PROCGEN_SOAK_SAMPLE_MS, 1000);
  const opTimeoutMs = toPositiveNumber(args.get('opTimeout') || env.PROCGEN_SOAK_OP_TIMEOUT_MS, 30000);
  const maxRuntimeMs = toPositiveNumber(
    args.get('maxRuntime') || env.PROCGEN_SOAK_MAX_RUNTIME_MS,
    warmupMs + durationMs + Math.max(60000, sampleMs * 20)
  );
  const heapLimitMb = toPositiveNumber(args.get('heapLimitMb') || env.PROCGEN_SOAK_HEAP_LIMIT_MB, 0);
  const headless = toBoolean(args.get('headless') || env.PROCGEN_SOAK_HEADLESS, true);
  if (durationMs > 3600000 || warmupMs > 600000 || sampleMs < 10 || Math.ceil(durationMs / sampleMs) + 2 > 16384 || maxRuntimeMs < warmupMs + durationMs)
    throw new RangeError('ProcGen soak observation duration/sample bounds exceed the finite receipt policy.');

  return {
    baseUrl,
    name: args.get('name') || 'rook',
    durationMs,
    warmupMs,
    sampleMs,
    opTimeoutMs,
    maxRuntimeMs,
    heapLimitMb,
    headless
  };
};

/**
 * Runs the procgen soak benchmark in a Playwright browser context.
 *
 * @param {{
 *   baseUrl: string,
 *   durationMs: number,
 *   warmupMs: number,
 *   sampleMs: number,
 *   opTimeoutMs: number,
 *   maxRuntimeMs: number,
 *   heapLimitMb: number,
 *   headless: boolean
 * }} [config]
 * @returns {Promise<void>}
 */
const admitProcgenSoakMeasurement = report => {
  if (report?.schema !== 'procgen-completed-work-probe/v1' || report.clock !== 'browser-performance-now' ||
      !Number.isSafeInteger(report.completedTicks) || report.completedTicks <= 0 || report.failedSteps !== 0 ||
      report.observedStepCalls !== report.completedTicks || report.worldTickDelta !== report.completedTicks ||
      report.stepMs?.samples !== report.completedTicks || !Number.isSafeInteger(report.rafIntervalMs?.samples) || report.rafIntervalMs.samples < 1 ||
      !Number.isFinite(report.end?.observationTime - report.baseline?.observationTime) || report.end.observationTime <= report.baseline.observationTime)
    throw new Error('ProcGen soak did not observe a comparable completed-work window.');
  return true;
};
const run = async (config = createProcgenSoakConfig(), { log = console.log } = {}) => {
  let browser = null, context = null, page = null;
  const { baseUrl, durationMs, warmupMs, sampleMs, opTimeoutMs, maxRuntimeMs, heapLimitMb, headless } = config;
  if (![durationMs, warmupMs, sampleMs, opTimeoutMs, maxRuntimeMs, heapLimitMb].every(Number.isFinite) || durationMs <= 0 || warmupMs < 0 || opTimeoutMs <= 0 || heapLimitMb < 0 || typeof headless !== 'boolean' ||
      durationMs > 3600000 || warmupMs > 600000 || sampleMs < 10 || Math.ceil(durationMs / sampleMs) + 2 > 16384 || maxRuntimeMs < warmupMs + durationMs)
    throw new RangeError('ProcGen soak needs bounded observation timing.');
  const runStart = performance.now(), samples = [];
  const assertRuntimeBudget = () => { if (performance.now() - runStart > maxRuntimeMs) throw new Error('ProcGen soak exceeded its declared runtime.'); };
  const source = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD', '--', '.', ':(exclude).repoMetrics'], { maxBuffer: 32 * 1048576 })).digest('hex'),
    harness: ['bench-procgen-soak.js', 'ProcgenSoakProbe.js'].map(file => ({ file: 'scripts/' + file, sha256: createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex') })) };
  try {
    browser = await withTimeout(chromium.launch({ headless, args: ['--allow-insecure-localhost', '--ignore-certificate-errors'] }), opTimeoutMs, 'chromium.launch');
    context = await withTimeout(browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, ignoreHTTPSErrors: true }), opTimeoutMs, 'browser.newContext');
    page = await withTimeout(context.newPage(), opTimeoutMs, 'context.newPage'); page.setDefaultTimeout(opTimeoutMs);
    await withTimeout(page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' }), opTimeoutMs, 'page.goto');
    await page.waitForFunction(() => window.__PROCGEN_LANES__?.world?.workstationEnabled && window.__PROCGEN_STUDIO__?.play, null, { timeout: opTimeoutMs });
    const environment = await page.evaluate(async () => {
      const { getActiveExecutionIdentity } = await import(new URL('js/runtime/ActiveExecutionIdentity.js', new URL('./', location.href)));
      const identity = getActiveExecutionIdentity('browser-survey-core');
      if (identity.activeExecution !== 'bound') throw new Error('Build the immutable browser runtime before measuring ProcGen.');
      const studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__, world = api.world;
      studio.transport.pause(); api.pause();
      return { executionIdentity: identity, seed: world.seed, lanes: world.laneCount, initialTick: world.tickIndex,
        rendererMode: api.renderer.workstationLayout.mode, visibleRows: api.renderer.workstationLayout.count,
        viewport: { width: window.innerWidth, height: window.innerHeight }, dpr: window.devicePixelRatio, userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory ?? null,
        output: studio.getOperationalSnapshot().output, scope: 'private headless browser; no native GPU, receiver or acoustic equivalence' };
    });
    await page.evaluate('void (globalThis.__PROCGEN_SOAK_PROBE__ = (' + installProcgenSoakProbe.toString() + ')())');
    await page.evaluate(() => window.__PROCGEN_STUDIO__.play());
    const warmupEnd = performance.now() + warmupMs;
    while (performance.now() < warmupEnd) { assertRuntimeBudget(); await sleep(Math.min(1000, Math.max(1, warmupEnd - performance.now()))); }
    await page.evaluate(() => window.__PROCGEN_SOAK_PROBE__.resetWindow());
    const endAt = performance.now() + durationMs;
    while (performance.now() < endAt) {
      assertRuntimeBudget();
      samples.push(await withTimeout(page.evaluate(() => window.__PROCGEN_SOAK_PROBE__.sample()), opTimeoutMs, 'sampleProcgenCompletedWork'));
      if (samples.length >= 16383) throw new Error('ProcGen soak reached its finite observation capacity.');
      await sleep(Math.max(1, Math.min(sampleMs, endAt - performance.now())));
    }
    await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.pause());
    const measurement = await page.evaluate(() => window.__PROCGEN_SOAK_PROBE__.report()); admitProcgenSoakMeasurement(measurement);
    const last = measurement.end, first = measurement.baseline, elapsedMs = last.observationTime - first.observationTime;
    samples.push({ ...last, completedTicks: measurement.completedTicks, failedSteps: measurement.failedSteps });
    const heaps = samples.map(sample => sample.memory?.usedJSHeapSize).filter(value => Number.isFinite(value) && value > 0);
    const maxHeapMb = heaps.length ? Math.max(...heaps) / 1048576 : null;
    if (heapLimitMb > 0 && maxHeapMb === null) throw new Error('Heap observations are unavailable; the requested heap limit was not qualified.');
    const summary = { schema: 'lemmings-procgen-soak/v2', name: config.name || 'rook', source, environment: { ...environment, browserVersion: browser.version(),
      os: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpu: os.cpus()[0]?.model || null, logicalProcessors: os.availableParallelism(), totalMemoryBytes: os.totalmem() } },
    url: page.url(), durationMs, warmupMs, sampleMs, sampleCount: samples.length, maximumSamples: 16384, measurement,
    observedTicksPerSecond: measurement.completedTicks * 1000 / elapsedMs,
    growth: { tickDelta: measurement.worldTickDelta, spawnDelta: last.spawnTotal - first.spawnTotal, activeDelta: last.activeCount - first.activeCount, totalCountDelta: last.totalCount - first.totalCount },
    maxHeapMb, heapLimitMb, heapLimitExceeded: heapLimitMb > 0 && maxHeapMb !== null && maxHeapMb > heapLimitMb, memoryScope: 'Chromium performance.memory allocator estimate; native/GPU memory and collected retained heap are not established', samples,
    qualification: 'completed-work timing only; input/audio tails, injected persistence stalls, observer overhead A/B and stable-population lifetime-birth comparisons require separate receipts' };
    log(JSON.stringify(summary, null, 2));
    if (summary.heapLimitExceeded) throw new Error('ProcGen soak exceeded its declared observed heap limit.');
    return summary;
  } finally {
    if (page) { try { await withTimeout(page.evaluate(() => { window.__PROCGEN_STUDIO__?.transport.pause(); window.__PROCGEN_SOAK_PROBE__?.dispose(); delete window.__PROCGEN_SOAK_PROBE__; }), 5000, 'retireProcgenProbe'); } catch {} }
    await closeQuietly(page, 'page.close'); await closeQuietly(context, 'context.close'); await closeQuietly(browser, 'browser.close');
  }
};

const isDirectExecution = () => {
  const entry = process.argv?.[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  admitProcgenSoakMeasurement,
  buildUrl,
  createProcgenSoakConfig,
  parseArgs,
  run,
  summarize,
  toBoolean,
  toPositiveNumber
};
