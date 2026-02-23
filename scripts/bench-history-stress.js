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

const toBoolean = (value, fallback) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
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
    // best-effort shutdown
  }
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.get('url') || process.env.LEMMINGS_BENCH_URL || 'https://localhost:8080/?e2e=1';
const smokeRequested = args.has('smoke') || process.env.BENCH_SMOKE === '1';
const soakRequested = args.has('soak') || process.env.BENCH_SOAK === '1';
const requestedProfile = (
  args.get('profile') ||
  process.env.HISTORY_PROFILE ||
  (soakRequested ? 'soak' : smokeRequested ? 'smoke' : 'smoke')
).toLowerCase();

const HISTORY_PROFILES = {
  smoke: {
    durationMs: 6000,
    sampleMs: 500,
    targetSpanTicks: 12000,
    speeds: '30,60',
    seekSamples: 4,
    seekP95MsMax: 200,
    maxRuntimeMs: 70000
  },
  default: {
    durationMs: 60000,
    sampleMs: 1000,
    targetSpanTicks: 60000,
    speeds: '30,60,120',
    seekSamples: 12,
    seekP95MsMax: 400,
    maxRuntimeMs: 300000
  },
  soak: {
    durationMs: 180000,
    sampleMs: 1000,
    targetSpanTicks: 60000,
    speeds: '30,60,120',
    seekSamples: 12,
    seekP95MsMax: 400,
    maxRuntimeMs: 300000
  }
};

const profile = HISTORY_PROFILES[requestedProfile] || HISTORY_PROFILES.smoke;
const durationMs = toPositiveNumber(
  args.get('duration') || process.env.HISTORY_DURATION_MS,
  profile.durationMs
);
const sampleMs = toPositiveNumber(
  args.get('sample') || process.env.HISTORY_SAMPLE_MS,
  profile.sampleMs
);
const targetSpan = toPositiveNumber(
  args.get('target') || process.env.HISTORY_TARGET_TICKS,
  profile.targetSpanTicks
);
const speeds = (args.get('speeds') || process.env.HISTORY_SPEEDS || profile.speeds)
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isFinite(value) && value > 0);
const headless = (args.get('headless') || process.env.HISTORY_HEADLESS || 'true') !== 'false';
const opTimeoutMs = toPositiveNumber(args.get('opTimeout') || process.env.HISTORY_OP_TIMEOUT_MS, 30000);
const maxRuntimeMs = toPositiveNumber(
  args.get('maxRuntime') || process.env.HISTORY_MAX_RUNTIME_MS,
  profile.maxRuntimeMs ?? ((durationMs * Math.max(speeds.length, 1)) + Math.max(60000, sampleMs * 20))
);
const seekSamples = Math.max(1, Math.trunc(toPositiveNumber(
  args.get('seekSamples') || process.env.HISTORY_SEEK_SAMPLES,
  profile.seekSamples
)));
const seekP95MsMax = toPositiveNumber(
  args.get('seekP95MsMax') || process.env.HISTORY_SEEK_P95_MS_MAX,
  profile.seekP95MsMax
);
const requireReplayParity = toBoolean(
  args.get('requireReplayParity') || process.env.HISTORY_REQUIRE_REPLAY_PARITY,
  true
);

const buildUrl = (raw) => {
  const url = new URL(raw);
  url.searchParams.set('e2e', '1');
  url.searchParams.set('ph', 'true');
  url.searchParams.set('endless', 'true');
  return url.toString();
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * clamped)));
  return sorted[index];
};

