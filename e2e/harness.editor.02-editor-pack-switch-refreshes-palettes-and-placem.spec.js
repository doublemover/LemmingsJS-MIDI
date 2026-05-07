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
