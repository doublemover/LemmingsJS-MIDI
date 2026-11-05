import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { armActualPhysicalClock } from './helpers/physicalMidiClock.js';
import { revealWorkstationControl } from './helpers/workstationChrome.js';

test('main audio profile controls retire native contexts and preserve truthful route/rate observations @boundary', async ({ page }, testInfo) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/README.md');
  await page.evaluate(async () => {
    const { BrowserNotePreview } = await import('/js/app/midi-ui/browserNotePreview.js');
    const { createAudioRuntimeSettingsView } = await import('/js/app/midi-ui/AudioRuntimeSettingsView.js');
    const native = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!native) { globalThis.runtimeQualification = { unsupported: 'AudioContext unavailable' }; return; }
    const contexts = [], requests = [], results = []; let stops = 0;
    const preview = new BrowserNotePreview({ createAudioContext: options => { requests.push(options); const context = new native(options); contexts.push(context); return context; } });
    const view = createAudioRuntimeSettingsView({ document, readSnapshot: () => preview.getAudioRuntimeSettingsState(),
      configure: async config => { const result = await preview.configureAudioRuntime({ ...preview.getAudioRuntimeConfig(), ...config }); results.push({ result, state: preview.getState() }); return result; },
      chooseOutput: () => preview.chooseAudioOutput(), useDefault: () => preview.configureAudioRuntime({ ...preview.getAudioRuntimeConfig(), sinkPreference: '' }), resetLatency: () => preview.resetAudioLatencyStatistics() });
    preview.registerPerformanceStop(() => { stops++; }); preview.subscribe(() => view.render()); document.body.replaceChildren(view.element);
    view.element.open = true;
    const enable = document.createElement('button'); enable.textContent = 'Enable test audio'; enable.onclick = async () => { globalThis.runtimeEnable = null; globalThis.runtimeEnable = await preview.enable(); view.render(); }; document.body.append(enable);
    globalThis.runtimeQualification = { preview, view, contexts, requests, results, getStops: () => stops };
  });
  const supported = await page.evaluate(() => !globalThis.runtimeQualification.unsupported);
  if (!supported) { await testInfo.attach('native-runtime-capability', { body: JSON.stringify(await page.evaluate(() => globalThis.runtimeQualification)), contentType: 'application/json' }); return; }
  const receipts = [];
  for (const [profile, rate] of [['balanced', '44100'], ['robust', '96000'], ['performance', '48000']]) {
    await page.getByRole('button', { name: 'Enable test audio', exact: true }).click(); await expect.poll(() => page.evaluate(() => globalThis.runtimeEnable)).toBe(true);
    const prior = await page.evaluate(() => { const q = globalThis.runtimeQualification; q.preview.output.channels[1].sendNoteOn(60, { rawAttack: 80, time: performance.now() + 10000 }); return { contextEpoch: q.preview.getState().contextEpoch, contexts: q.contexts.length }; });
    await page.getByRole('combobox', { name: 'Audio latency profile' }).selectOption(profile); await page.getByRole('combobox', { name: 'Preferred audio sample rate' }).selectOption(rate);
    await page.getByRole('button', { name: 'Apply audio settings', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Audio settings applied');
    const receipt = await page.evaluate(() => { const q = globalThis.runtimeQualification; return { latest: q.results.at(-1), states: q.contexts.map(c => c.state), contexts: q.contexts.length, stops: q.getStops(), currentNull: q.preview.getAudioContext() === null }; });
    expect(receipt.latest.result).toMatchObject({ status: 'rebuild-ready', requiresEnable: true }); expect(receipt.contexts).toBe(prior.contexts); expect(receipt.currentNull).toBe(true);
    expect(receipt.states.every(state => state === 'closed')).toBe(true); expect(receipt.latest.state.activeVoices).toBe(0); expect(receipt.latest.state.enabled).toBe(false);
    expect(receipt.latest.state.contextEpoch).toBeGreaterThan(prior.contextEpoch); receipts.push({ profile, requestedRate: Number(rate), ...receipt });
    await expect(page.getByRole('combobox', { name: 'Audio latency profile' })).toHaveValue(profile);
  }
  await page.getByRole('button', { name: 'Enable test audio', exact: true }).click(); await expect.poll(() => page.evaluate(() => globalThis.runtimeEnable)).toBe(true);
  const routes = await page.evaluate(async () => {
    const q = globalThis.runtimeQualification, context = q.preview.getAudioContext(), count = q.contexts.length;
    const rejected = await q.preview.configureAudioRuntime({ ...q.preview.getAudioRuntimeConfig(), sinkPreference: 'lemmings-test-output-not-granted' });
    const afterRejection = q.preview.getState(); let silent, restored;
    if (typeof context.setSinkId === 'function') {
      // Exercise the actual native route API, then recover the configured default.
      try {
        await context.setSinkId({ type: 'none' }); const sink = context.sinkId;
        silent = { nativeKind: sink?.type === 'none' ? 'silent' : sink === '' ? 'default' : typeof sink === 'string' ? 'explicit-device' : 'unknown', cachedKind: q.preview.getState().audioRuntime.outputSelection.actualSink };
      }
      catch (error) { silent = { unavailable: error.name }; }
      restored = await q.preview.configureAudioRuntime({ ...q.preview.getAudioRuntimeConfig(), sinkPreference: '' });
    }
    return { rejected, afterRejection, silent, restored, afterDefault: q.preview.getState(), contextCountUnchanged: q.contexts.length === count };
  });
  expect(['failed', 'canceled', 'unsupported']).toContain(routes.rejected.status); expect(routes.afterRejection.audioRuntime.config.sinkPreference).toBe('default'); expect(routes.contextCountUnchanged).toBe(true);
  if (routes.silent?.nativeKind === 'silent') { expect(routes.restored.status).toBe('configured'); expect(routes.afterDefault.audioRuntime.outputSelection).toMatchObject({ actualSink: 'default', preferenceObserved: true }); }
  const final = await page.evaluate(async () => {
    const q = globalThis.runtimeQualification, state = q.preview.getState();
    await q.preview.dispose(); q.view.dispose(); return { state, requests: q.requests, contexts: q.contexts.map(c => c.state), retirement: q.preview.getState().retirement, stops: q.getStops() };
  });
  expect(final.state.audioRuntime.actualSampleRate).toBeGreaterThan(0); expect(final.contexts.every(state => state === 'closed')).toBe(true); expect(final.retirement.outcome).toBe('complete'); expect(final.stops).toBeGreaterThanOrEqual(3);
  await testInfo.attach('native-main-runtime-transitions', { body: JSON.stringify({ viewport: { width: 1920, height: 1080 }, receipts, routes, final }, null, 2), contentType: 'application/json' });
});

