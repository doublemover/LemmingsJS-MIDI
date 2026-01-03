import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { clearLocalStorage, seedSavedLevels, waitForHarnessReady } from './helpers/harness.js';

test.describe('harness navigation', () => {
  test.beforeEach(async ({ page }) => {
    await installExternalAssetStubs(page);
    await clearLocalStorage(page);
    await page.goto('/?e2e=1');
    await waitForHarnessReady(page);
  });

  test('Selecting level group and level updates state', async ({ page }) => {
    const groupSelect = page.locator('#levelGroupSelect');
    await page.waitForFunction(() => {
      const select = document.getElementById('levelGroupSelect');
      return select && select.options.length > 1;
    });

    await groupSelect.selectOption({ index: 1 });
    await page.waitForFunction(() => {
      return window.__E2E__.getState().view.levelGroupIndex === 1;
    });

    const levelSelect = page.locator('#levelIndexSelect');
    await page.waitForFunction(() => {
      const select = document.getElementById('levelIndexSelect');
      return select && select.options.length > 1;
    });

    await levelSelect.selectOption({ index: 1 });
    await page.waitForFunction(() => {
      return window.__E2E__.getState().view.levelIndex === 1;
    });

    const state = await page.evaluate(() => window.__E2E__.getState());
    expect(state.game.level).toBeTruthy();
  });
});

test.describe('saved level ordering', () => {
  const savedEntries = [
    { id: 'alpha-1', name: 'Alpha', updatedAt: 1000, text: '' },
    { id: 'alpha-2', name: 'Alpha', updatedAt: 2000, text: '' },
    { id: 'beta-1', name: 'Beta', updatedAt: 1500, text: '' },
    { id: 'gamma-1', name: 'Gamma', updatedAt: 500, text: '' }
  ];

  test.beforeEach(async ({ page }) => {
    await installExternalAssetStubs(page);
    await seedSavedLevels(page, savedEntries);
    await page.goto('/?e2e=1');
    await waitForHarnessReady(page);
  });

  test('Saved group appears last and list is name/time sorted', async ({ page }) => {
    const groups = await page.$$eval('#levelGroupSelect option', (options) => {
      return options.map(option => option.textContent || '');
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[groups.length - 1]).toContain('Saved Levels');

    const entries = await page.evaluate(() => window.__E2E__.getState().editor.savedLevels);
    const labels = entries.map((entry) => `${entry.name}:${entry.updatedAt}`);
    expect(labels).toEqual([
      'Alpha:2000',
      'Alpha:1000',
      'Beta:1500',
      'Gamma:500'
    ]);
  });
});
