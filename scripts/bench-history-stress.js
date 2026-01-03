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
const durationMs = Number(args.get('duration') || process.env.HISTORY_DURATION_MS || 60000);
const sampleMs = Number(args.get('sample') || process.env.HISTORY_SAMPLE_MS || 1000);
const targetSpan = Number(args.get('target') || process.env.HISTORY_TARGET_TICKS || 60000);
const speeds = (args.get('speeds') || process.env.HISTORY_SPEEDS || '30,60,120')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isFinite(value) && value > 0);
const headless = (args.get('headless') || process.env.HISTORY_HEADLESS || 'true') !== 'false';

const buildUrl = (raw) => {
  const url = new URL(raw);
  url.searchParams.set('e2e', '1');
  url.searchParams.set('ph', 'true');
  url.searchParams.set('endless', 'true');
  return url.toString();
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const run = async () => {
  const browser = await chromium.launch({
    headless,
    args: ['--allow-insecure-localhost', '--ignore-certificate-errors']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const results = [];
  for (const speed of speeds) {
    await page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__E2E__?.getState?.().ready === true);
    await page.evaluate((value) => window.__E2E__.setSpeed(value), speed);
    await page.evaluate(() => window.__E2E__.resume());

    const start = Date.now();
    let spanTicks = 0;
    let maxSpan = 0;
    while (Date.now() - start < durationMs) {
      const history = await page.evaluate(() => window.__E2E__.getState().game.history);
      spanTicks = history?.spanTicks || 0;
      if (spanTicks > maxSpan) maxSpan = spanTicks;
      if (spanTicks >= targetSpan) break;
      await sleep(sampleMs);
    }
    await page.evaluate(() => window.__E2E__.pause());
    const memory = await page.evaluate(() => {
      if (typeof performance === 'undefined' || !performance.memory) return null;
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
    });
    results.push({
      speedFactor: speed,
      durationMs: Date.now() - start,
      maxSpanTicks: maxSpan,
      targetSpanTicks: targetSpan,
      memory
    });
  }

  await browser.close();
  console.log(JSON.stringify({
    targetSpanTicks: targetSpan,
    sampleMs,
    results
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
