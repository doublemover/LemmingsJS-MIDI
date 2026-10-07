import { expect, test } from '@playwright/test';
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
