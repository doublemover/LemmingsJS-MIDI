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

const getCanvasPoint = async (page, xRatio, yRatio) => {
  const box = await getCanvasBox(page);
  return {
    x: box.x + box.width * xRatio,
    y: box.y + box.height * yRatio
  };
};

const getWorldPointFromPage = async (page, point, canvasBox) => {
  return page.evaluate(({ x, y, canvasX, canvasY }) => {
    const stage = window.lemmings?.stage;
    if (!stage) return null;
    const img = stage.gameImgProps;
    const localX = (x - canvasX) - img.x;
    const localY = (y - canvasY) - img.y;
    return {
      x: img.viewPoint.getSceneX(localX),
      y: img.viewPoint.getSceneY(localY)
    };
  }, { x: point.x, y: point.y, canvasX: canvasBox.x, canvasY: canvasBox.y });
};

const snapWorldValue = (value, gridSize, snapEnabled) => {
  if (!snapEnabled || !Number.isFinite(gridSize) || gridSize <= 1) {
    return Math.round(value);
  }
  return Math.round(value / gridSize) * gridSize;
};

const getWorldPointFromRatio = (state, xRatio, yRatio) => {
  const viewRect = state?.stage?.viewRect;
  if (!viewRect) {
    throw new Error('Missing viewRect for world coordinate lookup.');
  }
  return {
    x: viewRect.x + viewRect.w * xRatio,
    y: viewRect.y + viewRect.h * yRatio
  };
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

const getPagePointFromWorld = async (page, point) => {
  return page.evaluate(({ x, y }) => {
    const stage = window.lemmings?.stage;
    const canvas = stage?.stageCav;
    const rect = canvas?.getBoundingClientRect?.();
    const viewRect = stage?.getGameViewRect?.();
    const scale = stage?.gameImgProps?.viewPoint?.scale ?? 1;
    if (!rect || !viewRect) return null;
    const localX = (stage.gameImgProps?.x ?? 0) + (x - viewRect.x) * scale;
    const localY = (stage.gameImgProps?.y ?? 0) + (y - viewRect.y) * scale;
    return {
      x: rect.left + localX,
      y: rect.top + localY
    };
  }, point);
};

const centerViewportOn = async (page, point) => {
  await page.evaluate(({ x, y }) => {
    const stage = window.lemmings?.stage;
    if (!stage) return;
    const viewRect = stage.getGameViewRect?.();
    if (!viewRect) return;
    const scale = stage.gameImgProps?.viewPoint?.scale ?? 1;
    stage.applyViewport(
      stage.gameImgProps,
      x - viewRect.w / 2,
      y - viewRect.h / 2,
      scale
    );
    stage.redraw?.();
  }, point);
};

const selectPaletteItem = async (page, containerSelector, id) => {
  const button = page.locator(`${containerSelector} button[data-id="${id}"]`);
  await button.scrollIntoViewIfNeeded();
  await button.click();
};

const captureSelectionScreenshot = async (page, name) => {
  const canvas = page.locator('#editorCanvas');
  await expect(canvas).toBeVisible();
  const path = test.info().outputPath(name);
  await canvas.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
};

const placeSelectAndSnapshot = async (page, options) => {
  const {
    tool,
    paletteContainer,
    id,
    clickRatio,
    snapshotName
  } = options;
  const before = await getEditorState(page);
  const worldClick = getWorldPointFromRatio(before, clickRatio.x, clickRatio.y);
  await centerViewportOn(page, worldClick);
  const centered = await getEditorState(page);
  const canvasBox = await getCanvasBox(page);
  const pagePoint = worldToPage(centered, canvasBox, worldClick);

  await page.click(`#editorToolList button[data-tool="${tool}"]`);
  await selectPaletteItem(page, paletteContainer, id);
  await page.mouse.click(pagePoint.x, pagePoint.y);

  await page.evaluate(() => {
    window.__E2E__?.pause?.();
  });
  await page.click('#editorToolList button[data-tool="select"]');
  await page.mouse.click(pagePoint.x, pagePoint.y);
  await captureSelectionScreenshot(page, snapshotName);
  await page.keyboard.press('Control+Z');
};

const coerceNumber = (value, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

const getEntryCenter = (entry, meta) => {
  const props = entry?.props || {};
  const width = Number.isFinite(props.WIDTH)
    ? props.WIDTH
    : Number.isFinite(meta?.width)
      ? meta.width
      : 1;
  const height = Number.isFinite(props.HEIGHT)
    ? props.HEIGHT
    : Number.isFinite(meta?.height)
      ? meta.height
      : 1;
  const centerX = coerceNumber(props.X, 0) + Math.floor(Math.max(1, width) / 2);
  const centerY = coerceNumber(props.Y, 0) + Math.floor(Math.max(1, height) / 2);
  return { x: centerX, y: centerY };
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
    if ('serviceWorker' in navigator) {
      const noopRegister = async () => ({ unregister: async () => true });
      navigator.serviceWorker.register = noopRegister;
      navigator.serviceWorker.getRegistrations = async () => [];
    }
  });
  await page.goto(`/editor.html?e2e=1&cacheBust=${Date.now()}`);
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
  const terrainMeta = before.editor.assets.terrain.find(item => item.id === Number(terrainId));
  const snapEnabled = before.editor.controller.snapEnabled;
  const gridSize = before.editor.controller.gridSize;
  const canvasBox = await getCanvasBox(page);
  const pagePoint = {
    x: canvasBox.x + canvasBox.width * 0.25,
    y: canvasBox.y + canvasBox.height * 0.35
  };
  const worldClick = await getWorldPointFromPage(page, pagePoint, canvasBox);

  await page.click('#editorToolList button[data-tool="terrain"]');
  await page.mouse.click(pagePoint.x, pagePoint.y);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length > count;
  }, beforeCount);

  const after = await getEditorState(page);
  const terrains = after.editor.session.level.terrains;
  const placed = terrains[terrains.length - 1];
  expect(placed.props.PIECE).toBe(Number(terrainId));
  const offsetX = terrainMeta?.width ? Math.floor(terrainMeta.width / 2) : 0;
  const offsetY = terrainMeta?.height ? Math.floor(terrainMeta.height / 2) : 0;
  const snappedX = snapWorldValue(worldClick.x, gridSize, snapEnabled);
  const snappedY = snapWorldValue(worldClick.y, gridSize, snapEnabled);
  expect(placed.props.X).toBe(snappedX - offsetX);
  expect(placed.props.Y).toBe(snappedY - offsetY);
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
  const gadgetCanvasBox = await getCanvasBox(page);
  const gadgetPoint = {
    x: gadgetCanvasBox.x + gadgetCanvasBox.width * 0.35,
    y: gadgetCanvasBox.y + gadgetCanvasBox.height * 0.4
  };
  const worldClick = await getWorldPointFromPage(page, gadgetPoint, gadgetCanvasBox);
  await page.mouse.click(gadgetPoint.x, gadgetPoint.y);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.gadgets.length > count;
  }, gadgetsBefore);

  state = await getEditorState(page);
  let gadgets = state.editor.session.level.gadgets;
  let placed = gadgets[gadgets.length - 1];
  expect(placed.props.PIECE).toBe(Number(gadgetId));
  const gadgetMeta = state.editor.assets.gadgets.find(item => item.id === Number(gadgetId));
  const offsetX = gadgetMeta?.width ? Math.floor(gadgetMeta.width / 2) : 0;
  const offsetY = gadgetMeta?.height ? Math.floor(gadgetMeta.height / 2) : 0;
  const snappedX = snapWorldValue(worldClick.x, state.editor.controller.gridSize, state.editor.controller.snapEnabled);
  const snappedY = snapWorldValue(worldClick.y, state.editor.controller.gridSize, state.editor.controller.snapEnabled);
  expect(placed.props.X).toBe(snappedX - offsetX);
  expect(placed.props.Y).toBe(snappedY - offsetY);

  await page.click('#editorPaletteTabs button[data-tab="triggers"]');
  const triggerButton = page.locator('#editorPaletteTriggers button').first();
  await expect(triggerButton).toBeVisible();
  const triggerId = await triggerButton.getAttribute('data-id');
  expect(triggerId).not.toBeNull();
  await triggerButton.click();

  state = await getEditorState(page);
  const triggersBefore = state.editor.session.level.gadgets.length;

  await page.click('#editorToolList button[data-tool="trigger"]');
  const triggerCanvasBox = await getCanvasBox(page);
  const triggerPoint = {
    x: triggerCanvasBox.x + triggerCanvasBox.width * 0.45,
    y: triggerCanvasBox.y + triggerCanvasBox.height * 0.45
  };
  const triggerWorldClick = await getWorldPointFromPage(page, triggerPoint, triggerCanvasBox);
  await page.mouse.click(triggerPoint.x, triggerPoint.y);

  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.gadgets.length > count;
  }, triggersBefore);

  state = await getEditorState(page);
  gadgets = state.editor.session.level.gadgets;
  placed = gadgets[gadgets.length - 1];
  expect(placed.props.PIECE).toBe(Number(triggerId));
  const triggerMeta = state.editor.assets.gadgets.find(item => item.id === Number(triggerId));
  const triggerOffsetX = triggerMeta?.width ? Math.floor(triggerMeta.width / 2) : 0;
  const triggerOffsetY = triggerMeta?.height ? Math.floor(triggerMeta.height / 2) : 0;
  const triggerX = snapWorldValue(triggerWorldClick.x, state.editor.controller.gridSize, state.editor.controller.snapEnabled);
  const triggerY = snapWorldValue(triggerWorldClick.y, state.editor.controller.gridSize, state.editor.controller.snapEnabled);
  expect(placed.props.X).toBe(triggerX - triggerOffsetX);
  expect(placed.props.Y).toBe(triggerY - triggerOffsetY);
});

