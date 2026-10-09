import { expect, test } from '@playwright/test';
import { installWebMidiStub } from './helpers/webmidiStub.js';
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
  expect(after.terrainRecipe).toEqual(expect.any(String));
  expect(after.recipeMemoryMB).toBeLessThan(4);
  expect(await page.locator('canvas').count()).toBe(1);
});

test('drawer keyboard/repeated controls keep stable appearance and expose local presets only', async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=4'); await ready(page);
  await page.locator('#procgenTab').click();
  await expect(page.locator('#procgenPreset option')).toHaveCount(15);
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
  expect(state.alive).toBeGreaterThanOrEqual(1024); expect(state.recipeMemoryMB).toBeLessThan(4);
  expect(await page.locator('canvas').count()).toBe(1);
  await expect(page.locator('#procgenLanes')).toHaveValue('1024');
});

test('musical span bundles keep several editors open and apply common edits durably', async ({ page }) => {
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
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('lemmings.procgen.automationSpans.v1')).value);
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

test('procgen selected MIDI destination connects explicitly, sends actual bytes and stops on disconnect', async ({ page }) => {
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
