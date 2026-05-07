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

test('Editor built-in classic level can be edited, saved, reloaded, and exported', async ({ page }) => {
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

  const loaded = await getEditorState(page);
  const terrainId = loaded.editor.assets.terrain[0]?.id;
  expect(Number.isFinite(terrainId)).toBe(true);

  const editedTitle = 'Classic Edited E2E';
  const uniqueX = 137;
  const uniqueY = 93;
  const edited = await applyEditorOps(page, [
    { type: 'level.patchHeader', args: { set: { TITLE: editedTitle } } },
    { type: 'entry.add', args: { kind: 'terrain', props: { PIECE: terrainId, X: uniqueX, Y: uniqueY } } },
    { type: 'level.save', args: { name: 'classic-edited-e2e' } }
  ], { preview: { refresh: false }, returnState: 'editor' });
  expect(edited.ok).toBe(true);
  const saveResult = edited.results.find(result => result.type === 'level.save');
  const savedId = saveResult?.value?.savedId;
  expect(savedId).toBeTruthy();

  const reloaded = await applyEditorOps(page, [
    { type: 'level.patchHeader', args: { set: { TITLE: 'Unsaved Noise' } } },
    { type: 'level.loadSaved', args: { savedId, resetHistory: true } },
    { type: 'level.export', args: { format: 'classicLvl', filename: 'classic-edited-e2e.lvl' } }
  ], { preview: { refresh: false }, returnState: 'editor' });

  expect(reloaded.ok).toBe(true);
  expect(reloaded.state.session.level.header.TITLE).toBe(editedTitle);
  expect(reloaded.state.session.level.terrains.some(entry =>
    entry.props?.PIECE === terrainId
    && entry.props?.X === uniqueX
    && entry.props?.Y === uniqueY
  )).toBe(true);
  const exported = reloaded.resources.find(resource => resource.meta?.format === 'classicLvl');
  expect(exported?.encoding).toBe('base64');
  expect(exported?.data?.length || 0).toBeGreaterThan(0);
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
