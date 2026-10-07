import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { waitForHarnessReady } from './helpers/harness.js';

test.use({ permissions: [] });
for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1909, height: 950 }, { width: 2560, height: 720 }]) {
  test(`compact studio keeps both rails and a clear map at ${size.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size); await installExternalAssetStubs(page);
    await page.goto('/?e2e=1'); await waitForHarnessReady(page);
    await page.evaluate(() => { window.__E2E__.pause(); window.__studioCanvas = document.querySelector('#gameCanvas'); });
    await expect(page.locator('#midiSequencerWorkspace')).toBeVisible();
    await expect(page.locator('#characterStatus')).toBeEmpty();
    await expect(page.locator('#characterShapeChoices [data-value=mixed]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('input[type=color]')).toHaveCount(0);
    await expect(page.locator('#savedLevelSave')).toBeHidden();
    const rectangles = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return { viewport: window.innerWidth, document: document.documentElement.scrollWidth, header: rect('#gameChrome'),
        level: rect('#levelIndexSelect'), previous: rect('#levelPrevButton'), next: rect('#levelNextButton'),
        left: rect('#studioLibrary'), game: rect('#gameCanvas'), editor: rect('#midiSequencerWorkspace'),
        listen: rect('#midiLocalListenButton'), volume: rect('#midiMasterVolume'), layout: rect('.midi-layout-choices') };
    });
    expect(rectangles.document).toBeLessThanOrEqual(rectangles.viewport);
    expect(rectangles.previous.left).toBeGreaterThanOrEqual(rectangles.level.right);
    expect(rectangles.previous.left - rectangles.level.right).toBeLessThan(15);
    expect(rectangles.next.left).toBeGreaterThan(rectangles.previous.left);
    for (const key of ['level', 'previous', 'next', 'listen', 'volume', 'layout']) {
      expect(rectangles[key].top).toBeGreaterThanOrEqual(rectangles.header.top);
      expect(rectangles[key].bottom).toBeLessThanOrEqual(rectangles.header.bottom + 1);
    }
    expect(rectangles.volume.left).toBeGreaterThan(rectangles.listen.right);
    expect(rectangles.volume.left - rectangles.listen.right).toBeLessThan(20);
    expect(rectangles.game.left).toBeGreaterThanOrEqual(rectangles.left.right);
    expect(rectangles.game.left - rectangles.left.right).toBeLessThanOrEqual(8);
    expect(rectangles.editor.width).toBeLessThanOrEqual(360);
    expect(rectangles.game.right).toBeLessThanOrEqual(rectangles.editor.left);
    expect(rectangles.game.width / rectangles.game.height).toBeCloseTo(800 / 480, 2);
    await page.screenshot({ path: testInfo.outputPath(`desktop-studio-${size.width}.png`), fullPage: true });
    for (const mode of ['Focus', 'Overlay', 'Split']) {
      await page.locator(`#midiLayout${mode}`).click();
      expect(await page.evaluate(() => window.__studioCanvas === document.querySelector('#gameCanvas'))).toBe(true);
    }
    await page.locator('#midiWorkspaceClose').click();
    await expect(page.locator('#midiWorkspaceToggle')).toBeFocused();
    await page.locator('#midiWorkspaceToggle').click();
    await expect(page.locator('#midiLayoutSplit')).toHaveAttribute('aria-pressed', 'true');
  });
}

test('visual selectors support repeated mixed/single/accessory changes without changing actor state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await installExternalAssetStubs(page);
  await page.goto('/?e2e=1'); await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  const tick = await page.locator('#midiGameClock').textContent();
  for (const shape of ['donut', 'circle', 'rounded_triangle', 'mixed']) {
    await page.locator(`#characterShapeChoices [data-value=${shape}]`).click();
    await expect(page.locator('#characterStatus')).not.toContainText('Preparing');
    await page.locator('#characterBodyPaletteChoices [data-value=random]').click();
    await page.locator('#characterAccessoryChoices [data-value=crown]').click();
    await page.locator('#characterEyewearChoices [data-value=monocle]').click();
    await expect(page.locator('#characterStatus')).not.toContainText('Preparing');
  }
  await expect(page.locator('#midiGameClock')).toHaveText(tick);
  await page.locator('#characterShapeChoices [data-value=mixed]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#characterShapeChoices [data-value=rounded_triangle]')).toBeFocused();
  await expect(page.locator('#characterShapeChoices [data-value=rounded_triangle]')).toHaveAttribute('aria-checked', 'true');
});

test('focused speed range preserves global Help and speed keys while native arrows use game detents', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await installExternalAssetStubs(page);
  await page.goto('/?e2e=1'); await waitForHarnessReady(page);
  await page.evaluate(() => { window.__E2E__.pause(); window.__E2E__.setSpeed(10); });
  const range = page.locator('#midiGameSpeed'), number = page.locator('#midiGameSpeedValue');
  await expect(number).toHaveValue('10'); await range.focus();
  await page.keyboard.press('ArrowRight'); await expect(number).toHaveValue('20');
  await page.keyboard.press('='); await expect(number).toHaveValue('21');
  await page.keyboard.press('-'); await expect(number).toHaveValue('20');
  await page.keyboard.press('F1'); await expect(page.locator('#shortcutOverlay')).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape'); await expect(range).toBeFocused();
  await page.evaluate(() => window.__E2E__.setSpeed(0.4));
  await expect(range).toHaveAttribute('aria-valuetext', '0.4 times game speed');
  await expect(number).toHaveValue('0.4');
});
