import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

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

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
    window.prompt = () => 'E2E Save';
    window.alert = () => {};
  });
  await page.goto('/editor.html?e2e=1');
  await waitForEditorHarness(page);
});

test('Editor harness exposes state and history', async ({ page }) => {
  const state = await page.evaluate(() => window.__E2E__.getState());
  expect(state.mode).toBe('editor');
  expect(state.editor).toBeTruthy();
  expect(state.editor.session).toBeTruthy();
  expect(state.editor.controller).toBeTruthy();
  expect(state.editor.history).toBeTruthy();
  expect(state.editor.controller.tool).toBe('select');
  expect(state.editor.history.count).toBeGreaterThan(0);
  expect(Array.isArray(state.editor.validation.issues)).toBe(true);
  expect(Array.isArray(state.editor.savedLevels)).toBe(true);

  const title = state.editor.session.level.header.TITLE;
  expect(String(title || '')).not.toBe('');
  expect(Array.isArray(state.editor.session.level.headerOrder)).toBe(true);
  expect(state.editor.assets.terrain.length).toBeGreaterThan(0);

  const entry = await page.evaluate(() => window.__E2E__.getEditorHistoryEntry(0));
  expect(entry.text.length).toBeGreaterThan(0);

  const missingEntry = await page.evaluate(() => window.__E2E__.getEditorHistoryEntry(9999));
  expect(missingEntry).toBeNull();
});

test('Editor harness toggles playtest', async ({ page }) => {
  await page.evaluate(() => window.__E2E__.setEditorPlaytest(true));
  const playtest = await page.evaluate(() => window.__E2E__.getState().editor.playtest);
  expect(playtest).toBe(true);

  await page.evaluate(() => window.__E2E__.setEditorPlaytest(false));
  const stopped = await page.evaluate(() => window.__E2E__.getState().editor.playtest);
  expect(stopped).toBe(false);
});
