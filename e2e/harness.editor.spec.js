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

const getEditorState = (page) => page.evaluate(() => window.__E2E__.getState());

const getCanvasBox = async (page) => {
  const canvas = page.locator('#editorCanvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Editor canvas is not visible.');
  }
  return box;
};

const clickCanvas = async (page, xRatio, yRatio) => {
  const box = await getCanvasBox(page);
  await page.mouse.click(
    box.x + box.width * xRatio,
    box.y + box.height * yRatio
  );
};

const dragCanvas = async (page, start, end) => {
  const box = await getCanvasBox(page);
  const startX = box.x + box.width * start.x;
  const startY = box.y + box.height * start.y;
  const endX = box.x + box.width * end.x;
  const endY = box.y + box.height * end.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY);
  await page.mouse.up();
};

const parseLevelName = (label) => {
  const text = String(label || '');
  const idx = text.indexOf(':');
  const raw = idx === -1 ? text : text.slice(idx + 1);
  return raw.replace(/\0/g, '').trim();
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
  const state = await getEditorState(page);
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

test('Editor playtest toggles timer and input state', async ({ page }) => {
  let state = await getEditorState(page);
  expect(state.view.editorMode).toBe(true);
  expect(state.editor.playtest).toBe(false);
  expect(state.game.timer.running).toBe(false);
  expect(state.stage.panEnabled).toBe(false);
  const inputBefore = await page.evaluate(() => window.lemmings?.game?.inputEnabled);
  expect(inputBefore).toBe(false);

  await page.click('#editorPlaytestToggle');
  await page.waitForFunction(() => {
    const next = window.__E2E__.getState();
    return next.editor.playtest === true && next.game.timer.running === true;
  });
  state = await getEditorState(page);
  expect(state.stage.panEnabled).toBe(true);
  const inputAfter = await page.evaluate(() => window.lemmings?.game?.inputEnabled);
  expect(inputAfter).toBe(true);

  await page.click('#editorPlaytestToggle');
  await page.waitForFunction(() => {
    const next = window.__E2E__.getState();
    return next.editor.playtest === false && next.game.timer.running === false;
  });
  state = await getEditorState(page);
  expect(state.stage.panEnabled).toBe(false);
  const inputStopped = await page.evaluate(() => window.lemmings?.game?.inputEnabled);
  expect(inputStopped).toBe(false);
});

test('Editor level selection loads into editor session', async ({ page }) => {
  const state = await getEditorState(page);
  const levelSelect = page.locator('#editorLevelIndexSelect');
  const optionCount = await levelSelect.locator('option').count();
  expect(optionCount).toBeGreaterThan(1);

  const currentIndex = state.view.levelIndex ?? 0;
  const targetIndex = currentIndex === 0 ? 1 : 0;
  const targetOption = levelSelect.locator(`option[value="${targetIndex}"]`);
  const targetLabel = await targetOption.textContent();
  const targetName = parseLevelName(targetLabel);
  expect(targetName).not.toBe('');

  await levelSelect.selectOption(String(targetIndex));
  await page.waitForFunction((name) => {
    const title = window.__E2E__.getState().editor.session.level.header.TITLE || '';
    return title.replace(/\0/g, '').trim() === name;
  }, targetName);

  const nextState = await getEditorState(page);
  expect(nextState.view.editorMode).toBe(true);
  expect(nextState.view.levelIndex).toBe(targetIndex);
  const normalizedTitle = String(nextState.editor.session.level.header.TITLE || '')
    .replace(/\0/g, '')
    .trim();
  expect(normalizedTitle).toBe(targetName);
});

test('Editor terrain placement uses palette selection', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  const terrainId = await terrainButton.getAttribute('data-id');
  expect(terrainId).not.toBeNull();
  await terrainButton.click();

  const before = await getEditorState(page);
  const beforeCount = before.editor.session.level.terrains.length;

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.25, 0.35);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length > count;
  }, beforeCount);

  const after = await getEditorState(page);
  const terrains = after.editor.session.level.terrains;
  const placed = terrains[terrains.length - 1];
  expect(placed.props.PIECE).toBe(Number(terrainId));
});

