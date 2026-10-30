import { expect, test } from '@playwright/test';

test('deferred creative tools honor Escape and module failure without replacing the desktop performance', { tag: '@boundary' }, async ({ page }) => {
  test.setTimeout(90000); let release, entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/js/app/midi-ui/ShapeFoundryView.js', async route => { entered(); await held; await route.continue(); });
  await page.addInitScript(() => {
    window.lazyToolAudioContexts = 0; const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.lazyToolAudioContexts++; super(options); } };
  });
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain);
  await page.evaluate(() => {
    const studio = window.__PROCGEN_STUDIO__; studio.transport.pause();
    window.lazyToolWorld = window.__PROCGEN_LANES__.world; window.lazyToolProject = JSON.stringify(studio.getProject());
    window.lazyToolRequest = studio.handlers.openShapeFoundry();
  });
  await arrived; await page.keyboard.press('Escape'); release();
  expect(await page.evaluate(() => window.lazyToolRequest)).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Original shape body authoring' })).toHaveCount(0);
  await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.openShapeFoundry());
  const foundry = page.getByRole('dialog', { name: 'Original shape body authoring' }); await expect(foundry).toBeVisible();
  await foundry.getByRole('button', { name: 'Close', exact: true }).click(); await expect(foundry).not.toBeVisible();
  let releaseSkin, skinArrived;
  const skinReady = new Promise(resolve => { skinArrived = resolve; }), skinHeld = new Promise(resolve => { releaseSkin = resolve; });
  await page.route('**/js/app/midi-ui/RectangularMembraneView.js', async route => { skinArrived(); await skinHeld; await route.continue(); });
  await page.evaluate(() => { window.lazySkinRequest = window.__PROCGEN_STUDIO__.handlers.openRectangularMembrane(); });
  await skinReady; await page.locator('#gameCanvas').click({ position: { x: 1, y: 1 } }); releaseSkin();
  expect(await page.evaluate(() => window.lazySkinRequest)).toBe(false);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.route('**/js/app/midi-ui/CrossExcitationView.js', route => route.abort('failed'));
  expect(await page.evaluate(() => window.__PROCGEN_STUDIO__.handlers.openCrossExcitation())).toBe(false);
  await expect(page.locator('.studio-status')).toContainText('Cross excitation could not open');
  expect(await page.evaluate(() => ({ sameWorld: window.lazyToolWorld === window.__PROCGEN_LANES__.world,
    sameProject: window.lazyToolProject === JSON.stringify(window.__PROCGEN_STUDIO__.getProject()),
    output: window.__PROCGEN_STUDIO__.getPlaybackState().enabled, audioContexts: window.lazyToolAudioContexts })))
    .toEqual({ sameWorld: true, sameProject: true, output: false, audioContexts: 0 });
});
