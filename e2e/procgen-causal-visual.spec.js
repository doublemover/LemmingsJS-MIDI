import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';

const ready = async page => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=2&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
  await page.locator('#procgenListen').click(); await page.locator('#procgenMidiDevice').selectOption('pw-output-1'); await page.locator('#procgenListen').click();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.ports.configure({ recording: true }); window.__PROCGEN_LANES__.resume(); window.__PROCGEN_STUDIO__.play(); });
};
const freeze = async (page, dense = false) => {
  await expect.poll(() => page.locator('.studio-causal-mark').evaluateAll((nodes, dense) => nodes.some(node => !node.closest('[hidden]') && (!dense || Number(node.dataset.count) > 1)), dense), { timeout: 20000 }).toBe(true);
  await page.evaluate(() => { window.__PROCGEN_LANES__.pause(); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.renderer.render(true); });
  await page.locator('#procgenPanic').click(); await expect(page.locator('.studio-causal-mark').first()).toBeVisible();
};
const ownerState = page => page.evaluate(async () => {
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'); const { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { project: JSON.stringify(window.__PROCGEN_STUDIO__.getProject()), hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(window.__PROCGEN_LANES__.world)), midi: window.__WEBMIDI_STUB__.metrics().sent };
});

test('actual physical causes project through the accepted world frame and open exact read-only evidence', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page);
  const capture = await page.waitForFunction(async () => {
    const { projectCausalHistory } = await import('/js/app/procgen/workstation/CausalVisualProjection.js'), studio = window.__PROCGEN_STUDIO__, renderer = window.__PROCGEN_LANES__.renderer;
    const snapshot = renderer.presentation.getSnapshot(), values = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id)), model = projectCausalHistory({ displays: values, presentation: snapshot });
    const button = document.querySelector('.studio-causal-mark'); if (!snapshot || !button || button.closest('[hidden]') || button.dataset.projectionRevision !== String(snapshot.projectionRevision)) return false;
    const mark = model.marks.find(value => value.causes[0].eventId === button.dataset.eventId); if (!mark) return false; const rect = button.getBoundingClientRect();
    return { accepted: renderer.presentation.valid(snapshot), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, expectedX: mark.x, expectedY: mark.y, eventId: button.dataset.eventId, sourceIds: mark.causes.map(value => value.eventId), geometrySubscribers: renderer.presentation.geometryListeners.size, entitySubscribers: renderer.presentation.listeners.size, width: rect.width, height: rect.height, font: window.getComputedStyle(button).fontSize };
  });
  const geometry = await capture.jsonValue(); await capture.dispose();
  expect(geometry).toMatchObject({ accepted: true, geometrySubscribers: 1, entitySubscribers: 1, width: 44, height: 44, font: '14px' }); expect(geometry.x).toBeCloseTo(geometry.expectedX, 0); expect(geometry.y).toBeCloseTo(geometry.expectedY, 0); expect(geometry.sourceIds).toContain(geometry.eventId);
  const before = await ownerState(page); const mark = page.locator('.studio-causal-mark').first(); await mark.focus(); await mark.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Physical cause explanation' }); await expect(dialog).toBeVisible(); await expect(dialog).toContainText(geometry.eventId); await expect(dialog).toContainText('Source binding:'); await expect(dialog).toContainText('frozen pitch'); await expect(dialog).toContainText('API submission is not acoustic evidence');
  await expect(dialog.getByRole('button', { name: 'Panic', exact: true })).toBeVisible(); await dialog.getByRole('button', { name: 'Refresh retained evidence' }).click();
  await dialog.getByRole('button', { name: 'Close cause explanation' }).click(); expect(await ownerState(page)).toEqual(before);
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1920, 1080]);
  await page.screenshot({ path: test.info().outputPath('desktop-causal-marks.png') });
});

test('same-seed replay retires old projected sources and stale detached marks cannot inspect the new run', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); await freeze(page);
  const before = await page.evaluate(() => {
    window.__oldCausalMark = document.querySelector('.studio-causal-mark'); window.__oldCausalWorld = window.__PROCGEN_LANES__.world;
    const studio = window.__PROCGEN_STUDIO__, values = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id));
    return { worldId: window.__oldCausalWorld.worldId, generation: window.__oldCausalWorld.generation, sources: values.flatMap(value => value.evidence.history.map(event => event.sourceKey)) };
  });
  await page.evaluate(async () => { await window.__PROCGEN_STUDIO__.handlers.replay(); window.__PROCGEN_LANES__.pause(); window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.renderer.render(true); });
  const after = await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world, values = studio.handlers.laneDisplayState(studio.getProject().procgen.lanes.map(lane => lane.id));
    window.__oldCausalMark.click(); return { replaced: world !== window.__oldCausalWorld, worldId: world.worldId, generation: world.generation, sources: values.flatMap(value => value.evidence.history.map(event => event.sourceKey)), dialogOpen: document.querySelector('.studio-causal-dialog').open };
  });
  expect(after.replaced).toBe(true); expect(after.worldId).toBe(before.worldId); expect(after.generation).toBe(before.generation); expect(after.sources.every(source => !before.sources.includes(source))).toBe(true); expect(after.dialogOpen).toBe(false);
});

test('reduced-motion dense causes retain counted identities and keyboard drilldown without animations', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page); await freeze(page, true);
  const bundled = page.locator('.studio-causal-mark:not([data-count="1"])').first(); await expect(bundled).toBeVisible();
  const count = Number(await bundled.getAttribute('data-count')); expect(count).toBeGreaterThan(1); await bundled.focus(); await bundled.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Physical cause explanation' }); await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('Retained physical cause').locator('option')).toHaveCount(count);
  const ids = await dialog.getByLabel('Retained physical cause').locator('option').evaluateAll(options => options.map(option => option.value)); expect(new Set(ids).size).toBe(count);
  await dialog.getByLabel('Retained physical cause').selectOption(ids.at(-1)); await expect(dialog).toContainText('Physical fact:'); await expect(dialog).toContainText('no individually correlated render receipt');
  expect(await page.locator('.studio-causal-mark').evaluateAll(nodes => nodes.every(node => window.getComputedStyle(node).animationName === 'none' && window.getComputedStyle(node).transitionDuration === '0s'))).toBe(true);
});
