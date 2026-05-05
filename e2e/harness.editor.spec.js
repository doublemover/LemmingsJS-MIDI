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
const applyEditorOps = (page, ops, options = {}) => page.evaluate(
  ({ ops, options }) => window.__E2E__.editorApply(ops, options),
  { ops, options }
);

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

const getWorldPointFromPage = async (page, point) => {
  return page.evaluate(({ x, y }) => {
    return window.__E2E__?.stageWorldFromPage?.({ x, y }) || null;
  }, { x: point.x, y: point.y });
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
  return page.evaluate((worldPoint) => {
    return window.__E2E__?.stagePageFromWorld?.(worldPoint) || null;
  }, point);
};

const centerViewportOn = async (page, point) => {
  await page.evaluate((targetPoint) => {
    window.__E2E__?.centerStageOn?.(targetPoint);
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
  expect(state.game.inputEnabled).toBe(false);

  await page.click('#editorPlaytestToggle');
  await page.waitForFunction(() => {
    const next = window.__E2E__.getState();
    return next.editor.playtest === true && next.game.timer.running === true;
  });
  state = await getEditorState(page);
  expect(state.stage.panEnabled).toBe(true);
  expect(state.game.inputEnabled).toBe(true);

  await page.click('#editorPlaytestToggle');
  await page.waitForFunction(() => {
    const next = window.__E2E__.getState();
    return next.editor.playtest === false && next.game.timer.running === false;
  });
  state = await getEditorState(page);
  expect(state.stage.panEnabled).toBe(false);
  expect(state.game.inputEnabled).toBe(false);
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

test('Editor new level seeds entrance and exit', async ({ page }) => {
  await page.click('#editorNewLevel');
  await page.waitForFunction(() => {
    const state = window.__E2E__?.getState?.();
    return (state?.editor?.session?.level?.gadgets?.length || 0) >= 1;
  });
  const state = await getEditorState(page);
  const entranceId = state.editor.assets.entranceId;
  const exitId = state.editor.assets.exitId;
  const gadgets = state.editor.session.level.gadgets || [];
  const entrance = gadgets.find(entry => entry?.props?.PIECE === entranceId);
  const exit = gadgets.find(entry => entry?.props?.PIECE === exitId);
  expect(entrance).toBeTruthy();
  expect(exit).toBeTruthy();

  const viewRect = state.stage.viewRect;
  const entranceX = entrance?.props?.X ?? 0;
  const exitX = exit?.props?.X ?? 0;
  expect(entranceX).toBeGreaterThanOrEqual(viewRect.x);
  expect(entranceX).toBeLessThanOrEqual(viewRect.x + viewRect.w);
  expect(exitX).toBeGreaterThanOrEqual(viewRect.x);
  expect(exitX).toBeLessThanOrEqual(viewRect.x + viewRect.w);
});

test('Editor tool.place uses centered terrain placement', async ({ page }) => {
  const before = await getEditorState(page);
  const terrainId = before.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);

  const clickRatio = { x: 0.25, y: 0.35 };
  const worldClick = getWorldPointFromRatio(before, clickRatio.x, clickRatio.y);

  const result = await applyEditorOps(page, [
    {
      type: 'tool.place',
      args: {
        tool: 'terrain',
        pieceId: terrainId,
        x: worldClick.x,
        y: worldClick.y
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(result.ok).toBe(true);
  const after = result.state;
  const terrains = after.session.level.terrains;
  const placed = terrains[terrains.length - 1];
  expect(placed.props.PIECE).toBe(Number(terrainId));
  const terrainMeta = after.assets.terrain.find(item => item.id === terrainId);
  const offsetX = terrainMeta?.width ? Math.floor(terrainMeta.width / 2) : 0;
  const offsetY = terrainMeta?.height ? Math.floor(terrainMeta.height / 2) : 0;
  const snappedX = snapWorldValue(worldClick.x, after.controller.gridSize, after.controller.snapEnabled);
  const snappedY = snapWorldValue(worldClick.y, after.controller.gridSize, after.controller.snapEnabled);
  expect(placed.props.X).toBe(snappedX - offsetX);
  expect(placed.props.Y).toBe(snappedY - offsetY);
});

test('Editor layer order buttons reorder selection', async ({ page }) => {
  const state = await getEditorState(page);
  const terrainId = state.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);
  const result = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 10, Y: 10 } } },
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 30, Y: 10 } } },
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: 0 }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });
  expect(result.ok).toBe(true);

  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 1;
  });

  const beforeIndex = await page.evaluate(
    () => window.__E2E__.getState().editor.controller.selectionEntries[0].index
  );
  await page.click('#editorSelectionMoveForward');
  const afterIndex = await page.evaluate(
    () => window.__E2E__.getState().editor.controller.selectionEntries[0].index
  );
  expect(afterIndex).toBe(beforeIndex + 1);
});

