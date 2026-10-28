import { inspectLane } from './helpers/workstationDock.js';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.use({ permissions: [] });
test.setTimeout(120000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

test('an immutable worker renders a real captured physical phrase and dry stem without enabling live audio or hardware', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.causalRenderAudioOpens = 0; window.causalRenderMidiRequests = 0; const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext { constructor(options) { window.causalRenderAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.causalRenderMidiRequests++; throw new Error('Unexpected MIDI permission request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause(); window.__PROCGEN_LANES__.pause();
    studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1,
      instruments: [{ id: 'render-crossing', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 6012.34567,
        velocity01: 0.8, role: 'crossing', route: 'local' }] } });
  });
  await inspectLane(page, 'Physical');
  await page.getByLabel('Take name', { exact: true }).fill('Actual physical sine revoice'); await page.getByLabel('Take name', { exact: true }).blur();
  await page.getByRole('button', { name: 'Record causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().recording)).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(96);
    window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Stop causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__PROCGEN_STUDIO__.handlers.causalTakeState().last?.takeId)).toBe(true);
  const before = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex,
    takeId: window.__PROCGEN_STUDIO__.handlers.causalTakeState().last.takeId }));
  await page.getByRole('button', { name: 'Render sine WAV…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Render causal take owned-source revoice', exact: true });
  await dialog.getByLabel('Render source model', { exact: true }).selectOption('worklet-sine');
  await expect(dialog.getByRole('button', { name: 'Prepare revoice WAV', exact: true })).toBeEnabled();
  const endSeconds = Math.min(5, Number(await dialog.getByLabel('End seconds from capture').getAttribute('max')));
  await dialog.getByLabel('End seconds from capture').fill(String(endSeconds)); await dialog.getByLabel('Include all captured dry lane stems').check();
  await dialog.getByRole('button', { name: 'Prepare revoice WAV', exact: true }).click();
  await expect(dialog.getByRole('status', { name: '', exact: true })).toContainText('prepared', { timeout: 60000 });
  await expect(dialog.getByLabel('Prepared rendered file').locator('option')).toHaveCount(2);
  const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download selected WAV', exact: true }).click();
  const download = await downloading, filename = testInfo.outputPath('actual-causal-sine-master.wav'); await download.saveAs(filename);
  const bytes = await readFile(filename), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let manifest;
  for (let at = 12; at < bytes.length;) { const id = bytes.subarray(at, at + 4).toString(), size = view.getUint32(at + 4, true);
    if (id === 'lmjs') manifest = JSON.parse(bytes.subarray(at + 8, at + 8 + size).toString()); at += 8 + size + size % 2; }
  expect(manifest).toMatchObject({ schema: 'lemmings-causal-audio-render/v1', takeId: before.takeId, mode: 'intent-render', frames: Math.round(endSeconds * 48000),
    acousticReceipt: false, operation: 'sound-only-revoice', originalRecordMutated: false });
  expect(manifest.applicationBuildId).toMatch(/^[a-f0-9]{64}$/); expect(manifest.commands.capturedBegins).toBeGreaterThan(0);
  expect(manifest.commands.applied).toBe(manifest.commands.submitted); expect(manifest.statistics.peak).toBeGreaterThan(0);
  expect(manifest.realization.liveAdmissionHistoryRecreated).toBe(false); expect(manifest.stems.allCapturedLanesIncluded).toBe(true);
  const after = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex,
    audio: window.causalRenderAudioOpens, midi: window.causalRenderMidiRequests }));
  expect(after.project).toBe(before.project); expect(after.tick).toBe(before.tick); expect(after.audio).toBe(0); expect(after.midi).toBe(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('button', { name: 'Render sine WAV…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download selected WAV', exact: true })).toBeEnabled();
  await testInfo.attach('causal-sine-render-manifest.json', { body: JSON.stringify(manifest), contentType: 'application/json' });
});
