import { expect, test } from '@playwright/test';
import { inspectLane } from './helpers/workstationDock.js';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';

test.use({ permissions: [] });
test.setTimeout(180000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const ready = async page => {
  await page.goto('/dist/browser/procgen.html?e2e=1&workstation=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};

test('six pinned native sounds preserve the actual 1000-tick world and causal event order without a legacy pattern path', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await ready(page); await page.locator('#procgenListen').click();
  const result = await page.evaluate(async () => {
    const root = new URL('./', location.href), { captureProcgenCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root)),
      { hashProcgenPhysicsCheckpoint, projectProcgenPhysicsCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root)),
      { hashJournalData } = await import(new URL('js/app/procgen/workstation/CausalJournalCanonical.js', root));
    const studio = window.__PROCGEN_STUDIO__;
    while (window.__PROCGEN_LANES__.world.tickIndex < 2) window.__PROCGEN_LANES__.world.step();
    const initial = studio.capture('Sound isolation fixture');
    if (studio.getProject().procgen.lanes.some(lane => lane.mode !== 'physical' || lane.patterns.length)) throw new Error('Legacy pattern path must be disabled.');
    const trace = [], control = window.__PROCGEN_LANES__.world, record = batch => trace.push(batch), initialHash = await hashProcgenPhysicsCheckpoint(initial.world);
    control.soundEvents.onBatch.on(record); for (let tick = 0; tick < 1000; tick++) control.step(tick * 16); control.soundEvents.onBatch.off(record);
    const controlCheckpoint = captureProcgenCheckpoint(control), controlHash = await hashProcgenPhysicsCheckpoint(controlCheckpoint), controlTrace = await hashJournalData(trace, { maxBytes: 32 * 1048576, maxNodes: 4000000 }); trace.length = 0;
    await studio.loadSession(initial); window.__PROCGEN_LANES__.pause();
    const world = window.__PROCGEN_LANES__.world, tickStart = world.tickIndex, projectBefore = studio.getProject(), ids = ['foundation.soft-triangle', 'forge.glass-rivet', 'material.timber', 'pluck.burrow-thumb', 'choir.hollow-ooh', 'spectrum.bubble-reed'];
    const restoredHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
    world.soundEvents.onBatch.on(record); const selections = [];
    for (let tick = 0; tick < 1000; tick++) {
      if (tick % 150 === 0 && tick < 900) {
        const before = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
        await studio.handlers.selectNativeSound('lane-1', ids[tick / 150]);
        const after = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)); if (before !== after || world !== window.__PROCGEN_LANES__.world) throw new Error('Sound selection changed the physical world.');
        selections.push(studio.getProject().procgen.lanes[0].instrumentPatchId);
      }
      world.step(tick * 16);
    }
    world.soundEvents.onBatch.off(record); const changedCheckpoint = captureProcgenCheckpoint(world), changedHash = await hashProcgenPhysicsCheckpoint(changedCheckpoint), changedTrace = await hashJournalData(trace, { maxBytes: 32 * 1048576, maxNodes: 4000000 });
    await studio.handlers.undo(); const undoHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
    const difference = (left, right) => {
      const pending = [{ left, right, path: '$' }]; let visits = 0;
      while (pending.length && visits++ < 100000) {
        const pair = pending.pop(); if (Object.is(pair.left, pair.right)) continue;
        if (!pair.left || !pair.right || typeof pair.left !== 'object' || typeof pair.right !== 'object') return pair;
        const a = Object.keys(pair.left), b = Object.keys(pair.right); if (!Array.isArray(pair.left) && a.length !== b.length) return { path: pair.path, leftKeys: a.length, rightKeys: b.length };
        for (let index = a.length - 1; index >= 0; index--) { const key = a[index]; if (!Object.hasOwn(pair.right, key)) return { path: pair.path + '.' + key, missing: 'right' }; pending.push({ left: pair.left[key], right: pair.right[key], path: pair.path + '.' + key }); }
      }
      return pending.length ? { unknown: 'diagnostic traversal budget' } : null;
    };
    const mismatchStates = changedHash === controlHash ? null : { control: projectProcgenPhysicsCheckpoint(controlCheckpoint), changed: projectProcgenPhysicsCheckpoint(changedCheckpoint) };
    return { initialHash, restoredHash, mismatchStates, difference: mismatchStates ? difference(mismatchStates.control, mismatchStates.changed) : null,
      controlHash, changedHash, controlTrace, changedTrace, undoHash, selections, tickStart, tickEnd: world.tickIndex, sameWorld: world === window.__PROCGEN_LANES__.world,
      hardwareUnchanged: ['channel', 'externalProgram', 'externalPercussion', 'outputId'].every(key => studio.getProject().procgen.lanes[0][key] === projectBefore.procgen.lanes[0][key]),
      sourceOnlyFixture: false, acousticQualification: false };
  });
  await testInfo.attach('sound-world-isolation.json', { body: JSON.stringify(result), contentType: 'application/json' });
  console.info('SOUND_WORLD_ISOLATION ' + JSON.stringify({ ...result, mismatchStates: undefined }));
  expect(result.restoredHash).toBe(result.initialHash);
  expect(result.changedHash).toBe(result.controlHash); expect(result.changedTrace).toBe(result.controlTrace); expect(result.undoHash).toBe(result.changedHash);
  expect(result.selections).toHaveLength(6); expect(new Set(result.selections).size).toBe(6); expect(result.sameWorld).toBe(true); expect(result.hardwareUnchanged).toBe(true); expect(result.tickEnd - result.tickStart).toBe(1000);
});

test('hold preview restores on keyboard release and commits only through the explicit Apply command', async ({ page }) => {
  await ready(page); await inspectLane(page, 'Lane'); await page.getByRole('button', { name: 'Sound library…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sound library', exact: true });
  await dialog.getByRole('button', { name: 'Prepare factory instruments', exact: true }).click();
  await expect(dialog.getByLabel('Saved instrument revision').locator('option')).toHaveCount(4, { timeout: 30000 });
  await dialog.getByLabel('Saved instrument revision').selectOption('foundation.soft-triangle@3');
  await dialog.getByRole('button', { name: 'Rehearsal on live output', exact: true }).click(); await expect(dialog.getByLabel('Prelisten route')).toContainText('ready');
  await dialog.getByRole('button', { name: 'Audition controls', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Control audition completed');
  await dialog.getByRole('button', { name: 'Install auditioned pack', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Pack installed');
  const before = await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject())), hold = dialog.getByRole('button', { name: /Hold Space, Enter or pointer/ });
  await hold.focus(); await page.keyboard.down('Space'); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.soundSelectionState().preview)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toBe(before);
  await page.keyboard.up('Space'); await expect.poll(() => page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.soundSelectionState().pendingOwners)).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toBe(before);
  await dialog.getByRole('button', { name: 'Apply to selected lane', exact: true }).click(); await expect(dialog.getByLabel('Sound library status')).toContainText('Instrument applied');
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.undo()); expect(await page.evaluate(() => JSON.stringify(window.__PROCGEN_STUDIO__.getProject()))).toBe(before);
});
