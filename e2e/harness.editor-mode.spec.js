import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { clearLocalStorage, waitForHarnessReady } from './helpers/harness.js';

const focusGameCanvas = async (page) => {
  const canvas = page.locator('#gameCanvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error('gameCanvas is not visible');
  }
  await page.evaluate(() => {
    const canvasElement = document.getElementById('gameCanvas');
    if (!canvasElement) return;
    canvasElement.setAttribute('tabindex', '-1');
    canvasElement.focus();
  });
};

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await clearLocalStorage(page);
  await page.goto('/?e2e=1');
  await waitForHarnessReady(page);
  await focusGameCanvas(page);
});

test('Editor mode toggle suppresses input and pauses timer', async ({ page }) => {
  await page.waitForFunction(() => window.__E2E__.getState().game.timer.running === true);
  const stateBefore = await page.evaluate(() => window.__E2E__.getState());
  expect(stateBefore.view.editorMode).toBe(false);
  expect(stateBefore.stage.panEnabled).toBe(true);
  expect(stateBefore.game.inputEnabled).toBe(true);

  await page.keyboard.press('Shift+Backquote');
  await page.waitForFunction(() => window.__E2E__.getState().view.editorMode === true);
  await page.waitForFunction(() => window.__E2E__.getState().game.timer.running === false);
  const stateEdit = await page.evaluate(() => window.__E2E__.getState());
  expect(stateEdit.stage.panEnabled).toBe(false);
  expect(stateEdit.game.inputEnabled).toBe(false);

  await page.keyboard.press('Shift+Backquote');
  await page.waitForFunction(() => window.__E2E__.getState().view.editorMode === false);
  await page.waitForFunction(() => window.__E2E__.getState().game.timer.running === true);
  const stateAfter = await page.evaluate(() => window.__E2E__.getState());
  expect(stateAfter.stage.panEnabled).toBe(true);
  expect(stateAfter.game.inputEnabled).toBe(true);
});