test('Editor gadget and trigger placement use centered tool placement', async ({ page }) => {
  let state = await getEditorState(page);
  const gadgetId = state.editor.assets.gadgets[0]?.id;
  expect(Number.isFinite(gadgetId)).toBe(true);

  const gadgetClick = { x: 64, y: 64 };
  let result = await applyEditorOps(page, [
    {
      type: 'tool.place',
      args: {
        tool: 'gadget',
        pieceId: gadgetId,
        x: gadgetClick.x,
        y: gadgetClick.y
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(result.ok).toBe(true);
  state = result.state;
  let gadgets = state.session.level.gadgets;
  let placed = gadgets[gadgets.length - 1];
  expect(placed.props.PIECE).toBe(Number(gadgetId));
  const gadgetMeta = state.assets.gadgets.find(item => item.id === gadgetId);
  const offsetX = gadgetMeta?.width ? Math.floor(gadgetMeta.width / 2) : 0;
  const offsetY = gadgetMeta?.height ? Math.floor(gadgetMeta.height / 2) : 0;
  const snappedX = snapWorldValue(gadgetClick.x, state.controller.gridSize, state.controller.snapEnabled);
  const snappedY = snapWorldValue(gadgetClick.y, state.controller.gridSize, state.controller.snapEnabled);
  expect(placed.props.X).toBe(snappedX - offsetX);
  expect(placed.props.Y).toBe(snappedY - offsetY);

  const triggerId = state.assets.triggers[0]?.id;
  expect(Number.isFinite(triggerId)).toBe(true);
  const triggerClick = { x: 96, y: 96 };
  result = await applyEditorOps(page, [
    {
      type: 'tool.place',
      args: {
        tool: 'trigger',
        pieceId: triggerId,
        x: triggerClick.x,
        y: triggerClick.y
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(result.ok).toBe(true);
  state = result.state;
  gadgets = state.session.level.gadgets;
  placed = gadgets[gadgets.length - 1];
  expect(placed.props.PIECE).toBe(Number(triggerId));
  const triggerMeta = state.assets.gadgets.find(item => item.id === triggerId);
  const triggerOffsetX = triggerMeta?.width ? Math.floor(triggerMeta.width / 2) : 0;
  const triggerOffsetY = triggerMeta?.height ? Math.floor(triggerMeta.height / 2) : 0;
  const triggerX = snapWorldValue(triggerClick.x, state.controller.gridSize, state.controller.snapEnabled);
  const triggerY = snapWorldValue(triggerClick.y, state.controller.gridSize, state.controller.snapEnabled);
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

  const clickPoint = getWorldPointFromRatio(nextState, 0.2, 0.3);
  const result = await applyEditorOps(page, [
    {
      type: 'tool.place',
      args: {
        tool: 'terrain',
        pieceId: firstTerrain.id,
        x: clickPoint.x,
        y: clickPoint.y
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(result.ok).toBe(true);
  const placed = result.state.session.level.terrains.slice(-1)[0];
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
  await page.evaluate(({ x, y, scale }) => {
    window.__E2E__?.centerStageOn?.({ x, y, scale });
  }, { x: targetX + viewRect.w / 2, y: viewRect.y + viewRect.h / 2, scale });

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
  const before = await getEditorState(page);
  const terrainId = before.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);

  const clickPoint = getWorldPointFromRatio(before, 0.3, 0.55);
  const placeResult = await applyEditorOps(page, [
    {
      type: 'tool.place',
      args: {
        tool: 'terrain',
        pieceId: terrainId,
        x: clickPoint.x,
        y: clickPoint.y
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const placedIndex = placeResult.state.session.level.terrains.length - 1;
  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: placedIndex }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

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
  const before = await getEditorState(page);
  const terrainBefore = before.editor.session.level.terrains.length;
  const brushStart = getWorldPointFromRatio(before, 0.2, 0.3);
  const brushEnd = getWorldPointFromRatio(before, 0.35, 0.4);
  const brushResult = await applyEditorOps(page, [
    { type: 'editor.setBrushSettings', args: { brushSize: 2 } },
    {
      type: 'tool.stroke',
      args: {
        tool: 'brush',
        points: [brushStart, brushEnd]
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(brushResult.ok).toBe(true);
  const terrainAfter = brushResult.state.session.level.terrains.length;
  expect(terrainAfter).toBeGreaterThan(terrainBefore + 1);

  const steelBefore = brushResult.state.session.level.steel.length;
  const steelRect = {
    x: Math.round(brushStart.x + 40),
    y: Math.round(brushStart.y + 20),
    width: 12,
    height: 12
  };
  const steelResult = await applyEditorOps(page, [
    { type: 'tool.steelRect', args: { rects: [steelRect] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(steelResult.ok).toBe(true);
  const steel = steelResult.state.session.level.steel;
  expect(steel.length).toBeGreaterThan(steelBefore);
  const placed = steel[steel.length - 1];
  expect(placed.props.WIDTH).toBeGreaterThan(1);
  expect(placed.props.HEIGHT).toBeGreaterThan(1);
});

test('Editor brush respects grid size snapping', async ({ page }) => {
  const before = await getEditorState(page);
  const clickPoint = getWorldPointFromRatio(before, 0.22, 0.32);
  const result = await applyEditorOps(page, [
    { type: 'editor.setBrushSettings', args: { gridSize: 8, snapEnabled: true, brushSize: 1 } },
    { type: 'tool.stroke', args: { tool: 'brush', points: [clickPoint] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(result.ok).toBe(true);
  const placed = result.state.session.level.terrains[result.state.session.level.terrains.length - 1];
  const meta = result.state.assets.terrain.find(item => item.id === placed.props.PIECE);
  const offsetX = meta?.width ? Math.floor(meta.width / 2) : 0;
  const offsetY = meta?.height ? Math.floor(meta.height / 2) : 0;
  expect((placed.props.X + offsetX) % 8).toBe(0);
  expect((placed.props.Y + offsetY) % 8).toBe(0);
});

test('Editor eraser removes terrain entries', async ({ page }) => {
  const before = await getEditorState(page);
  const clickPoint = getWorldPointFromRatio(before, 0.25, 0.4);
  const placeResult = await applyEditorOps(page, [
    {
      type: 'tool.place',
      args: {
        tool: 'terrain',
        pieceId: before.editor.assets.terrain[0]?.id,
        x: clickPoint.x,
        y: clickPoint.y
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const afterCount = placeResult.state.session.level.terrains.length;

  const eraseResult = await applyEditorOps(page, [
    { type: 'tool.erase', args: { points: [clickPoint] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(eraseResult.ok).toBe(true);
  expect(eraseResult.state.session.level.terrains.length).toBeLessThan(afterCount);
});

test('Editor exports and imports classic levels via editor.apply', async ({ page }) => {
  const exportResult = await applyEditorOps(page, [
    { type: 'level.export', args: { format: 'classicLvl', filename: 'e2e.lvl' } }
  ], { preview: { refresh: false } });

  expect(exportResult.ok).toBe(true);
  const resource = exportResult.resources?.[0];
  expect(resource?.data).toBeTruthy();

  const importResult = await applyEditorOps(page, [
    {
      type: 'level.importClassicLvl',
      args: {
        bytesBase64: resource.data,
        resetHistory: true,
        sourceLabel: 'Import LVL'
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(importResult.ok).toBe(true);
  const entries = importResult.state.history?.entries || [];
  expect(entries[entries.length - 1]?.label).toBe('Import LVL');
});

test('Editor selection workflows support multi-select, nudge, and delete', async ({ page }) => {
  const before = await getEditorState(page);
  const terrainId = before.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);

  const placeResult = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 12, Y: 12 } } },
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 24, Y: 12 } } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const terrainBefore = placeResult.state.session.level.terrains.length;
  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [
      { kind: 'terrain', index: terrainBefore - 2 },
      { kind: 'terrain', index: terrainBefore - 1 }
    ] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  await page.waitForFunction(() => {
    return window.__E2E__.getState().editor.controller.selectionEntries.length === 2;
  });

  let state = await getEditorState(page);
  const entriesBefore = state.editor.controller.selectionEntries.map((entry) => ({
    x: entry.entry.props.X,
    y: entry.entry.props.Y
  }));

  await page.keyboard.press('ArrowRight');

  await page.waitForFunction((beforeEntries) => {
    const entries = window.__E2E__.getState().editor.controller.selectionEntries;
    if (entries.length !== 2) return false;
    return entries.every((entry, idx) => entry.entry.props.X === beforeEntries[idx].x + 1);
  }, entriesBefore);

  await page.keyboard.press('Delete');
  await page.waitForFunction((count) => {
    return window.__E2E__.getState().editor.session.level.terrains.length === count - 2;
  }, terrainBefore);
});

test('Editor snap-to-grid aligns selection to grid size', async ({ page }) => {
  const before = await getEditorState(page);
  const terrainId = before.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);
  const placeResult = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 16, Y: 16 } } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const placedIndex = placeResult.state.session.level.terrains.length - 1;
  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: placedIndex }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

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

  const grid = 8;
  await applyEditorOps(page, [
    { type: 'editor.setBrushSettings', args: { gridSize: grid, snapEnabled: true } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  const snappedX = Math.round(3 / grid) * grid;
  const snappedY = Math.round(5 / grid) * grid;
  await applyEditorOps(page, [
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'terrain', index: placedIndex },
        set: { X: snappedX, Y: snappedY }
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  await page.waitForFunction(({ x, y }) => {
    const entry = window.__E2E__.getState().editor.controller.selectionEntries[0];
    return entry && entry.entry.props.X === x && entry.entry.props.Y === y;
  }, { x: snappedX, y: snappedY });
});

test('Editor copy/paste/duplicate and undo/redo update terrain counts', async ({ page }) => {
  const before = await getEditorState(page);
  const terrainId = before.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);
  const placeResult = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 16, Y: 16 } } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const placedIndex = placeResult.state.session.level.terrains.length - 1;
  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: placedIndex }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });

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

test('Editor entry.update adjusts steel position and size', async ({ page }) => {
  const before = await getEditorState(page);
  const placeResult = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'steel', props: { X: 40, Y: 40, WIDTH: 12, HEIGHT: 12 } } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const steelIndex = placeResult.state.session.level.steel.length - 1;
  const beforeEntry = placeResult.state.session.level.steel[steelIndex];
  const updateResult = await applyEditorOps(page, [
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'steel', index: steelIndex },
        set: {
          X: beforeEntry.props.X + 4,
          Y: beforeEntry.props.Y + 3,
          WIDTH: beforeEntry.props.WIDTH + 4,
          HEIGHT: beforeEntry.props.HEIGHT + 5
        }
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(updateResult.ok).toBe(true);
  const updated = updateResult.state.session.level.steel[steelIndex];
  expect(updated.props.X).toBe(beforeEntry.props.X + 4);
  expect(updated.props.Y).toBe(beforeEntry.props.Y + 3);
  expect(updated.props.WIDTH).toBe(beforeEntry.props.WIDTH + 4);
  expect(updated.props.HEIGHT).toBe(beforeEntry.props.HEIGHT + 5);
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

test('Editor entry.update writes gadget width and height props', async ({ page }) => {
  const before = await getEditorState(page);
  const gadgetId = before.editor.assets.gadgets[0]?.id;
  expect(Number.isFinite(gadgetId)).toBe(true);
  const placeResult = await applyEditorOps(page, [
    { type: 'entry.add', args: { kind: 'gadget', props: { PIECE: gadgetId, X: 32, Y: 32 } } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const gadgetIndex = placeResult.state.session.level.gadgets.length - 1;
  const beforeEntry = placeResult.state.session.level.gadgets[gadgetIndex];
  const updateResult = await applyEditorOps(page, [
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'gadget', index: gadgetIndex },
        set: {
          WIDTH: (beforeEntry.props.WIDTH || 8) + 6,
          HEIGHT: (beforeEntry.props.HEIGHT || 8) + 4
        }
      }
    }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(updateResult.ok).toBe(true);
  const updated = updateResult.state.session.level.gadgets[gadgetIndex];
  expect(updated.props.WIDTH).toBeGreaterThan(0);
  expect(updated.props.HEIGHT).toBeGreaterThan(0);
});

test('Editor view stays stable during edit actions', async ({ page }) => {
  let state = await getEditorState(page);
  const initialRect = state.stage.viewRect;
  expect(initialRect).toBeTruthy();
  const terrainId = state.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);
  const clickPoint = getWorldPointFromRatio(state, 0.3, 0.35);
  const placeResult = await applyEditorOps(page, [
    { type: 'tool.place', args: { tool: 'terrain', pieceId: terrainId, x: clickPoint.x, y: clickPoint.y } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(placeResult.ok).toBe(true);
  const placedIndex = placeResult.state.session.level.terrains.length - 1;
  await applyEditorOps(page, [
    { type: 'selection.set', args: { selection: [{ kind: 'terrain', index: placedIndex }] } }
  ], { preview: { refresh: false }, returnState: 'editor' });
  await page.keyboard.press('ArrowRight');

  state = await getEditorState(page);
  const nextRect = state.stage.viewRect;
  expect(nextRect).toEqual(initialRect);
});

test('Editor apply API supports entry edits and exports', async ({ page }) => {
  const result = await page.evaluate(() => {
    const state = window.__E2E__.getState();
    const terrainId = state.editor.assets.terrain[0]?.id ?? 0;
    return window.__E2E__.editorApply([
      { type: 'level.new', args: { header: { TITLE: 'E2E Apply', STYLE: 'dirt' } } },
      { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: 64, Y: 64 } } },
      { type: 'level.export', args: { format: 'nxlv', filename: 'apply-test.nxlv' } }
    ], { preview: { refresh: false }, returnState: 'editor' });
  });

  expect(result.ok).toBe(true);
  expect(Array.isArray(result.results)).toBe(true);
  expect(result.resources?.length || 0).toBeGreaterThan(0);
  expect(result.state?.session?.level?.terrains?.length || 0).toBeGreaterThan(0);
  const entry = result.state?.session?.level?.terrains?.[0];
  expect(entry?.uid).toBeTruthy();
});

test('Editor MIDI flag triggers survive playtest seek and reverse replay', async ({ page }) => {
  const editorState = await getEditorState(page);
  const gadgetId = editorState.editor.assets.gadgets[0]?.id;
  expect(Number.isFinite(gadgetId)).toBe(true);

  const setup = await applyEditorOps(page, [
    { type: 'level.new', args: { header: { TITLE: 'MIDI Flag Replay', STYLE: 'dirt' } } },
    {
      type: 'entry.add',
      args: {
        kind: 'gadget',
        insert: { index: 0 },
        props: { PIECE: gadgetId, X: 96, Y: 80 }
      }
    },
    {
      type: 'entry.update',
      args: {
        ref: { kind: 'gadget', index: 0 },
        set: {
          MIDI_FLAG: true,
          MIDI_FLAG_ID: 2,
          MIDI_FLAG_COOLDOWN: 3
        }
      }
    }
  ], {
    history: { record: false },
    preview: { refresh: true, preserveViewport: true },
    validate: { run: false },
    returnState: 'full'
  });
  expect(setup.ok).toBe(true);

  await page.evaluate(() => window.__E2E__.setEditorPlaytest(true));
  await page.evaluate(() => window.__E2E__.pause());
  await page.waitForFunction(() => {
    const triggers = window.__E2E__.getState().game?.triggers?.entries || [];
    return triggers.some(trigger => trigger.ownerKind === 'midi_flag' && trigger.ownerData?.midiFlagId === 2);
  });

  const baseline = await page.evaluate(() => {
    const state = window.__E2E__.getState();
    const trigger = state.game.triggers.entries.find(entry =>
      entry.ownerKind === 'midi_flag' && entry.ownerData?.midiFlagId === 2
    );
    return {
      tick: state.game.timer.tickIndex,
      trigger
    };
  });
  expect(baseline.trigger?.ownerId).toContain('midi_flag_2');
  expect(baseline.trigger?.ownerData?.triggerType).toBeGreaterThan(1000);

  await page.evaluate(() => window.__E2E__.step(8));
  await page.evaluate((tick) => window.__E2E__.seek(tick), baseline.tick);
  const restored = await page.evaluate(() => {
    const state = window.__E2E__.getState();
    return state.game.triggers.entries.find(entry =>
      entry.ownerKind === 'midi_flag' && entry.ownerData?.midiFlagId === 2
    );
  });
  expect(restored).toEqual(baseline.trigger);

  await page.evaluate(() => window.__E2E__.step(10));
  const tickBeforeReverse = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  await page.evaluate(() => window.__E2E__.startReverse());
  await page.waitForFunction((startTick) => {
    return window.__E2E__.getState().game.timer.tickIndex < startTick;
  }, tickBeforeReverse);
  await page.evaluate(() => window.__E2E__.stopReverse());
  const afterReverse = await page.evaluate(() => {
    const state = window.__E2E__.getState();
    return state.game.triggers.entries.find(entry =>
      entry.ownerKind === 'midi_flag' && entry.ownerData?.midiFlagId === 2
    );
  });
  expect(afterReverse?.ownerData).toEqual(baseline.trigger.ownerData);
});
