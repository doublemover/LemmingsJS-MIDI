import { expect, test } from './helpers/workstationValidation.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';

const ready = async page => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto('/procgen.html?e2e=1&recipe=1&seed=42&lanes=64&output=midi');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const scope = page => page.evaluate(async () => {
  const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'), { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { tick: world.tickIndex, hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)), project: JSON.stringify(studio.getProject()), document: studio.getDocumentState(), routes: studio.ports.getState().outputRoutes, midi: window.__WEBMIDI_STUB__.metrics() };
});

test('search and offscreen return navigate the real ensemble without changing music, routes, output or physics', { tag: '@boundary' }, async ({ page }, testInfo) => {
  test.setTimeout(60000); await ready(page); const before = await scope(page), search = page.getByLabel('Lane search', { exact: true });
  await useWorkstationControl(page, search, {}, 'fill', 'Lane 64'); await expect(page.getByRole('group', { name: 'Matching lanes' }).getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: '64 · Lane 64', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(page.locator('.studio-lane-header')).toHaveCount(8); await expect(page.locator('.studio-lane-header.selected')).toHaveAttribute('data-lane-id', 'lane-64');
  await expect(page.getByLabel('Visible lane range')).toHaveText('57–64 of 64');
  await page.getByTitle('Show previous lanes').click(); await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toContainText('Selected offscreen');
  await page.getByRole('button', { name: 'Jump to offscreen lane' }).click(); await expect(page.getByLabel('Visible lane range')).toHaveText('57–64 of 64');
  await expect(page.locator('.studio-lane-header.selected .studio-lane-title')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Jump to offscreen lane' })).toBeHidden();
  expect(await scope(page)).toEqual(before); await page.screenshot({ path: testInfo.outputPath('large-ensemble-stable-jump.png') });
  await testInfo.attach('navigation-invariance', { body: JSON.stringify({ before, after: await scope(page), mountedHeaders: await page.locator('.studio-lane-header').count(), mountedDisplays: await page.locator('.studio-lane-header .studio-lane-display').count() }), contentType: 'application/json' });
});

test('native wheel accumulation and search focus survive unrelated canonical edits with bounded matches', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(60000); await ready(page); const search = page.getByLabel('Lane search', { exact: true });
  await useWorkstationControl(page, search, {}, 'fill', 'Lane'); await search.evaluate(element => { window.__navigatorSearch = element; element.setSelectionRange(2, 2); });
  await page.evaluate(() => window.__PROCGEN_STUDIO__.dispatch({ type: 'procgen/lane', laneId: 'lane-40', patch: { name: 'A renamed distant lane' } }));
  expect(await search.evaluate(element => ({ same: element === window.__navigatorSearch, active: element === document.activeElement, start: element.selectionStart, value: element.value }))).toEqual({ same: true, active: true, start: 2, value: 'Lane' });
  await expect(page.getByRole('group', { name: 'Matching lanes' }).getByRole('button')).toHaveCount(16);
  await page.keyboard.press('Escape'); const range = page.getByLabel('Visible lane range'), before = await range.textContent();
  for (let i = 0; i < 5; i++) await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 1 });
  await expect(range).toHaveText(before); await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 50 }); await expect(range).toHaveText('2–9 of 64');
  await page.locator('.studio-lane-headers').dispatchEvent('wheel', { deltaY: 100, ctrlKey: true }); await expect(range).toHaveText('2–9 of 64');
});
