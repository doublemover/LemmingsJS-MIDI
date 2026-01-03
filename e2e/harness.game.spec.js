import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { decodeE2EBuffer } from './helpers/e2eState.js';

const waitForHarnessReady = async (page) => {
  await page.waitForFunction(() => {
    const api = window.__E2E__;
    if (!api?.getState) return false;
    return api.getState().ready === true;
  });
};

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
  });
  await page.goto('/?e2e=1');
  await waitForHarnessReady(page);
});

test('Harness exposes state and can step/seek', async ({ page }) => {
  await page.evaluate(() => window.__E2E__.pause());
  const tickBefore = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  await page.evaluate(() => window.__E2E__.step(2));
  const tickAfter = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  expect(tickAfter).toBe(tickBefore + 2);

  await page.evaluate((target) => window.__E2E__.seek(target), tickBefore);
  const tickSeek = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  expect(tickSeek).toBe(tickBefore);

  const state = await page.evaluate(() => window.__E2E__.getState());
  expect(state.version).toBe(1);
  expect(state.mode).toBe('game');
  expect(state.view).toBeTruthy();
  expect(state.game).toBeTruthy();
  expect(state.view.includeSavedLevels).toBe(true);
  expect(state.stage.viewRect).toBeTruthy();
  expect(state.stage.viewRect.w).toBeGreaterThan(0);
  expect(state.stage.viewRect.h).toBeGreaterThan(0);
  expect(state.game.timer.running).toBe(false);
  expect(state.game.lemmings.length).toBe(state.game.lemmingManager.totalCount);
  expect(state.game.triggers.entries.length).toBe(state.game.triggers.totalCount);
  expect(state.game.objects.entries.length).toBe(state.game.objects.count);
  expect(state.midi.enabled).toBe(state.view.midiEnabled);
});

test('Harness returns buffers with decodable metadata', async ({ page }) => {
  const groundMask = await page.evaluate(() => window.__E2E__.getBuffer('ground-mask'));
  expect(groundMask).toBeTruthy();
  const decodedMask = decodeE2EBuffer(groundMask);
  expect(decodedMask.format).toBe('mask8');
  expect(decodedMask.width).toBeGreaterThan(0);
  expect(decodedMask.height).toBeGreaterThan(0);
  expect(decodedMask.array.length).toBe(decodedMask.width * decodedMask.height);

  const minimapTerrain = await page.evaluate(() => window.__E2E__.getBuffer('minimap-terrain'));
  expect(minimapTerrain).toBeTruthy();
  const decodedMinimap = decodeE2EBuffer(minimapTerrain);
  expect(decodedMinimap.format).toBe('u8');
  expect(decodedMinimap.array.length).toBe(decodedMinimap.width * decodedMinimap.height);

  const unknownBuffer = await page.evaluate(() => window.__E2E__.getBuffer('missing-buffer'));
  expect(unknownBuffer).toBeNull();
});
