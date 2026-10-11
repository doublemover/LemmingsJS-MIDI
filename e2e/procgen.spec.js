import { expect, test } from '@playwright/test';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS } from '../js/midi/project/ProcgenMidiDefaults.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
const expectBoundedTerrain = state => {
  const themes = state.terrainGeneration.themes;
  expect(themes.length).toBeGreaterThan(0);
  // Each source theme owns its atlas and bounded caches; the world shares them across lanes.
  for (const theme of themes) {
    expect(theme.memoryMB).toBeLessThan(8);
    expect(theme.cachedCollisionChunks).toBeLessThanOrEqual(theme.collisionLimit);
    expect(theme.cachedRasterChunks).toBeLessThanOrEqual(theme.rasterLimit);
    expect(theme.cachedDescriptions).toBeLessThanOrEqual(theme.descriptionLimit);
  }
};
const ready = async page => {
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.getState?.().terrainRecipe);
  await page.evaluate(() => window.__PROCGEN_LANES__.pause());
};

test('procgen hides controls by default and generates a single shared real-art world', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=8'); await ready(page);
  await expect(page.locator('#procgenTab')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('#procgenDrawer').evaluate(el => el.inert)).toBe(true);
  const initial = await page.evaluate(() => window.__PROCGEN_LANES__.getState());
  await page.evaluate(() => window.__PROCGEN_LANES__.step(240));
  const after = await page.evaluate(() => window.__PROCGEN_LANES__.getState());
  expect(after.lanes).toBe(8); expect(after.spawnedTotal).toBeGreaterThan(initial.spawnedTotal);
  expect(after.distance.max).toBeGreaterThan(initial.distance.max);
  await expect(page.locator('#procgenDistance')).toContainText(String(Math.floor(after.distance.max)));
  expect(after.terrainRecipe).toEqual(expect.any(String));
  expectBoundedTerrain(after);
  expect(await page.locator('canvas.gameCanvas').count()).toBe(1);
});

test('drawer keyboard/repeated controls keep stable appearance and expose local presets only', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=4'); await ready(page);
  await page.locator('#procgenTab').click();
  await expect(page.locator('#procgenPreset option')).toHaveCount(PROCGEN_GAME_EVENT_MIDI_PRESETS.length);
  await expect(page.locator('#characterShapeChoices [role=radio]')).toHaveCount(14);
  const getAppearance = () => page.evaluate(() => {
    const api = window.__PROCGEN_LANES__, sprites = api.world.gameResources.characterSprites;
    return api.world.actors.map(a => sprites.appearanceForActor(a));
  });
  await page.evaluate(() => window.__PROCGEN_LANES__.step(20));
  const original = await getAppearance();
  await page.keyboard.press('Escape'); await page.locator('#procgenTab').click();
  expect(await getAppearance()).toEqual(original);
  await page.locator('#procgenPreset').selectOption('game-lydian-lanterns');
  await expect(page.locator('#procgenPresetDescription')).not.toBeEmpty();
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#midiOutput, #midiInput, #midiStudio')).toHaveCount(0);
});

test('1024 lane count clamps and restarts without multiplying renderers', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2'); await ready(page);
  await page.locator('#procgenTab').click();
  await page.locator('#procgenLanes').fill('2048'); await page.locator('#procgenLanes').dispatchEvent('change');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.getState?.().lanes === 1024);
  await page.evaluate(() => { window.__PROCGEN_LANES__.pause(); window.__PROCGEN_LANES__.step(12); });
  const state = await page.evaluate(() => window.__PROCGEN_LANES__.getState());
  expect(state.alive).toBeGreaterThanOrEqual(1024); expectBoundedTerrain(state);
  expect(await page.locator('canvas.gameCanvas').count()).toBe(1);
  await expect(page.locator('#procgenLanes')).toHaveValue('1024');
});

