import { useWorkstationControl } from './helpers/workstationChrome.js';
import { MIN_DESKTOP_VIEWPORT } from './helpers/desktopViewports.js';
import { expect, test } from '@playwright/test';

const setup = async (page, lanes = 8) => {
  await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=' + lanes);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world; studio.transport.pause();
    for (let tick = 0; tick < 180; tick++) world.step();
    const walker = world.actors.find(actor => actor.action?.actionName === 'walk'); if (!walker) throw new Error('The controlled starter needs a real walking actor.');
    const lane = walker.laneIndex, floorY = world.surfaceAt(lane, 96), firstX = 72, lastX = 120;
    for (const actor of world.actors) if (actor.laneIndex === lane) { actor.x = 24; actor.y = world.surfaceAt(lane, 24) - 1; }
    for (let x = firstX - 16; x < lastX + 16; x += 16) world.hasGroundAt(x, floorY);
    const { validatePhysicalJunction } = await import('/js/app/procgen/PhysicalJunctions.js');
    const definition = validatePhysicalJunction({ id: 'browser-switch', revision: 1, safetyVersion: 1,
      control: { x1: firstX, x2: lastX, y1: floorY, y2: floorY + 16 }, influence: { x1: firstX - 16, x2: lastX + 16, y1: Math.max(lane * world.laneHeight, floorY - 24), y2: Math.min((lane + 1) * world.laneHeight, floorY + 24) },
      ports: [{ id: 'in', role: 'inlet', position: { x: firstX - 14, y: floorY }, direction: 'right' }, { id: 'out', role: 'outlet', position: { x: lastX + 14, y: floorY }, direction: 'right' }],
      configurations: [{ id: 'direct', outletIds: ['out'], spans: Array.from({ length: 16 }, (_, row) => ({ y: floorY + row, x1: firstX, x2: lastX, solid: true })) },
        { id: 'stepped', outletIds: ['out'], spans: Array.from({ length: 16 }, (_, row) => { const x = firstX + 16 + (Math.ceil((16 - row) / 2) - 1) * 4; return [{ y: floorY + row, x1: firstX, x2: x, solid: false }, { y: floorY + row, x1: x, x2: lastX, solid: true }]; }).flat() }] });
    studio.dispatch({ type: 'procgen/junctions', junctions: [definition] }); window.junctionFixture = { definition, floorY, lane };
  });
  await page.locator('#procgenStep').click();
  await useWorkstationControl(page, page.getByRole('button', { name: 'Junctions…', exact: true }), {'button':'Junctions…'}, 'click');
  const dock = page.getByRole('region', { name: 'Selected physical junction', exact: true });
  await expect(dock.getByLabel('Inspect physical junction')).toHaveValue('browser-switch');
  await dock.getByRole('button', { name: 'Switch request', exact: true }).click(); await page.locator('#procgenStep').click();
  await expect(dock.locator('[data-configuration="direct"][data-applied=true]')).toHaveCount(1);
  return dock;
};
const pausedTick = page => page.evaluate(() => window.__PROCGEN_LANES__.world.tickIndex);

