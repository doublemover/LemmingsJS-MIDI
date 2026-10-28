import { useWorkstationControl } from './helpers/workstationChrome.js';
import { expect, test } from '@playwright/test';
import { DESKTOP_VIEWPORTS } from './helpers/desktopViewports.js';
import { inspectLane } from './helpers/workstationDock.js';
import { enableComplementaryPatterns } from './helpers/procgenPatterns.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';

const ready = async (page, seed = 42) => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto(`/procgen.html?e2e=1&recipe=1&seed=${seed}&lanes=8&output=midi`);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(16); window.__PROCGEN_LANES__.renderer.render(true); window.__dockWorld = window.__PROCGEN_LANES__.world; });
};
const ownerState = page => page.evaluate(async () => {
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'), { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  const output = window.__PROCGEN_STUDIO__.getPlaybackState(); return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)), sameWorld: window.__dockWorld === window.__PROCGEN_LANES__.world, output: { selectedBackend: output.selectedBackend, enabled: output.enabled, outputRoutes: window.__PROCGEN_STUDIO__.ports.getState().outputRoutes }, midi: window.__WEBMIDI_STUB__.metrics().sent };
});
const geometry = page => page.evaluate(() => {
  const rectangle = selector => { const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
  return { workspace: rectangle('#procgenStudio'), world: rectangle('#procgenStudioStage'), headers: rectangle('.studio-lane-headers'), dock: rectangle('#procgenDeepDock'), rows: document.querySelectorAll('.studio-lane-header').length };
});
const presentedColors = page => page.evaluate(() => {
  const canvas = window.__PROCGEN_LANES__.renderer.canvas, pixels = canvas.getContext('2d').getImageData(0, 0, Math.min(600, canvas.width), canvas.height).data, colors = new Set();
  for (let index = 0; index < pixels.length; index += 16) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
  return colors.size;
});

for (const viewport of DESKTOP_VIEWPORTS) test(`desktop ${viewport.width}x${viewport.height} keeps a joined terrain-first surface through scoped dock resize and close`, { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(60000); await page.setViewportSize(viewport); await ready(page); const before = await ownerState(page), closed = await geometry(page);
  await expect(page.locator('#procgenDeepDock')).toBeHidden(); expect(closed.world.width / closed.workspace.width).toBeGreaterThanOrEqual(0.65); expect(Math.abs(closed.headers.right - closed.world.x)).toBeLessThanOrEqual(2);
  await inspectLane(page); const open = await geometry(page); expect(open.dock.y).toBeGreaterThanOrEqual(open.world.bottom - 2); expect(open.world.width).toBe(closed.world.width); expect(open.rows).toBeLessThanOrEqual(closed.rows);
  const laneTab = page.getByRole('tab', { name: 'Lane', exact: true }); await laneTab.focus(); await laneTab.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'Physical', exact: true })).toBeFocused(); await page.getByRole('tab', { name: 'Physical', exact: true }).press('Home'); await expect(laneTab).toBeFocused();
  const separator = page.getByRole('separator', { name: 'Resize instrument dock' }); await separator.focus(); const height = Number(await separator.getAttribute('aria-valuenow')); await separator.press('ArrowUp'); await expect(separator).toHaveAttribute('aria-valuenow', String(height + 16));
  await expect(page.getByLabel('Current editor target')).toContainText('lane-1'); expect(await ownerState(page)).toEqual(before);
  await expect.poll(() => presentedColors(page)).toBeGreaterThan(8);
  await testInfo.attach('desktop-layout-metrics', { body: JSON.stringify({ viewport, closed, open, resized: await geometry(page), presentedColors: await presentedColors(page) }), contentType: 'application/json' }); await page.screenshot({ path: testInfo.outputPath(`joined-workstation-open-${viewport.width}.png`) });
  await page.getByRole('button', { name: 'Close instrument dock', exact: true }).click(); await expect(page.getByRole('button', { name: 'Inspect selected lane', exact: true })).toBeFocused(); await expect(page.locator('#procgenDeepDock')).toBeHidden(); expect(await ownerState(page)).toEqual(before);
  await expect.poll(() => presentedColors(page)).toBeGreaterThan(8); await page.screenshot({ path: testInfo.outputPath(`joined-workstation-${viewport.width}.png`) });
});

