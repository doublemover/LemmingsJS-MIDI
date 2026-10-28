import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('recording range refresh cancels only active/future ownership in the production workstation', { tag: '@boundary' }, async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const result = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause(); studio.handlers.record(true);
    for (let index = 0; index < 1000; index++) studio.ports.recordEvent({ type: 'cc', controller: 74, value: index % 128, timestamp: index, beat: 0 });
    const now = performance.now(); studio.ports.recordOutput({ note: 60, timeMs: now + 1000, durationMs: 500 });
    studio.ports.recordOutput({ note: 64, timeMs: now - 100, durationMs: 500 });
    const before = studio.ports.getRecordingIndexState(); studio.handlers.stopOutput(); const state = studio.ports.getState(), after = studio.ports.getRecordingIndexState();
    studio.handlers.stopOutput();
    return { count: state.recordedEvents, repeated: studio.ports.getState().recordedEvents, visits: after.scannedEvents - before.scannedEvents,
      repeatedVisits: studio.ports.getRecordingIndexState().scannedEvents - after.scannedEvents };
  });
  expect(result.count).toBe(1003); expect(result.repeated).toBe(result.count); expect(result.visits).toBeLessThanOrEqual(256); expect(result.repeatedVisits).toBe(0);
});
test('benchmark recording flush and Panic over1k–1m retained events at fixed active/future counts', { tag: '@benchmark' }, async ({ page, context, browser }, testInfo) => {
  test.skip(process.env.LEMMINGS_RECORDING_BENCH !== '1', 'Explicit large-history recording-owner qualification.'); test.setTimeout(240000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  const session = await context.newCDPSession(page);
  await page.exposeFunction('__recordingRangeHeap', async () => { await session.send('HeapProfiler.collectGarbage'); return session.send('Runtime.getHeapUsage'); });
  try {
    const result = await page.evaluate(async () => {
      const root = new URL('./', location.href), { createProcgenMidiPorts } = await import(new URL('js/app/procgen/workstation/ProcgenMidiPorts.js', root));
      const { createResourceBudget } = await import(new URL('js/app/resources/ResourceBudget.js', root));
      const { benchmarkRecordingRanges } = await import('/test/support/recording-range-benchmark.js');
      return benchmarkRecordingRanges({ createPorts: createProcgenMidiPorts, createBudget: createResourceBudget, collectMemory: () => window.__recordingRangeHeap(),
        onProgress: progress => { window.__recordingRangeProgress = progress; } });
    });
    expect(result.profiles.map(profile => profile.history)).toEqual([1000, 10000, 100000, 1000000]);
    expect(result.profiles.every(profile => profile.maximumRescannedEvents <= 256 && profile.retained === profile.history + profile.iterations * 2)).toBe(true);
    await testInfo.attach('browser-recording-range-benchmark', { body: JSON.stringify({ ...result, environment: { browser: browser.version(), viewport: page.viewportSize(), source: 'built-browser-runtime', heap: 'CDP after explicit collection' } }), contentType: 'application/json' });
  } finally { await session.detach(); }
});