test('Editor pack switch refreshes palettes and placement', async ({ page }) => {
  const state = await getEditorState(page);
  const gameTypeSelect = page.locator('#editorGameTypeSelect');
  const selectInfo = await page.evaluate(() => {
    const select = document.getElementById('editorGameTypeSelect');
    if (!select) return null;
    const values = Array.from(select.options).map(option => option.value);
    return { selectedIndex: select.selectedIndex, values };
  });
  expect(selectInfo?.values?.length).toBeGreaterThan(1);
  const nextIndex = selectInfo.selectedIndex === 0 ? 1 : 0;
  const nextValue = selectInfo.values[nextIndex];

  await gameTypeSelect.selectOption(nextValue);
  await page.waitForFunction((prevType) => {
    return window.__E2E__.getState().view.gameType !== prevType;
  }, state.view.gameType);

  const nextState = await getEditorState(page);
  expect(nextState.view.gameType).not.toBe(state.view.gameType);
  expect(nextState.editor.assets.terrain.length).toBeGreaterThan(0);

  const firstTerrain = nextState.editor.assets.terrain[0];
  const paletteFirstId = await page.locator('#editorPaletteTerrain button').first().getAttribute('data-id');
  expect(Number(paletteFirstId)).toBe(firstTerrain.id);

  await page.click('#editorPaletteTerrain button');
  const beforeCount = nextState.editor.session.level.terrains.length;
  await page.click('#editorToolList button[data-tool="terrain"]');
  await clickCanvas(page, 0.2, 0.3);
  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length > count;
  }, beforeCount);
  const placedState = await getEditorState(page);
  const placed = placedState.editor.session.level.terrains.slice(-1)[0];
  expect(placed.props.PIECE).toBe(firstTerrain.id);
});

