import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await installWebMidiStub(page);
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
  await expect(page.locator('#midiInSelect')).toBeEnabled();
  await expect(page.locator('#midiOutSelect')).toBeEnabled();
});

test('MIDI event list excludes unknown-0B', async ({ page }) => {
  await page.goto('/');
  await page.locator('#midiEnabledToggle').check();
  await page.waitForSelector('#midiEventList details');
  await expect(page.locator('#midiEventList')).not.toContainText('unknown-0B');
});
