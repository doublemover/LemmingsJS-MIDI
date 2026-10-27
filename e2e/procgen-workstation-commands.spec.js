import { expect, test } from '@playwright/test';
import { enableComplementaryPatterns } from './helpers/procgenPatterns.js';

test.use({ permissions: [] });
const ready = async page => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=8');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await enableComplementaryPatterns(page);
  await page.evaluate(() => { const { world, renderer } = window.__PROCGEN_LANES__; for (let tick = 0; tick < 32; tick++) world.step(); renderer.render(true); if (!world.actors.length) throw new Error('Command safety needs a populated physical world.'); });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { enabled: true, note: 60 } }));
  await page.locator('.studio-cell').first().click();
};
const snapshot = page => page.evaluate(async () => {
  const world = window.__PROCGEN_LANES__.world; window.__PROCGEN_LANES__.renderer.render(true);
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
  const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  const { getProcgenCommandDispatcher } = await import('/js/app/controls/ProcgenCommandDispatcher.js');
  return { hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)), tick: world.tickIndex,
    step: window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0].steps[0],
    selectedStep: window.__PROCGEN_STUDIO__.state.step, playing: window.__PROCGEN_STUDIO__.transport.getState().playing,
    commands: getProcgenCommandDispatcher({ document, window }).inspect() };
});
const openCommands = async page => {
  const menu = page.locator('.studio-transport-overflow'); if (!await menu.evaluate(element => element.open)) await menu.locator('summary').click();
  await menu.getByRole('button', { name: 'Commands…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Commands and shortcuts', exact: true }); await expect(dialog).toBeVisible(); return dialog;
};

test('desktop native controls, modal actions and composition never dispatch an unrelated world or pattern command', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); await ready(page); const before = await snapshot(page);
  expect(before.commands).toMatchObject({ groups: 3, installed: true });
  const save = page.locator('#procgenStudioFooter').getByRole('button', { name: 'Save', exact: true }); await save.focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Delete');
  const native = await snapshot(page); expect(native.hash).toBe(before.hash); expect(native.step).toEqual(before.step); expect(native.selectedStep).toBe(before.selectedStep);
  await page.keyboard.press('Space'); const naming = page.getByRole('dialog', { name: 'Project name', exact: true }); await expect(naming).toBeVisible();
  await naming.getByRole('button', { name: 'Cancel', exact: true }).focus(); await page.keyboard.press('Shift+T'); await page.keyboard.press('Escape'); await expect(naming).toHaveCount(0);
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Load', exact: true }).click();
  const saved = page.getByRole('dialog', { name: 'Saved projects', exact: true }); await expect(saved).toBeVisible();
  await saved.getByRole('button', { name: 'Close', exact: true }).focus(); await page.keyboard.press('Shift+T');
  expect((await snapshot(page)).hash).toBe(before.hash); await page.keyboard.press('Escape'); await expect(saved).not.toBeVisible();
  const menu = page.locator('.studio-transport-overflow'); await menu.locator('summary').focus(); await page.keyboard.press('Space');
  expect((await snapshot(page)).playing).toBe(false); await page.keyboard.press('Space');
  const delivery = await page.evaluate(() => {
    const canvas = document.getElementById('gameCanvas'), event = new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', shiftKey: true, isComposing: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event); const reserved = new KeyboardEvent('keydown', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(reserved); return { reserved: reserved.defaultPrevented, composing: event.defaultPrevented };
  }); expect(delivery).toEqual({ reserved: false, composing: false });
  const after = await snapshot(page); expect(after.hash).toBe(before.hash); expect(after.step).toEqual(before.step); expect(after.playing).toBe(false);
});

test('owned step repeat follows its own edits and stops at an unrelated project revision', async ({ page }) => {
  test.setTimeout(90000); await ready(page);
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.state.step)).toBe(3);
  await page.keyboard.down('ArrowRight'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.state.step)).toBe(4);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.5 } }));
  await page.keyboard.down('ArrowRight'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.state.step)).toBe(4);
  await page.keyboard.up('ArrowRight'); await page.locator('.studio-cell.selected').focus(); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.state.step)).toBe(5);
  await page.keyboard.down('Control'); await page.keyboard.down('z'); await page.keyboard.down('z'); await page.keyboard.up('z'); await page.keyboard.up('Control');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].gain)).toBe(1);
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0].steps[0].enabled)).toBe(true);
  await page.keyboard.press('Control+c'); const copied = await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0]);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 5, patch: { note: 82 } }));
  await page.locator('.studio-cell.selected').focus(); await page.keyboard.press('Control+v');
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0])).toEqual(copied);
  await page.keyboard.press('Control+z'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].patterns[0].steps[5].note)).toBe(82);

});

