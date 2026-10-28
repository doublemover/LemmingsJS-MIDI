import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.use({ permissions: [] });
test.setTimeout(180000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const ready = async page => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); window.__variationWorld = window.__PROCGEN_LANES__.world; });
  await page.locator('#procgenListen').click();
  await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; await studio.handlers.selectNativeSound(studio.getProject().procgen.lanes[0].id, 'forge.glass-rivet'); });
};
const snapshot = page => page.evaluate(async () => {
  const root = new URL('./', location.href), { captureProcgenCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root));
  const { hashProcgenPhysicsCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root));
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), physics: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)),
    sameWorld: window.__variationWorld === window.__PROCGEN_LANES__.world, tick: window.__PROCGEN_LANES__.world.tickIndex };
});

test('four authored slots retain an exact pin through a second batch and reopen its canonical Keep offline without autoplay or world edits', { tag: ['@boundary', '@workstation-typed-controls'] }, async ({ page }, testInfo) => {
  await ready(page); const before = await snapshot(page), dock = await inspectLane(page, 'Variations'), tray = dock.getByRole('region', { name: 'Authored sound variations' });
  await tray.getByRole('button', { name: 'Prepare parent', exact: true }).click(); await expect(tray.getByRole('slider', { name: 'Glass size', exact: true })).toBeVisible({ timeout: 30000 });
  await tray.getByRole('slider', { name: 'Glass size', exact: true }).focus(); await page.keyboard.press('ArrowUp');
  await expect(tray.getByLabel('Glass size numeric value', { exact: true })).toHaveValue('0.01');
  await tray.getByRole('button', { name: 'Edit Glass size value', exact: true }).click();
  await tray.getByLabel('Glass size numeric value', { exact: true }).fill('0.35'); await tray.getByLabel('Glass size numeric value', { exact: true }).press('Enter');
  await tray.locator('summary').click(); await tray.getByLabel('Lock parameter modulatorRatio', { exact: true }).check(); await tray.getByLabel('Variation seed', { exact: true }).fill('42');
  await tray.getByRole('button', { name: 'Generate four', exact: true }).click(); await expect(tray.locator('.studio-variation-row')).toHaveCount(4);
  await expect(tray.getByLabel('Variation status', { exact: true })).toContainText('4 compiled', { timeout: 45000 });
  const first = tray.locator('.studio-variation-row').first(); await first.locator('button').first().click(); await first.getByRole('button', { name: /^Pin / }).click();
  const pinned = await page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().session.pins[0]);
  expect(pinned.provenance.locks.parameters).toContain('modulatorRatio'); expect(pinned.provenance.changes.some(change => change.parameter === 'modulatorRatio')).toBe(false);
  await first.getByRole('button', { name: /^Compare / }).click(); await expect(tray.getByLabel('Variation status', { exact: true })).toContainText('immutable captured physical take');
  await first.getByRole('button', { name: /^Keep / }).click(); await expect(first.locator('output')).toContainText('kept', { timeout: 30000 });
  await expect(first.getByRole('button', { name: /^Apply / })).toBeDisabled();
  await tray.getByLabel('Variation seed', { exact: true }).fill('43'); await tray.getByRole('button', { name: 'Generate four', exact: true }).click();
  await expect(tray.locator('.studio-variation-row')).toHaveCount(5); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().session.generating)).toBe(false);
  const currentFirst = tray.locator('.studio-variation-row').first().locator('button').first(); await currentFirst.focus(); await page.keyboard.press('ArrowDown');
  await expect(tray.locator('.studio-variation-row').nth(1).locator('button').first()).toBeFocused();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().session.comparison)).toBeNull(); expect(await snapshot(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('variations-pinned-1080p.png') });
  await page.evaluate(async () => { const studio = window.__PROCGEN_STUDIO__; await studio.handlers.selectNativeSound(studio.getProject().procgen.lanes[0].id, 'forge.copper-tine'); });
  await expect(tray.locator('.studio-variations-parent')).toContainText('PARENT CHANGED');
  const old = tray.locator(`[data-candidate-id="${pinned.candidateId}"]`);
  await expect(old).toHaveCount(1); await expect(old.getByRole('button', { name: /^Compare / })).toBeDisabled();
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().session.pins[0].reference)).toEqual(pinned.reference);
  await page.evaluate(async () => { const root = new URL('./', location.href); window.__variationReopen = {
    registry: await import(new URL('js/app/midi-ui/SoundContentRegistry.js', root)), budget: await import(new URL('js/app/resources/ResourceBudget.js', root)),
    catalog: await import(new URL('js/app/midi-ui/NativeInstrumentSchema.js', root)) }; });
  await page.context().setOffline(true);
  const reopened = await page.evaluate(async reference => {
    const modules = window.__variationReopen, budget = modules.budget.createResourceBudget(), catalog = await modules.catalog.getNativeInstrumentCatalog();
    const registry = modules.registry.createSoundContentRegistry({ indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, resourceBudget: budget }); let loan;
    try { loan = await registry.loadPack(reference.packHash, { engineDescriptors: catalog.descriptors }); const patch = loan.prepared.patches[0];
      return { hash: loan.prepared.contentHash, definitionHash: patch.definitionHash, provenance: loan.prepared.pack.compilation.artifacts[0].neighborhood }; }
    finally { loan?.release(); registry.close(); }
  }, pinned.reference);
  expect(reopened).toEqual({ hash: pinned.reference.packHash, definitionHash: pinned.reference.definitionHash, provenance: pinned.provenance });
  await testInfo.attach('kept-neighborhood-receipt', { body: JSON.stringify({ pinned, reopened }), contentType: 'application/json' });
  await page.context().setOffline(false);
});

