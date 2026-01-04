import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
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

const worldToPage = (state, canvasBox, point) => {
  const viewRect = state?.stage?.viewRect;
  const gamePos = state?.stage?.gamePosition;
  const scale = state?.stage?.gameScale ?? 1;
  if (!viewRect || !gamePos || !Number.isFinite(scale)) {
    throw new Error('Missing stage transform data for editor canvas.');
  }
  const canvasX = gamePos.x + (point.x - viewRect.x) * scale;
  const canvasY = gamePos.y + (point.y - viewRect.y) * scale;
  return {
    x: canvasBox.x + canvasX,
    y: canvasBox.y + canvasY
  };
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

test('Editor placement preserves viewport when panned', async ({ page }) => {
  let state = await getEditorState(page);
  const scale = state.stage.gameScale || 2;
  const viewRect = state.stage.viewRect;
  const stage = state.stage;
  if (!viewRect || !stage) {
    throw new Error('Missing stage view data');
  }
  const targetX = Math.max(0, viewRect.x + viewRect.w * 0.6);
  await page.evaluate(({ x, scale }) => {
    const stage = window.lemmings?.stage;
    if (!stage) return;
    stage.applyViewport(stage.gameImgProps, x, 0, scale);
    stage.redraw();
  }, { x: targetX, scale });

  await page.waitForFunction((x) => {
    const rect = window.__E2E__.getState().stage.viewRect;
    return rect && rect.x >= x - 1;
  }, targetX);

  state = await getEditorState(page);
  const beforeX = state.stage.viewRect.x;
  const beforeScale = state.stage.gameScale;
  const canvasBox = await getCanvasBox(page);

  await page.click('#editorToolList button[data-tool="gadget"]');
  const gadgetEntry = state.editor.assets.gadgets.find(entry => entry.width > 0 || entry.height > 0);
  if (!gadgetEntry) {
    throw new Error('No gadget entry found');
  }
  await page.click(`#editorPaletteGadgets button[data-id="${gadgetEntry.id}"]`);

  const placePoint = {
    x: beforeX + Math.min(80, state.stage.viewRect.w * 0.4),
    y: 80
  };
  const pagePoint = worldToPage(state, canvasBox, placePoint);
  await page.mouse.click(pagePoint.x, pagePoint.y);

  await page.waitForFunction((expected) => {
    const next = window.__E2E__.getState().stage.viewRect;
    return next && Math.abs(next.x - expected) < 1;
  }, beforeX);

  state = await getEditorState(page);
  expect(Math.abs(state.stage.gameScale - beforeScale)).toBeLessThan(0.01);
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

test('Editor brush respects grid size snapping', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  const gridSize = page.locator('#editorGridSize');
  await gridSize.fill('8');
  await gridSize.dispatchEvent('change');

  const snapToggle = page.locator('#editorSnapToggle');
  await snapToggle.check();

  const before = await getEditorState(page);
  const beforeCount = before.editor.session.level.terrains.length;

  await page.click('#editorToolList button[data-tool="brush"]');
  await clickCanvas(page, 0.22, 0.32);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length > count;
  }, beforeCount);

  const after = await getEditorState(page);
  const placed = after.editor.session.level.terrains[after.editor.session.level.terrains.length - 1];
  expect(placed.props.X % 8).toBe(0);
  expect(placed.props.Y % 8).toBe(0);
});

test('Editor eraser removes terrain entries', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  const before = await getEditorState(page);
  const beforeCount = before.editor.session.level.terrains.length;

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.25, 0.4);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length > count;
  }, beforeCount);

  const afterPlace = await getEditorState(page);
  const afterCount = afterPlace.editor.session.level.terrains.length;

  await page.click('#editorToolList button[data-tool="eraser"]');
  await clickCanvas(page, 0.25, 0.4);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length < count;
  }, afterCount);
});

test('Editor exports and imports classic levels via downloads', async ({ page }) => {
  const [nxlvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#editorSavedExport')
  ]);
  expect(nxlvDownload.suggestedFilename()).toMatch(/\.nxlv$/i);

  const [classicDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#editorSavedExportClassic')
  ]);
  expect(classicDownload.suggestedFilename()).toMatch(/\.lvl$/i);

  const classicPath = await classicDownload.path();
  expect(classicPath).not.toBeNull();
  const buffer = await fs.readFile(classicPath);

  await page.setInputFiles('#editorSavedImportClassicInput', {
    name: 'imported-level.lvl',
    mimeType: 'application/octet-stream',
    buffer
  });

  await page.waitForFunction(() => {
    const history = window.__E2E__.getState().editor.history;
    const entries = history?.entries || [];
    return entries.length > 0 && entries[entries.length - 1].label === 'Import LVL';
  });
});

