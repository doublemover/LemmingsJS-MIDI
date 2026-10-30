import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const base = process.env.LEMMINGS_E2E_BASE_URL || 'http://127.0.0.1:8189';
const report = { schema: 'procgen-recovery-cost/v1', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cases: [], errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: process.env.LEMMINGS_E2E_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: MIN_DESKTOP_VIEWPORT }); page.on('pageerror', error => report.errors.push(error.message));
  for (const laneCount of [8, 128, 1024]) {
    await page.goto(`${base}/procgen.html?e2e=1&seed=42&lanes=${laneCount}`);
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled, null, { timeout: 180000 });
    report.cases.push(await page.evaluate(async laneCount => {
      const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
      if (world.laneCount !== laneCount) throw new Error('Recovery benchmark lane fixture differs from its declared tier.');
      const longTasks = [], lateness = [], writes = [], observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ type: 'longtask', buffered: false });
      let deadline = performance.now(); const interval = setInterval(() => { const now = performance.now(); lateness.push(Math.max(0, now - deadline - 1000 / 120)); deadline = now; }, 1000 / 120);
      const heapBefore = performance.memory?.usedJSHeapSize ?? null;
      try {
        studio.play();
        for (let revision = 0; revision < 8; revision++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: .5 + revision / 16 } });
          const before = studio.getRecoveryState(), started = performance.now(), accepted = await studio.recover(), after = studio.getRecoveryState();
          writes.push({ accepted, elapsedMs: performance.now() - started, tick: world.tickIndex, durableTick: after.durableTick,
            encodeMs: (after.storage?.encodeMs || 0) - (before.storage?.encodeMs || 0), commitMs: (after.storage?.commitMs || 0) - (before.storage?.commitMs || 0),
            encodedPages: (after.storage?.encodedPages || 0) - (before.storage?.encodedPages || 0), reusedPages: (after.storage?.reusedPages || 0) - (before.storage?.reusedPages || 0), state: after.state, error: after.error?.message || null });
        }
      } finally { clearInterval(interval); observer.disconnect(); studio.transport.pause(); }
      lateness.sort((a, b) => a - b); const percentile = p => lateness[Math.floor((lateness.length - 1) * p)] ?? null;
      return { laneCount, writes, capture: studio.getRecoveryState().journal?.capture, journal: studio.getRecoveryState().journal,
        schedulingLatenessMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, longTasks,
        heapBefore, heapAfter: performance.memory?.usedJSHeapSize ?? null, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
    }, laneCount));
  }
} finally { await browser.close(); }
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (report.errors.length || report.cases.some(entry => entry.writes.some(write => !write.accepted))) process.exitCode = 1;
