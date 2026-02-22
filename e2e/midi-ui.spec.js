import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
});

test('MIDI UI starts disabled and hides panels', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#midiEnabledToggle');
  await expect(page.locator('body')).toHaveClass(/midi-disabled/);
  await expect(page.locator('#midiEnabledToggle')).not.toBeChecked();
  await expect(page.locator('#controlRight')).toBeHidden();
});

test('Enabling MIDI reveals panels and inputs', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#midiEnabledToggle');
  await toggle.check();
  await expect(page.locator('body')).not.toHaveClass(/midi-disabled/);
  await expect(page.locator('#controlRight')).toBeVisible();
  const inputState = await page.evaluate(() => {
    const input = document.getElementById('midiInSelect');
    const output = document.getElementById('midiOutSelect');
    const error = document.getElementById('errorDisplay');
    return {
      inputDisabled: input?.disabled ?? null,
      outputDisabled: output?.disabled ?? null,
      inputLabel: input?.options?.[0]?.textContent ?? '',
      outputLabel: output?.options?.[0]?.textContent ?? '',
      errorText: error?.textContent ?? ''
    };
  });
  if (inputState.inputDisabled) {
    expect(inputState.inputLabel).toContain('No input');
    expect(inputState.errorText).toContain('No input device');
  } else {
    await expect(page.locator('#midiInSelect')).toBeEnabled();
  }
  if (inputState.outputDisabled) {
    expect(inputState.outputLabel).toContain('No output');
    expect(inputState.errorText).toContain('No output device');
  } else {
    await expect(page.locator('#midiOutSelect')).toBeEnabled();
  }
});

test('MIDI panels render expected layout and tab content', async ({ page }) => {
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  await page.waitForSelector('#midiEventList details');
  const leftPanel = page.locator('#controlLeft');
  const rightPanel = page.locator('#controlRight');
  await expect(leftPanel).toBeVisible();
  await expect(rightPanel).toBeVisible();

  const bounds = await Promise.all([
    leftPanel.boundingBox(),
    rightPanel.boundingBox()
  ]);
  const leftBounds = bounds[0];
  const rightBounds = bounds[1];
  expect(leftBounds).not.toBeNull();
  expect(rightBounds).not.toBeNull();
  expect(rightBounds.x).toBeGreaterThan(leftBounds.x + 200);
  expect(leftBounds.height).toBeGreaterThan(200);
  expect(rightBounds.height).toBeGreaterThan(200);

  const eventDetailsCount = await page.locator('#midiEventList details').count();
  expect(eventDetailsCount).toBeGreaterThan(0);
  await expect(page.locator('#midiEventList summary .panel-title-text').first()).toContainText('#');
  await page.locator('[data-tab-target="midiTabTriggers"]').click();
  await expect(page.locator('#midiTabTriggers')).toHaveClass(/active/);
  const triggerDetailsCount = await page.locator('#midiTriggerList details').count();
  expect(triggerDetailsCount).toBeGreaterThan(0);
  await page.locator('[data-tab-target="midiTabAdsr"]').click();
  await expect(page.locator('#midiTabAdsr')).toHaveClass(/active/);
  await expect(page.locator('#midiEnvAttack')).toBeVisible();
  await expect(page.locator('#midiEnvRelease')).toBeVisible();
  await page.locator('[data-tab-target="midiTabGlobalFx"]').click();
  await expect(page.locator('#midiTabGlobalFx')).toHaveClass(/active/);
  await expect(page.locator('#midiIntensity')).toBeVisible();
  await expect(page.locator('#midiAccent')).toBeVisible();
});

test('MIDI event and trigger titles render with width', async ({ page }) => {   
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  await page.waitForSelector('#midiEventList details');
  await expect(page.locator('#controlRight')).toBeVisible();
  await page.waitForSelector('#midiTabEvents #midiEventList summary .panel-title-text', { state: 'visible' });
  const eventTitle = page.locator('#midiTabEvents #midiEventList summary .panel-title-text').first();
  await expect(eventTitle).toContainText('#');
  const eventWidth = await eventTitle.evaluate(el => el.getBoundingClientRect().width);
  expect(eventWidth).toBeGreaterThan(1);
  await page.locator('[data-tab-target="midiTabTriggers"]').click();
  await page.waitForSelector('#midiTabTriggers #midiTriggerList summary .panel-title-text', { state: 'visible' });
  const triggerTitle = page.locator('#midiTabTriggers #midiTriggerList summary .panel-title-text').first();
  await expect(triggerTitle).toContainText('#');
  const triggerWidth = await triggerTitle.evaluate(el => el.getBoundingClientRect().width);
  expect(triggerWidth).toBeGreaterThan(1);
});

test('MIDI event list excludes unknown-0B', async ({ page }) => {
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  await page.waitForSelector('#midiEventList details');
  await expect(page.locator('#midiEventList')).not.toContainText('unknown-0B');
});

test('MIDI panels warn when scrolling is required', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  const selectors = ['#controlLeft', '#controlRight'];
  for (const selector of selectors) {
    const metrics = await page.evaluate((sel) => {
      const panel = document.querySelector(sel);
      if (!panel) return null;
      const styles = window.getComputedStyle(panel);
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
      return {
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
        paddingX: paddingLeft + paddingRight
      };
    }, selector);
    if (!metrics) continue;
    expect(metrics.scrollWidth).toBeLessThanOrEqual(
      metrics.clientWidth + metrics.paddingX + 2
    );
    if (metrics.scrollHeight > metrics.clientHeight + 2) {
      testInfo.annotations.push({
        type: 'warning',
        description: `${selector} requires scrolling at default size.`
      });
    }
  }
});

test('Canvas interaction clears focused MIDI inputs', async ({ page }) => {
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  const bpmInput = page.locator('#midiBpmBase');
  await bpmInput.focus();
  await expect(bpmInput).toBeFocused();
  const canvas = page.locator('#gameCanvas');
  await canvas.click({ position: { x: 20, y: 20 }, force: true });
  await expect(bpmInput).not.toBeFocused();
});
