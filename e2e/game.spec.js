import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
  });
  await page.goto('/?e2e=1');
});

test('Game loads the first level on startup', async ({ page }) => {
  await page.waitForFunction(() => {
    return window.__E2E__?.getState?.()?.ready === true;
  });
  const ready = await page.evaluate(() => window.__E2E__?.getState?.()?.ready === true);
  expect(ready).toBe(true);
});

test('Arrow navigation updates the selected level', async ({ page }) => {
  const levelSelect = page.locator('#levelIndexSelect');
  await page.waitForFunction(() => {
    const select = document.getElementById('levelIndexSelect');
    return select && select.options.length > 1;
  });
  const initialValue = await levelSelect.inputValue();
  await page.locator('.arrow_r').click();
  await page.waitForFunction((prev) => {
    const select = document.getElementById('levelIndexSelect');
    return select && select.value !== prev;
  }, initialValue);
  const nextValue = await levelSelect.inputValue();
  expect(nextValue).not.toBe(initialValue);

  await page.locator('.arrow_l').click();
  await page.waitForFunction((prev) => {
    const select = document.getElementById('levelIndexSelect');
    return select && select.value === prev;
  }, initialValue);
});

test('Space toggles pause state', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => window.__E2E__?.getState?.().ready);
  const isRunning = () => window.__E2E__?.getState?.().game?.timer?.running;
  await page.waitForFunction(isRunning);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__E2E__?.getState?.().game?.timer?.running === false);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__E2E__?.getState?.().game?.timer?.running === true);
});
