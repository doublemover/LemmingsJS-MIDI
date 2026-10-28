import { MIN_DESKTOP_VIEWPORT } from './helpers/desktopViewports.js';
import { expect, test } from '@playwright/test';

test('production workstation reaccepts the same world and canvas after fullscreen geometry changes', { tag: ['@boundary'] }, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize(MIN_DESKTOP_VIEWPORT);
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=3');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => {
    window.__PROCGEN_STUDIO__.transport.pause();
    window.fullscreenWorld = window.__PROCGEN_LANES__.world;
    window.fullscreenCanvas = document.getElementById('gameCanvas');
    const renderer = window.__PROCGEN_LANES__.renderer;
    window.fullscreenPresentationRelease = renderer.presentation.subscribe(() => {});
    renderer.render(false);
  });
  await page.waitForFunction(() => window.__PROCGEN_LANES__.renderer.presentation.getSnapshot());
  const geometry = () => page.evaluate(() => {
    const renderer = window.__PROCGEN_LANES__.renderer;
    const snapshot = renderer.presentation.getSnapshot();
    const rect = document.getElementById('gameCanvas').getBoundingClientRect();
    return { fullscreen: document.fullscreenElement?.id || null, snapshot: !!snapshot,
      width: snapshot?.rect.width, height: snapshot?.rect.height,
      domWidth: rect.width, domHeight: rect.height,
      sameWorld: window.fullscreenWorld === window.__PROCGEN_LANES__.world,
      sameCanvas: window.fullscreenCanvas === document.getElementById('gameCanvas'),
      stagePreparing: document.getElementById('procgenStudioStage').dataset.presentation === 'preparing' };
  });
  await page.locator('.studio-transport-overflow summary').click();
  await page.getByRole('button', { name: 'Expand fullscreen' }).click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'procgenPresentationRoot');
  await expect.poll(geometry).toMatchObject({ fullscreen: 'procgenPresentationRoot', snapshot: true,
    sameWorld: true, sameCanvas: true, stagePreparing: false });
  const entered = await geometry();
  expect(entered.width).toBeCloseTo(entered.domWidth, 0);
  expect(entered.height).toBeCloseTo(entered.domHeight, 0);

  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(geometry).toMatchObject({ fullscreen: null, snapshot: true,
    sameWorld: true, sameCanvas: true, stagePreparing: false });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect.poll(geometry).toMatchObject({ snapshot: true, sameWorld: true, sameCanvas: true, stagePreparing: false });
  const resized = await geometry();
  expect(resized.width).toBeCloseTo(resized.domWidth, 0);
  expect(resized.height).toBeCloseTo(resized.domHeight, 0);

  await page.getByRole('button', { name: 'Expand fullscreen' }).click();
  await expect.poll(geometry).toMatchObject({ fullscreen: 'procgenPresentationRoot', snapshot: true,
    sameWorld: true, sameCanvas: true, stagePreparing: false });
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(geometry).toMatchObject({ fullscreen: null, snapshot: true,
    sameWorld: true, sameCanvas: true, stagePreparing: false });
  await page.evaluate(() => window.fullscreenPresentationRelease());
});
