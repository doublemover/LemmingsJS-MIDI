import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { clearLocalStorage, waitForHarnessReady } from './helpers/harness.js';

const focusGameCanvas = async (page) => {
  const canvas = page.locator('#gameCanvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error('gameCanvas is not visible');
  }
  const panelBox = await page.locator('#controlLeft').boundingBox();
  let clickX = canvasBox.x + canvasBox.width * 0.5;
  const clickY = canvasBox.y + canvasBox.height * 0.5;
  if (panelBox) {
    const safeX = panelBox.x + panelBox.width + 20;
    if (safeX < canvasBox.x + canvasBox.width - 5) {
      clickX = Math.max(clickX, safeX);
    } else {
      clickX = canvasBox.x + canvasBox.width - 5;
    }
  }
  await page.mouse.click(clickX, clickY);
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
