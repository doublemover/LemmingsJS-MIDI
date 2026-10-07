import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { waitForHarnessReady } from './helpers/harness.js';

test.use({ hasTouch: true });

for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
  test(`game controls stay above the fold and arrows beside the level selector at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installExternalAssetStubs(page);
    await page.goto('/?e2e=1');
    await waitForHarnessReady(page);
    const measure = async () => page.evaluate(() => {
      const rect = selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      return {
        width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth,
        canvas: rect('#gameCanvas'), chrome: rect('#gameChrome'), level: rect('#levelIndexSelect'),
        controls: ['#gameTypeSelect', '#levelGroupSelect', '#levelIndexSelect', '#savedLevelSelect', '#savedLevelSave', '#savedLevelExport', '#savedLevelImport', '#midiWorkspaceToggle', '#levelPrevButton', '#levelNextButton'].map(rect),
        arrows: ['#levelPrevButton', '#levelNextButton'].map(rect)
      };
    });
    const check = async () => {
      await expect.poll(() => page.evaluate(() => {
        const slot = document.querySelector('.game-stage-slot');
        const canvas = document.querySelector('#gameCanvas').getBoundingClientRect();
        return Math.abs(canvas.width - Math.min(slot.clientWidth, slot.clientHeight * 800 / 480));
      })).toBeLessThan(1);
      const layout = await measure();
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
      expect(layout.canvas.y).toBeGreaterThanOrEqual(layout.chrome.bottom - 1);
      expect(layout.canvas.bottom).toBeLessThanOrEqual(layout.height + 1);
      expect(layout.canvas.width / layout.canvas.height).toBeCloseTo(800 / 480, 2);
      for (const rect of layout.controls) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(layout.width + 1);
        expect(rect.bottom).toBeLessThanOrEqual(layout.height + 1);
      }
      for (const arrow of layout.arrows) {
        expect(arrow.x).toBeGreaterThanOrEqual(layout.level.right);
        expect(arrow.y).toBeGreaterThanOrEqual(layout.chrome.y);
        expect(arrow.bottom).toBeLessThanOrEqual(layout.chrome.bottom + 1);
        expect(arrow.width).toBeGreaterThanOrEqual(27);
        expect(arrow.height).toBeGreaterThanOrEqual(27);
      }
    };
    await check();
    for (let i = 0; i < 2; i += 1) {
      if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
      await expect(page.locator('#midiExpertView')).toBeHidden();
      await expect(page.locator('#midiSoundsView')).toBeVisible();
      await page.locator('#midiWorkspaceClose').click();
      await expect(page.locator('#midiWorkspaceToggle')).toBeFocused();
    }
    await page.setViewportSize({ width: size.height, height: size.width });
    await check();
  });
}
