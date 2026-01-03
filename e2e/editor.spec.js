import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear?.();
    } catch (error) {}
    window.prompt = () => 'E2E Save';
    window.alert = () => {};
  });
  await page.goto('/editor.html');
  await expect(page.locator('#editorStatus')).toContainText('Tool:');
});

test('Editor UI loads and tool selection updates state', async ({ page }) => {
  await expect(page.locator('#editorCanvas')).toBeVisible();

  const selectTool = page.locator('#editorToolList button[data-tool="select"]');
  await expect(selectTool).toHaveAttribute('aria-pressed', 'true');

  const terrainTool = page.locator('#editorToolList button[data-tool="terrain"]');
  await terrainTool.click();
  await expect(terrainTool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editorStatus')).toContainText('Tool: terrain');
});

test('Palette tabs switch visible lists', async ({ page }) => {
  const gadgetsTab = page.locator('#editorPaletteTabs button[data-tab="gadgets"]');
  await gadgetsTab.click();
  await expect(page.locator('#editorPaletteGadgets')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#editorPaletteTerrain')).toHaveJSProperty('hidden', true);
});

test('Save and import keep saved list wired up', async ({ page }) => {
  await page.click('#editorSavedSave');
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Save');

  const text = await page.evaluate(() => {
    return window.lemmings?.getEditorLevelText?.() || '';
  });
  expect(text.length).toBeGreaterThan(0);

  await page.setInputFiles('#editorSavedImportInput', {
    name: 'e2e-import.nxlv',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8')
  });

  await page.waitForFunction(() => {
    const select = document.getElementById('editorSavedSelect');
    return select && select.value === '';
  });
});
