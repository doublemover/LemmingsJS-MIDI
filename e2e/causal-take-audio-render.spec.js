import { inspectLane } from './helpers/workstationDock.js';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.use({ permissions: [] });
test.setTimeout(120000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

for (const engineId of ['worklet-sine', 'worklet-pluck']) test('an immutable worker renders a real captured physical phrase and dry stem without enabling live audio or hardware' + (engineId === 'worklet-sine' ? '' : ' with owned seed-state receipts'), { tag: ['@boundary'] }, async ({ page }, testInfo) => {
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
  await page.getByLabel('Take name', { exact: true }).fill('Actual physical ' + engineId + ' revoice'); await page.getByLabel('Take name', { exact: true }).blur();
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
  await dialog.getByLabel('Render source model', { exact: true }).selectOption(engineId);
  await expect(dialog.getByRole('button', { name: 'Prepare revoice WAV', exact: true })).toBeEnabled();
  const endSeconds = Math.min(5, Number(await dialog.getByLabel('End seconds from capture').getAttribute('max')));
  await dialog.getByLabel('End seconds from capture').fill(String(endSeconds)); await dialog.getByLabel('Include all captured dry lane stems').check();
  await dialog.getByRole('button', { name: 'Prepare revoice WAV', exact: true }).click();
  await expect(dialog.getByRole('status', { name: '', exact: true })).toContainText('prepared', { timeout: 60000 });
  await expect(dialog.getByLabel('Prepared rendered file').locator('option')).toHaveCount(2);
  const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download selected WAV', exact: true }).click();
  const download = await downloading, filename = testInfo.outputPath('actual-causal-' + engineId + '-master.wav'); await download.saveAs(filename);
  const bytes = await readFile(filename), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let manifest;
  for (let at = 12; at < bytes.length;) { const id = bytes.subarray(at, at + 4).toString(), size = view.getUint32(at + 4, true);
    if (id === 'lmjs') manifest = JSON.parse(bytes.subarray(at + 8, at + 8 + size).toString()); at += 8 + size + size % 2; }
  expect(manifest).toMatchObject({ schema: 'lemmings-causal-audio-render/v1', takeId: before.takeId, mode: 'intent-render', frames: Math.round(endSeconds * 48000),
    acousticReceipt: false, operation: 'sound-only-revoice', originalRecordMutated: false });
  expect(manifest.applicationBuildId).toMatch(/^[a-f0-9]{64}$/); expect(manifest.commands.capturedBegins).toBeGreaterThan(0);
  expect(manifest.commands.applied).toBe(manifest.commands.submitted); expect(manifest.statistics.peak).toBeGreaterThan(0);
  expect(manifest.realization.liveAdmissionHistoryRecreated).toBe(false); expect(manifest.stems.allCapturedLanesIncluded).toBe(true);
  if (engineId === 'worklet-sine') { expect(manifest.realization.sourceControls.seededOnsets).toBe(0); expect(manifest.realization.sourceControls.seedContracts).toEqual([]); }
  else {
    expect(manifest.realization.sourceControls.seededOnsets).toBe(manifest.commands.capturedBegins);
    expect(manifest.realization.sourceControls.seedContracts).toHaveLength(1);
    expect(manifest.realization.sourceControls.seedContracts[0]).toMatchObject({ schema: 'lemmings-owned-source-seed-contract/v1', recipe: 'owned-onset-seed-v1',
      algorithm: 'xorshift32-13-17-5-v1', source: { engineId }, restoration: { capability: 'exactSnapshot', qualification: 'declared-source-capability;not-a-PCM-equivalence-receipt' } });
  }
  const after = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex,
    audio: window.causalRenderAudioOpens, midi: window.causalRenderMidiRequests }));
  expect(after.project).toBe(before.project); expect(after.tick).toBe(before.tick); expect(after.audio).toBe(0); expect(after.midi).toBe(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('button', { name: 'Render sine WAV…', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download selected WAV', exact: true })).toBeEnabled();
  await testInfo.attach('causal-' + engineId + '-render-manifest.json', { body: JSON.stringify(manifest), contentType: 'application/json' });
});


test('a prepared real-time print realizes a frozen physical take in a silent private context and preserves the paused world', { tag: ['@boundary'] }, async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.printAudioContexts = []; window.printMidiRequests = 0; window.printMicrophoneRequests = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext { constructor(options) { super(options); window.printAudioContexts.push(this); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.printMidiRequests++; throw new Error('Unexpected MIDI access during private print'); } });
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.printMicrophoneRequests++; throw new Error('Unexpected microphone access during private print'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await inspectLane(page, 'Lane'); await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await library.getByRole('button', { name: 'Prepare factory instruments', exact: true }).click();
  await expect(library.getByLabel('Saved instrument revision').locator('option')).toHaveCount(4, { timeout: 30000 });
  await library.getByLabel('Saved instrument revision').selectOption('foundation.soft-triangle@3');
  await library.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click();
  await library.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(library.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 30000 });
  await library.getByRole('button', { name: 'Install auditioned pack', exact: true }).click();
  await expect(library.getByLabel('Sound library status')).toContainText('Pack installed');
  await library.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect(library.getByLabel('Sound library status')).toContainText('Instrument applied');
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1, revision: studio.getProject().procgen.physicalGraph.revision + 1, instruments: [{ id: 'print-crossing', sourceKind: 'MotionCommitted', gateX: 40, crossingDirection: 'positive', pitchCents: 6012.34567, velocity01: 0.8, role: 'crossing', route: 'local' }] } }); });
  await inspectLane(page, 'Physical'); await page.getByLabel('Take name', { exact: true }).fill('Private real-time print source'); await page.getByLabel('Take name', { exact: true }).blur();
  await page.getByRole('button', { name: 'Record causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().recording)).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(96); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Stop causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__PROCGEN_STUDIO__.handlers.causalTakeState().last?.takeId)).toBe(true);
  const before = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, contexts: window.printAudioContexts.length, takeId: window.__PROCGEN_STUDIO__.handlers.causalTakeState().last.takeId }));
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.openCausalAudioRender());
  const dialog = page.getByRole('dialog', { name: 'Render causal take owned-source revoice', exact: true });
  await dialog.getByLabel('Start seconds from capture').fill('4.1'); await dialog.getByLabel('End seconds from capture').fill('5.5');
  await dialog.getByRole('button', { name: 'Prepare real-time print · saved live instrument', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getCausalAudioRenderState().realtimePrint?.readyToPrint)).toBe(true);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getCausalAudioRenderState().realtimePrint.plan.intents)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.printAudioContexts.length)).toBe(before.contexts);
  await dialog.getByRole('button', { name: 'Start real-time print · stop live browser output', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getCausalAudioRenderState().realtimePrint?.phase), { timeout: 60000 }).toBe('prepared');
  const downloadReady = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download selected WAV', exact: true }).click();
  const download = await downloadReady, filename = testInfo.outputPath('private-real-time-print.wav'); await download.saveAs(filename);
  const bytes = await readFile(filename), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let manifest = null, pcm = null;
  for (let at = 12; at < bytes.length;) { const id = bytes.subarray(at, at + 4).toString(), size = view.getUint32(at + 4, true); if (id === 'lmjs') manifest = JSON.parse(bytes.subarray(at + 8, at + 8 + size).toString()); if (id === 'data') pcm = bytes.subarray(at + 8, at + 8 + size); at += 8 + size + size % 2; }
  const { createHash } = await import('node:crypto');
  expect(manifest).toMatchObject({ schema: 'lemmings-causal-audio-render/v1', mode: 'real-time-intent-print', takeId: before.takeId, sampleRate: 48000, frames: 67200, timelineZeroSourceFrame: 196800, exactEndSourceFrame: 264000, fileState: 'complete-private-digital-capture', originalRecordMutated: false, acousticReceipt: false });
  expect(manifest.capture).toMatchObject({ tap: 'post-protection-private-capture-only-browser-graph', monitorOutput: 'capture-only', terminalAcknowledged: true, gaps: [], microphone: false, externalMidiAudio: false });
  expect(manifest.capture.endFrameExclusive - manifest.capture.sourceStartFrame).toBe(67200); expect(manifest.realization.peak).toBeGreaterThan(0); expect(manifest.pcmHash).toBe(createHash('sha256').update(pcm).digest('hex'));
  const after = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex, playing: window.__PROCGEN_STUDIO__.transport.getState().playing, contexts: window.printAudioContexts.length, closed: window.printAudioContexts.at(-1).state, midi: window.printMidiRequests, microphone: window.printMicrophoneRequests, faults: window.__PROCGEN_STUDIO__.getCausalAudioRenderState().realtimePrint.unresolvedRetirement }));
  expect(after.project).toBe(before.project); expect(after.tick).toBe(before.tick); expect(after.playing).toBe(false); expect(after.contexts).toBe(before.contexts + 1); expect(after.closed).toBe('closed'); expect(after.midi).toBe(0); expect(after.microphone).toBe(0); expect(after.faults).toBe(0);
  await testInfo.attach('private-real-time-print-receipt.json', { body: JSON.stringify(manifest), contentType: 'application/json' });
});