test('desktop command search fences stale targets and hands one modal to the selected deep editor', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); await ready(page); let dialog = await openCommands(page);
  await expect(dialog.getByRole('heading', { name: 'Commands and shortcuts' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('desktop-command-reference.png') });
  const input = dialog.getByRole('searchbox', { name: 'Find a command' }); await input.fill('sound library');
  await page.evaluate(() => { window.oldCommand = document.querySelector('[data-command-id="workstation.openSoundLibrary"]'); window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.5 } }); });
  await dialog.locator('[data-command-id="workstation.openSoundLibrary"]').click(); await expect(dialog).toContainText('Close and reopen Commands');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); dialog = await openCommands(page);
  await page.evaluate(() => window.oldCommand.click()); await expect(dialog).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(1);
  await dialog.getByRole('searchbox', { name: 'Find a command' }).fill('sound library'); await page.keyboard.press('Enter');
  const library = page.getByRole('dialog', { name: 'Sound library', exact: true }); await expect(library).toBeVisible(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(1);
});


test('Stage command availability stays read-only and preserves permitted performance actions', async ({ page }) => {
  test.setTimeout(90000); await ready(page); await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.stage());
  const before = await snapshot(page); await page.locator('.studio-scene-cue').getByRole('button', { name: 'Panic', exact: true }).focus();
  await page.keyboard.press('Shift+T'); expect((await snapshot(page)).hash).toBe(before.hash);
  const dialog = await openCommands(page);
  await expect(dialog.locator('[data-command-id="workstation.undo"]')).toBeDisabled();
  await expect(dialog.locator('[data-command-id="workstation.openPhysicalAuthoring"]')).toBeDisabled();
  await expect(dialog.locator('[data-command-id="world.restartLevel"]')).toBeDisabled();
  await expect(dialog.locator('[data-command-id="world.nukeInstant"]')).toBeDisabled();
  await expect(dialog.locator('[data-command-id="workstation.openMasterCapture"]')).toBeEnabled();
  await expect(dialog.locator('[data-command-id="workstation.panicOutput"]')).toBeEnabled();
  await dialog.getByRole('searchbox', { name: 'Find a command' }).fill('Panic:'); await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0);
  expect((await snapshot(page)).hash).toBe(before.hash); await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.stageExit());
});


test('custom desktop bindings publish together after neutral loading and remain consistent with actual dispatch', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/keybindings.json', async route => { await gate; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1,
    bindings: { zoomIn: ['KeyG'], zoomOut: ['KeyH'], 'pattern.nextStep': ['KeyL'], 'workstation.panicOutput': ['F8'] } }) }); });
  try {
    await ready(page); const scale = () => page.evaluate(() => window.__PROCGEN_LANES__.renderer.camera.getState().scale);
    const original = await scale(); await expect(page.locator('#procgenZoomIn')).toHaveAttribute('title', 'Zoom in');
    await page.locator('#gameCanvas').focus(); await page.keyboard.press('z'); expect(await scale()).toBe(original);
    release(); await expect(page.locator('#procgenZoomIn')).toHaveAttribute('title', 'Zoom in (G)'); await expect(page.locator('#procgenZoomOut')).toHaveAttribute('title', 'Zoom out (H)');
    await page.keyboard.press('z'); expect(await scale()).toBe(original); await page.keyboard.press('g'); expect(await scale()).toBeGreaterThan(original);
    await page.locator('.studio-cell.selected').focus(); await page.keyboard.press('ArrowRight'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.state.step)).toBe(0);
    await page.keyboard.press('l'); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.state.step)).toBe(1);
    const dialog = await openCommands(page); await expect(dialog.locator('[data-command-id="pattern.nextStep"] kbd')).toHaveText('L');
    await expect(dialog.locator('[data-command-id="world.zoomIn"] kbd')).toHaveText('G');
    const before = await snapshot(page); await dialog.getByRole('searchbox', { name: 'Find a command' }).focus(); await page.keyboard.press('F8');
    await expect(dialog).toBeVisible(); expect((await snapshot(page)).hash).toBe(before.hash);
  } finally { release(); }
});