test('world levers distinguish pending, applied and observed routes without changing paused physics', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); const dock = await setup(page);
  const before = await page.evaluate(async () => {
    const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
    const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
    return hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world));
  });
  await page.getByRole('button', { name: 'Inspect junction browser-switch', exact: true }).click();
  await dock.getByLabel('Dock junction destination').selectOption('stepped');
  await expect(page.getByLabel('World junction destination')).toHaveValue('stepped');
  const after = await page.evaluate(async () => {
    const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js');
    const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
    for (let frame = 0; frame < 20; frame++) window.__PROCGEN_LANES__.renderer.render(true);
    return hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world));
  }); expect(after).toBe(before);
  await page.evaluate(() => { const world = window.__PROCGEN_LANES__.world, actor = world.actors.find(value => value.laneIndex === window.junctionFixture.lane); actor.x = 60; actor.y = window.junctionFixture.floorY - 1; });
  await dock.getByRole('button', { name: 'Switch request', exact: true }).click();
  await expect(dock.locator('[data-configuration="stepped"][data-requested=true]')).toHaveCount(1);
  await page.locator('#procgenStep').click(); await expect(dock).toContainText('waiting');
  await expect(dock.locator('[data-configuration="direct"][data-applied=true]')).toHaveCount(1);
  const tick = await pausedTick(page); await page.setViewportSize({ width: 2560, height: 1440 }); expect(await pausedTick(page)).toBe(tick);
  await dock.getByLabel('Dock junction destination').selectOption('direct'); await dock.getByRole('button', { name: 'Switch request', exact: true }).click();
  await expect(dock).toContainText('superseded'); await expect(dock).toContainText('eligible ticks remain');
  await dock.getByRole('button', { name: 'Cancel pending', exact: true }).click(); await expect(dock.getByRole('button', { name: 'Cancel pending', exact: true })).toBeDisabled();
  await expect(dock.locator('[data-configuration="direct"][data-applied=true]')).toHaveCount(1); await expect(dock).toContainText('0 observed inlet-to-outlet');
  await page.evaluate(() => {
    const { world } = window.__PROCGEN_LANES__, { floorY: floor, lane } = window.junctionFixture;
    const actor = world.actors.find(value => String(value.action?.actionName).toLowerCase().includes('walk') && value.laneIndex === lane);
    if (!actor) throw new Error('The controlled starter needs its real walking actor.');
    for (const value of world.actors) if (value.laneIndex === lane) { value.x = 36; value.y = floor - 1; }
    actor.x = 56; actor.y = floor - 1; actor.lookRight = true; window.junctionFixture.actorId = actor.id;
    for (let tick = 0; tick < 90; tick++) world.step(); window.__PROCGEN_LANES__.renderer.render(true);
  });
  await expect(dock).toContainText(/\b[1-9]\d* observed inlet-to-outlet/); await expect(page.locator('.studio-junction-layer svg')).toBeVisible();
  const stroke = await page.evaluate(() => {
    const element = document.querySelector('.junction-observed');
    if (!element?.isConnected) throw new Error('The current observed junction path is not attached.');
    const length = element.getTotalLength(), style = window.getComputedStyle(element);
    return { length, width: parseFloat(style.strokeWidth), color: style.stroke, hit: element.isPointInStroke(element.getPointAtLength(length / 2)), connected: element.isConnected };
  });
  expect(stroke.connected).toBe(true);
  expect(stroke.length).toBeGreaterThan(0); expect(stroke.width).toBeGreaterThan(0); expect(stroke.color).not.toBe('none'); expect(stroke.hit).toBe(true);
  await dock.locator('ol details summary').first().click();
  await expect(dock.getByRole('list', { name: 'Observed junction crossings' })).toContainText('Committed movement');
  await page.screenshot({ path: test.info().outputPath('switchyard-wide.png') });
  await dock.getByRole('button', { name: 'Inspect actor', exact: true }).first().click(); await expect(dock).toBeHidden(); await expect(page.locator('.studio-junction-layer')).toBeHidden();
  const inspected = await page.evaluate(() => ({ selection: window.__PROCGEN_STUDIO__.getWorldInspector().getState().selection, actorId: window.junctionFixture.actorId }));
  expect(inspected.selection).toMatchObject({ actorId: inspected.actorId, kind: 'actor' });
});

test('desktop switchyard cancels mouse and definition gestures', async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize(MIN_DESKTOP_VIEWPORT); const dock = await setup(page, 2);
  await dock.getByLabel('Dock junction destination').selectOption('stepped');
  await expect(page.getByRole('region', { name: 'World junction lever' })).toBeVisible();
  const bounds = await dock.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(MIN_DESKTOP_VIEWPORT.width);
  const before = await page.evaluate(() => window.__PROCGEN_LANES__.world.interventionState.sequence);
  const anchor = page.getByRole('button', { name: 'Inspect junction browser-switch', exact: true });
  await anchor.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'mouse', isPrimary: true }); await anchor.dispatchEvent('pointercancel', { pointerId: 9, pointerType: 'mouse', isPrimary: true });
  expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.interventionState.sequence)).toBe(before);
  await dock.getByRole('button', { name: 'Edit definitions…', exact: true }).click(); const editor = page.getByRole('dialog', { name: 'Physical junction definitions', exact: true });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(await page.evaluate(() => window.__PROCGEN_LANES__.world.interventionState.sequence)).toBe(before);
  await page.screenshot({ path: test.info().outputPath('switchyard-desktop-controls.png') });
  await dock.getByLabel('Dock junction destination').focus(); await page.keyboard.press('Escape'); await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Close switchyard', exact: true }).focus(); await page.keyboard.press('Escape'); await expect(dock).toBeHidden();
  expect(await page.evaluate(() => !!window.__PROCGEN_LANES__.renderer.junctionInspectionOwner)).toBe(false);
});
