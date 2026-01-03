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
const durationMs = Number(args.get('duration') || process.env.BENCH_DURATION_MS || 60000);
const sampleMs = Number(args.get('sample') || process.env.BENCH_SAMPLE_MS || 1000);
const mode = (args.get('mode') || process.env.BENCH_MODE || 'sequence').toLowerCase();
const entrances = Number(args.get('entrances') || process.env.BENCH_ENTRANCES || 50);
const headless = (args.get('headless') || process.env.BENCH_HEADLESS || 'true') !== 'false';

const buildUrl = (raw) => {
  const url = new URL(raw);
  url.searchParams.set('e2e', '1');
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
  await page.goto(buildUrl(baseUrl), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__E2E__?.getState?.().ready === true);

  await page.evaluate(() => window.__E2E__.pause());
  if (mode === 'sequence' && window.__E2E__.startBenchSequence) {
    await page.evaluate(() => window.__E2E__.startBenchSequence());
  } else if (window.__E2E__.startBench) {
    await page.evaluate((count) => window.__E2E__.startBench(count), entrances);
  }
  await page.evaluate(() => window.__E2E__.resume());

  const samples = [];
  let maxTps = 0;
  let maxSpeed = 0;
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const bench = await page.evaluate(() => window.__E2E__.getBenchMetrics?.());
    const tps = Number(bench?.tps || 0);
    const speed = Number(bench?.speedFactor || 0);
    if (tps > maxTps) maxTps = tps;
    if (speed > maxSpeed) maxSpeed = speed;
    samples.push({
      elapsedMs: Date.now() - start,
      tps,
      speedFactor: speed,
      benchMaxSpeed: bench?.benchMaxSpeed ?? null
    });
    await sleep(sampleMs);
  }

  await page.evaluate(() => window.__E2E__.pause());
  await browser.close();

  const summary = {
    mode,
    durationMs,
    sampleMs,
    maxTps,
    maxSpeed,
    samples
  };
  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
