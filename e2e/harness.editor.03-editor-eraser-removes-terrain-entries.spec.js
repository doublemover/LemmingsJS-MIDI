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