test('curve drafts retain exact lane ownership through invalid text, lane switch, Undo, graphical edits and two-stage Escape', { tag: ['@boundary', '@workstation-dock'] }, async ({ page }) => {
  test.setTimeout(90000); await ready(page); await enableComplementaryPatterns(page); await inspectLane(page, 'Automation'); await page.getByRole('button', { name: 'Add CC curve', exact: true }).click();
  const points = page.getByLabel('Points', { exact: true }); await points.fill('0:32, 2:'); await points.evaluate(element => { window.__curveDraftInput = element; }); await expect(points).toHaveAttribute('aria-invalid', 'true'); await expect(page.getByRole('button', { name: 'Apply curve', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/lane', laneId: 'lane-2', patch: { gain: 0.5 } })); await expect(points).toHaveValue('0:32, 2:');
  await page.locator('.studio-lane-header').nth(1).locator('.studio-lane-title').click(); await page.getByRole('tab', { name: 'Automation', exact: true }).click(); await page.getByRole('button', { name: 'Add CC curve', exact: true }).click();
  await points.fill('0:16, 2:100, 4:16'); await page.getByRole('button', { name: 'Apply curve', exact: true }).click(); await expect(page.getByLabel('Current editor target')).toContainText('lane-2');
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }).click(); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[1].ccAutomation[0].points[0].value)).toBe(32); await expect(page.getByLabel('Current editor target')).toContainText('lane-2');
  await page.locator('.studio-lane-header').first().locator('.studio-lane-title').click(); await page.getByRole('tab', { name: 'Automation', exact: true }).click(); expect(await points.evaluate(element => element === window.__curveDraftInput)).toBe(true); await expect(points).toHaveValue('0:32, 2:');
  await points.fill('0:32, 2:100, 4:32'); const before = await ownerState(page); const point = page.locator('.studio-curve-editor circle').first(); await point.focus(); await point.press('ArrowUp'); expect(await ownerState(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply curve', exact: true }).click(); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].ccAutomation[0].points[0].value)).toBe(33); await expect(page.getByLabel('Current editor target')).toContainText('lane-1');
  const middle = page.locator('.studio-curve-editor circle').nth(1); await middle.scrollIntoViewIfNeeded(); const bounds = await middle.boundingBox(), beforeDrag = await ownerState(page);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 10, { steps: 20 });
  await page.locator('.studio-curve-editor svg').evaluate(element => element.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 999, bubbles: true }))); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 16, { steps: 10 }); await page.mouse.up(); expect(await ownerState(page)).toEqual(beforeDrag);
  await page.getByRole('button', { name: 'Apply curve', exact: true }).click(); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes[0].ccAutomation[0].points[1].value)).toBeGreaterThan(100); await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }).click();
  await middle.scrollIntoViewIfNeeded(); const cancelledBounds = await middle.boundingBox(); await page.mouse.move(cancelledBounds.x + cancelledBounds.width / 2, cancelledBounds.y + cancelledBounds.height / 2); await page.mouse.down(); await page.mouse.move(cancelledBounds.x + cancelledBounds.width / 2, cancelledBounds.y + cancelledBounds.height / 2 - 12, { steps: 10 }); await useWorkstationControl(page, page.getByLabel('Workspace mode', { exact: true }), {}, 'selectOption', 'overview'); await page.mouse.up(); await inspectLane(page, 'Automation'); await expect(points).toHaveValue('0:33, 2:100, 4:32');
  await points.fill('0:'); await points.press('Escape'); await expect(page.locator('#procgenDeepDock')).toBeVisible(); await expect(points).toHaveValue('0:33, 2:100, 4:32'); await points.press('Escape'); await expect(page.locator('#procgenDeepDock')).toBeHidden();
});

test('world selection has one explicit panel and cannot consume the graphical editor or borrow an actor from another target', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); await inspectLane(page, 'Automation'); await page.getByRole('button', { name: 'Add CC curve', exact: true }).click(); const before = await ownerState(page);
  const selected = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, snapshot = window.__PROCGEN_LANES__.renderer.presentation.getSnapshot(), actor = snapshot?.entities.find(value => value.kind === 'actor'); if (!actor) throw new Error('Selection qualification needs an actually presented actor.');
    if (!studio.getWorldInspector().select(actor.id)) throw new Error('The accepted actor could not be selected.'); return actor.id;
  });
  await expect(page.getByRole('region', { name: 'World inspection', exact: true })).toBeHidden(); await page.getByRole('tab', { name: 'Selection', exact: true }).click(); await expect(page.getByRole('tabpanel', { name: 'Selection', exact: true })).toBeVisible(); await expect(page.getByRole('region', { name: 'World inspection', exact: true })).toBeVisible(); await expect(page.getByLabel('Current editor target')).toContainText(selected);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click(); await expect(page.getByLabel('Current editor target')).not.toContainText(selected); await page.getByRole('tab', { name: 'Automation', exact: true }).click(); await expect(page.getByRole('region', { name: 'World inspection', exact: true })).toBeHidden(); await expect(page.locator('.studio-curve-editor')).toBeVisible(); expect(await ownerState(page)).toEqual(before);
});

