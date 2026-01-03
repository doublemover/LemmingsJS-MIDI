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

test('MIDI event list excludes unknown-0B', async ({ page }) => {
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  await page.waitForSelector('#midiEventList details');
  await expect(page.locator('#midiEventList')).not.toContainText('unknown-0B');
});
