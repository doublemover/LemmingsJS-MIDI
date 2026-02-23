import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toNonNegativeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const toFiniteNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const PROFILE_PRESETS = Object.freeze({
  smoke: Object.freeze({
    durationMs: 15000,
    sampleMs: 1000,
    replayChecks: 2,
    maxHeapGrowthBytes: 128 * 1024 * 1024,
    maxHeapChurnBytes: 256 * 1024 * 1024,
    maxSoundQueueRatio: 1.0,
    maxSoundQueueGrowth: 128,
    minHistorySpanTicks: 2000,
    maxTriggerDrift: 0,
    maxRuntimeMs: 90000
  }),
  default: Object.freeze({
    durationMs: 90000,
    sampleMs: 1000,
    replayChecks: 6,
    maxHeapGrowthBytes: 256 * 1024 * 1024,
    maxHeapChurnBytes: 768 * 1024 * 1024,
    maxSoundQueueRatio: 1.0,
    maxSoundQueueGrowth: 256,
    minHistorySpanTicks: 8000,
    maxTriggerDrift: 0,
    maxRuntimeMs: 300000
  }),
  soak: Object.freeze({
    durationMs: 300000,
    sampleMs: 1000,
    replayChecks: 12,
    maxHeapGrowthBytes: 512 * 1024 * 1024,
    maxHeapChurnBytes: 1536 * 1024 * 1024,
    maxSoundQueueRatio: 1.0,
    maxSoundQueueGrowth: 512,
    minHistorySpanTicks: 12000,
    maxTriggerDrift: 0,
    maxRuntimeMs: 420000
  })
});

/**
 * @param {Partial<{
 *   elapsedMs: number,
 *   tickIndex: number,
 *   historySpanTicks: number,
 *   coldBlockCount: number,
 *   soundQueued: number,
 *   soundQueueLimit: number,
 *   triggerCount: number,
 *   heapUsedBytes: number
 * }>} sample
 * @returns {{
 *   elapsedMs: number,
 *   tickIndex: number,
 *   historySpanTicks: number,
 *   coldBlockCount: number,
 *   soundQueued: number,
 *   soundQueueLimit: number,
 *   triggerCount: number,
 *   heapUsedBytes: number
 * }}
 */
const normalizeLongSessionSample = (sample) => ({
  elapsedMs: toNonNegativeNumber(sample?.elapsedMs, 0),
  tickIndex: toFiniteNumber(sample?.tickIndex, 0),
  historySpanTicks: toNonNegativeNumber(sample?.historySpanTicks, 0),
  coldBlockCount: toNonNegativeNumber(sample?.coldBlockCount, 0),
  soundQueued: toNonNegativeNumber(sample?.soundQueued, 0),
  soundQueueLimit: toNonNegativeNumber(sample?.soundQueueLimit, 0),
  triggerCount: toNonNegativeNumber(sample?.triggerCount, 0),
  heapUsedBytes: toNonNegativeNumber(sample?.heapUsedBytes, 0)
});

/**
 * @param {{
 *   samples?: Array<{
 *     tickIndex?: number,
 *     heapUsedBytes?: number,
 *     soundQueued?: number,
 *     soundQueueLimit?: number,
 *     historySpanTicks?: number,
 *     triggerCount?: number
 *   }>,
 *   replayChecks?: Array<{hashMatch?: boolean}>,
 *   thresholds?: {
 *     maxHeapGrowthBytes?: number,
 *     maxHeapChurnBytes?: number,
 *     maxSoundQueueRatio?: number,
 *     maxSoundQueueGrowth?: number,
 *     minHistorySpanTicks?: number,
 *     maxTriggerDrift?: number
 *   }
 * }} [options]
 * @returns {{
 *   metrics: {
 *     sampleCount: number,
 *     replayCheckCount: number,
 *     tickProgress: number,
 *     heapGrowthBytes: number,
 *     heapChurnBytes: number,
 *     maxSoundQueueRatio: number,
 *     soundQueueGrowth: number,
 *     historySpanEnd: number,
 *     triggerDrift: number,
 *     replayMismatchCount: number
 *   },
 *   failures: string[]
 * }}
 */
