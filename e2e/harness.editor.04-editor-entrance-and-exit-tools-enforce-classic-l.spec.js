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
