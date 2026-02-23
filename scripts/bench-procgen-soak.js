import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://localhost:8080/procgen.html?e2e=1';

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

  return {
    baseUrl,
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
const run = async (config = createProcgenSoakConfig()) => {
  let browser = null;
  let context = null;
  let page = null;
  const runStart = Date.now();
  const samples = [];
  const {
    baseUrl,
    durationMs,
    warmupMs,
    sampleMs,
    opTimeoutMs,
    maxRuntimeMs,
    heapLimitMb,
    headless
  } = config;

  const assertRuntimeBudget = (phase) => {
    const elapsed = Date.now() - runStart;
    if (elapsed > maxRuntimeMs) {
      throw new Error(`Procgen soak exceeded max runtime (${maxRuntimeMs}ms) during ${phase}.`);
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

    await withTimeout(page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' }), opTimeoutMs, 'page.goto');
    await withTimeout(
      page.waitForFunction(() => window.__E2E__?.getState?.().ready === true),
      opTimeoutMs,
      'waitForProcgenReady'
    );

    await withTimeout(page.evaluate(() => window.__E2E__.resume()), opTimeoutMs, 'e2e.resume');

    const loopStart = Date.now();
    const totalWindow = warmupMs + durationMs;
    while (Date.now() - loopStart < totalWindow) {
      assertRuntimeBudget('sampling');
      const sample = await withTimeout(page.evaluate(() => {
        const state = window.__E2E__?.getState?.() || {};
        const timer = state?.game?.timer || {};
        const manager = state?.game?.lemmingManager || {};
        const history = state?.game?.history || {};
        const perfMem = (typeof performance !== 'undefined' && performance.memory)
          ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
          }
          : null;
        return {
          tick: Number(timer.tickIndex || 0),
          frameMs: Number(timer.frameTime || 0),
          speedFactor: Number(timer.speedFactor || 0),
          activeCount: Number(manager.activeCount || 0),
          totalCount: Number(manager.totalCount || 0),
          spawnTotal: Number(manager.spawnTotal || 0),
          historySpanTicks: Number(history.spanTicks || 0),
          memory: perfMem
        };
      }), opTimeoutMs, 'sampleProcgenState');

      samples.push({
        elapsedMs: Date.now() - loopStart,
        ...sample
      });
      await sleep(sampleMs);
    }

    await withTimeout(page.evaluate(() => window.__E2E__.pause()), opTimeoutMs, 'e2e.pause');

    const measured = samples
      .filter(sample => sample.elapsedMs >= warmupMs)
      .map(sample => ({ ...sample, elapsedMs: sample.elapsedMs - warmupMs }));
    const warmupSamples = samples.length - measured.length;

    const first = measured[0] || null;
    const last = measured[measured.length - 1] || null;
    const memorySamples = measured
      .map(sample => sample.memory?.usedJSHeapSize || 0)
      .filter(value => Number.isFinite(value) && value > 0);
    const maxHeapBytes = memorySamples.length ? Math.max(...memorySamples) : 0;
    const maxHeapMb = maxHeapBytes > 0 ? (maxHeapBytes / (1024 * 1024)) : 0;

    const summary = {
      url: buildUrl(baseUrl),
      durationMs,
      warmupMs,
      sampleMs,
      sampleCount: measured.length,
      warmupSamples,
      growth: {
        tickDelta: first && last ? Math.max(0, last.tick - first.tick) : 0,
        spawnDelta: first && last ? Math.max(0, last.spawnTotal - first.spawnTotal) : 0,
        activeDelta: first && last ? (last.activeCount - first.activeCount) : 0,
        totalCountDelta: first && last ? (last.totalCount - first.totalCount) : 0,
        historySpanDelta: first && last ? Math.max(0, last.historySpanTicks - first.historySpanTicks) : 0
      },
      frameMsStats: summarize(measured.map(sample => sample.frameMs)),
      activeCountStats: summarize(measured.map(sample => sample.activeCount)),
      totalCountStats: summarize(measured.map(sample => sample.totalCount)),
      maxHeapMb,
      heapLimitMb,
      heapLimitExceeded: heapLimitMb > 0 && maxHeapMb > heapLimitMb,
      samples: measured
    };

    console.log(JSON.stringify(summary, null, 2));

    if (summary.heapLimitExceeded) {
      throw new Error(`Heap usage ${maxHeapMb.toFixed(2)}MB exceeded limit ${heapLimitMb}MB`);
    }
  } finally {
    await closeQuietly(page, 'page.close');
    await closeQuietly(context, 'context.close');
    await closeQuietly(browser, 'browser.close');
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
  buildUrl,
  createProcgenSoakConfig,
  parseArgs,
  run,
  summarize,
  toBoolean,
  toPositiveNumber
};
