import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { seedSavedLevels } from './helpers/harness.js';

const waitForEditorHarness = async (page) => {
  await page.waitForFunction(() => {
    const api = window.__E2E__;
    if (!api?.getState) return false;
    const state = api.getState();
    return Boolean(
      state.editor?.session?.level?.header
      && state.editor?.assets?.terrain?.length
    );
  });
};

const bootEditor = async (page, options = {}) => {
  await installExternalAssetStubs(page);
  if (options.savedEntries) {
    await seedSavedLevels(page, options.savedEntries);
  } else {
    await page.addInitScript(() => {
      try {
        const key = '__e2eStorageCleared';
        if (!window.sessionStorage?.getItem?.(key)) {
          window.localStorage?.clear?.();
          window.sessionStorage?.setItem?.(key, 'true');
        }
      } catch (error) {}
    });
  }
  await page.addInitScript((promptValue) => {
    window.prompt = () => promptValue;
    window.alert = () => {};
  }, options.promptValue || 'E2E Save');
  await page.goto('/editor.html?e2e=1');
  await waitForEditorHarness(page);
};

test('Saved levels dropdown orders entries by name then updatedAt', async ({ page }) => {
  await bootEditor(page, {
    savedEntries: [
      { id: 'c', name: 'Zed', updatedAt: 10, text: 'zed' },
      { id: 'a', name: 'alpha', updatedAt: 5, text: 'alpha-5' },
      { id: 'b', name: 'alpha', updatedAt: 1, text: 'alpha-1' }
    ]
  });

  const options = await page.locator('#editorSavedSelect option').allTextContents();
  expect(options[0]).toBe('Saved levels');
  expect(options.slice(1)).toEqual(['alpha', 'alpha', 'Zed']);
});

test('Saved levels persist across reloads', async ({ page }) => {
  await bootEditor(page, { promptValue: 'E2E Persist' });

  await page.click('#editorSavedSave');
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Persist');

  await page.reload();
  await waitForEditorHarness(page);
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Persist');
});
