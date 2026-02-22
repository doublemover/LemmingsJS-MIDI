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
const durationMs = toPositiveNumber(args.get('duration') || process.env.HISTORY_DURATION_MS, 60000);
const sampleMs = toPositiveNumber(args.get('sample') || process.env.HISTORY_SAMPLE_MS, 1000);
const targetSpan = toPositiveNumber(args.get('target') || process.env.HISTORY_TARGET_TICKS, 60000);
const speeds = (args.get('speeds') || process.env.HISTORY_SPEEDS || '30,60,120')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isFinite(value) && value > 0);
const headless = (args.get('headless') || process.env.HISTORY_HEADLESS || 'true') !== 'false';
const opTimeoutMs = toPositiveNumber(args.get('opTimeout') || process.env.HISTORY_OP_TIMEOUT_MS, 30000);
const maxRuntimeMs = toPositiveNumber(
  args.get('maxRuntime') || process.env.HISTORY_MAX_RUNTIME_MS,
  (durationMs * Math.max(speeds.length, 1)) + Math.max(60000, sampleMs * 20)
);

const buildUrl = (raw) => {
  const url = new URL(raw);
  url.searchParams.set('e2e', '1');
  url.searchParams.set('ph', 'true');
  url.searchParams.set('endless', 'true');
  return url.toString();
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const run = async () => {
  let browser = null;
  let context = null;
  let page = null;
  const runStart = Date.now();

  const assertRuntimeBudget = (phase) => {
    const elapsed = Date.now() - runStart;
    if (elapsed > maxRuntimeMs) {
      throw new Error(`History benchmark exceeded max runtime (${maxRuntimeMs}ms) during ${phase}.`);
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

    const results = [];
    for (const speed of speeds) {
      assertRuntimeBudget(`speed=${speed} setup`);
      await withTimeout(page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' }), opTimeoutMs, 'page.goto');
      await withTimeout(
        page.waitForFunction(() => window.__E2E__?.getState?.().ready === true),
        opTimeoutMs,
        'waitForGameReady'
      );
      await withTimeout(page.evaluate((value) => window.__E2E__.setSpeed(value), speed), opTimeoutMs, 'setSpeed');
      await withTimeout(page.evaluate(() => window.__E2E__.resume()), opTimeoutMs, 'e2e.resume');

      const start = Date.now();
      let spanTicks = 0;
      let maxSpan = 0;
      while (Date.now() - start < durationMs) {
        assertRuntimeBudget(`speed=${speed} sampling`);
        const history = await withTimeout(
          page.evaluate(() => window.__E2E__.getState().game.history),
          opTimeoutMs,
          'readHistoryState'
        );
        spanTicks = history?.spanTicks || 0;
        if (spanTicks > maxSpan) maxSpan = spanTicks;
        if (spanTicks >= targetSpan) break;
        await sleep(sampleMs);
      }

      await withTimeout(page.evaluate(() => window.__E2E__.pause()), opTimeoutMs, 'e2e.pause');
      const memory = await withTimeout(page.evaluate(() => {
        if (typeof performance === 'undefined' || !performance.memory) return null;
        return {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        };
      }), opTimeoutMs, 'readMemorySnapshot');

      results.push({
        speedFactor: speed,
        durationMs: Date.now() - start,
        maxSpanTicks: maxSpan,
        targetSpanTicks: targetSpan,
        memory
      });
    }

    console.log(JSON.stringify({
      targetSpanTicks: targetSpan,
      sampleMs,
      results
    }, null, 2));
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
