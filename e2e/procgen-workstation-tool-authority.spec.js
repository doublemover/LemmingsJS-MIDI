import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';
import { inspectLane } from './helpers/workstationDock.js';
import { withNativeDesktopZoom } from './helpers/nativeDesktopZoom.js';

test.setTimeout(180000);
test.beforeAll(async () => { await buildBrowserRuntime({ rootDir: fileURLToPath(new URL('../', import.meta.url)) }); });
const ready = async (page, url) => {
  await installWebMidiStub(page, { trackOutput: true }); await page.goto(url);
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
  await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
};
const boundary = page => page.evaluate(async () => {
  const root = new URL('./', location.href), { captureProcgenCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root));
  const { hashProcgenPhysicsCheckpoint } = await import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root));
  const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
  return { physics: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)), project: JSON.stringify(studio.getProject()), document: studio.getDocumentState(),
    tick: world.tickIndex, sequence: world.soundEvents._causalSequence, midi: window.__WEBMIDI_STUB__.metrics() };
});
const matrix = async page => {
  const receipts = [];
  for (const layout of ['strip', 'overlay']) {
    await useWorkstationControl(page, page.getByLabel('Sequencer layout', { exact: true }), {}, 'selectOption', layout); await page.keyboard.press('Escape');
    for (const lower of [false, true]) {
      const search = page.getByLabel('Lane search', { exact: true });
      await useWorkstationControl(page, search, {}, 'fill', lower ? 'Lane 64' : '');
      if (lower) {
        await expect(page.getByRole('group', { name: 'Matching lanes' }).getByRole('button')).toHaveCount(1);
        await page.getByRole('button', { name: '64 · Lane 64', exact: true }).click(); await page.keyboard.press('Escape');
        await expect(page.locator('.studio-lane-header.selected')).toHaveAttribute('data-lane-id', 'lane-64');
        await useWorkstationControl(page, search, {}, 'fill', ''); await page.keyboard.press('Escape');
        const jump = page.getByRole('button', { name: 'Jump to offscreen lane' }); if (await jump.isVisible()) await jump.click();
        await expect(page.getByLabel('Visible lane range')).toHaveText('57–64 of 64');
      } else {
        await page.keyboard.press('Escape');
        const previous = page.getByTitle('Show previous lanes'); for (let count = 0; count < 8 && await previous.isEnabled(); count++) await previous.click();
        await expect(page.getByLabel('Visible lane range')).toHaveText('1–8 of 64');
      }
      const dock = await inspectLane(page, 'Automation'), before = await boundary(page);
      await expect(page.locator('#procgenSpanEdit')).toBeDisabled(); await expect(page.locator('#procgenSpanVisible')).toBeDisabled();
      const status = page.locator('#procgenSpanToolStatus'); await expect(status).toContainText('unavailable in workstation layout');
      const retired = await page.evaluate(() => {
        const renderer = window.__PROCGEN_LANES__.renderer, edit = document.getElementById('procgenSpanEdit');
        edit.checked = true; edit.dispatchEvent(new Event('change', { bubbles: true }));
        return { overlayAttached: !!renderer.midiSpanOverlay, editing: edit.checked, disabled: edit.disabled,
          layout: renderer.workstationLayout && { firstLane: renderer.workstationLayout.firstLane, count: renderer.workstationLayout.count, laneIndices: renderer.workstationLayout.laneIndices } };
      });
      expect(retired.overlayAttached).toBe(false); expect(retired.editing).toBe(false); expect(retired.disabled).toBe(true);
      await page.keyboard.press('Escape'); await expect(dock).toBeHidden();
      const canvas = await page.locator('#gameCanvas').boundingBox(); expect(canvas).toBeTruthy();
      await page.mouse.move(canvas.x + canvas.width * 0.45, canvas.y + canvas.height * 0.4); await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.45, { steps: 4 }); await page.mouse.up();
      expect(await boundary(page)).toEqual(before);
      const nextDock = await inspectLane(page, 'Automation'); await expect(page.locator('#procgenSpanEdit')).not.toBeChecked();
      await page.keyboard.press('Escape'); await expect(nextDock).toBeHidden(); receipts.push({ layout, lower, retired, before });
    }
  }
  return receipts;
};

for (const deviceScaleFactor of [1, 2]) test.describe('desktop canvas authority at DPR' + deviceScaleFactor, () => {
  test.use({ deviceScaleFactor });
  test('retired span tools have no renderer hook or invisible commits across layouts, lower rows and dock changes', { tag: ['@boundary', '@workstation-typed-controls'] }, async ({ page }, testInfo) => {
    await ready(page, '/dist/browser/procgen.html?e2e=1&recipe=1&seed=42&lanes=64&output=midi');
    expect(await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toMatchObject({ width: 1920, height: 1080 });
    const receipts = await matrix(page); await testInfo.attach('canvas-authority-matrix', { body: JSON.stringify({ deviceScaleFactor, receipts }), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('canvas-authority-desktop-dpr' + deviceScaleFactor + '.png') });
  });
});

test('actual200% browser zoom preserves desktop tool refusal and input ownership', { tag: ['@boundary', '@workstation-typed-controls'] }, async ({ baseURL }, testInfo) => {
  await withNativeDesktopZoom(baseURL, async ({ page, setZoom, read, screenshot, browserVersion }) => {
    await ready(page, baseURL + '/dist/browser/procgen.html?e2e=1&recipe=1&seed=42&lanes=64&output=midi');
    const native = await setZoom(2); expect(native.width).toBeGreaterThanOrEqual(1920); expect(native.height).toBeGreaterThanOrEqual(1080);
    const receipts = await matrix(page), capture = await screenshot(testInfo.outputPath('canvas-authority-native-200.png'));
    await setZoom(1); await testInfo.attach('native-canvas-authority', { body: JSON.stringify({ browserVersion, native, final: await read(), receipts, capture }), contentType: 'application/json' });
  });
});
