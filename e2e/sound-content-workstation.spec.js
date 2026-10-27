import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test.use({ permissions: [] });
test.setTimeout(120000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

test('liquid tables and drawbars use real worklet audition before installing the chosen source revision', async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare liquid tables / drawbars', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision'); await expect(revisions.locator('option')).toHaveCount(6, { timeout: 30000 });
  await revisions.selectOption('spectrum.pipe-crew@1'); await expect(dialog.getByLabel('Instrument source model')).toContainText('8 authored additive partials');
  await expect(dialog.getByRole('button', { name: 'Install auditioned pack', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click(); await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toContain('worklet-spectrum'); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  for (const name of ['BODY', 'EDGE', 'FLOW', 'RING']) await expect(page.getByLabel(name + ' · next onset', { exact: true })).toBeVisible();
});

test('Artificial Choir stages four recipes and only applies a real auditioned worklet revision', async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(() => {
    window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause();
    return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex };
  });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare artificial choir', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision'); await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 });
  await revisions.selectOption('choir.hollow-ooh@1'); await expect(dialog.getByLabel('Instrument source model')).toContainText('artificial three-band formants');
  await expect(dialog.getByRole('button', { name: 'Install auditioned pack', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click(); await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  expect(await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex }))).toEqual(before);
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toContain('worklet-choir');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  for (const name of ['VOWEL', 'BREATH', 'SIZE', 'CHORUS']) await expect(page.getByLabel(name + ' · next onset', { exact: true })).toBeVisible();
});

test('Plucked Garden requires real worklet application before Install and Apply', async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare plucked garden', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision'); await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 });
  await revisions.selectOption('pluck.wire-ladder@1'); await expect(dialog.getByLabel('Instrument source model')).toContainText('seeded fractional-delay string');
  await expect(dialog.getByRole('button', { name: 'Install auditioned pack', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click(); await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toContain('worklet-pluck');
});

test('struck materials audition real native mode children and expose saved onset controls after Apply', async ({ page }) => {
  await page.addInitScript(() => {
    window.materialSourcesStarted = 0; window.materialSourcesEnded = 0; const native = window.AudioContext.prototype.createOscillator;
    window.AudioContext.prototype.createOscillator = function() {
      const source = native.call(this), start = source.start.bind(source); source.start = (...args) => { window.materialSourcesStarted++; return start(...args); };
      source.addEventListener('ended', () => { window.materialSourcesEnded++; }, { once: true }); return source;
    };
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare struck materials', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision'); await expect(revisions.locator('option')).toHaveCount(5, { timeout: 30000 });
  await revisions.selectOption('material.timber@1'); await expect(dialog.getByLabel('Instrument source model')).toContainText('4 authored damped-sine modes');
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click(); await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  const children = await page.evaluate(() => ({ started: window.materialSourcesStarted, ended: window.materialSourcesEnded }));
  expect(children.started).toBe(4); await expect.poll(() => page.evaluate(() => window.materialSourcesEnded)).toBe(4);
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  for (const name of ['MASS', 'HARDNESS', 'DAMPING', 'HOLLOW']) await expect(page.getByLabel(name + ' · next onset', { exact: true })).toBeVisible();
});

test('FM Forge stages original source recipes and only applies the auditioned installed revision', async ({ page }) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(() => {
    window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause();
    return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex };
  });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare FM Forge', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision'); await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 });
  await revisions.selectOption('forge.glass-rivet@4'); await expect(dialog.getByLabel('Instrument source model')).toContainText('1:2.71');
  await expect(dialog.getByRole('button', { name: 'Apply to selected lane', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click();
  await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  expect(await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex }))).toEqual(before);
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toContain('native-fm');
});