test('musical span bundles keep several editors open and apply common edits durably', { tag: '@boundary' }, async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'lemmings.procgen.automation.v2';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 2, value: [] }));
  });
  await page.goto('/procgen.html?e2e=1&seed=span-edit&lanes=4'); await ready(page);
  await page.locator('#procgenTab').click();
  await page.locator('#procgenSpanFields > summary').click();
  await page.locator('#procgenSpanPresetApply').click();
  const rows = page.locator('#procgenSpanList .midi-span-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('details[open]')).toHaveCount(3);
  await expect(page.locator('.midi-span-batch strong')).toHaveText('3 selected');
  const length = page.getByRole('spinbutton', { name: 'Selected spans Length', exact: true });
  await length.fill('8'); await length.dispatchEvent('change');
  await expect(length).toBeFocused();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('lemmings.procgen.automation.v2')).value);
  expect((await stored()).map(entry => entry.span.duration)).toEqual([8, 8, 8]);
  const name = rows.first().locator('input[data-span-property=name]');
  await name.fill('Shared rise'); await name.dispatchEvent('change');
  await expect(rows.first().locator('input[data-span-property=name]')).toBeFocused();
  await expect(rows.locator('details[open]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Bypass selected', exact: true }).click();
  expect((await stored()).every(entry => !entry.enabled)).toBe(true);
  await page.reload(); await ready(page); await page.locator('#procgenTab').click();
  await page.locator('#procgenSpanFields > summary').click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator('input[data-span-property=name]')).toHaveValue('Shared rise');
  expect((await stored()).map(entry => entry.span.duration)).toEqual([8, 8, 8]);
  const beforeDrag = await stored(); await page.locator('#procgenSpanEdit').check(); await page.locator('#procgenTab').click();
  const point = await page.evaluate(() => {
    const api = window.__PROCGEN_LANES__; api.renderer.render();
    const rect = api.renderer.midiSpanOverlay.snapshot().rectangles[0], box = document.getElementById('gameCanvas').getBoundingClientRect();
    return { x: box.left + rect.x + 24, y: box.top + rect.y + Math.min(70, rect.height - 4) };
  });
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 35, point.y);
  expect(await page.locator('#gameCanvas').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(true);
  expect(await stored()).toEqual(beforeDrag);
  expect(await page.evaluate(() => { document.getElementById('procgenRestart').click(); return document.getElementById('gameCanvas').hasPointerCapture(1); })).toBe(false);
  await page.mouse.up(); await ready(page); expect(await stored()).toEqual(beforeDrag);
});

test('procgen selected MIDI destination connects explicitly, sends actual bytes and stops on disconnect', { tag: '@boundary' }, async ({ page }) => {
  await installWebMidiStub(page);
  await page.addInitScript(() => {
    const request = navigator.requestMIDIAccess; window.__procgenMidiRequests = 0; window.__procgenMidiBytes = [];
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async options => {
      window.__procgenMidiRequests++; const access = await request(options);
      for (const output of access.outputs.values()) output.send = bytes => window.__procgenMidiBytes.push([...bytes]);
      return access;
    } });
  });
  await page.goto('/procgen.html?e2e=1&seed=midi-output&lanes=4&output=midi'); await ready(page);
  await expect(page.locator('#procgenOutput')).toHaveValue('midi'); await expect(page.locator('#procgenListen')).toHaveText('Connect MIDI');
  expect(await page.evaluate(() => window.__procgenMidiRequests)).toBe(0); await expect(page.locator('#procgenMasterVolume')).toBeDisabled();
  await page.locator('#procgenListen').click(); await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#procgenMidiDevice')).toHaveValue('pw-output-1');
  await page.evaluate(() => window.__PROCGEN_LANES__.step(80));
  await expect.poll(() => page.evaluate(() => window.__procgenMidiBytes.filter(bytes => (bytes[0] & 240) === 144 && bytes[2] > 0).length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__procgenMidiRequests)).toBe(1);
  await page.locator('#procgenTab').click(); await expect(page.locator('#procgenAudioStatus')).toContainText('Playwright Output');
  await page.evaluate(() => window.__WEBMIDI_STUB__.disconnectOutput());
  await expect(page.locator('#procgenListen')).toHaveAttribute('aria-pressed', 'false'); await expect(page.locator('#procgenAudioStatus')).toContainText('disconnected');
  await page.locator('#procgenOutput').selectOption('synth'); await expect(page.locator('#procgenListen')).toHaveText('Listen locally');
  await expect(page.locator('#procgenMasterVolume')).toBeEnabled(); expect(await page.evaluate(() => window.__procgenMidiRequests)).toBe(1);
});


test('seed menu dismissal and Help preserve useful keyboard focus', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2'); await ready(page);
  const seed = page.locator('#procgenSeedControls');
  await seed.locator('summary').click(); await page.locator('#procgenSeed').focus();
  await page.keyboard.press('Escape');
  await expect(seed).not.toHaveAttribute('open', '');
  await expect(seed.locator('summary')).toBeFocused();
  await seed.locator('summary').click(); await page.locator('#procgenPause').click();
  await expect(seed).not.toHaveAttribute('open', '');
  await page.locator('#procgenHelp').click();
  await expect(page.locator('#procgenHelpFields > summary')).toBeFocused();
  await expect(page.locator('#procgenTab')).toHaveText('Close details');
  await page.keyboard.press('Escape');
  await expect(page.locator('#procgenTab')).toBeFocused();
  await expect(page.locator('#procgenTab')).toHaveText('Details +');
  expect(await page.locator('#procgenDrawer').evaluate(el => el.inert)).toBe(true);
});

for (const width of [390, 768, 1440]) {
  test('procgen primary controls fit a ' + width + 'px viewport', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/procgen.html?e2e=1&seed=42&lanes=2'); await ready(page);
    for (const id of ['procgenPause', 'procgenFollow', 'procgenListen', 'procgenLanes', 'procgenPack', 'procgenHelp', 'procgenTab']) {
      const box = await page.locator('#' + id).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(26);
    }
    const canvas = await page.locator('#gameCanvas').boundingBox();
    expect(canvas.height).toBeGreaterThan(500);
    await page.locator('#procgenTab').click();
    expect(await page.locator('#procgenDrawer').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('#procgenWorldGuide')).toBeVisible();
  });
}
