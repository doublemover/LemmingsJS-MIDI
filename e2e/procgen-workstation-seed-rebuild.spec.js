import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { inspectLane } from './helpers/workstationDock.js';

test.use({ permissions: [] });
test.setTimeout(180000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
test.afterEach(async ({ page }, testInfo) => { if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
  const diagnostic = await page.evaluate(() => window.__PROCGEN_STUDIO__?.getSoundSeedState()).catch(() => null);
  await testInfo.attach('seed-rebuild-failure-state', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
} });
const state = page => page.evaluate(() => window.__PROCGEN_STUDIO__.getSoundSeedState());
const readyInstrument = async (page, field, branch = false) => {
  const instrument = async () => { const value = await state(page); return branch ? value.rebuild.instrument : value.instrument; };
  await expect.poll(async () => { const value = await instrument(); return !!value?.[field] || !value?.active && !!value?.error; }, { timeout: 45000 }).toBe(true);
  const value = await instrument(); expect(value.error).toBeNull(); expect(value[field]).toBe(true);
};
const boundary = page => page.evaluate(async () => {
  const root = new URL('./', location.href), { captureProcgenCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root));
  const { hashProcgenPhysicsCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root));
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), physics: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)),
    tick: window.__PROCGEN_LANES__.world.tickIndex, sameWorld: window.__seedRebuildWorld === window.__PROCGEN_LANES__.world };
});