const evaluateLongSessionGates = ({
  samples = [],
  replayChecks = [],
  thresholds = PROFILE_PRESETS.smoke
} = {}) => {
  const clean = Array.isArray(samples) ? samples.filter(Boolean) : [];
  const replay = Array.isArray(replayChecks) ? replayChecks.filter(Boolean) : [];
  const first = clean[0] || null;
  const last = clean[clean.length - 1] || null;
  const heapStart = Number(first?.heapUsedBytes || 0);
  const heapEnd = Number(last?.heapUsedBytes || 0);
  const heapGrowthBytes = (Number.isFinite(heapStart) && Number.isFinite(heapEnd))
    ? Math.max(0, heapEnd - heapStart)
    : 0;
  const heapSeries = clean
    .map((sample) => Number(sample.heapUsedBytes || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  let heapChurnBytes = 0;
  for (let i = 1; i < heapSeries.length; i += 1) {
    heapChurnBytes += Math.abs(heapSeries[i] - heapSeries[i - 1]);
  }

  const queueRatios = clean
    .map((sample) => {
      const limit = Number(sample.soundQueueLimit || 0);
      const queued = Number(sample.soundQueued || 0);
      if (!Number.isFinite(limit) || limit <= 0) return 0;
      return queued / limit;
    })
    .filter((value) => Number.isFinite(value) && value >= 0);
  const maxSoundQueueRatio = queueRatios.length ? Math.max(...queueRatios) : 0;
  const queueStart = Number(first?.soundQueued || 0);
  const queueEnd = Number(last?.soundQueued || 0);
  const soundQueueGrowth = Number.isFinite(queueStart) && Number.isFinite(queueEnd)
    ? Math.max(0, queueEnd - queueStart)
    : 0;

  const tickSeries = clean
    .map((sample) => Number(sample.tickIndex || 0))
    .filter((value) => Number.isFinite(value));
  const tickProgress = tickSeries.length > 1
    ? tickSeries[tickSeries.length - 1] - tickSeries[0]
    : 0;

  const triggerStart = Number(first?.triggerCount || 0);
  const triggerEnd = Number(last?.triggerCount || 0);
  const triggerDrift = Number.isFinite(triggerStart) && Number.isFinite(triggerEnd)
    ? Math.abs(triggerEnd - triggerStart)
    : 0;

  const historySpanEnd = Number(last?.historySpanTicks || 0);
  const replayMismatchCount = replay.filter(check => check.hashMatch === false).length;

  const failures = [];
  if (tickProgress <= 0) {
    failures.push('tick_progress_stalled');
  }
  if (heapGrowthBytes > Number(thresholds.maxHeapGrowthBytes || 0)) {
    failures.push('heap_growth_exceeded');
  }
  if (heapChurnBytes > Number(thresholds.maxHeapChurnBytes || 0)) {
    failures.push('heap_churn_exceeded');
  }
  if (maxSoundQueueRatio > Number(thresholds.maxSoundQueueRatio || 1)) {
    failures.push('sound_queue_ratio_exceeded');
  }
  if (soundQueueGrowth > Number(thresholds.maxSoundQueueGrowth || 0)) {
    failures.push('sound_queue_growth_exceeded');
  }
  if (historySpanEnd < Number(thresholds.minHistorySpanTicks || 0)) {
    failures.push('history_span_below_minimum');
  }
  if (triggerDrift > Number(thresholds.maxTriggerDrift || 0)) {
    failures.push('trigger_count_drift_detected');
  }
  if (replayMismatchCount > 0) {
    failures.push('replay_hash_mismatch');
  }

  return {
    metrics: {
      sampleCount: clean.length,
      replayCheckCount: replay.length,
      tickProgress,
      heapGrowthBytes,
      heapChurnBytes,
      maxSoundQueueRatio,
      soundQueueGrowth,
      historySpanEnd,
      triggerDrift,
      replayMismatchCount
    },
    failures
  };
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isMainModule = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.get('url') || process.env.LEMMINGS_BENCH_URL || 'https://localhost:8080/?e2e=1';
  const requestedProfile = (
    args.get('profile')
    || process.env.LONG_SESSION_PROFILE
    || (args.has('soak') ? 'soak' : args.has('smoke') ? 'smoke' : 'smoke')
  ).toLowerCase();
  const preset = PROFILE_PRESETS[requestedProfile] || PROFILE_PRESETS.smoke;
  const durationMs = toPositiveNumber(args.get('duration') || process.env.LONG_SESSION_DURATION_MS, preset.durationMs);
  const sampleMs = toPositiveNumber(args.get('sample') || process.env.LONG_SESSION_SAMPLE_MS, preset.sampleMs);
  const replayChecksTarget = Math.max(1, Math.trunc(toPositiveNumber(
    args.get('replayChecks') || process.env.LONG_SESSION_REPLAY_CHECKS,
    preset.replayChecks
  )));
  const opTimeoutMs = toPositiveNumber(args.get('opTimeout') || process.env.LONG_SESSION_OP_TIMEOUT_MS, 30000);
  const maxRuntimeMs = toPositiveNumber(args.get('maxRuntime') || process.env.LONG_SESSION_MAX_RUNTIME_MS, preset.maxRuntimeMs);
  const headless = (args.get('headless') || process.env.LONG_SESSION_HEADLESS || 'true') !== 'false';

  const runStart = Date.now();
  const assertRuntimeBudget = (phase) => {
    const elapsed = Date.now() - runStart;
    if (elapsed > maxRuntimeMs) {
      throw new Error(`Long-session bench exceeded max runtime (${maxRuntimeMs}ms) during ${phase}.`);
    }
  };

  const toBenchUrl = (raw) => {
    const url = new URL(raw);
    url.searchParams.set('e2e', '1');
    if (!url.searchParams.has('profile')) {
      url.searchParams.set('profile', 'perf');
    }
    return url.toString();
  };

  let browser = null;
  let context = null;
  let page = null;
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
      page.goto(toBenchUrl(baseUrl), { waitUntil: 'domcontentloaded' }),
      opTimeoutMs,
      'page.goto'
    );
    await withTimeout(
      page.waitForFunction(() => window.__E2E__?.getState?.().ready === true),
      opTimeoutMs,
      'waitForReady'
    );

    await withTimeout(page.evaluate(() => window.__E2E__.resume()), opTimeoutMs, 'resume');
    const samples = [];
    const replayChecks = [];
    const replayEveryMs = Math.max(sampleMs, Math.trunc(durationMs / replayChecksTarget));
    let lastReplayAtMs = -Infinity;
    const start = Date.now();

    while (Date.now() - start < durationMs) {
      assertRuntimeBudget('sampling');
      const elapsedMs = Date.now() - start;
      const rawSample = await withTimeout(page.evaluate((elapsed) => {
        const state = window.__E2E__?.getState?.() || {};
        const game = state.game || {};
        const history = game.history || {};
        const sound = game.soundEvents || {};
        const triggers = game.triggers || {};
        const memory = typeof performance !== 'undefined' ? performance.memory : null;
        return {
          elapsedMs: Number(elapsed || 0),
          tickIndex: Number(game.timer?.tickIndex || 0),
          historySpanTicks: Number(history.spanTicks || 0),
          coldBlockCount: Number(history.coldBlockCount || 0),
          soundQueued: Number(sound.queuedCount || 0),
          soundQueueLimit: Number(sound.queueLimit || 0),
          triggerCount: Number(triggers.totalCount || 0),
          heapUsedBytes: Number(memory?.usedJSHeapSize || 0)
        };
      }, elapsedMs), opTimeoutMs, 'sampleState');
      const sample = normalizeLongSessionSample(rawSample);
      samples.push(sample);

      if (elapsedMs - lastReplayAtMs >= replayEveryMs) {
        lastReplayAtMs = elapsedMs;
        const replayCheck = await withTimeout(page.evaluate(() => {
          const api = window.__E2E__;
          const state = api?.getState?.();
          const history = state?.game?.history;
          if (!api?.getDelta || !history) {
            return { hashMatch: true, hashBefore: null, hashAfter: null, checked: false };
          }
          const minTick = Number.isFinite(history.minTick) ? Math.trunc(history.minTick) : 0;
          const maxTick = Number.isFinite(history.maxTick) ? Math.trunc(history.maxTick) : minTick;
          const current = Number.isFinite(state?.game?.timer?.tickIndex)
            ? Math.trunc(state.game.timer.tickIndex)
            : maxTick;
          const hashFn = () => {
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
              pushAscii(tick);
              pushAscii(delta.flags ?? 0);
              pushAscii(delta.soundEvents?.length || 0);
              pushAscii(delta.minimapDeaths?.length || 0);
              pushByte(10);
            }
            return (hash >>> 0).toString(16).padStart(8, '0');
          };
          const hashBefore = hashFn();
          const span = Math.max(1, maxTick - minTick);
          const target = Math.max(minTick, current - Math.max(1, Math.trunc(span * 0.25)));
          api.seek(target);
          api.seek(current);
          const hashAfter = hashFn();
          return {
            checked: true,
            hashBefore,
            hashAfter,
            hashMatch: hashBefore === hashAfter
          };
        }), opTimeoutMs, 'replayCheck');
        replayChecks.push(replayCheck);
      }

      await sleep(sampleMs);
    }

    await withTimeout(page.evaluate(() => window.__E2E__.pause()), opTimeoutMs, 'pause');

    const thresholds = {
      ...preset,
      maxHeapGrowthBytes: toPositiveNumber(
        args.get('maxHeapGrowthBytes') || process.env.LONG_SESSION_MAX_HEAP_GROWTH_BYTES,
        preset.maxHeapGrowthBytes
      ),
      maxHeapChurnBytes: toPositiveNumber(
        args.get('maxHeapChurnBytes') || process.env.LONG_SESSION_MAX_HEAP_CHURN_BYTES,
        preset.maxHeapChurnBytes
      ),
      maxSoundQueueRatio: toNonNegativeNumber(
        args.get('maxSoundQueueRatio') || process.env.LONG_SESSION_MAX_SOUND_QUEUE_RATIO,
        preset.maxSoundQueueRatio
      ),
      maxSoundQueueGrowth: toNonNegativeNumber(
        args.get('maxSoundQueueGrowth') || process.env.LONG_SESSION_MAX_SOUND_QUEUE_GROWTH,
        preset.maxSoundQueueGrowth
      ),
      minHistorySpanTicks: toPositiveNumber(
        args.get('minHistorySpanTicks') || process.env.LONG_SESSION_MIN_HISTORY_SPAN_TICKS,
        preset.minHistorySpanTicks
      ),
      maxTriggerDrift: toNonNegativeNumber(
        args.get('maxTriggerDrift') || process.env.LONG_SESSION_MAX_TRIGGER_DRIFT,
        preset.maxTriggerDrift
      )
    };
    const evaluation = evaluateLongSessionGates({
      samples,
      replayChecks,
      thresholds
    });
    const summary = {
      profile: requestedProfile,
      url: toBenchUrl(baseUrl),
      durationMs,
      sampleMs,
      thresholds,
      metrics: evaluation.metrics,
      failures: evaluation.failures,
      samples,
      replayChecks
    };
    console.log(JSON.stringify(summary, null, 2));
    if (evaluation.failures.length) {
      process.exitCode = 1;
    }
  } finally {
    await closeQuietly(page, 'page.close');
    await closeQuietly(context, 'context.close');
    await closeQuietly(browser, 'browser.close');
  }
};

if (isMainModule) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  PROFILE_PRESETS,
  evaluateLongSessionGates,
  normalizeLongSessionSample,
  toNonNegativeNumber,
  toPositiveNumber
};
