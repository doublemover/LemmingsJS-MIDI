import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.use({ permissions: [] });
test.setTimeout(120000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });

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
  await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 }); await revisions.selectOption('foundation.soft-triangle@2');
  await expect(dialog.getByRole('button', { name: 'Apply to selected lane', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Pack installed');
  expect(await page.evaluate(() => ({ project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), tick: window.__PROCGEN_LANES__.world.tickIndex }))).toEqual(before);
  await expect(dialog.getByRole('button', { name: 'Prepare selected material', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Instrument applied');
  const applied = await page.evaluate(() => ({ reference: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef,
    tick: window.__PROCGEN_LANES__.world.tickIndex, hardwareRequests: window.soundLibraryMidiRequests }));
  expect(applied.reference).toMatchObject({ schema: 'lemmings-sound-reference/v1', patchId: 'foundation.soft-triangle', revision: 2 });
  expect(applied.reference.definitionHash).toMatch(/^[a-f0-9]{64}$/); expect(applied.tick).toBe(before.tick); expect(applied.hardwareRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Prepare reference export', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download prepared file', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download prepared file', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.lemmings-sound$/);
  await expect(dialog.getByRole('status')).toContainText('Download requested');
});

test('a pinned worklet lane sends actual voice measurements through physical playback to the actor view', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=911&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare factory instruments', exact: true }).click();
  const revisions = dialog.getByLabel('Saved instrument revision');
  await expect(revisions.locator('option')).toHaveCount(4, { timeout: 30000 }); await revisions.selectOption('foundation.held-sine@2');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Control audition completed', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Pack installed');
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Instrument applied'); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
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