test('built desktop audio settings preserve the authored project and reprepare the physical output after replacement @boundary', async ({ page }, testInfo) => {
  // Build within this journey's declared preparation budget. The independent
  // native API case above does not need a full application build.
  test.setTimeout(120000); await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) });
  await page.setViewportSize({ width: 1920, height: 1080 }); await armActualPhysicalClock(page, { speed: 3 });
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  const prior = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), audio: window.__PROCGEN_STUDIO__.handlers.audioRuntimeState() }));
  const summary = page.locator('.studio-audio-runtime > summary'); await revealWorkstationControl(page, summary); await summary.click();
  await page.getByRole('combobox', { name: 'Audio latency profile' }).selectOption('robust'); await page.getByRole('combobox', { name: 'Preferred audio sample rate' }).selectOption('44100');
  const geometry = await page.locator('.studio-audio-runtime').evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }; });
  const imagePath = testInfo.outputPath('main-audio-settings.png'); await page.screenshot({ path: imagePath });
  await testInfo.attach('main-audio-settings-desktop', { path: imagePath, contentType: 'image/png' });
  expect(geometry.x).toBeGreaterThanOrEqual(0); expect(geometry.y).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(1920); expect(geometry.bottom).toBeLessThanOrEqual(1080);
  await page.getByRole('button', { name: 'Apply audio settings', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.audioRuntimeState().transition.last?.status)).toBe('rebuild-ready');
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  const stopped = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), audio: window.__PROCGEN_STUDIO__.handlers.audioRuntimeState(), tick: window.__PROCGEN_LANES__.world.tickIndex }));
  expect(stopped.project).toBe(prior.project); expect(stopped.audio.observation.actualSampleRate).toBeNull(); expect(stopped.audio.observation.config).toMatchObject({ latencyProfile: 'robust', preferredSampleRate: 44100 });
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play world', exact: true }).click();
  await expect.poll(() => page.evaluate(() => { const state = window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics(); return state.accepted + state.degraded; }), { timeout: 15000 }).toBeGreaterThan(0);
  const resumed = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), audio: window.__PROCGEN_STUDIO__.handlers.audioRuntimeState(), output: window.__PROCGEN_STUDIO__.getPhysicalOutputDiagnostics() }));
  expect(resumed.project).toBe(prior.project); expect(resumed.audio.observation.actualSampleRate).toBeGreaterThan(0); expect(resumed.audio.observation.contextEpoch).toBeGreaterThan(prior.audio.observation.contextEpoch);
  await page.locator('#procgenPanic').click();
  await testInfo.attach('built-main-audio-runtime-transition', { body: JSON.stringify({ viewport: page.viewportSize(), geometry, prior, stopped, resumed, scope: 'Actual built1920x1080workstation, native context replacement and physical backend admission; no acoustic receipt.' }, null, 2), contentType: 'application/json' });
});