test('real captured physical phrase renders matched A/B through PRELISTEN and applies one kept revision with sound-only Undo', { tag: ['@boundary', '@workstation-local-audio'] }, async ({ page }, testInfo) => {
  await ready(page);
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1,
    revision: studio.getProject().procgen.physicalGraph.revision + 1, instruments: [{ id: 'variation-crossing', sourceKind: 'MotionCommitted', gateX: 40,
      crossingDirection: 'positive', pitchCents: 6012.34567, velocity01: 0.8, role: 'crossing', route: 'local' }] } }); });
  await inspectLane(page, 'Physical'); await page.getByRole('button', { name: 'Record causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().recording)).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(96); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Stop causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => { const state = window.__PROCGEN_STUDIO__.handlers.causalTakeState(); return !!state.last?.takeId && !state.stopping; })).toBe(true);
  const dock = await inspectLane(page, 'Variations'), tray = dock.getByRole('region', { name: 'Authored sound variations' });
  await tray.getByRole('button', { name: 'PRELISTEN route…', exact: true }).click(); await page.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click();
  const before = await snapshot(page);
  await tray.getByRole('button', { name: 'Generate four', exact: true }).click(); await expect(tray.getByLabel('Variation status', { exact: true })).toContainText('4 compiled', { timeout: 45000 });
  const row = tray.locator('.studio-variation-row').first(); await row.getByRole('button', { name: /^Keep / }).click(); await expect(row.locator('output')).toContainText('kept', { timeout: 30000 });
  await row.getByRole('button', { name: /^Compare / }).click(); await expect(row.locator('output')).toContainText('reference qualified', { timeout: 60000 });
  const comparison = await page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().comparison);
  await testInfo.attach('physical-variation-comparison-receipt', { body: JSON.stringify(comparison), contentType: 'application/json' });
  expect(comparison.pcmHashes).toHaveLength(2); expect(comparison.pcmHashes[0]).not.toBe(comparison.pcmHashes[1]);
  expect(comparison.levels.levels.every(level => level > 0 && level <= 1)).toBe(true);
  expect(comparison.levels.sourceRms[0] * comparison.levels.levels[0]).toBeCloseTo(comparison.levels.sourceRms[1] * comparison.levels.levels[1], 12);
  await tray.getByRole('button', { name: 'A · Parent', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().playing)).toBe('parent');
  await tray.getByRole('button', { name: 'B · Candidate', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getVariationState().playing)).toBe('candidate');
  expect(await snapshot(page)).toEqual(before); await page.screenshot({ path: testInfo.outputPath('variations-physical-comparison-1080p.png') });
  await row.getByRole('button', { name: /^Apply / }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef.definitionHash)).toBe(comparison.candidateHash);
  const applied = await snapshot(page); expect(applied.physics).toBe(before.physics); expect(applied.sameWorld).toBe(true); expect(applied.tick).toBe(before.tick);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.undo()); await expect.poll(() => snapshot(page)).toEqual(before);
});
