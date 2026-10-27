import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { enableComplementaryPatterns } from './helpers/procgenPatterns.js';

test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const ready = async (page, { patterns = false } = {}) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, { timeout: 60000 });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.transport.pause());
  if (patterns) await enableComplementaryPatterns(page);
};

test('workstation boots eight instrument lanes and switches sequence layouts without replacing the world', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes.length)).toBe(8);
  await expect(page.locator('#gameCanvas')).toHaveCount(1);
  await expect(page.locator('#procgenStudio')).toBeVisible();
  const visible = await page.locator('.studio-lane-header').count();
  expect(visible).toBeGreaterThan(0); expect(visible).toBeLessThanOrEqual(8);
  await expect(page.getByLabel('Visible lane range')).toHaveText(`1–${visible} of 8`);
  await page.evaluate(() => { window.workstationWorldBefore = window.__PROCGEN_LANES__.world; });
  await page.getByLabel('Sequencer layout').selectOption('overlay');
  await expect(page.locator('#procgenStudio')).toHaveAttribute('data-layout', 'overlay');
  await page.getByLabel('Sequencer layout').selectOption('strip');
  expect(await page.evaluate(() => window.workstationWorldBefore === window.__PROCGEN_LANES__.world)).toBe(true);
  const zoom = await page.evaluate(() => {
    const renderer = window.__PROCGEN_LANES__.renderer;
    renderer.camera.setZoom(1); const wide = renderer.buffer.width;
    renderer.camera.setZoom(3); return { wide, close: renderer.buffer.width, sameWorld: window.workstationWorldBefore === window.__PROCGEN_LANES__.world };
  });
  expect(zoom.wide / zoom.close).toBeGreaterThan(2.8); expect(zoom.sameWorld).toBe(true);
  expect(errors).toEqual([]);
});

test('live musical edits undo and survive save/load, reroll and same-seed replay', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, { patterns: true });
  await page.getByLabel('Global key', { exact: true }).selectOption('9');
  await page.locator('#procgenListen').click();
  await page.evaluate(() => { window.soundSelectionWorld = window.__PROCGEN_LANES__.world; });
  await page.getByLabel('Sound collection', { exact: true }).selectOption('bubble');
  await expect(page.locator('.studio-status')).toContainText('Sound committed', { timeout: 30000 });
  expect(await page.evaluate(() => window.soundSelectionWorld === window.__PROCGEN_LANES__.world)).toBe(true);
  await page.getByRole('button', { name: 'Apply matching world', exact: true }).click();
  await expect(page.locator('.studio-status')).toContainText('World rebuilt');
  await expect(page.getByLabel('Global key', { exact: true })).toHaveValue('9');
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.terrain.laneThemes[0])).toMatch(/bubble/i);
  await page.locator('.studio-sequence').first().locator('.studio-cell').first().click();
  await page.getByLabel('Scale degree', { exact: true }).fill('2'); await page.getByLabel('Scale degree', { exact: true }).dispatchEvent('change');
  await page.getByLabel('Chord', { exact: true }).check();
  await page.getByLabel('Inversion', { exact: true }).fill('1'); await page.getByLabel('Inversion', { exact: true }).dispatchEvent('change');
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Inversion', { exact: true })).toHaveValue('0');
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Inversion', { exact: true })).toHaveValue('1');
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }).click();
  const naming = page.getByRole('dialog', { name: 'Project name', exact: true });
  await naming.getByRole('textbox').fill('Acceptance session');
  await naming.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.studio-status')).toContainText('Saved Acceptance session');
  const saved = await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, seed: window.__PROCGEN_LANES__.world.seed, project: window.__PROCGEN_STUDIO__.getProject().procgen }));
  await page.getByLabel('Scale degree', { exact: true }).fill('9'); await page.getByLabel('Scale degree', { exact: true }).dispatchEvent('change');
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('dialog', { name: 'Saved projects' }).getByRole('button', { name: /Acceptance session/ }).click();
  await expect(page.locator('.studio-status')).toContainText('Project loaded paused');
  expect(await page.evaluate(() => ({ tick: window.__PROCGEN_LANES__.world.tickIndex, seed: window.__PROCGEN_LANES__.world.seed, project: window.__PROCGEN_STUDIO__.getProject().procgen }))).toEqual(saved);
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page.getByRole('button', { name: 'Reroll world', exact: true }).click();
  await page.waitForFunction(seed => window.__PROCGEN_LANES__?.world.seed !== seed, saved.seed);
  await expect(page.locator('.studio-status')).toContainText('World rebuilt');
  await expect(page.getByLabel('Global key', { exact: true })).toHaveValue('9');
  const rerollSeed = await page.evaluate(() => { window.replayWorld = window.__PROCGEN_LANES__.world; return window.replayWorld.seed; });
  await page.getByRole('button', { name: 'Replay seed', exact: true }).click();
  await page.waitForFunction(() => window.replayWorld !== window.__PROCGEN_LANES__.world);
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.seed)).toBe(rerollSeed);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0].steps[0].chord.inversion)).toBe(1);
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.studio-status')).toContainText('New project ready');
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.seed)).not.toBe(rerollSeed);
  expect(errors).toEqual([]);
});

