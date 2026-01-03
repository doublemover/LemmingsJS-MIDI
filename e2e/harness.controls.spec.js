import { test } from '@playwright/test';
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

test('Pan and zoom controls update the viewport', async ({ page }) => {
  const startRect = await page.evaluate(() => window.__E2E__.getState().stage.viewRect);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((x) => {
    const rect = window.__E2E__.getState().stage.viewRect;
    return rect && rect.x > x + 1;
  }, startRect.x);
  await page.keyboard.up('ArrowRight');

  const scaleBefore = await page.evaluate(() => window.__E2E__.getState().stage.gameScale);
  await page.keyboard.down('KeyZ');
  await page.waitForFunction((scale) => {
    const next = window.__E2E__.getState().stage.gameScale;
    return next && next > scale;
  }, scaleBefore);
  await page.keyboard.up('KeyZ');
  const scaleAfterZoomIn = await page.evaluate(() => window.__E2E__.getState().stage.gameScale);

  await page.keyboard.down('KeyX');
  await page.waitForFunction((scale) => {
    const next = window.__E2E__.getState().stage.gameScale;
    return next && next < scale;
  }, scaleAfterZoomIn);
  await page.keyboard.up('KeyX');

  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => {
    const scale = window.__E2E__.getState().stage.gameScale;
    return scale && Math.abs(scale - 2) < 0.05;
  });
});

test('Pause, step, and speed controls update timer state', async ({ page }) => {
  await page.waitForFunction(() => window.__E2E__.getState().game.timer.running === true);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__E2E__.getState().game.timer.running === false);

  const tickBefore = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  await page.keyboard.press('BracketRight');
  await page.waitForFunction((tick) => {
    return window.__E2E__.getState().game.timer.tickIndex === tick + 1;
  }, tickBefore);

  await page.keyboard.press('BracketLeft');
  await page.waitForFunction((tick) => {
    return window.__E2E__.getState().game.timer.tickIndex === tick;
  }, tickBefore);

  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__E2E__.getState().game.timer.running === true);

  const speedBefore = await page.evaluate(() => window.__E2E__.getState().game.timer.speedFactor);
  await page.keyboard.press('Equal');
  await page.waitForFunction((speed) => {
    return window.__E2E__.getState().game.timer.speedFactor > speed;
  }, speedBefore);
  const speedAfterUp = await page.evaluate(() => window.__E2E__.getState().game.timer.speedFactor);

  await page.keyboard.press('Minus');
  await page.waitForFunction((speed) => {
    return window.__E2E__.getState().game.timer.speedFactor < speed;
  }, speedAfterUp);
});

test('Release rate and skill shortcuts update game state', async ({ page }) => {
  const state = await page.evaluate(() => window.__E2E__.getState());
  const releaseRate = state.game.victory.releaseRate;
  const minReleaseRate = state.game.victory.minReleaseRate;

  if (releaseRate > minReleaseRate) {
    await page.keyboard.press('Digit1');
    await page.waitForFunction((value) => {
      return window.__E2E__.getState().game.victory.releaseRate === value - 1;
    }, releaseRate);
  } else {
    await page.keyboard.press('Digit2');
    await page.waitForFunction((value) => {
      return window.__E2E__.getState().game.victory.releaseRate === value + 1;
    }, releaseRate);
  }

  await page.keyboard.press('Digit3');
  await page.waitForFunction(() => {
    return window.__E2E__.getState().game.skills.selectedSkill === 1;
  });

  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => {
    return window.__E2E__.getState().game.skills.selectedSkill === 5;
  });
});
