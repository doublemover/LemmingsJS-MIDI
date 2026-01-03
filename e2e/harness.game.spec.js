import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { decodeE2EBuffer } from './helpers/e2eState.js';
import { clearLocalStorage, waitForHarnessReady } from './helpers/harness.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await clearLocalStorage(page);
  await page.goto('/?e2e=1');
  await waitForHarnessReady(page);
});

const snapshotInvariantState = (state) => {
  const game = state.game;
  const lemmings = Array.isArray(game.lemmings)
    ? game.lemmings.filter(Boolean).map(lem => ({ ...lem })).sort((a, b) => a.id - b.id)
    : [];
  const triggers = game.triggers?.entries?.length
    ? game.triggers.entries.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    : [];
  const objects = game.objects?.entries?.length
    ? game.objects.entries.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    : [];
  return {
    timer: game.timer ? { tickIndex: game.timer.tickIndex, speedFactor: game.timer.speedFactor } : null,
    victory: game.victory ? { ...game.victory } : null,
    skills: game.skills ? { ...game.skills } : null,
    lemmingManager: game.lemmingManager ? { ...game.lemmingManager } : null,
    lemmings,
    triggers: game.triggers ? { ...game.triggers, entries: triggers } : null,
    objects: game.objects ? { ...game.objects, entries: objects } : null,
    minimap: game.minimap ? { ...game.minimap } : null,
    commandManager: game.commandManager ? { ...game.commandManager } : null,
    soundEvents: game.soundEvents ? { queuedCount: game.soundEvents.queuedCount ?? 0 } : null
  };
};

test('Harness exposes state and can step/seek', async ({ page }) => {
  await page.evaluate(() => window.__E2E__.pause());
  await page.evaluate(() => window.__E2E__.flushSoundEvents());
  const tickBefore = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  await page.evaluate(() => window.__E2E__.step(2));
  const tickAfter = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  expect(tickAfter).toBe(tickBefore + 2);

  await page.evaluate((target) => window.__E2E__.seek(target), tickBefore);
  const tickSeek = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  expect(tickSeek).toBe(tickBefore);

  const state = await page.evaluate(() => window.__E2E__.getState());
  expect(state.version).toBe(1);
  expect(state.mode).toBe('game');
  expect(state.view).toBeTruthy();
  expect(state.game).toBeTruthy();
  expect(state.view.includeSavedLevels).toBe(true);
  expect(state.stage.viewRect).toBeTruthy();
  expect(state.stage.viewRect.w).toBeGreaterThan(0);
  expect(state.stage.viewRect.h).toBeGreaterThan(0);
  expect(state.game.timer.running).toBe(false);
  expect(state.game.lemmings.length).toBe(state.game.lemmingManager.totalCount);
  expect(state.game.triggers.entries.length).toBe(state.game.triggers.totalCount);
  expect(state.game.objects.entries.length).toBe(state.game.objects.count);
  expect(state.midi.enabled).toBe(state.view.midiEnabled);
});

test('Time travel restores invariant state', async ({ page }) => {
  await page.evaluate(() => window.__E2E__.pause());
  await page.evaluate(() => window.__E2E__.flushSoundEvents());
  await page.evaluate(() => window.__E2E__.step(6));
  await page.waitForFunction(() => {
    const history = window.__E2E__?.getState?.().game?.history;
    return history && history.maxTick >= 5;
  });
  const baselineState = await page.evaluate(() => window.__E2E__.getState());
  const baselineTick = baselineState.game.timer.tickIndex;
  const baselineSnapshot = snapshotInvariantState(baselineState);

  await page.evaluate(() => window.__E2E__.step(4));
  await page.evaluate((tick) => window.__E2E__.seek(tick), baselineTick);
  await page.evaluate(() => window.__E2E__.flushSoundEvents());
  const restoredState = await page.evaluate(() => window.__E2E__.getState());
  const restoredSnapshot = snapshotInvariantState(restoredState);
  expect(restoredSnapshot).toEqual(baselineSnapshot);
});

test('Reverse playback toggles and rewinds ticks', async ({ page }) => {
  await page.evaluate(() => window.__E2E__.pause());
  await page.evaluate(() => window.__E2E__.step(10));
  const tickBefore = await page.evaluate(() => window.__E2E__.getState().game.timer.tickIndex);
  await page.evaluate(() => window.__E2E__.startReverse());
  await page.waitForFunction(() => window.__E2E__.getState().game.timeTravel.isReversing === true);
  await page.waitForFunction((startTick) => {
    const tick = window.__E2E__.getState().game.timer.tickIndex;
    return tick < startTick;
  }, tickBefore);
  const reversingState = await page.evaluate(() => window.__E2E__.getState());
  expect(reversingState.game.timeTravel.playbackDirection).toBe(-1);
  await page.evaluate(() => window.__E2E__.stopReverse());
  await page.waitForFunction(() => window.__E2E__.getState().game.timeTravel.isReversing === false);
});

test('Harness returns buffers with decodable metadata', async ({ page }) => {
  const groundMask = await page.evaluate(() => window.__E2E__.getBuffer('ground-mask'));
  expect(groundMask).toBeTruthy();
  const decodedMask = decodeE2EBuffer(groundMask);
  expect(decodedMask.format).toBe('mask8');
  expect(decodedMask.width).toBeGreaterThan(0);
  expect(decodedMask.height).toBeGreaterThan(0);
  expect(decodedMask.array.length).toBe(decodedMask.width * decodedMask.height);

  const minimapTerrain = await page.evaluate(() => window.__E2E__.getBuffer('minimap-terrain'));
  expect(minimapTerrain).toBeTruthy();
  const decodedMinimap = decodeE2EBuffer(minimapTerrain);
  expect(decodedMinimap.format).toBe('u8');
  expect(decodedMinimap.array.length).toBe(decodedMinimap.width * decodedMinimap.height);

  const unknownBuffer = await page.evaluate(() => window.__E2E__.getBuffer('missing-buffer'));
  expect(unknownBuffer).toBeNull();
});