test('records an input note into the selected phrase and exports a MIDI performance', async ({ page }) => {
  await installWebMidiStub(page); await ready(page, { patterns: true });
  await page.getByRole('button', { name: 'MIDI', exact: true }).filter({ hasNot: page.locator('#procgenStudioFooter') }).first().click();
  await page.getByRole('button', { name: 'Connect MIDI', exact: true }).click();
  await page.getByLabel('MIDI input', { exact: true }).selectOption('pw-input-1');
  await page.locator('#studioRecord').click();
  await page.evaluate(() => { window.__WEBMIDI_STUB__.sendInput([0x90, 67, 101]); window.__WEBMIDI_STUB__.sendInput([0x80, 67, 0]); });
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0].steps[0])).toMatchObject({ enabled: true, note: 67, velocity: 101 });
  const download = page.waitForEvent('download');
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'MIDI', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('procgen-performance.mid');
});

test('launches a selected phrase at a musical bar and updates its header state', async ({ page }) => {
  await ready(page, { patterns: true });
  await page.locator('.studio-lane-header').first().getByTitle('Launch phrase 2 on next bar').click();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].queuedSlot)).toBe(1);
  await page.getByLabel('BPM', { exact: true }).fill('240'); await page.getByLabel('BPM', { exact: true }).dispatchEvent('change');
  await page.locator('#procgenPause').click();
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].activeSlot === 1);
  await expect(page.locator('.studio-lane-header').first().getByTitle('Launch phrase 2 on next bar')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.engine.getLanePosition('lane-1').origin % 4)).toBe(0);
});

test('browser synth produces measurable audio from the authoritative pattern clock', async ({ page }) => {
  await page.addInitScript(() => {
    window.workstationAudioMeters = [];
    const connect = window.AudioNode.prototype.connect;
    window.AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof window.AudioDestinationNode) {
        let analyser = window.workstationAudioMeters.find(item => item.context === this.context);
        if (!analyser) { analyser = this.context.createAnalyser(); analyser.fftSize = 2048; window.workstationAudioMeters.push(analyser); connect.call(analyser, destination); }
        return connect.call(this, analyser, ...args);
      }
      return connect.call(this, destination, ...args);
    };
  });
  await ready(page, { patterns: true });
  await page.locator('#procgenListen').click();
  await page.locator('#procgenPause').click();
  await expect.poll(() => page.evaluate(() => window.workstationAudioMeters.reduce((peak, analyser) => {
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    return Math.max(peak, rms);
  }, 0)), { timeout: 10000 }).toBeGreaterThan(0.00001);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.engine.snapshot().lanes['lane-1'].lastStep)).toBeGreaterThanOrEqual(0);
});

test('shared automation editor updates the canonical project and resolves spans on workstation notes', async ({ page }) => {
  await ready(page, { patterns: true });
  await page.locator('.studio-inspector-tabs').getByRole('button', { name: 'Automation', exact: true }).click();
  await page.getByRole('button', { name: 'Open automation editor', exact: true }).click();
  await page.locator('#procgenSpanFields > summary').click();
  await page.locator('#procgenSpanAdd').click();
  const spanId = await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().automation.find(entry => entry.span)?.id);
  expect(spanId).toBeTruthy();
  await page.locator('#procgenTab').click();
  await page.locator('#procgenPause').click();
  await expect.poll(() => page.evaluate(id => window.__PROCGEN_STUDIO__.engine.getAutomationSpanState(id, 0)?.resolution?.winnerId, spanId)).toBe(spanId);
});