test('Editor selection workflows support multi-select, nudge, and delete', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.2, 0.3);
  await clickCanvas(page, 0.3, 0.3);

  let state = await getEditorState(page);
  const terrainBefore = state.editor.session.level.terrains.length;

  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.2, 0.3);
  await page.keyboard.down('Shift');
  await clickCanvas(page, 0.3, 0.3);
  await page.keyboard.up('Shift');

  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 2;
  });

  state = await getEditorState(page);
  const entriesBefore = state.editor.controller.selectionEntries.map((entry) => ({
    x: entry.entry.props.X,
    y: entry.entry.props.Y
  }));

  await page.keyboard.press('ArrowRight');

  await page.waitForFunction((before) => {
    const entries = window.__E2E__.getState().editor.controller.selectionEntries;
    if (entries.length !== 2) return false;
    return entries.every((entry, idx) => entry.entry.props.X === before[idx].x + 1);
  }, entriesBefore);

  await page.keyboard.press('Delete');
  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length === count - 2;
  }, terrainBefore);
});

test('Editor snap-to-grid aligns selection to grid size', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.25, 0.35);

  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.25, 0.35);
  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 1;
  });

  const selX = page.locator('#editorSelX');
  const selY = page.locator('#editorSelY');
  await selX.fill('3');
  await selX.dispatchEvent('change');
  await selY.fill('5');
  await selY.dispatchEvent('change');

  await page.waitForFunction(() => {
    const entry = window.__E2E__.getState().editor.controller.selectionEntries[0];
    return entry && entry.entry.props.X === 3 && entry.entry.props.Y === 5;
  });

  await page.keyboard.press('Control+KeyG');

  await page.waitForFunction(() => {
    const state = window.__E2E__.getState();
    const entry = state.editor.controller.selectionEntries[0];
    const grid = state.editor.controller.gridSize || 1;
    return entry
      && entry.entry.props.X % grid === 0
      && entry.entry.props.Y % grid === 0;
  });
});

test('Editor copy/paste/duplicate and undo/redo update terrain counts', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.25, 0.35);

  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.25, 0.35);
  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 1;
  });

  let state = await getEditorState(page);
  const terrainBefore = state.editor.session.level.terrains.length;

  await page.keyboard.press('Control+KeyC');
  await page.keyboard.press('Control+KeyV');

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length === count + 1;
  }, terrainBefore);

  state = await getEditorState(page);
  const afterPaste = state.editor.session.level.terrains.length;

  await page.keyboard.press('Control+KeyD');
  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length === count + 1;
  }, afterPaste);

  state = await getEditorState(page);
  const afterDuplicate = state.editor.session.level.terrains.length;

  await page.keyboard.press('KeyZ');
  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length === count - 1;
  }, afterDuplicate);

  await page.keyboard.press('Shift+KeyZ');
  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length === count;
  }, afterDuplicate);
});

