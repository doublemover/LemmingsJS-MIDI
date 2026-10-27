import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Start the repository HTTP server separately. Example:
// LEMMINGS_E2E_BASE_URL=http://127.0.0.1:8189 node scripts/profile-procgen-workstation.mjs --name=Lyra
// Set LEMMINGS_E2E_EXECUTABLE when using an installed Chrome/Edge executable.
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const baseURL = process.env.LEMMINGS_E2E_BASE_URL || 'http://127.0.0.1:8189';
const durationMs = Math.max(1000, Math.min(60000, Number(args.duration) || 6000));
const warmupTicks = Math.max(0, Math.min(10000, Number(args.ticks) || 1200));
const seed = Number(args.seed) || 42;
const laneCounts = [...new Set(String(args.lanes || '8,64,1024').split(',').map(Number))].sort((a, b) => a - b);
if (!laneCounts.length || laneCounts.length > 8 || laneCounts.some(value => !Number.isSafeInteger(value) || value < 1 || value > 1024)) throw new Error('Profile lane counts must be integers from 1 to 1024.');
const report = { name: args.name || 'Lyra', timestamp: new Date().toISOString(), baseURL, durationMs, warmupTicks, seed,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), laneCounts,
  viewport: MIN_DESKTOP_VIEWPORT, cases: [], errors: [] };

const measure = ({ durationMs }) => new Promise(resolve => {
  const api = window.__PROCGEN_LANES__, world = api.world, renderer = api.renderer;
  const original = renderer.render, costs = [], intervals = [], start = performance.now(), tick = world.tickIndex;
  const heapStart = performance.memory?.usedJSHeapSize; let last = null, frame;
  const displayStart = window.__PROCGEN_STUDIO__.getDisplayDiagnostics();
  renderer.render = function(...args) {
    const before = performance.now(), changed = original.apply(this, args);
    if (changed) costs.push(performance.now() - before);
    return changed;
  };
  const observeFrame = timestamp => {
    if (last != null) intervals.push(timestamp - last);
    last = timestamp; frame = requestAnimationFrame(observeFrame);
  };
  frame = requestAnimationFrame(observeFrame);
  setTimeout(() => {
    cancelAnimationFrame(frame); renderer.render = original;
    costs.sort((a, b) => a - b); intervals.sort((a, b) => a - b);
    const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;
    const distribution = values => ({ samples: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) });
    const state = world.getDebugState();
    const display = window.__PROCGEN_STUDIO__.getDisplayDiagnostics();
    resolve({ lanes: world.laneCount, mode: renderer.workstationLayout.mode, visibleRows: renderer.workstationLayout.count,
      scale: renderer.scale, durationMs: performance.now() - start, ticks: world.tickIndex - tick,
      soundEnabled: document.getElementById('procgenListen').getAttribute('aria-pressed') === 'true',
      renderMs: distribution(costs), frameIntervalMs: distribution(intervals),
      instrumentDisplay: { start: displayStart, end: display, measuredFrameDelta: display.totalFrames - displayStart.totalFrames,
        distributionScope: 'bounded-rolling-window-at-end', rollingWindowFrames: display.sampleCapacity },
      allocatedHeapStartMB: heapStart == null ? null : heapStart / 1048576,
      allocatedHeapEndMB: performance.memory?.usedJSHeapSize == null ? null : performance.memory.usedJSHeapSize / 1048576,
      terrainResidentMB: state.terrainGeneration.memoryMB, sceneryEntries: world.scenery.entries.reduce((count, entries) => count + entries.length, 0),
      growthStates: world.terrainGrowth.states.size });
  }, durationMs);
});

const browser = await chromium.launch({ headless: true, executablePath: process.env.LEMMINGS_E2E_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: report.viewport, ignoreHTTPSErrors: true });
  page.on('pageerror', error => report.errors.push(error.message));
  const url = new URL('procgen.html', baseURL); url.searchParams.set('e2e', '1'); url.searchParams.set('seed', String(seed));
  await page.goto(url.href);
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.world?.workstationEnabled, null, { timeout: 60000 });
  report.environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigator.deviceMemory ?? null, devicePixelRatio, language: navigator.language })); report.environment.browserVersion = browser.version();
  await page.evaluate(ticks => {
    window.__PROCGEN_STUDIO__.transport.pause(); if (ticks) window.__PROCGEN_LANES__.step(ticks);
  }, warmupTicks);
  const enableSound = async () => {
    if (await page.locator('#procgenListen').getAttribute('aria-pressed') !== 'true') await page.locator('#procgenListen').click();
    await page.waitForFunction(() => document.getElementById('procgenListen').getAttribute('aria-pressed') === 'true');
  };
  await enableSound();
  for (const laneCount of laneCounts) {
    if (laneCount !== await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes.length)) {
      await page.evaluate(async ({ ticks, laneCount }) => {
        const studio = window.__PROCGEN_STUDIO__; studio.transport.pause();
        while (studio.getProject().procgen.lanes.length < laneCount) studio.dispatch({ type: 'procgen/addLane' });
        while (studio.getProject().procgen.lanes.length > laneCount) studio.dispatch({ type: 'procgen/removeLane', laneId: studio.getProject().procgen.lanes.at(-1).id });
        await studio.handlers.rebuild(); if (ticks) window.__PROCGEN_LANES__.step(ticks);
      }, { ticks: warmupTicks, laneCount });
      await enableSound();
    }
    for (const mode of ['strip', 'overlay']) {
      await page.getByLabel('Sequencer layout', { exact: true }).selectOption(mode);
      await page.evaluate(() => { window.__PROCGEN_LANES__.renderer.camera.setZoom(3); window.__PROCGEN_STUDIO__.play(); });
      report.cases.push(await page.evaluate(measure, { durationMs }));
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  report.invariants = await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__, world = api.world, renderer = api.renderer;
    window.__PROCGEN_STUDIO__.transport.pause(); renderer.render(); world.step();
    const reducedMotionComplete = world.scenery.entries.every(entries => entries.every(entry => entry.progress === 8));
    const saved = JSON.stringify(world.scenery.snapshot()), misses = world.terrain.getDebugState().descriptorMisses;
    renderer.follow = false; renderer.cameraX += 100000; renderer.render();
    return { reducedMotionComplete, cameraPanDoesNotGenerate: misses === world.terrain.getDebugState().descriptorMisses,
      cameraPanDoesNotAdvanceScenery: saved === JSON.stringify(world.scenery.snapshot()) };
  });
  report.notes = ['Render costs count changed frames; RAF cadence follows the host display and can exceed 60 Hz.',
    'Allocated JavaScript heap includes garbage pending collection; terrainResidentMB counts source and terrain buffers.',
    'Sound is enabled through a trusted UI click. Physical MIDI device validation is a separate manual check.'];
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length || Object.values(report.invariants).some(value => !value)) process.exitCode = 1;
} finally { await browser.close(); }