test('dock preferences survive an explicit new seed without restoring the previous music or physical source', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await inspectLane(page); const resize = page.getByRole('separator', { name: 'Resize instrument dock' }); await resize.focus(); await resize.press('ArrowUp');
  const height = Number(await resize.getAttribute('aria-valuenow'));
  await page.waitForFunction(height => Object.keys(localStorage).some(key => { try { const value = JSON.parse(localStorage.getItem(key)); return value?.ui?.workspaceMode === 'inspect' && value.ui.dockHeight === height; } catch { return false; } }), height);
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=43&lanes=8&output=midi'); await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain); await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await expect(page.locator('#procgenDeepDock')).toBeVisible(); await expect(resize).toHaveAttribute('aria-valuenow', String(height)); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.seed)).toBe(43); expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.getProject().procgen.lanes.length)).toBe(8);
});

test('selected actors and shared mapping commands retain their actual target through lane switching and Undo', { tag: '@boundary' }, async ({ page }) => {
  await ready(page); await inspectLane(page, 'Selection');
  const actorIds = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, entities = window.__PROCGEN_LANES__.renderer.presentation.getSnapshot().entities;
    const ids = [0, 1].map(lane => entities.find(entity => entity.kind === 'actor' && entity.lane === lane)?.id);
    if (ids.some(id => !id) || !studio.getWorldInspector().select(ids[0])) throw new Error('Mapping qualification requires two actually presented lane actors.');
    return ids;
  });
  await page.getByRole('tab', { name: 'Physical', exact: true }).click();
  const group = page.locator('.studio-physical-instrument').first(), pitch = group.getByLabel('Pitch / cents', { exact: true });
  const mappingId = await group.getAttribute('data-mapping-id'), initial = await pitch.inputValue(), changed = String(Number(initial) + 100);
  await pitch.focus(); await expect(page.getByLabel('Current editor target')).toContainText('Shared physical graph');
  await expect(page.getByLabel('Current editor target')).toContainText(mappingId); await expect(page.getByLabel('Current editor target')).toContainText(actorIds[0]);
  await pitch.fill(changed); await pitch.press('Enter');
  await expect.poll(() => page.evaluate(id => window.__PROCGEN_STUDIO__.getProject().procgen.physicalGraph.instruments.find(value => value.id === id).pitchCents, mappingId)).toBe(Number(changed));
  await page.locator('.studio-lane-header').nth(1).locator('.studio-lane-title').click();
  await page.evaluate(id => { if (!window.__PROCGEN_STUDIO__.getWorldInspector().select(id)) throw new Error('The second actor reference was not accepted.'); }, actorIds[1]);
  await page.getByRole('tab', { name: 'Physical', exact: true }).click();
  await expect(page.getByLabel('Current editor target')).toContainText('lane-2'); await expect(page.getByLabel('Current editor target')).toContainText(actorIds[1]); await expect(page.getByLabel('Current editor target')).not.toContainText(actorIds[0]);
  await page.locator('#procgenStudioFooter').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(id => window.__PROCGEN_STUDIO__.getProject().procgen.physicalGraph.instruments.find(value => value.id === id).pitchCents, mappingId)).toBe(Number(initial));
  await expect(page.getByLabel('Current editor target')).toContainText('lane-2'); await expect(page.getByLabel('Current editor target')).not.toContainText(actorIds[0]);
});

test('desktop text enlargement keeps graphical and exact curve controls reachable inside one scrollable dock', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await ready(page); await page.addStyleTag({ content: '.studio-dock-header, .studio-dock-header button, .studio-deep-dock .studio-field, .studio-deep-dock input, .studio-deep-dock select, .studio-deep-dock button, .studio-curve-editor { font-size:16px!important; line-height:1.5!important; }' });
  await inspectLane(page, 'Automation'); await page.getByRole('button', { name: 'Add CC curve', exact: true }).click(); const points = page.getByLabel('Points', { exact: true }); await points.fill('0:32, 2:100, 4:32'); await points.scrollIntoViewIfNeeded();
  const dock = await page.locator('#procgenDeepDock').boundingBox(); for (const control of [points, page.getByRole('button', { name: 'Discard curve draft', exact: true }), page.getByRole('button', { name: 'Close instrument dock', exact: true })]) { await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(dock.x); expect(box.x + box.width).toBeLessThanOrEqual(dock.x + dock.width + 1); }
  await page.getByRole('separator', { name: 'Resize instrument dock' }).focus(); await page.getByRole('separator', { name: 'Resize instrument dock' }).press('End'); await page.locator('.studio-curve-editor svg').scrollIntoViewIfNeeded();
  await expect(page.locator('.studio-selection-panel')).toBeHidden(); expect(await page.locator('.studio-curve-editor svg').evaluate(element => { const rect = element.getBoundingClientRect(), parent = element.closest('.studio-inspector-fields').getBoundingClientRect(); return Math.min(rect.bottom, parent.bottom) - Math.max(rect.top, parent.top); })).toBeGreaterThanOrEqual(160);
  expect(await points.evaluate(element => window.getComputedStyle(element).fontSize)).toBe('16px'); expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1920, 1080]); await expect.poll(() => presentedColors(page)).toBeGreaterThan(8); await page.screenshot({ path: testInfo.outputPath('desktop-dock-enlarged-text.png') });
});
