import { expect, test } from './helpers/workstationValidation.js';
import { withNativeDesktopZoom } from './helpers/nativeDesktopZoom.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { useWorkstationControl } from './helpers/workstationChrome.js';
import { inspectLane } from './helpers/workstationDock.js';

const bounds = async locator => locator.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
const assertDesktopBounds = (items, viewport) => {
  for (const box of items) { expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0); expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.y).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1); }
};
const worldScope = page => page.evaluate(async () => {
  const studio = window.__PROCGEN_STUDIO__, world = window.__PROCGEN_LANES__.world;
  const { captureProcgenCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpoint.js'), { hashProcgenPhysicsCheckpoint } = await import('/js/app/procgen/workstation/ProcgenCheckpointProvenance.js');
  return { tick: world.tickIndex, hash: await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world)), project: JSON.stringify(studio.getProject()), document: studio.getDocumentState(),
    routes: studio.ports.getState().outputRoutes, playback: studio.getPlaybackState().enabled, midi: window.__WEBMIDI_STUB__.metrics() };
});

test('real browser 100%/200% zoom retains eight-lane desktop geometry, exact entry and dock ownership', { tag: '@boundary' }, async ({ baseURL }, testInfo) => {
  test.setTimeout(120000);
  await withNativeDesktopZoom(baseURL, async ({ page, setZoom, read, screenshot, browserVersion }) => {
    await installWebMidiStub(page, { trackOutput: true });
    await page.goto(baseURL + '/procgen.html?e2e=1&recipe=1&seed=42&lanes=8&output=midi');
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
    await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); });
    const before = await worldScope(page), observations = [];
    for (const zoom of [1, 2, 1]) {
      const native = await setZoom(zoom); await expect(page.locator('.studio-lane-header')).toHaveCount(8);
      const geometry = await bounds(page.locator('.studio-lane-header, #procgenPanic, #procgenListen')); assertDesktopBounds(geometry, native);
      await page.locator('.studio-lane-header').first().getByRole('button', { name: 'Edit Pan value' }).click();
      const entry = page.locator('.studio-lane-header').first().getByLabel('Pan numeric value'); await expect(entry).toBeFocused(); await entry.fill('-'); await entry.press('Enter'); await expect(entry).toHaveAttribute('aria-invalid', 'true');
      const popup = await bounds(page.locator('.parameter-entry-popover:visible')); expect(popup).toHaveLength(1); assertDesktopBounds(popup, native);
      const capture = await screenshot(testInfo.outputPath(`production-native-zoom-${zoom * 100}-${observations.length}.png`));
      await entry.press('Escape'); await entry.press('Escape'); await expect(entry).toBeHidden();
      await inspectLane(page, 'World'); await expect(page.getByRole('button', { name: 'Replay seed', exact: true })).toBeVisible();
      const dock = await bounds(page.locator('#procgenDeepDock')); assertDesktopBounds(dock, native);
      await page.keyboard.press('Escape'); await expect(page.locator('#procgenDeepDock')).toBeHidden();
      await useWorkstationControl(page, page.getByLabel('Instrument motion', { exact: true }), {}, 'selectOption', 'reduce'); await page.keyboard.press('Escape');
      expect(await worldScope(page)).toEqual(before); observations.push({ native, geometry, popup, dock, capture });
    }
    await testInfo.attach('native-browser-zoom-production', { body: JSON.stringify({ browserVersion, baseDpr: 1, observations, final: await read(), before }), contentType: 'application/json' });
  });
});

test('native 200% material specimen preserves states, contrast, hit targets and forced-color geometry', { tag: '@boundary' }, async ({ baseURL }, testInfo) => {
  test.setTimeout(90000);
  await withNativeDesktopZoom(baseURL, async ({ page, setZoom, screenshot, browserVersion }) => {
    await setZoom(2); await page.goto(baseURL + '/test/support/workstation-materials.html'); await page.waitForFunction(() => window.materialSpecimen);
    const native = await setZoom(2), articles = page.locator('article[data-material-state]'); await expect(articles).toHaveCount(9);
    const geometry = await bounds(articles); assertDesktopBounds(geometry, native);
    const contrast = await page.evaluate(() => {
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
      const texts = [...document.querySelectorAll('h1,h2,p,.parameter-knob-caption,.parameter-knob-value,.studio-lane-display,button')].filter(node => node.getClientRects().length).map(node => {
        const ink = luminance(window.getComputedStyle(node).color); let parent = node, background;
        while (parent) { const color = window.getComputedStyle(parent).backgroundColor, alpha = color.match(/[\d.]+/g).map(Number); if (alpha.length === 3 || alpha[3] === 1) { background = luminance(color); break; } parent = parent.parentElement; }
        if (background == null) throw new Error('Missing material background.'); return { text: node.textContent.trim().slice(0, 48), ratio: (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) };
      });
      const intercepted = [...document.querySelectorAll('.parameter-knob-cap')].filter(node => { const r = node.getBoundingClientRect(), target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return target !== node && !node.contains(target); }).length;
      return { texts, intercepted };
    });
    expect(contrast.intercepted).toBe(0); for (const row of contrast.texts) expect(row.ratio, row.text).toBeGreaterThanOrEqual(4.5);
    const normalCapture = await screenshot(testInfo.outputPath('materials-native-zoom-200.png'));
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' }); const forcedGeometry = await bounds(articles); expect(forcedGeometry).toEqual(geometry);
    const control = page.locator('article[data-material-state=idle] .studio-lane-pan'); await control.getByRole('button', { name: 'Edit Pan value' }).click(); await expect(control.getByLabel('Pan numeric value')).toBeFocused();
    assertDesktopBounds(await bounds(control.locator('.parameter-entry-popover')), native);
    const forcedCapture = await screenshot(testInfo.outputPath('materials-native-zoom-200-forced-colors.png'));
    await testInfo.attach('native-browser-zoom-materials', { body: JSON.stringify({ browserVersion, baseDpr: 1, native, geometry, forcedGeometry, contrast, normalCapture, forcedCapture, commits: await page.evaluate(() => window.materialSpecimen.commits) }), contentType: 'application/json' });
    expect(await page.evaluate(() => window.materialSpecimen.commits)).toEqual([]);
  });
});