test('built sound library keeps world/project state unchanged through staging, audition and installation, then applies a pinned revision', async ({ page }) => {
  await page.addInitScript(() => {
    window.soundLibraryMidiRequests = 0;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.soundLibraryMidiRequests++; throw new Error('Unexpected hardware permission request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(() => {
    window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause();
    return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex };
  });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare factory instruments', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision');
  await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 }); await revisions.selectOption('foundation.soft-triangle@3');
  await expect(dialog.getByRole('button', { name: 'Apply to selected lane', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click();
  await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  expect(await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex }))).toEqual(before);
  await expect(dialog.getByRole('button', { name: 'Prepare selected material', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  const applied = await page.evaluate(() => ({ reference: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef,
    tick: window.__PROCGEN_LANES__.world.tickIndex, hardwareRequests: window.soundLibraryMidiRequests }));
  expect(applied.reference).toMatchObject({ schema: 'lemmings-sound-reference/v1', patchId: 'foundation.soft-triangle', revision: 3 });
  expect(applied.reference.definitionHash).toMatch(/^[a-f0-9]{64}$/); expect(applied.tick).toBe(before.tick); expect(applied.hardwareRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Prepare reference export', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download prepared file', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download prepared file', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.lemmings-sound$/);
  await expect(dialog.getByLabel('Sound library status')).toContainText('Download requested');
});

test('a pinned worklet lane sends actual voice measurements through physical playback to the actor view', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare factory instruments', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision');
  await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 }); await revisions.selectOption('foundation.held-sine@2');
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click();
  await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied'); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#procgenListen').click(); await page.evaluate(() => window.__PROCGEN_STUDIO__.play());
  await page.waitForFunction(() => {
    const renderer = window.__PROCGEN_LANES__.renderer, manager = renderer.actorEffects;
    for (const [actorId, box] of manager.mailboxes) {
      const source = [...box.sources.values()].find(record => record.effectId === 'worklet-sine.voice-output' && record.quantity === 'rms' && record.evidenceClass === 'measured' && record.value > 0);
      if (!source) continue;
      window.realWorkletDisplayReceipt = { actorId, source, epoch: manager.epoch, tick: renderer.world.tickIndex };
      manager.setProfile({ version: 1, enabled: true, intensity: 1, smoothingMs: 0,
        bindings: [{ effectId: source.effectId, quantity: 'rms', channel: 'scale' }] }, { actorId }); return true;
    }
    return false;
  }, null, { timeout: 30000 });
  const receipt = await page.evaluate(() => {
    const renderer = window.__PROCGEN_LANES__.renderer, found = window.realWorkletDisplayReceipt;
    const visual = renderer.actorEffects.evaluate(found.actorId, performance.now());
    window.__PROCGEN_STUDIO__.transport.pause();
    return { ...found, visual, observationClosed: !renderer.actorEffects.subscription };
  });
  expect(receipt.epoch.executionEpoch).not.toContain('@owned-execution:'); expect(receipt.source.muted).toBe(false);
  expect(receipt.source.tap).toBe('voice-pre-pan-pre-owner-bus'); expect(receipt.source.detectorDelayFrames).toBeGreaterThan(0);
  expect(receipt.visual.scale).toBeGreaterThan(1); expect(receipt.observationClosed).toBe(true);
  await testInfo.attach('real-worklet-actor-display.json', { body: JSON.stringify({ ...receipt, acousticReceipt: false }), contentType: 'application/json' });
});

test('selected control WAV rendering uses a real immutable worker without enabling local or hardware output', async ({ page }) => {
  await page.addInitScript(() => {
    window.renderAudioOpens = 0; window.renderMidiRequests = 0; const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext { constructor(options) { window.renderAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.renderMidiRequests++; throw new Error('Unexpected MIDI request'); } });
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  const before = await page.evaluate(() => {
    window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause();
    return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex };
  });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare factory instruments', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision'); await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 });
  await revisions.selectOption('foundation.held-sine@2'); await dialog.getByLabel('Rendered reference sample rate').selectOption('44100');
  await dialog.getByRole('button', { name: 'Render controls WAV', exact: true }).click();
  await expect(dialog.getByLabel('Sound library status')).toContainText('Control reference WAV prepared at 44100 Hz', { timeout: 30000 });
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download prepared file', exact: true }).click();
  const download = await pending, bytes = await readFile(await download.path()); let manifest = null, pcm = null;
  for (let offset = 12; offset < bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), body = bytes.subarray(offset + 8, offset + 8 + length);
    if (id === 'lmjs') manifest = JSON.parse(body.toString('utf8')); if (id === 'data') pcm = body; offset += 8 + length + length % 2;
  }
  expect(manifest).toMatchObject({ schema: 'lemmings-rendered-audition/v1', sampleRate: 44100, physicalTakeEvidence: false, acousticReceipt: false,
    source: { patchIdentity: 'foundation.held-sine@2' }, tail: { state: 'all-voices-ended' } });
  expect(manifest.applicationBuildId).toMatch(/^[a-f0-9]{64}$/); expect(createHash('sha256').update(pcm).digest('hex')).toBe(manifest.pcmHash);
  expect(manifest.statistics.peak).toBeGreaterThan(0);
  const after = await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex,
    audioOpens: window.renderAudioOpens, hardwareRequests: window.renderMidiRequests }));
  expect(after).toEqual({ ...before, audioOpens: 0, hardwareRequests: 0 });
});

