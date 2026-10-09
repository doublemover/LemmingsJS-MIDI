import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { waitForHarnessReady } from './helpers/harness.js';

test.use({ permissions: [] });

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.addInitScript(() => {
    window.__midiPermissionCalls = 0;
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      window.__midiPermissionCalls += 1;
      throw new Error('Unexpected MIDI permission request');
    } });
  });
});

test('all layouts keep the identical live map canvas and musical undo keeps game time', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => { window.__E2E__.pause(); window.__originalGameCanvas = document.getElementById('gameCanvas'); });
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  await page.locator('[data-game-event-id="1"]').click();
  for (const layout of ['Focus', 'Split', 'Overlay', 'Split']) {
    await page.locator(`#midiLayout${layout}`).click();
    await expect(page.locator(`#midiLayout${layout}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#gameCanvas')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('gameCanvas') === window.__originalGameCanvas)).toBe(true);
    await expect(page.locator('#gameCanvas')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`workbench-${layout.toLowerCase()}.png`), fullPage: true });
  }
  const duration = page.locator('#midiSoundDurationNumber');
  const before = await duration.inputValue();
  await duration.fill(before === '7' ? '8' : '7'); await duration.dispatchEvent('change');
  await page.locator('#midiGameStep').click();
  const clock = await page.locator('#midiGameClock').textContent();
  await page.locator('#midiUndo').click();
  await expect(duration).toHaveValue(before);
  await expect(page.locator('#midiGameClock')).toHaveText(clock);
  await page.locator('#midiRedo').click();
  await expect(duration).toHaveValue(before === '7' ? '8' : '7');
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});

test('instrument menus support keyboard navigation, dismissal and repeated opening', async ({ page }) => {
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  const nav = page.locator('#midiInstrumentMenus');
  const menu = nav.locator('summary');
  await menu.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#midiMenuImport')).toBeFocused();
  await page.keyboard.press('End'); await expect(page.locator('#midiMenuSave')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  await expect(nav.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('#midiSequencerWorkspace')).toBeVisible();
  await menu.click(); await page.locator('#midiGameClock').click();
  await expect(nav.locator('details[open]')).toHaveCount(0);
  await menu.click(); await page.locator('#midiWorkspaceClose').click();
  await page.locator('#midiWorkspaceToggle').click();
  await expect(nav.locator('details[open]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});

test('character choices replace one accessory while retaining separate eyewear', async ({ page }, testInfo) => {
  await page.goto('/?e2e=1&midi=1');
  await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  await page.locator('#characterShapeChoices [data-value=donut]').click();
  const accessory = page.locator('#characterAccessory'), eyewear = page.locator('#characterEyewear');
  await expect(accessory).toBeEnabled();
  await page.locator('#characterEyewearChoices [data-value=monocle]').click();
  for (const choice of ['headphones', 'bow', 'crown', 'none', 'beret']) {
    await page.locator(`#characterAccessoryChoices [data-value=${choice}]`).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lemmings.character.appearance.v1')));
    expect(saved.accessory || 'beret').toBe(choice);
    expect(saved.eyewear).toBe('monocle');
    expect(saved.accessories).toBeUndefined();
    expect(saved.headwear).toBeUndefined();
    await expect(eyewear).toHaveValue('monocle');
  }
  await page.screenshot({ path: testInfo.outputPath('characters-single-accessory.png'), fullPage: true });
  await page.locator('#characterShapeChoices [data-value=classic]').click();
  await expect(accessory).toBeDisabled(); await expect(eyewear).toBeDisabled();
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});

test.describe('mobile workbench availability', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  test('mobile hides MIDI until explicit opt-in', async ({ page }) => {
    await page.goto('/?e2e=1'); await waitForHarnessReady(page);
    await expect(page.locator('#midiWorkspaceToggle')).toBeHidden();
    await expect(page.locator('#midiSequencerWorkspace')).toBeHidden();
    expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
    await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
    await expect(page.locator('#midiWorkspaceToggle')).toBeVisible();
    if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
    await expect(page.locator('#midiSequencerWorkspace')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#gameCanvas')).toBeVisible();
  });
});

test('every right-pane workspace keeps aligned direct Panic and close controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?e2e=1&midi=1'); await waitForHarnessReady(page);
  await page.evaluate(() => window.__E2E__.pause());
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
  for (const view of ['Sounds', 'Expert', 'Project', 'Devices']) {
    await page.locator(`#midiView${view}`).click();
    await expect(page.locator('#midiPanicButton')).toBeVisible(); await expect(page.locator('#midiWorkspaceClose')).toBeVisible();
    const bounds = await page.locator('#midiTransportStrip').evaluate(header => {
      const title = header.querySelector('#midiEditScope').getBoundingClientRect(), close = header.querySelector('#midiWorkspaceClose').getBoundingClientRect();
      return { titleCenter: title.top + title.height / 2, closeCenter: close.top + close.height / 2,
        titleRight: title.right, closeLeft: close.left, overflowing: header.scrollWidth > header.clientWidth + 1 };
    });
    expect(Math.abs(bounds.titleCenter - bounds.closeCenter)).toBeLessThan(2);
    expect(bounds.closeLeft).toBeGreaterThanOrEqual(bounds.titleRight); expect(bounds.overflowing).toBe(false);
    const tick = await page.locator('#midiGameClock').textContent(); await page.locator('#midiPanicButton').click();
    await expect(page.locator('#midiGameClock')).toHaveText(tick);
  }
  await page.locator('#midiViewSounds').click();
  await expect(page.locator('.midi-sound-secondary')).not.toHaveAttribute('open');
  await page.locator('.midi-sound-secondary > summary').click(); await expect(page.locator('#midiSoundSnapshot')).toBeVisible();
  await page.locator('.midi-sound-secondary > summary').click(); await expect(page.locator('#midiSoundSnapshot')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('midi-pane-titlebar-hierarchy.png'), fullPage: true });
  expect(await page.evaluate(() => window.__midiPermissionCalls)).toBe(0);
});
