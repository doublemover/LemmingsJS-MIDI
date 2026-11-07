import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { revealWorkstationControl } from './helpers/workstationChrome.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test('New and stored-project load retain earlier MIDI without rearming or concatenating it', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(150000);
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    studio.handlers.record(true); studio.ports.recordOutput({ note: 60, timeMs: performance.now() - 100, durationMs: 50 }, { beat: 0 }); studio.handlers.record(false);
    const retained = JSON.stringify(studio.ports.getRecording()), origin = studio.getMidiRecordingState().recordingOrigin;
    const session = studio.capture('MIDI boundary regression');
    const { createProcgenSessionStorage } = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', new URL('./', location.href)));
    const store = createProcgenSessionStorage();
    let loaded;
    try { await store.saveDocument('doc:recording-boundary', 0, session, 'recording-boundary-commit'); loaded = await store.loadDocument('doc:recording-boundary'); }
    finally { store.close(); }
    if (!await studio.handlers.new()) throw new Error('New failed.');
    studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    if (studio.handlers.record(true) || studio.ports.getState().recording || JSON.stringify(studio.ports.getRecording()) !== retained) throw new Error('New concatenated or lost earlier MIDI.');
    if (!await studio.loadSession(loaded.session)) throw new Error('Stored load failed.');
    if (studio.handlers.record(true) || JSON.stringify(studio.ports.getRecording()) !== retained) throw new Error('Load rearmed or replaced earlier MIDI.');
    const state = studio.getMidiRecordingState();
    if (!state.foreignRecording || state.recordingOrigin.generation !== origin.generation) throw new Error('Earlier source identity was lost.');
    return { events: state.recordedEvents, recording: state.recording, foreignRecording: state.foreignRecording, originalSourcePreserved: true,
      storage: 'actual IndexedDB saveDocument/loadDocument;project checkpoint does not contain the MIDI recording' };
  });
  expect(result.events).toBe(3); expect(result.recording).toBe(false);
  await expect(page.locator('#studioRecord')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#studioRecord')).toHaveText('● Retained MIDI');
  const clear = page.locator('#studioClearRecording'); await revealWorkstationControl(page, clear); await expect(clear).toBeEnabled(); await clear.click();
  const next = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; if (studio.ports.getState().recordedEvents) throw new Error('Explicit clear retained old MIDI.');
    const armed = studio.handlers.record(true), count = studio.ports.getState().recordedEvents; studio.handlers.record(false); return { armed, count };
  });
  expect(next).toEqual({ armed: true, count: 1 });
  await testInfo.attach('recording-document-boundary', { body: JSON.stringify({ ...result, next }), contentType: 'application/json' });
});