test('master recording uses the real capture worklet and keeps PCM after a canceled file save', { tag: '@boundary' }, async ({ page }) => {
  await page.addInitScript(() => {
    window.captureMidiRequests = 0; window.capturePickerCount = 0; window.captureFileChunks = []; window.captureFileClosed = false;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.captureMidiRequests++; throw new Error('Unexpected MIDI request'); } });
    window.showSaveFilePicker = async () => {
      if (++window.capturePickerCount === 1) throw new window.DOMException('Canceled by fixture', 'AbortError');
      return { createWritable: async () => ({ write: async bytes => { window.captureFileChunks.push(Array.from(bytes)); },
        close: async () => { window.captureFileClosed = true; }, abort: async () => {} }) };
    };
  });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.getByRole('button', { name: 'Record audio…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record browser master', exact: true });
  await expect(dialog.getByRole('button', { name: 'Start master capture', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await page.locator('#procgenListen').click();
  await page.evaluate(() => window.__PROCGEN_STUDIO__.play());
  await page.getByRole('button', { name: 'Record audio…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start master capture', exact: true }).click();
  await expect.poll(async () => `${await dialog.getByRole('status').textContent()}\n${(await dialog.locator('p').allTextContents()).join('\n')}`, { timeout: 15000 })
    .toMatch(/^recording ·/);
  await expect.poll(async () => {
    const text = await dialog.getByRole('status').textContent(); return Number(text.match(/([\d,]+) received frames/)?.[1].replaceAll(',', '') || 0);
  }, { timeout: 15000 }).toBeGreaterThan(24000);
  try { await dialog.getByRole('button', { name: 'Stop capture', exact: true }).click({ timeout: 1500 }); }
  catch (error) { if (!/^(ready|partial) ·/.test(await dialog.getByRole('status').textContent())) throw error; }
  await expect(dialog.getByRole('status')).toContainText(/ready|partial/);
  await dialog.getByRole('button', { name: 'Save captured WAV', exact: true }).click(); await expect(dialog).toContainText('Save canceled. Captured PCM remains available.');
  await dialog.getByRole('button', { name: 'Save captured WAV', exact: true }).click(); await expect(dialog).toContainText('WAV stream closed successfully.');
  const receipt = await page.evaluate(() => ({ chunks: window.captureFileChunks, fileClosed: window.captureFileClosed, hardwareRequests: window.captureMidiRequests }));
  const bytes = Buffer.concat(receipt.chunks.map(chunk => Buffer.from(chunk))); let manifest, samples;
  for (let offset = 12; offset < bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), body = bytes.subarray(offset + 8, offset + 8 + length);
    if (id === 'lmjs') manifest = JSON.parse(body.toString('utf8')); if (id === 'data') samples = body; offset += 8 + length + length % 2;
  }
  expect(receipt.fileClosed).toBe(true); expect(receipt.hardwareRequests).toBe(0); expect(samples.length).toBe(manifest.timelineFrames * 8);
  expect(manifest).toMatchObject({ schema: 'lemmings-master-pcm/v1', tap: 'post-protection-shared-browser-master', channels: 2,
    includesCurrentMasterOwnersAndAuditions: true, acousticEvidence: false, terminalAcknowledged: true, format: 'float32-le' });
  expect(['Ready', 'Partial']).toContain(manifest.state);
  console.log('Master capture receipt ' + JSON.stringify({ state: manifest.state, frames: manifest.timelineFrames, captured: manifest.capturedFrames, stopReason: manifest.stopReason, clockDiscontinuity: manifest.clockDiscontinuity }));
  let peak = 0, nonfinite = 0;
  for (let at = 0; at < samples.length; at += 4) { const sample = samples.readFloatLE(at); if (!Number.isFinite(sample)) nonfinite++; else peak = Math.max(peak, Math.abs(sample)); }
  expect(nonfinite).toBe(0); expect(peak).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Discard captured PCM', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Save captured WAV', exact: true })).toBeDisabled();
});