test('Editor gadget and trigger placement use palette selection', async ({ page }) => {
  await page.click('#editorPaletteTabs button[data-tab="gadgets"]');
  const gadgetButton = page.locator('#editorPaletteGadgets button').first();
  await expect(gadgetButton).toBeVisible();
  const gadgetId = await gadgetButton.getAttribute('data-id');
  expect(gadgetId).not.toBeNull();
  await gadgetButton.click();

  let state = await getEditorState(page);
  const gadgetsBefore = state.editor.session.level.gadgets.length;

  await page.click('#editorToolList button[data-tool="gadget"]');
  await clickCanvas(page, 0.35, 0.4);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.gadgets.length > count;
  }, gadgetsBefore);

  state = await getEditorState(page);
  let gadgets = state.editor.session.level.gadgets;
  let placed = gadgets[gadgets.length - 1];
  expect(placed.props.PIECE).toBe(Number(gadgetId));

  await page.click('#editorPaletteTabs button[data-tab="triggers"]');
  const triggerButton = page.locator('#editorPaletteTriggers button').first();
  await expect(triggerButton).toBeVisible();
  const triggerId = await triggerButton.getAttribute('data-id');
  expect(triggerId).not.toBeNull();
  await triggerButton.click();

  state = await getEditorState(page);
  const triggersBefore = state.editor.session.level.gadgets.length;

  await page.click('#editorToolList button[data-tool="trigger"]');
  await clickCanvas(page, 0.45, 0.45);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.gadgets.length > count;
  }, triggersBefore);

  state = await getEditorState(page);
  gadgets = state.editor.session.level.gadgets;
  placed = gadgets[gadgets.length - 1];
  expect(placed.props.PIECE).toBe(Number(triggerId));
});

test('Editor selection updates inspector state', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  const terrainId = await terrainButton.getAttribute('data-id');
  expect(terrainId).not.toBeNull();
  await terrainButton.click();

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.3, 0.55);

  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.3, 0.55);

  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 1;
  });

  const state = await getEditorState(page);
  const selected = state.editor.controller.selectionEntries[0];
  expect(selected.type).toBe('terrain');
  expect(selected.entry.props.PIECE).toBe(Number(terrainId));

  await expect(page.locator('#editorSelType')).toHaveText('terrain');
  await expect(page.locator('#editorSelName')).not.toHaveText('');
  await expect(page.locator('#editorSelX')).toBeEnabled();
});

test('Editor brush and steel tools modify level data', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  const brushSize = page.locator('#editorBrushSize');
  await brushSize.fill('2');
  await brushSize.dispatchEvent('change');

  let state = await getEditorState(page);
  const terrainBefore = state.editor.session.level.terrains.length;

  await page.click('#editorToolList button[data-tool="brush"]');
  await dragCanvas(page, { x: 0.2, y: 0.3 }, { x: 0.35, y: 0.4 });

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length > count;
  }, terrainBefore);

  state = await getEditorState(page);
  const terrainAfter = state.editor.session.level.terrains.length;
  expect(terrainAfter).toBeGreaterThan(terrainBefore + 1);

  const steelBefore = state.editor.session.level.steel.length;
  await page.click('#editorToolList button[data-tool="steel"]');
  await dragCanvas(page, { x: 0.55, y: 0.4 }, { x: 0.7, y: 0.55 });

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.steel.length > count;
  }, steelBefore);

  state = await getEditorState(page);
  const steel = state.editor.session.level.steel;
  const placed = steel[steel.length - 1];
  expect(placed.props.WIDTH).toBeGreaterThan(1);
  expect(placed.props.HEIGHT).toBeGreaterThan(1);
});