test('a captured phrase durably branches a fitted body, preserves a shared frozen project and refuses an over-budget graft cue', { tag: ['@boundary', '@workstation-local-audio'] }, async ({ page }, testInfo) => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); window.__seedRebuildWorld = window.__PROCGEN_LANES__.world; });
  await page.locator('#procgenListen').click();
  const dock = await inspectLane(page, 'Variations'); await dock.getByRole('button', { name: 'PRELISTEN route…', exact: true }).click();
  await page.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click();
  await page.evaluate(() => { const studio = window.__PROCGEN_STUDIO__; studio.dispatch({ type: 'procgen/physicalGraph', graph: { version: 1,
    revision: studio.getProject().procgen.physicalGraph.revision + 1, instruments: [{ id: 'seed-rebuild-crossing', sourceKind: 'MotionCommitted', gateX: 40,
      crossingDirection: 'positive', pitchCents: 6000, velocity01: 0.8, role: 'crossing', route: 'local' }] } }); });
  await inspectLane(page, 'Physical'); await page.getByRole('button', { name: 'Record causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.causalTakeState().recording)).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.play(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(96); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.getByRole('button', { name: 'Stop causal take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => { const take = window.__PROCGEN_STUDIO__.handlers.causalTakeState(); return !!take.last?.takeId && !take.stopping; })).toBe(true);
  let before = await boundary(page); const capturedBoundary = before;
  const render = async model => {
    await page.evaluate(async () => { await window.__PROCGEN_STUDIO__.handlers.openCausalAudioRender(); });
    const dialog = page.getByRole('dialog', { name: 'Render causal take owned-source revoice' }); await expect(dialog).toBeVisible();
    await dialog.getByLabel('Render source model', { exact: true }).selectOption(model);
    await dialog.getByLabel('Render end policy', { exact: true }).selectOption('exact-crop');
    await dialog.getByLabel('Include all captured dry lane stems', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Prepare revoice WAV', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Harvest selected file as seed', exact: true })).toBeEnabled({ timeout: 60000 });
    await dialog.getByLabel('Prepared rendered file', { exact: true }).selectOption('1'); return dialog;
  };
  let dialog = await render('native-modal');
  const downloadPromise = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download selected WAV', exact: true }).click();
  const download = await downloadPromise, file = testInfo.outputPath('original-phrase.wav'); await download.saveAs(file);
  const bytes = await readFile(file), frames = bytes.readUInt32LE(44); let onset = 0;
  while (onset < frames && Math.max(Math.abs(bytes.readFloatLE(56 + onset * 8)), Math.abs(bytes.readFloatLE(60 + onset * 8))) < 0.0001) onset++;
  expect(onset).toBeLessThan(frames - 8192); const first = Math.max(0, onset - 32), end = Math.min(frames, first + 24000);
  await dialog.getByRole('button', { name: 'Harvest selected file as seed', exact: true }).click();
  const lab = page.getByRole('region', { name: 'Sound seed laboratory' }); await expect(lab).toBeVisible();
  await lab.getByLabel('Trim in · parent frame', { exact: true }).fill(String(first)); await lab.getByLabel('Trim out · exclusive parent frame', { exact: true }).fill(String(end));
  await lab.getByRole('button', { name: 'Freeze selected region', exact: true }).click(); await expect.poll(async () => (await state(page)).analysis.candidate?.assetReady).toBe(true);
  const frozen = (await state(page)).analysis.candidate;
  await lab.getByText('BODY FIT · editable damped-sinusoid approximation', { exact: true }).click(); await lab.getByRole('button', { name: 'Estimate body modes', exact: true }).click();
  await expect.poll(async () => (await state(page)).modal.analysis?.estimate?.modes.length, { timeout: 45000 }).toBeGreaterThan(0);
  await expect(lab.getByRole('button', { name: 'Refit edited mode selection', exact: true })).toBeEnabled({ timeout: 10000 });
  await lab.getByRole('button', { name: 'Refit edited mode selection', exact: true }).click();
  await expect.poll(async () => Array.isArray((await state(page)).modal.analysis?.recipe?.manualModes), { timeout: 45000 }).toBe(true);
  await lab.getByLabel('Seed recipe', { exact: true }).selectOption('modal-body');
  await lab.getByLabel('Pitch declaration', { exact: true }).selectOption('pitched'); await lab.getByRole('button', { name: 'Compile seed instrument', exact: true }).click();
  await expect.poll(async () => (await state(page)).instrument.compiledPatchReady, { timeout: 45000 }).toBe(true);
  const original = await state(page); expect(await boundary(page)).toEqual(before);
  await lab.getByRole('button', { name: 'Audition seed controls', exact: true }).click(); await readyInstrument(page, 'audibleAuditionReady');
  await lab.getByRole('button', { name: 'Save playable seed locally', exact: true }).click(); await readyInstrument(page, 'durable');
  await lab.getByRole('button', { name: 'Apply to selected lane', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef?.packHash)).toBe(original.instrument.contentHash);
  const frozenProject = await page.evaluate(async () => {
    const root = new URL('./', location.href), module = await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root));
    const store = module.createProcgenSessionStorage(), id = 'doc:seed-rebuild-unselected', session = window.__PROCGEN_STUDIO__.capture('Unselected shared frozen graft', { resume: false });
    try { await store.saveDocument(id, 0, session, 'seed-rebuild-unselected-commit'); return await store.loadDocument(id); } finally { store.close(); }
  });
  before = await boundary(page); expect(before.physics).toBe(capturedBoundary.physics); expect(before.sameWorld).toBe(true);
  dialog = await render('worklet-sine'); await dialog.getByRole('button', { name: 'Harvest selected file as seed', exact: true }).click();
  await expect.poll(async () => (await state(page)).offeredSource).toBe(true); expect((await state(page)).analysis.candidate.assetHash).toBe(frozen.assetHash);
  await lab.getByRole('button', { name: 'Plan selected derived rebuild', exact: true }).click(); await expect.poll(async () => (await state(page)).rebuildPlan?.state).toBe('rebuildable');
  const plan = (await state(page)).rebuildPlan; expect(plan.nodes.map(node => node.id)).toEqual(['source', 'region', 'modal', 'patch']);
  await lab.getByRole('button', { name: 'Prepare selected derived branch', exact: true }).click();
  await expect.poll(async () => (await state(page)).rebuild.summary?.contentHash, { timeout: 60000 }).toBeTruthy();
  const prepared = await state(page); expect(prepared.rebuild.summary.contentHash).not.toBe(original.instrument.contentHash);
  expect(prepared.analysis.candidate.assetHash).toBe(frozen.assetHash); expect(prepared.instrument.contentHash).toBe(original.instrument.contentHash); expect(await boundary(page)).toEqual(before);
  await expect(lab.getByRole('button', { name: 'Apply derived branch to selected lane', exact: true })).toBeDisabled();
  await lab.getByRole('button', { name: 'Audition derived branch', exact: true }).click(); await readyInstrument(page, 'audibleAuditionReady', true);
  await lab.getByRole('button', { name: 'Save derived branch locally', exact: true }).click(); await readyInstrument(page, 'durable', true);
  expect(await boundary(page)).toEqual(before); await lab.getByRole('button', { name: 'Apply derived branch to selected lane', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].instrumentRef?.packHash)).toBe(prepared.rebuild.summary.contentHash);
  const applied = await boundary(page); expect(applied.physics).toBe(before.physics); expect(applied.tick).toBe(before.tick); expect(applied.sameWorld).toBe(true);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.undo()); expect(await boundary(page)).toEqual(before);
  await page.evaluate(async () => { const root = new URL('./', location.href); window.__seedRebuildOffline = {
    storage: await import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)), registry: await import(new URL('js/app/midi-ui/SoundContentRegistry.js', root)),
    budget: await import(new URL('js/app/resources/ResourceBudget.js', root)), catalog: await import(new URL('js/app/midi-ui/NativeInstrumentSchema.js', root)) }; });
  await page.context().setOffline(true);
  const offline = await page.evaluate(async hashes => {
    const modules = window.__seedRebuildOffline, budget = modules.budget.createResourceBudget(), catalog = await modules.catalog.getNativeInstrumentCatalog(), store = modules.storage.createProcgenSessionStorage();
    const registry = modules.registry.createSoundContentRegistry({ indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, resourceBudget: budget });
    try { const packs = []; for (const hash of hashes) { const loan = await registry.loadPack(hash, { engineDescriptors: catalog.descriptors });
      try { packs.push({ hash: loan.prepared.contentHash, patches: loan.prepared.patches.map(patch => ({ hash: patch.definitionHash, state: patch.state })) }); } finally { loan.release(); } }
    return { frozenProject: await store.loadDocument('doc:seed-rebuild-unselected'), packs }; }
    finally { registry.close(); store.close(); }
  }, [original.instrument.contentHash, prepared.rebuild.summary.contentHash]);
  await page.context().setOffline(false); expect(offline.frozenProject).toEqual(frozenProject);
  expect(offline.packs.map(pack => pack.hash)).toEqual([original.instrument.contentHash, prepared.rebuild.summary.contentHash]);
  expect(offline.packs.every(pack => pack.patches.every(patch => patch.state === 'definition-admitted'))).toBe(true);
  await lab.getByLabel('Seed recipe', { exact: true }).selectOption('feedforward-graft'); await lab.getByLabel('Graft body component', { exact: true }).selectOption('fitted');
  await lab.getByRole('button', { name: 'Plan selected derived rebuild', exact: true }).click(); await expect.poll(async () => (await state(page)).rebuildPlan?.transform).toBe('feedforward-graft');
  const graftPlan = (await state(page)).rebuildPlan;
  await lab.getByRole('button', { name: 'Prepare selected derived branch', exact: true }).click();
  await expect.poll(async () => (await state(page)).rebuild.summary?.planHash, { timeout: 60000 }).toBe(graftPlan.planHash);
  await expect.poll(async () => (await state(page)).rebuild.active).toBe(false);
  await lab.getByRole('button', { name: 'Audition derived branch', exact: true }).click();
  await expect.poll(async () => (await state(page)).rebuild.error, { timeout: 15000 }).toContain('workload-source-reservations');
  const refusedGraft = (await state(page)).rebuild;
  expect(refusedGraft.instrument.compiledPatchReady).toBe(true); expect(refusedGraft.instrument.audibleAuditionReady).toBe(false); expect(refusedGraft.instrument.durable).toBe(false);
  await expect(lab.getByRole('button', { name: 'Apply derived branch to selected lane', exact: true })).toBeDisabled();
  expect((await state(page)).analysis.candidate.assetHash).toBe(frozen.assetHash); expect(await boundary(page)).toEqual(before);
  await testInfo.attach('native-seed-rebuild-receipt', { body: JSON.stringify({ frozen, original: original.instrument, plan, prepared: prepared.rebuild, applied, before, offline, refusedGraft }), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('seed-rebuild-desktop.png') });
});
