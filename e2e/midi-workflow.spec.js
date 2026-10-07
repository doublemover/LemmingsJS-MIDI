import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';
import { waitForHarnessReady } from './helpers/harness.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await installWebMidiStub(page);
  await page.goto('/?e2e=1');
  await waitForHarnessReady(page);
  if (!await page.locator('#midiSequencerWorkspace').isVisible()) await page.locator('#midiWorkspaceToggle').click();
});

test('sound editing is primary and device choices explain their disconnected state', async ({ page }) => {
  await expect(page.locator('#midiSoundsView')).toBeVisible();
  await expect(page.locator('#midiDevicesView')).toBeHidden();
  await expect(page.locator('#midiExpertView')).toBeHidden();
  await expect(page.locator('#midiActiveKeySummary')).toContainText('Key:');
  await page.locator('#midiViewDevices').click();
  await expect(page.locator('#midiInSelect')).toBeDisabled();
  await expect(page.locator('#midiInSelect option')).toHaveText('Connect MIDI to choose a device');
  await expect(page.locator('#midiOutSelect')).toBeDisabled();
  await expect(page.locator('#midiProjectStatus')).not.toContainText('MIDI disabled');
  await page.locator('#midiViewSounds').click();
  await expect(page.locator('#midiSoundTitle')).toBeVisible();
});

test('simple Exit editing changes the effective trigger voice and shows the active key', async ({ page }) => {
  await page.locator('#midiViewProject').click();
  await page.locator('#midiGamePresetSelect').selectOption('game-minor');
  await page.locator('#midiGamePresetApply').click();
  await page.locator('#midiViewSounds').click();
  await expect(page.locator('#midiActiveKeySummary')).toContainText('A Minor');
  await page.locator('#midiGameEventList').getByRole('option', { name: /^Exit/ }).click();
  await expect(page.locator('#midiSoundTitle')).toHaveText('Exit sound');
  await page.locator('#midiSoundBehavior').selectOption('note');
  await page.locator('#midiSoundPitch').fill('76');
  await page.locator('#midiSoundPitch').press('Tab');
  await expect(page.locator('#midiSoundPitchName')).toHaveText('E5 (76)');
  expect(await page.evaluate(() => window.__E2E__.midiGetRuntimeConfig().triggers[1].note)).toBe(76);
});

test('local game listening remains independent of WebMIDI permission and stops cleanly', async ({ page }) => {
  expect(await page.evaluate(() => window.WebMidi.enabled)).toBe(false);
  await page.locator('#midiLocalListenButton').click();
  await expect(page.locator('#midiOutputSummary')).toContainText('Listening to game locally · MIDI off');
  expect(await page.evaluate(() => window.WebMidi.enabled)).toBe(false);
  expect(await page.evaluate(() => window.__E2E__.midiGetProject().enabled)).toBe(false);
  await page.locator('#midiLocalListenButton').click();
  await expect(page.locator('#midiOutputSummary')).toHaveText('Local sound off · MIDI off');
  await page.locator('#midiWorkspaceClose').click();
  await expect(page.locator('#midiWorkspaceToggle')).toBeFocused();
});
