import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
  });
  await page.goto('/');
});

test('Game loads the first level on startup', async ({ page }) => {
  await page.waitForFunction(() => {
    return Boolean(window.lemmings?.game?.level);
  });
  const hasLevel = await page.evaluate(() => Boolean(window.lemmings?.game?.level));
  expect(hasLevel).toBe(true);
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
