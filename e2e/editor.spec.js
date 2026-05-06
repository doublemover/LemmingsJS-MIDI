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
  await page.goto('/editor.html?e2e=1');
  await expect(page.locator('#editorStatus')).toContainText('Tool:');
  await page.waitForFunction(() => typeof window.__E2E__?.getEditorLevelText === 'function');
});

const setEditorField = async (page, selector, value) => {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};

const applyEditorOps = (page, ops, options = {}) => page.evaluate(
  ({ ops, options }) => window.__E2E__.editorApply(ops, options),
  { ops, options }
);

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
  const terrainTab = page.locator('#editorPaletteTabs button[data-tab="terrain"]');
  const gadgetsTab = page.locator('#editorPaletteTabs button[data-tab="gadgets"]');
  const triggersTab = page.locator('#editorPaletteTabs button[data-tab="triggers"]');
  await expect(terrainTab).toHaveAttribute('aria-pressed', 'true');
  await expect(gadgetsTab).toHaveAttribute('aria-pressed', 'false');

  await gadgetsTab.click();
  await expect(terrainTab).toHaveAttribute('aria-pressed', 'false');
  await expect(gadgetsTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editorPaletteGadgets')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#editorPaletteGadgets')).toBeVisible();
  await expect(page.locator('#editorPaletteTerrain')).toHaveJSProperty('hidden', true);
  await expect(page.locator('#editorPaletteTerrain')).toBeHidden();

  await triggersTab.click();
  await expect(gadgetsTab).toHaveAttribute('aria-pressed', 'false');
  await expect(triggersTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editorPaletteTriggers')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#editorPaletteTriggers')).toBeVisible();
  await expect(page.locator('#editorPaletteTerrain')).toHaveJSProperty('hidden', true);
  await expect(page.locator('#editorPaletteTerrain')).toBeHidden();
});

test('Palette view toggle switches list and grid layouts', async ({ page }) => {
  const listButton = page.locator('#editorPaletteViewList');
  const gridButton = page.locator('#editorPaletteViewGrid');
  const terrainList = page.locator('#editorPaletteTerrain');

  await expect(listButton).toHaveClass(/active/);
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
  await expect(terrainList).not.toHaveClass(/grid/);

  await gridButton.click();
  await expect(gridButton).toHaveClass(/active/);
  await expect(listButton).toHaveAttribute('aria-pressed', 'false');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await expect(terrainList).toHaveClass(/grid/);

  await listButton.click();
  await expect(listButton).toHaveClass(/active/);
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
  await expect(terrainList).not.toHaveClass(/grid/);
});

test('Palette recent strip records and reselects pieces', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button[data-type="terrain"]').first();
  const terrainId = Number(await terrainButton.getAttribute('data-id'));
  expect(Number.isFinite(terrainId)).toBe(true);

  await terrainButton.click();
  const recentTerrain = page.locator(`#editorPaletteRecent button[data-type="terrain"][data-id="${terrainId}"]`);
  await expect(recentTerrain).toBeVisible();
  await expect(recentTerrain).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#editorPaletteTabs button[data-tab="gadgets"]').click();
  const gadgetButton = page.locator('#editorPaletteGadgets button[data-type="gadget"]').first();
  const gadgetId = Number(await gadgetButton.getAttribute('data-id'));
  expect(Number.isFinite(gadgetId)).toBe(true);
  await gadgetButton.click();

  const recentButtons = page.locator('#editorPaletteRecent button');
  await expect(recentButtons.first()).toHaveAttribute('data-type', 'gadget');
  await expect(recentButtons.first()).toHaveAttribute('data-id', String(gadgetId));

  await recentTerrain.click();
  const selectedTerrainId = await page.evaluate(() => window.__E2E__.getState().editor.controller.selectedTerrainId);
  expect(selectedTerrainId).toBe(terrainId);
});

test('Save and import keep saved list wired up', async ({ page }) => {
  await page.click('#editorSavedSave');
  await expect(page.locator('#editorSavedSelect')).toContainText('E2E Save');

  const text = await page.evaluate(() => {
    return window.__E2E__?.getEditorLevelText?.() || '';
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

test('Validation panel renders and applies fix buttons', async ({ page }) => {
  await setEditorField(page, '#editorHeaderLemmings', 5);
  await setEditorField(page, '#editorHeaderSaveRequirement', 8);

  await expect(page.locator('#editorIssuesList')).toHaveAttribute('role', 'list');
  await expect(page.locator('#editorIssuesList')).toHaveAttribute('aria-live', 'polite');
  const issue = page.locator('#editorIssuesList .issue-item', {
    hasText: 'Save requirement exceeds lemmings.'
  });
  await expect(issue).toBeVisible();
  await expect(issue).toHaveAttribute('data-severity', 'error');
  await expect(issue).toHaveAttribute('aria-label', 'Error: Save requirement exceeds lemmings.');
  await expect(issue.locator('.issue-severity')).toHaveText('Error');
  await expect(issue.locator('.issue-message')).toHaveText('Save requirement exceeds lemmings.');
  await issue.getByRole('button', { name: 'Clamp save requirement' }).click();
  await expect(page.locator('#editorIssuesList')).not.toContainText('Save requirement exceeds lemmings.');

  const header = await page.evaluate(() => window.__E2E__.getState().editor.session.level.header);
  expect(header.SAVE_REQUIREMENT).toBe(5);
  expect(header.LEMMINGS).toBe(5);
});

test('Selection inspector toggles terrain one-way flags', async ({ page }) => {
  const terrainId = await page.evaluate(() => window.__E2E__.getState().editor.assets.terrain[0]?.id);
  expect(Number.isFinite(terrainId)).toBe(true);

  await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 32, Y: 32 } } },
    { type: 'entry.add', args: { kind: 'steel', props: { X: 96, Y: 32, WIDTH: 16, HEIGHT: 16 } } },
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: 0 }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  const oneWay = page.locator('#editorSelOneWay');
  await page.locator('#editorSelectionFlags').evaluate(element => {
    element.open = true;
  });
  await expect(oneWay).toBeEnabled();
  await expect(oneWay).not.toBeChecked();

  await oneWay.check();
  const checkedProps = await page.evaluate(() => window.__E2E__.getState().editor.session.level.terrains[0].props);
  expect(checkedProps.ONE_WAY).toBe(true);

  await oneWay.uncheck();
  const uncheckedProps = await page.evaluate(() => window.__E2E__.getState().editor.session.level.terrains[0].props);
  expect(Object.prototype.hasOwnProperty.call(uncheckedProps, 'ONE_WAY')).toBe(false);

  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [{ kind: 'steel', index: 0 }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });
  await expect(oneWay).toBeDisabled();
});

test('Canvas interaction clears focused editor inputs', async ({ page }) => {
  const titleInput = page.locator('#editorHeaderTitle');
  await titleInput.focus();
  await expect(titleInput).toBeFocused();
  await page.locator('#editorCanvas').click({ position: { x: 12, y: 12 }, force: true });
  await expect(titleInput).not.toBeFocused();
});