const summarizeTimings = (timingsMs) => {
  const clean = (Array.isArray(timingsMs) ? timingsMs : [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const max = clean.length ? clean[clean.length - 1] : 0;
  return {
    count: clean.length,
    p50Ms: percentile(clean, 0.5),
    p95Ms: percentile(clean, 0.95),
    maxMs: max,
    samplesMs: clean
  };
};

const run = async () => {
  let browser = null;
  let context = null;
  let page = null;
  const runStart = Date.now();
  const failures = [];

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
      const seekProbe = await withTimeout(
        page.evaluate(({ samples }) => {
          const api = window.__E2E__;
          const gameState = api?.getState?.()?.game;
          const historyState = gameState?.history || null;
          const minTick = Number.isFinite(historyState?.minTick) ? Math.trunc(historyState.minTick) : 0;
          const maxTick = Number.isFinite(historyState?.maxTick)
            ? Math.trunc(historyState.maxTick)
            : Math.trunc(gameState?.timer?.tickIndex || 0);
          const startTick = Math.max(minTick, Math.min(maxTick, Math.trunc(gameState?.timer?.tickIndex || maxTick)));
          const seekMs = [];
          const count = Math.max(1, Math.trunc(samples || 1));
          const span = Math.max(1, startTick - minTick);

          const computeReplayHash = () => {
            if (!api?.getDelta || maxTick < minTick) return null;
            let hash = 2166136261;
            const pushByte = (value) => {
              hash ^= value & 0xff;
              hash = Math.imul(hash, 16777619);
            };
            const pushAscii = (value) => {
              const text = String(value);
              for (let i = 0; i < text.length; i += 1) {
                pushByte(text.charCodeAt(i));
              }
              pushByte(124);
            };
            for (let tick = minTick; tick <= maxTick; tick += 1) {
              const delta = api.getDelta(tick);
              if (!delta) continue;
              const noOp = Number.isFinite(delta.flags)
                ? ((delta.flags | 0) === 0 ? 1 : 0)
                : 0;
              pushAscii(tick);
              pushAscii(noOp);
              pushAscii(delta.lemChanges?.ids?.length || 0);
              pushAscii(delta.lemAdded?.length || 0);
              pushAscii(delta.lemRemoved?.length || 0);
              pushAscii(delta.groundChanges?.indices?.length || 0);
              pushAscii(delta.entranceChanges?.indices?.length || 0);
              pushAscii(delta.triggerCooldownChanges?.ids?.length || 0);
              pushAscii(delta.triggerAdd?.length || 0);
              pushAscii(delta.triggerRemove?.length || 0);
              pushAscii(delta.objectAnimChanges?.ids?.length || 0);
              pushAscii(delta.soundEvents?.length || 0);
              pushAscii(delta.minimapDeaths?.length || 0);
              pushByte(10);
            }
            return (hash >>> 0).toString(16).padStart(8, '0');
          };

          const hashBefore = computeReplayHash();
          for (let i = 0; i < count; i += 1) {
            const ratio = (i + 1) / (count + 1);
            const target = Math.max(minTick, startTick - Math.trunc(span * ratio));
            const start = performance.now();
            api.seek(target);
            seekMs.push(performance.now() - start);
          }
          const returnStart = performance.now();
          api.seek(startTick);
          seekMs.push(performance.now() - returnStart);
          const hashAfter = computeReplayHash();
          return {
            minTick,
            maxTick,
            startTick,
            seekMs,
            hashBefore,
            hashAfter,
            hashMatch: hashBefore === hashAfter
          };
        }, { samples: seekSamples }),
        opTimeoutMs,
        'seekReplayProbe'
      );
      const seekStats = summarizeTimings(seekProbe?.seekMs);
      if (seekStats.p95Ms > seekP95MsMax) {
        failures.push(
          `speed=${speed} seek p95 ${seekStats.p95Ms.toFixed(2)}ms > ${seekP95MsMax.toFixed(2)}ms`
        );
      }
      if (requireReplayParity && seekProbe?.hashMatch === false) {
        failures.push(
          `speed=${speed} replay parity mismatch after seeks (${seekProbe.hashBefore} != ${seekProbe.hashAfter})`
        );
      }
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
        seekProbe: {
          minTick: seekProbe?.minTick ?? 0,
          maxTick: seekProbe?.maxTick ?? 0,
          startTick: seekProbe?.startTick ?? 0,
          hashBefore: seekProbe?.hashBefore ?? null,
          hashAfter: seekProbe?.hashAfter ?? null,
          hashMatch: !!seekProbe?.hashMatch,
          ...seekStats
        },
        memory
      });
    }

    console.log(JSON.stringify({
      profile: requestedProfile,
      targetSpanTicks: targetSpan,
      sampleMs,
      seekGate: {
        seekSamples,
        seekP95MsMax,
        requireReplayParity
      },
      results,
      failures
    }, null, 2));
    if (failures.length) {
      process.exitCode = 1;
    }
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