test('Editor drag and resize move steel entries', async ({ page }) => {
  await page.click('#editorToolList button[data-tool="steel"]');
  await dragCanvas(page, { x: 0.55, y: 0.35 }, { x: 0.62, y: 0.45 });

  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.58, 0.4);

  await page.waitForFunction(() => {
    const bounds = window.__E2E__.getState().editor.controller.selectionBounds;
    return bounds && bounds.width > 0 && bounds.height > 0;
  });

  let state = await getEditorState(page);
  const beforeEntry = state.editor.controller.selectionEntries[0];
  const bounds = state.editor.controller.selectionBounds;
  const canvasBox = await getCanvasBox(page);
  const start = worldToPage(state, canvasBox, { x: bounds.x + 2, y: bounds.y + 2 });
  const grid = state.editor.controller.gridSize || 1;
  const target = worldToPage(state, canvasBox, {
    x: bounds.x + grid * 2,
    y: bounds.y + grid * 2
  });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y);
  await page.mouse.up();

  state = await getEditorState(page);
  const moved = state.editor.controller.selectionEntries[0];
  expect(moved.entry.props.X).not.toBe(beforeEntry.entry.props.X);
  expect(moved.entry.props.Y).not.toBe(beforeEntry.entry.props.Y);

  const resizedBounds = state.editor.controller.selectionBounds;
  const handle = worldToPage(state, canvasBox, {
    x: resizedBounds.x + resizedBounds.width,
    y: resizedBounds.y + resizedBounds.height
  });
  const resizeTarget = worldToPage(state, canvasBox, {
    x: resizedBounds.x + resizedBounds.width + grid * 2,
    y: resizedBounds.y + resizedBounds.height + grid * 2
  });

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(resizeTarget.x, resizeTarget.y);
  await page.mouse.up();

  state = await getEditorState(page);
  const resized = state.editor.controller.selectionEntries[0];
  expect(resized.entry.props.WIDTH).toBeGreaterThan(beforeEntry.entry.props.WIDTH || 0);
  expect(resized.entry.props.HEIGHT).toBeGreaterThan(beforeEntry.entry.props.HEIGHT || 0);
});

test('Editor entrance and exit tools enforce classic limits', async ({ page }) => {
  let state = await getEditorState(page);
  const entranceId = state.editor.assets.entranceId;
  const exitId = state.editor.assets.exitId;
  expect(Number.isFinite(entranceId)).toBe(true);
  expect(Number.isFinite(exitId)).toBe(true);

  await page.click('#editorToolList button[data-tool="entrance"]');
  for (let i = 0; i < 5; i += 1) {
    await clickCanvas(page, 0.18 + i * 0.04, 0.3);
  }

  state = await getEditorState(page);
  const entranceCount = state.editor.session.level.gadgets
    .filter(entry => entry?.props?.PIECE === entranceId).length;
  expect(entranceCount).toBeLessThanOrEqual(4);

  await page.click('#editorToolList button[data-tool="exit"]');
  for (let i = 0; i < 5; i += 1) {
    await clickCanvas(page, 0.18 + i * 0.04, 0.6);
  }

  state = await getEditorState(page);
  const exitCount = state.editor.session.level.gadgets
    .filter(entry => entry?.props?.PIECE === exitId).length;
  expect(exitCount).toBeLessThanOrEqual(4);
});

test('Editor gadget resize writes width and height props', async ({ page }) => {
  await page.click('#editorPaletteTabs button[data-tab="gadgets"]');
  const gadgetButton = page.locator('#editorPaletteGadgets button').first();
  await expect(gadgetButton).toBeVisible();
  await gadgetButton.click();

  await page.click('#editorToolList button[data-tool="gadget"]');
  await clickCanvas(page, 0.35, 0.45);

  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.35, 0.45);

  await page.waitForFunction(() => {
    const bounds = window.__E2E__.getState().editor.controller.selectionBounds;
    return bounds && bounds.width > 0 && bounds.height > 0;
  });

  let state = await getEditorState(page);
  const bounds = state.editor.controller.selectionBounds;
  const canvasBox = await getCanvasBox(page);
  const handle = worldToPage(state, canvasBox, {
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height
  });
  const resizeTarget = worldToPage(state, canvasBox, {
    x: bounds.x + bounds.width + 8,
    y: bounds.y + bounds.height + 8
  });

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(resizeTarget.x, resizeTarget.y);
  await page.mouse.up();

  state = await getEditorState(page);
  const resized = state.editor.controller.selectionEntries[0];
  expect(resized.entry.props.WIDTH).toBeGreaterThan(0);
  expect(resized.entry.props.HEIGHT).toBeGreaterThan(0);
});

test('Editor view stays stable during edit actions', async ({ page }) => {
  const terrainButton = page.locator('#editorPaletteTerrain button').first();
  await expect(terrainButton).toBeVisible();
  await terrainButton.click();

  let state = await getEditorState(page);
  const initialRect = state.stage.viewRect;
  expect(initialRect).toBeTruthy();

  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.3, 0.35);
  await page.click('#editorToolList button[data-tool="select"]');
  await clickCanvas(page, 0.3, 0.35);
  await page.keyboard.press('ArrowRight');

  state = await getEditorState(page);
  const nextRect = state.stage.viewRect;
  expect(nextRect).toEqual(initialRect);
});