test('Editor selection overlays render for every asset', async ({ page }) => {
  test.slow();
  await page.fill('#editorPaletteSearch', '');
  await page.click('#editorPaletteTabs button[data-tab="terrain"]');
  const terrainIds = await page.$$eval('#editorPaletteTerrain button', (buttons) => (
    buttons.map(button => Number(button.dataset.id)).filter(Number.isFinite)
  ));
  const gadgetIds = await page.$$eval('#editorPaletteGadgets button', (buttons) => (
    buttons.map(button => Number(button.dataset.id)).filter(Number.isFinite)
  ));
  const triggerIds = await page.$$eval('#editorPaletteTriggers button', (buttons) => (
    buttons.map(button => Number(button.dataset.id)).filter(Number.isFinite)
  ));

  const clickRatio = { x: 0.3, y: 0.35 };

  for (const id of terrainIds) {
    await placeSelectAndSnapshot(page, {
      tool: 'terrain',
      paletteContainer: '#editorPaletteTerrain',
      id,
      clickRatio,
      snapshotName: `editor-selection-terrain-${id}.png`
    });
  }

  await page.click('#editorPaletteTabs button[data-tab="gadgets"]');
  for (const id of gadgetIds) {
    await placeSelectAndSnapshot(page, {
      tool: 'gadget',
      paletteContainer: '#editorPaletteGadgets',
      id,
      clickRatio,
      snapshotName: `editor-selection-gadget-${id}.png`
    });
  }

  await page.click('#editorPaletteTabs button[data-tab="triggers"]');
  for (const id of triggerIds) {
    await placeSelectAndSnapshot(page, {
      tool: 'trigger',
      paletteContainer: '#editorPaletteTriggers',
      id,
      clickRatio,
      snapshotName: `editor-selection-trigger-${id}.png`
    });
  }
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

  const placedState = await getEditorState(page);
  const placed = placedState.editor.session.level.terrains.slice(-1)[0];
  const meta = placedState.editor.assets.terrain.find(item => item.id === placed.props.PIECE);
  const center = getEntryCenter(placed, meta);
  const pagePoint = await getPagePointFromWorld(page, center);

  await page.click('#editorToolList button[data-tool="select"]');
  if (!pagePoint) throw new Error('Failed to resolve selection click point.');
  await page.mouse.click(pagePoint.x, pagePoint.y);

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
  const meta = after.editor.assets.terrain.find(item => item.id === placed.props.PIECE);
  const offsetX = meta?.width ? Math.floor(meta.width / 2) : 0;
  const offsetY = meta?.height ? Math.floor(meta.height / 2) : 0;
  expect((placed.props.X + offsetX) % 8).toBe(0);
  expect((placed.props.Y + offsetY) % 8).toBe(0);
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

  let state = await getEditorState(page);
  let placed = state.editor.session.level.terrains.slice(-1)[0];
  let meta = state.editor.assets.terrain.find(item => item.id === placed.props.PIECE);
  let center = getEntryCenter(placed, meta);
  let pagePoint = await getPagePointFromWorld(page, center);

  await page.click('#editorToolList button[data-tool="select"]');
  if (!pagePoint) throw new Error('Failed to resolve selection click point.');
  await page.mouse.click(pagePoint.x, pagePoint.y);
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

  let state = await getEditorState(page);
  let placed = state.editor.session.level.terrains.slice(-1)[0];
  let meta = state.editor.assets.terrain.find(item => item.id === placed.props.PIECE);
  let center = getEntryCenter(placed, meta);
  let pagePoint = await getPagePointFromWorld(page, center);

  await page.click('#editorToolList button[data-tool="select"]');
  if (!pagePoint) throw new Error('Failed to resolve selection click point.');
  await page.mouse.click(pagePoint.x, pagePoint.y);
  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 1;
  });

  state = await getEditorState(page);
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

  let state = await getEditorState(page);
  const steelEntry = state.editor.session.level.steel.slice(-1)[0];
  const steelCenter = getEntryCenter(steelEntry, null);
  const steelPoint = await getPagePointFromWorld(page, steelCenter);

  await page.click('#editorToolList button[data-tool="select"]');
  if (!steelPoint) throw new Error('Failed to resolve steel selection point.');
  await page.mouse.click(steelPoint.x, steelPoint.y);

  await page.waitForFunction(() => {
    const bounds = window.__E2E__.getState().editor.controller.selectionBounds;
    return bounds && bounds.width > 0 && bounds.height > 0;
  });

  state = await getEditorState(page);
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

  let state = await getEditorState(page);
  const placed = state.editor.session.level.gadgets.slice(-1)[0];
  const meta = state.editor.assets.gadgets.find(item => item.id === placed.props.PIECE);
  const center = getEntryCenter(placed, meta);
  const pagePoint = await getPagePointFromWorld(page, center);

  await page.click('#editorToolList button[data-tool="select"]');
  if (!pagePoint) throw new Error('Failed to resolve gadget selection point.');
  await page.mouse.click(pagePoint.x, pagePoint.y);

  await page.waitForFunction(() => {
    const bounds = window.__E2E__.getState().editor.controller.selectionBounds;
    return bounds && bounds.width > 0 && bounds.height > 0;
  });

  state = await getEditorState(page);
  const bounds = state.editor.controller.selectionBounds;
  const canvasBox2 = await getCanvasBox(page);
  const handle = worldToPage(state, canvasBox2, {
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height
  });
  const resizeTarget = worldToPage(state, canvasBox2, {
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
  const placedState = await getEditorState(page);
  const placed = placedState.editor.session.level.terrains.slice(-1)[0];
  const meta = placedState.editor.assets.terrain.find(item => item.id === placed.props.PIECE);
  const center = getEntryCenter(placed, meta);
  const canvasBox = await getCanvasBox(page);
  const pagePoint = worldToPage(placedState, canvasBox, center);
  await page.click('#editorToolList button[data-tool="select"]');
  await page.mouse.click(pagePoint.x, pagePoint.y);
  await page.keyboard.press('ArrowRight');

  state = await getEditorState(page);
  const nextRect = state.stage.viewRect;
  expect(nextRect).toEqual(initialRect);
});
